import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { MASTER_ADMIN_EMAIL, sqlite } from './db.ts';
import crypto from 'node:crypto';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAdminAuth();
const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash('sha256').update(firebaseConfig.projectId + ':askara-session-secret').digest('hex');

export function isDateExpired(dateStr?: string | null): boolean {
  const clean = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return today > clean;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  roleId: 'super_admin' | 'tenant_admin' | 'teacher';
  fullName: string;
  email: string;
  tenantName: string;
  tenantStatus: string;
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
}

export function signSessionToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      roleId: user.roleId,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function loadUserRecordWithReason(userId: string): { user: AuthUser | null; error?: string } {
  const row = sqlite
    .prepare(
      `SELECT u.id, u.tenant_id, u.role_id, u.full_name, u.email, u.status AS user_status, u.is_active AS user_active,
              u.access_expires_at,
              t.name AS tenant_name, t.status AS tenant_status, t.is_active AS tenant_active,
              s.valid_until AS sub_valid_until
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       WHERE u.id = ?`
    )
    .get(userId) as any;

  if (!row) return { user: null, error: 'Akun tidak ditemukan.' };
  if (!row.user_active || row.user_status !== 'active') {
    return { user: null, error: 'Akun Anda sedang dinonaktifkan atau menunggu persetujuan.' };
  }

  if (row.role_id === 'super_admin') {
    if (String(row.email || '').toLowerCase() !== MASTER_ADMIN_EMAIL) {
      return { user: null, error: 'Akses Master Admin hanya diizinkan untuk akun pengendali resmi.' };
    }
  } else {
    if (row.tenant_status === 'pending') {
      return { user: null, error: `Pendaftaran Anda masih menunggu persetujuan Master Admin (${MASTER_ADMIN_EMAIL}).` };
    }
    if (row.tenant_status !== 'approved' || !row.tenant_active) {
      return { user: null, error: `Akses lembaga Anda sedang dinonaktifkan atau ditolak oleh Master Admin (${MASTER_ADMIN_EMAIL}).` };
    }
    if (isDateExpired(row.sub_valid_until)) {
      return {
        user: null,
        error: `Batas waktu penggunaan aplikasi lembaga Anda telah berakhir pada ${row.sub_valid_until}. Hubungi Master Admin (${MASTER_ADMIN_EMAIL}).`,
      };
    }
    if (isDateExpired(row.access_expires_at)) {
      return {
        user: null,
        error: `Batas waktu penggunaan akun Anda telah berakhir pada ${row.access_expires_at}. Hubungi Master Admin (${MASTER_ADMIN_EMAIL}).`,
      };
    }
  }

  return {
    user: {
      id: row.id,
      tenantId: row.tenant_id,
      roleId: row.role_id,
      fullName: row.full_name,
      email: row.email,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
    },
  };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sesi tidak ditemukan. Silakan masuk kembali.' });
  }

  const token = header.slice('Bearer '.length).trim();

  // 1. Try local signed session JWT first
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    const { user, error } = loadUserRecordWithReason(decoded.sub);
    if (!user) {
      return res.status(403).json({ error: error || 'Akun atau lembaga belum aktif / menunggu persetujuan admin.' });
    }
    req.authUser = user;
    return next();
  } catch {
    // Fall through to Firebase ID Token verification
  }

  // 2. Verify Firebase ID Token (Google Sign-In)
  try {
    const decodedFirebase = await adminAuth.verifyIdToken(token);
    const email = (decodedFirebase.email || '').toLowerCase();
    if (!email) {
      return res.status(401).json({ error: 'Token Google tidak memiliki alamat email yang valid.' });
    }

    const row = sqlite.prepare('SELECT id FROM users WHERE lower(email) = ? OR firebase_uid = ?').get(email, decodedFirebase.uid) as any;
    if (!row) {
      return res.status(403).json({
        error: 'Akun Google belum terdaftar pada lembaga manapun. Silakan daftarkan sekolah terlebih dahulu (menunggu persetujuan Master Admin).',
        needsRegistration: true,
        email,
        fullName: decodedFirebase.name || email.split('@')[0],
      });
    }

    const { user, error } = loadUserRecordWithReason(row.id);
    if (!user) {
      return res.status(403).json({ error: error || `Lembaga Anda masih menunggu persetujuan Master Admin (${MASTER_ADMIN_EMAIL}).` });
    }
    req.authUser = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Token autentikasi tidak valid atau telah kedaluwarsa.' });
  }
}

export function requireRole(...roles: Array<'super_admin' | 'tenant_admin' | 'teacher'>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.authUser.roleId)) {
      return res.status(403).json({ error: 'Akses ditolak. Peran Anda tidak memiliki izin untuk tindakan ini.' });
    }
    next();
  };
}

export function requireMasterAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.authUser.roleId !== 'super_admin' || req.authUser.email.toLowerCase() !== MASTER_ADMIN_EMAIL) {
    return res.status(403).json({ error: `Akses ditolak. Konsol ini khusus dikendalikan oleh Master Admin (${MASTER_ADMIN_EMAIL}).` });
  }
  next();
}

export function assertTenantOwnership(req: AuthRequest, targetTenantId: string): boolean {
  if (!req.authUser) return false;
  if (req.authUser.roleId === 'super_admin' && req.authUser.email.toLowerCase() === MASTER_ADMIN_EMAIL) return true;
  return req.authUser.tenantId === targetTenantId;
}

export function logActivity(
  tenantId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: string
) {
  try {
    sqlite
      .prepare(
        `INSERT INTO activity_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), tenantId, userId, action, entityType, entityId, details);
  } catch (err) {
    console.error('Activity log failed:', err);
  }
}
