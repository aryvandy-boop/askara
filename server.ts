import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { sqlite, MASTER_ADMIN_EMAIL, DEFAULT_ASKARA_FORMATTING, DEFAULT_ASKARA_PRESETS, DEFAULT_APP_PROFILE_LOGO, DEFAULT_PEMKAB_LOGO_SVG } from './server/db.ts';
import { AuthRequest, assertTenantOwnership, isDateExpired, logActivity, requireAuth, requireMasterAdmin, requireRole, signSessionToken } from './server/auth.ts';
import { parseUploadedDocument } from './server/parser.ts';
import {
  analyzeReferenceWithAI,
  describeExtractedBookImagesWithAI,
  detectAmbiguousQuestionIssues,
  extractCpTpWithAI,
  findAuthenticReferenceImageForQuestion,
  generateBlueprintWithAI,
  generateEducationalSvgIllustration,
  generateQuestionsBatchWithAI,
  repairQuestionWithAI,
  retrieveRagChunks,
  runQualityControlWithAI,
} from './server/ai.ts';
import { generateDocxBuffer, generateExcelBuffer, generatePdfBuffer } from './server/exporter.ts';

if (!getApps().length) {
  initializeApp({ projectId: firebaseConfig.projectId });
}
const adminAuth = getAdminAuth();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadsLogosDir = path.resolve(process.cwd(), 'uploads', 'logos');
if (!fs.existsSync(uploadsLogosDir)) fs.mkdirSync(uploadsLogosDir, { recursive: true });
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.use('/assets', express.static(path.resolve(process.cwd(), 'public', 'assets')));

function stripIpPort(raw: string): string {
  const trimmed = raw.trim().replace(/^"|"$/g, '');
  if (trimmed.startsWith('[')) {
    const endBracket = trimmed.indexOf(']');
    if (endBracket > 0) return trimmed.slice(1, endBracket);
  }
  // IPv4 with port (e.g. 203.0.113.5:54321) — has single colon
  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount === 1) {
    return trimmed.replace(/:\d+$/, '');
  }
  return trimmed;
}

function getClientIpKey(req: express.Request): string {
  const fwd = req.headers.forwarded;
  const forwardedHeader = Array.isArray(fwd) ? fwd[0] : fwd;
  if (forwardedHeader) {
    const match = forwardedHeader.match(/for=("[^"]+"|[^;,\s]+)/i);
    if (match?.[1]) {
      const cleaned = stripIpPort(match[1]);
      if (cleaned && cleaned !== 'unknown') {
        return ipKeyGenerator(cleaned);
      }
    }
  }
  const rawIp = stripIpPort(req.ip || req.socket.remoteAddress || '127.0.0.1');
  return ipKeyGenerator(rawIp || '127.0.0.1');
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIpKey,
  validate: { forwardedHeader: false },
  message: { error: 'Terlalu banyak permintaan autentikasi. Silakan tunggu beberapa menit.' },
});

const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIpKey,
  validate: { forwardedHeader: false },
  message: { error: 'Batas frekuensi permintaan AI sementara tercapai. Tunggu sebentar.' },
});

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function createDefaultTenantSvgLogo(schoolName: string): string {
  const initials = schoolName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'SK';
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="22" fill="#1e3a8a"/><circle cx="60" cy="60" r="42" fill="none" stroke="#facc15" stroke-width="4"/><text x="60" y="70" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="34" fill="#ffffff">${initials}</text></svg>`
  )}`;
}

function buildTenantBundle(userId: string) {
  const user = sqlite
    .prepare(
      `SELECT u.id, u.tenant_id, u.role_id, u.full_name, u.email, u.status, u.email_verified, u.access_expires_at, u.created_at,
              t.name AS tenant_name, t.slug AS tenant_slug, t.institution_type, t.regency, t.province, t.status AS tenant_status, t.is_active AS tenant_active
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = ?`
    )
    .get(userId) as any;

  if (!user) return null;

  const branding = sqlite.prepare('SELECT * FROM tenant_branding WHERE tenant_id = ?').get(user.tenant_id) as any;
  const schoolProfile = sqlite.prepare('SELECT * FROM school_profiles WHERE tenant_id = ?').get(user.tenant_id) as any;
  const settingsRow = sqlite.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(user.tenant_id) as any;
  const subscription = sqlite.prepare('SELECT * FROM subscriptions WHERE tenant_id = ?').get(user.tenant_id) as any;
  const announcementRow = sqlite.prepare('SELECT value FROM system_settings WHERE key = ?').get('system_announcement') as any;
  const eduRefsRow = sqlite.prepare('SELECT value FROM system_settings WHERE key = ?').get('education_references') as any;

  return {
    user: {
      id: user.id,
      tenantId: user.tenant_id,
      roleId: user.role_id,
      fullName: user.full_name,
      email: user.email,
      status: user.status,
      emailVerified: Boolean(user.email_verified),
      accessExpiresAt: user.access_expires_at || '',
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      institutionType: user.institution_type,
      regency: user.regency,
      province: user.province,
      tenantStatus: user.tenant_status,
    },
    branding,
    schoolProfile,
    settings: settingsRow
      ? {
          ...settingsRow,
          questionPresets: JSON.parse(settingsRow.question_presets_json || '{}'),
          formatting: JSON.parse(settingsRow.formatting_json || '{}'),
        }
      : null,
    subscription,
    announcement: announcementRow?.value || '',
    educationReferences: eduRefsRow ? JSON.parse(eduRefsRow.value) : {},
  };
}

function recalculateCognitiveAnalysis(tenantId: string, projectId: string) {
  const qs = sqlite
    .prepare('SELECT cognitive_level, cognitive_tier FROM assessment_questions WHERE tenant_id = ? AND project_id = ?')
    .all(tenantId, projectId) as Array<{ cognitive_level: string; cognitive_tier: string }>;

  let c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0, c6 = 0;
  let lots = 0, mots = 0, hots = 0;

  for (const q of qs) {
    const lvl = (q.cognitive_level || 'C2').toUpperCase();
    if (lvl.startsWith('C1')) c1++;
    else if (lvl.startsWith('C2')) c2++;
    else if (lvl.startsWith('C3')) c3++;
    else if (lvl.startsWith('C4')) c4++;
    else if (lvl.startsWith('C5')) c5++;
    else if (lvl.startsWith('C6')) c6++;

    const tier = (q.cognitive_tier || '').toUpperCase();
    if (tier === 'LOTS' || lvl.startsWith('C1') || lvl.startsWith('C2')) {
      if (tier !== 'MOTS' && tier !== 'HOTS') lots++;
      else if (tier === 'MOTS') mots++;
      else hots++;
    } else if (tier === 'HOTS' || lvl.startsWith('C4') || lvl.startsWith('C5') || lvl.startsWith('C6')) {
      hots++;
    } else {
      mots++;
    }
  }

  sqlite
    .prepare(
      `INSERT INTO cognitive_analysis (id, tenant_id, project_id, c1_count, c2_count, c3_count, c4_count, c5_count, c6_count, lots_count, mots_count, hots_count, summary_notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET
         c1_count = excluded.c1_count,
         c2_count = excluded.c2_count,
         c3_count = excluded.c3_count,
         c4_count = excluded.c4_count,
         c5_count = excluded.c5_count,
         c6_count = excluded.c6_count,
         lots_count = excluded.lots_count,
         mots_count = excluded.mots_count,
         hots_count = excluded.hots_count,
         summary_notes = excluded.summary_notes,
         updated_at = datetime('now')`
    )
    .run(
      crypto.randomUUID(),
      tenantId,
      projectId,
      c1, c2, c3, c4, c5, c6,
      lots, mots, hots,
      `Total ${qs.length} soal: LOTS ${lots}, MOTS ${mots}, HOTS ${hots}.`
    );
}

// ============================================================================
// AUTH ROUTES
// ============================================================================
app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan kata sandi wajib diisi.' });
    }
    const row = sqlite
      .prepare(
        `SELECT u.*, t.name AS tenant_name, t.status AS tenant_status, t.is_active AS tenant_active, s.valid_until AS sub_valid_until
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN subscriptions s ON s.tenant_id = t.id
         WHERE lower(u.email) = ?`
      )
      .get(String(email).trim().toLowerCase()) as any;

    if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
      return res.status(401).json({ error: 'Email atau kata sandi tidak sesuai.' });
    }
    if (!row.is_active || row.status !== 'active') {
      return res.status(403).json({ error: 'Akun Anda sedang dinonaktifkan atau menunggu persetujuan admin.' });
    }
    if (row.role_id === 'super_admin') {
      if (String(row.email || '').toLowerCase() !== MASTER_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Akses Master Admin tidak valid.' });
      }
    } else {
      if (row.tenant_status === 'pending') {
        return res.status(403).json({ error: `Pendaftaran lembaga Anda masih menunggu persetujuan Master Admin (${MASTER_ADMIN_EMAIL}).`, pendingApproval: true });
      }
      if (row.tenant_status === 'rejected' || row.tenant_status === 'suspended' || !row.tenant_active) {
        return res.status(403).json({ error: `Lembaga Anda saat ini sedang dinonaktifkan atau ditolak oleh Master Admin (${MASTER_ADMIN_EMAIL}).` });
      }
      if (isDateExpired(row.sub_valid_until)) {
        return res.status(403).json({ error: `Batas waktu penggunaan aplikasi lembaga Anda telah berakhir pada ${row.sub_valid_until}. Hubungi Master Admin (${MASTER_ADMIN_EMAIL}) untuk perpanjangan.` });
      }
      if (isDateExpired(row.access_expires_at)) {
        return res.status(403).json({ error: `Batas waktu penggunaan akun Anda telah berakhir pada ${row.access_expires_at}. Hubungi Master Admin (${MASTER_ADMIN_EMAIL}) untuk perpanjangan.` });
      }
    }

    sqlite.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);
    const token = signSessionToken({
      id: row.id,
      tenantId: row.tenant_id,
      roleId: row.role_id,
      fullName: row.full_name,
      email: row.email,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
    });
    logActivity(row.tenant_id, row.id, 'LOGIN', 'users', row.id, `${row.full_name} masuk ke sistem`);

    res.json({ token, ...buildTenantBundle(row.id) });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal memproses login.' });
  }
});

app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Token Google diperlukan.' });
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = (decoded.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email Google tidak ditemukan.' });

    const row = sqlite
      .prepare(
        `SELECT u.*, t.name AS tenant_name, t.status AS tenant_status, t.is_active AS tenant_active, s.valid_until AS sub_valid_until
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN subscriptions s ON s.tenant_id = t.id
         WHERE lower(u.email) = ? OR u.firebase_uid = ?`
      )
      .get(email, decoded.uid) as any;

    if (!row) {
      return res.status(404).json({
        needsRegistration: true,
        email,
        fullName: decoded.name || email.split('@')[0],
        error: `Akun Google (${email}) belum terdaftar. Silakan isi formulir Daftar Lembaga dan tunggu persetujuan Master Admin (${MASTER_ADMIN_EMAIL}).`,
      });
    }

    if (!row.is_active || row.status !== 'active') {
      return res.status(403).json({ error: 'Akun Anda sedang dinonaktifkan oleh admin.' });
    }

    if (row.role_id === 'super_admin') {
      if (String(row.email || '').toLowerCase() !== MASTER_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Akses Master Admin tidak valid.' });
      }
    } else {
      if (row.tenant_status === 'pending') {
        return res.status(403).json({ error: `Pendaftaran Anda masih menunggu persetujuan Master Admin (${MASTER_ADMIN_EMAIL}).`, pendingApproval: true });
      }
      if (row.tenant_status !== 'approved' || !row.tenant_active) {
        return res.status(403).json({ error: `Lembaga Anda ditolak atau sedang dinonaktifkan oleh Master Admin (${MASTER_ADMIN_EMAIL}).` });
      }
      if (isDateExpired(row.sub_valid_until)) {
        return res.status(403).json({ error: `Batas waktu penggunaan aplikasi lembaga Anda telah berakhir pada ${row.sub_valid_until}. Hubungi Master Admin (${MASTER_ADMIN_EMAIL}).` });
      }
      if (isDateExpired(row.access_expires_at)) {
        return res.status(403).json({ error: `Batas waktu penggunaan akun Anda telah berakhir pada ${row.access_expires_at}. Hubungi Master Admin (${MASTER_ADMIN_EMAIL}).` });
      }
    }

    sqlite.prepare(`UPDATE users SET firebase_uid = ?, last_login_at = datetime('now') WHERE id = ?`).run(decoded.uid, row.id);
    const token = signSessionToken({
      id: row.id,
      tenantId: row.tenant_id,
      roleId: row.role_id,
      fullName: row.full_name,
      email: row.email,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
    });
    logActivity(row.tenant_id, row.id, 'GOOGLE_LOGIN', 'users', row.id, `${row.full_name} masuk melalui Google`);
    res.json({ token, ...buildTenantBundle(row.id) });
  } catch (error: any) {
    res.status(401).json({ error: 'Verifikasi Google Sign-In gagal: ' + (error.message || '') });
  }
});

app.post('/api/auth/register', authLimiter, (req, res) => {
  try {
    const { fullName, email, password, schoolName, institutionType, regency, province, adminName } = req.body;
    if (!fullName || !email || !password || !schoolName) {
      return res.status(400).json({ error: 'Nama lengkap, email, kata sandi, dan nama sekolah/lembaga wajib diisi.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const existing = sqlite.prepare('SELECT id FROM users WHERE lower(email) = ?').get(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'Email sudah terdaftar di sistem. Silakan masuk atau gunakan email lain.' });
    }

    const tenantId = 'tenant-' + crypto.randomUUID().slice(0, 8);
    const slugBase = String(schoolName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    const slug = `${slugBase}-${tenantId.slice(-4)}`;
    const userId = 'user-' + crypto.randomUUID().slice(0, 8);
    const logoSvg = createDefaultTenantSvgLogo(schoolName);

    sqlite
      .prepare(
        `INSERT INTO tenants (id, name, slug, institution_type, regency, province, admin_name, admin_email, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`
      )
      .run(
        tenantId,
        schoolName.trim(),
        slug,
        institutionType || 'Sekolah Mandiri',
        regency || '',
        province || '',
        adminName || fullName.trim(),
        cleanEmail
      );

    sqlite
      .prepare(
        `INSERT INTO tenant_branding (id, tenant_id, app_name, slogan, logo_url, primary_color, navy_color, accent_color)
         VALUES (?, ?, ?, ?, ?, '#1d4ed8', '#0a192f', '#d4af37')`
      )
      .run(crypto.randomUUID(), tenantId, schoolName.trim(), 'Berkarya dengan Inovasi, Berkualitas dalam Asesmen.', DEFAULT_APP_PROFILE_LOGO);

    const resolvedRegencyUpper = (regency || '').trim().toUpperCase();
    const defaultPemkabName = resolvedRegencyUpper
      ? resolvedRegencyUpper.startsWith('PEMERINTAH')
        ? resolvedRegencyUpper
        : `PEMERINTAH ${resolvedRegencyUpper}`
      : 'PEMERINTAH KABUPATEN';
    const defaultDinasName = 'DINAS PENDIDIKAN DAN KEBUDAYAAN';

    sqlite
      .prepare(
        `INSERT INTO school_profiles (id, tenant_id, pemkab_name, dinas_name, school_name, gugus_name, address, phone, email, headmaster_name, pemkab_logo_url, school_logo_url, regency, province)
         VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        tenantId,
        defaultPemkabName,
        defaultDinasName,
        schoolName.trim().toUpperCase(),
        institutionType === 'Gugus Sekolah' ? schoolName.trim().toUpperCase() : '',
        cleanEmail,
        adminName || fullName.trim(),
        DEFAULT_PEMKAB_LOGO_SVG,
        logoSvg,
        regency || '',
        province || ''
      );

    sqlite
      .prepare(
        `INSERT INTO tenant_settings (id, tenant_id, academic_year, semester, curriculum, question_presets_json, formatting_json)
         VALUES (?, ?, '2026/2027', '1', 'Kurikulum Merdeka', ?, ?)`
      )
      .run(crypto.randomUUID(), tenantId, JSON.stringify(DEFAULT_ASKARA_PRESETS), JSON.stringify(DEFAULT_ASKARA_FORMATTING));

    sqlite
      .prepare(
        `INSERT INTO document_templates (id, tenant_id, name, logo_url, right_logo_url, logo_position, logo_size, pemkab_line, line_1, line_2, line_3, line_4, address_line, contact_line, border_style, font_family, is_default)
         VALUES (?, ?, ?, ?, ?, 'dual', 96, ?, ?, '[JENIS ASESMEN]', ?, 'TAHUN PELAJARAN [TAHUN PELAJARAN]', '', ?, 'thick', 'Calibri', 1)`
      )
      .run(
        crypto.randomUUID(),
        tenantId,
        `Kop Resmi ${schoolName.trim()}`,
        DEFAULT_PEMKAB_LOGO_SVG,
        logoSvg,
        defaultPemkabName,
        defaultDinasName,
        schoolName.trim().toUpperCase(),
        cleanEmail ? `Email: ${cleanEmail}` : ''
      );

    sqlite
      .prepare(
        `INSERT INTO subscriptions (id, tenant_id, plan_name, monthly_ai_limit, max_users, max_references, status, valid_until)
         VALUES (?, ?, 'Standar Lembaga', 300, 25, 100, 'active', '')`
      )
      .run(crypto.randomUUID(), tenantId);

    sqlite
      .prepare(
        `INSERT INTO users (id, tenant_id, role_id, full_name, email, password_hash, status, email_verified, is_active)
         VALUES (?, ?, 'tenant_admin', ?, ?, ?, 'active', 1, 1)`
      )
      .run(userId, tenantId, fullName.trim(), cleanEmail, bcrypt.hashSync(String(password), 10));

    logActivity(tenantId, userId, 'REGISTER_TENANT', 'tenants', tenantId, `Pendaftaran lembaga baru: ${schoolName.trim()} (${institutionType || 'Sekolah Mandiri'})`);

    res.status(201).json({
      message: `Pendaftaran berhasil! Akun lembaga Anda telah dicatat dan menunggu persetujuan Master Admin (${MASTER_ADMIN_EMAIL}) sebelum dapat masuk.`,
      tenantId,
      status: 'pending',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal mendaftarkan lembaga.' });
  }
});

app.post('/api/auth/forgot-password', authLimiter, (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Masukkan alamat email terdaftar.' });
  const user = sqlite.prepare('SELECT id, tenant_id, email FROM users WHERE lower(email) = ?').get(String(email).trim().toLowerCase()) as any;
  if (!user) {
    return res.status(404).json({ error: 'Email tidak ditemukan dalam database pengguna.' });
  }
  const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  sqlite
    .prepare(`INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
    .run(crypto.randomUUID(), user.id, resetToken, expiresAt);
  logActivity(user.tenant_id, user.id, 'REQUEST_PASSWORD_RESET', 'users', user.id, 'Permintaan kode atur ulang kata sandi');

  res.json({
    message: 'Kode verifikasi reset kata sandi telah dibuat (berlaku 30 menit).',
    verificationCode: resetToken,
  });
});

app.post('/api/auth/reset-password', authLimiter, (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Email, kode verifikasi, dan kata sandi baru (minimal 6 karakter) wajib diisi.' });
  }
  const user = sqlite.prepare('SELECT id, tenant_id FROM users WHERE lower(email) = ?').get(String(email).trim().toLowerCase()) as any;
  if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

  const tokenRow = sqlite
    .prepare(`SELECT * FROM password_reset_tokens WHERE user_id = ? AND token = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`)
    .get(user.id, String(code).trim().toUpperCase()) as any;
  if (!tokenRow || new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Kode verifikasi tidak valid atau sudah kedaluwarsa.' });
  }

  sqlite.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), user.id);
  sqlite.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(tokenRow.id);
  logActivity(user.tenant_id, user.id, 'PASSWORD_RESET', 'users', user.id, 'Kata sandi berhasil diperbarui');

  res.json({ message: 'Kata sandi berhasil diperbarui. Silakan masuk menggunakan kata sandi baru.' });
});

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
  const bundle = buildTenantBundle(req.authUser!.id);
  if (!bundle) return res.status(404).json({ error: 'Profil tidak ditemukan.' });
  res.json(bundle);
});

app.patch('/api/auth/profile', requireAuth, (req: AuthRequest, res) => {
  const { fullName, currentPassword, newPassword } = req.body;
  const uid = req.authUser!.id;
  if (fullName) {
    sqlite.prepare('UPDATE users SET full_name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(String(fullName).trim(), uid);
  }
  if (newPassword) {
    const userRow = sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid) as any;
    if (!currentPassword || !bcrypt.compareSync(String(currentPassword), userRow.password_hash)) {
      return res.status(400).json({ error: 'Kata sandi saat ini tidak sesuai.' });
    }
    sqlite.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), uid);
  }
  res.json(buildTenantBundle(uid));
});

// ============================================================================
// DASHBOARD ROUTE (REAL COUNTERS)
// ============================================================================
app.get('/api/dashboard/stats', requireAuth, (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;

  const documentsCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM generated_documents WHERE tenant_id = ?').get(tenantId) as any).c;
  const questionsCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM assessment_questions WHERE tenant_id = ?').get(tenantId) as any).c;
  const bankQuestionsCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM question_banks WHERE tenant_id = ?').get(tenantId) as any).c;
  const referencesCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM reference_documents WHERE tenant_id = ?').get(tenantId) as any).c;
  const assessmentsCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM assessment_projects WHERE tenant_id = ?').get(tenantId) as any).c;
  const cpCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM learning_outcomes WHERE tenant_id = ?').get(tenantId) as any).c;
  const tpCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM learning_objectives WHERE tenant_id = ?').get(tenantId) as any).c;

  const qCognitive = sqlite
    .prepare('SELECT cognitive_level, cognitive_tier FROM assessment_questions WHERE tenant_id = ?')
    .all(tenantId) as Array<{ cognitive_level: string; cognitive_tier: string }>;

  const bloom = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0 };
  const tiers = { LOTS: 0, MOTS: 0, HOTS: 0 };
  for (const q of qCognitive) {
    const lvl = (q.cognitive_level || '').toUpperCase().slice(0, 2) as keyof typeof bloom;
    if (lvl in bloom) bloom[lvl]++;
    const tier = (q.cognitive_tier || 'MOTS').toUpperCase() as keyof typeof tiers;
    if (tier in tiers) tiers[tier]++;
  }

  const recentActivity = sqlite
    .prepare(
      `SELECT a.*, u.full_name AS actor_name
       FROM activity_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = ?
       ORDER BY a.created_at DESC
       LIMIT 12`
    )
    .all(tenantId);

  const recentAssessments = sqlite
    .prepare(
      `SELECT id, title, subject, grade_level, assessment_type, status, updated_at,
              (SELECT COUNT(*) FROM assessment_questions q WHERE q.project_id = assessment_projects.id) AS total_questions
       FROM assessment_projects
       WHERE tenant_id = ?
       ORDER BY updated_at DESC
       LIMIT 5`
    )
    .all(tenantId);

  const aiUsedMonth = (
    sqlite
      .prepare(`SELECT COUNT(*) AS c FROM ai_usage_logs WHERE tenant_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`)
      .get(tenantId) as any
  ).c;

  res.json({
    counts: {
      documents: documentsCount,
      questions: questionsCount,
      bankQuestions: bankQuestionsCount,
      references: referencesCount,
      assessments: assessmentsCount,
      cp: cpCount,
      tp: tpCount,
      aiUsedMonth,
    },
    bloom,
    tiers,
    recentActivity,
    recentAssessments,
  });
});

// ============================================================================
// REFERENCES & BANK MATERI (RAG)
// ============================================================================
app.get('/api/references', requireAuth, (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;
  const docs = sqlite
    .prepare(
      `SELECT rd.id, rd.tenant_id, rd.user_id, rd.title, rd.file_name, rd.file_type, rd.file_size,
              rd.subject, rd.grade_level, rd.semester, rd.page_count,
              rd.chapters_json, rd.concepts_json, rd.competencies_json, rd.images_json, rd.summary, rd.created_at,
              u.full_name AS uploader_name,
              (SELECT COUNT(*) FROM reference_chunks rc WHERE rc.document_id = rd.id) AS chunk_count
       FROM reference_documents rd
       LEFT JOIN users u ON u.id = rd.user_id
       WHERE rd.tenant_id = ?
       ORDER BY rd.created_at DESC`
    )
    .all(tenantId) as any[];

  res.json(
    docs.map((d) => ({
      ...d,
      chapters: JSON.parse(d.chapters_json || '[]'),
      concepts: JSON.parse(d.concepts_json || '[]'),
      competencies: JSON.parse(d.competencies_json || '[]'),
      images: JSON.parse(d.images_json || '[]'),
    }))
  );
});

app.get('/api/references/:id', requireAuth, (req: AuthRequest, res) => {
  const doc = sqlite.prepare('SELECT * FROM reference_documents WHERE id = ?').get(req.params.id) as any;
  if (!doc) return res.status(404).json({ error: 'Dokumen referensi tidak ditemukan.' });
  if (!assertTenantOwnership(req, doc.tenant_id)) return res.status(403).json({ error: 'Akses lintas lembaga ditolak.' });

  const chunks = sqlite
    .prepare('SELECT * FROM reference_chunks WHERE document_id = ? AND tenant_id = ? ORDER BY chunk_index ASC')
    .all(doc.id, doc.tenant_id);

  res.json({
    ...doc,
    chapters: JSON.parse(doc.chapters_json || '[]'),
    concepts: JSON.parse(doc.concepts_json || '[]'),
    competencies: JSON.parse(doc.competencies_json || '[]'),
    images: JSON.parse(doc.images_json || '[]'),
    chunks,
  });
});

app.post('/api/references/upload', requireAuth, aiLimiter, uploadMemory.single('file'), async (req: AuthRequest, res) => {
  try {
    const file = req.file;
    const { title, subject, gradeLevel, semester, rawText } = req.body;
    const tenantId = req.authUser!.tenantId;
    const userId = req.authUser!.id;

    let parsed;
    let fileName = 'materi-input.txt';
    let fileSize = 0;

    if (file) {
      fileName = file.originalname;
      fileSize = file.size;
      parsed = await parseUploadedDocument(file.buffer, file.originalname);
    } else if (rawText && String(rawText).trim().length >= 30) {
      const buf = Buffer.from(String(rawText), 'utf8');
      fileSize = buf.length;
      parsed = await parseUploadedDocument(buf, `${title || 'materi'}.txt`);
    } else {
      return res.status(400).json({ error: 'Unggah file (PDF, DOCX, DOC, TXT, PPTX) atau masukkan teks materi minimal 30 karakter.' });
    }

    const docTitle = (title || fileName.replace(/\.[^.]+$/, '')).trim();
    let aiMeta = {
      chapters: parsed.chapters,
      concepts: [] as string[],
      competencies: [] as string[],
      summary: parsed.text.slice(0, 400) + '...',
    };

    const analyzePromise = (async () => {
      try {
        return await Promise.race([
          analyzeReferenceWithAI(tenantId, userId, docTitle, subject || 'Umum', gradeLevel || 'Umum', parsed.text),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
        ]);
      } catch (aiErr) {
        console.warn('AI summary fallback used:', aiErr);
        return null;
      }
    })();

    const visionPromise = (async (): Promise<Map<number, { keep: boolean; caption: string }>> => {
      if (!parsed.extractedImages?.length) return new Map();
      try {
        return await Promise.race([
          describeExtractedBookImagesWithAI({
            tenantId,
            userId,
            docTitle,
            subject: subject || 'Umum',
            images: parsed.extractedImages.map((img, idx) => ({
              index: idx,
              buffer: img.buffer,
              ext: img.ext,
              pageNumber: img.pageNumber,
              pageContext: img.pageContext,
              name: img.name,
            })),
          }),
          new Promise<Map<number, { keep: boolean; caption: string }>>((resolve) =>
            setTimeout(() => resolve(new Map()), 15000)
          ),
        ]);
      } catch {
        return new Map();
      }
    })();

    const [analyzed, visionCaptions] = await Promise.all([analyzePromise, visionPromise]);
    if (analyzed) {
      aiMeta = {
        chapters: analyzed.chapters?.length ? analyzed.chapters : parsed.chapters,
        concepts: analyzed.concepts || [],
        competencies: analyzed.competencies || [],
        summary: analyzed.summary || aiMeta.summary,
      };
    }

    const docId = 'ref-' + crypto.randomUUID().slice(0, 10);
    const savedImages: Array<{ url: string; pageNumber: number; label: string; width: number; height: number }> = [];
    if (parsed.extractedImages?.length) {
      const mediaDir = path.resolve(process.cwd(), 'uploads', 'references-media', docId);
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

      parsed.extractedImages.forEach((img, idx) => {
        const meta = visionCaptions.get(idx);
        if (meta && meta.keep === false) return;
        const fname = `img-${idx + 1}.${img.ext}`;
        fs.writeFileSync(path.join(mediaDir, fname), img.buffer);
        const contextLabel = meta?.caption
          ? `${meta.caption} (Buku Hal. ${img.pageNumber})`
          : img.pageContext
            ? `${img.pageContext.slice(0, 90)} (Hal. ${img.pageNumber})`
            : `${docTitle} — Hal. ${img.pageNumber} (${img.name})`;
        savedImages.push({
          url: `/uploads/references-media/${docId}/${fname}`,
          pageNumber: img.pageNumber,
          label: contextLabel,
          width: img.width,
          height: img.height,
        });
      });
    }

    sqlite
      .prepare(
        `INSERT INTO reference_documents (id, tenant_id, user_id, title, file_name, file_type, file_size, subject, grade_level, semester, page_count, extracted_text, chapters_json, concepts_json, competencies_json, images_json, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        docId,
        tenantId,
        userId,
        docTitle,
        fileName,
        parsed.fileType,
        fileSize,
        subject || 'Umum',
        gradeLevel || 'Semua Kelas',
        semester || 'Semua',
        parsed.pageCount,
        parsed.text,
        JSON.stringify(aiMeta.chapters),
        JSON.stringify(aiMeta.concepts),
        JSON.stringify(aiMeta.competencies),
        JSON.stringify(savedImages),
        aiMeta.summary
      );

    const insertChunk = sqlite.prepare(
      `INSERT INTO reference_chunks (id, tenant_id, document_id, chunk_index, chapter_title, page_number, content, keywords)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    sqlite.exec('BEGIN');
    try {
      for (const ch of parsed.chunks) {
        insertChunk.run(crypto.randomUUID(), tenantId, docId, ch.chunkIndex, ch.chapterTitle, ch.pageNumber, ch.content, ch.keywords);
      }
      sqlite.exec('COMMIT');
    } catch (txErr) {
      try { sqlite.exec('ROLLBACK'); } catch {}
      throw txErr;
    }

    logActivity(tenantId, userId, 'UPLOAD_REFERENCE', 'reference_documents', docId, `Mengunggah referensi "${docTitle}" (${parsed.chunks.length} potongan RAG, ${savedImages.length} gambar)`);
    res.status(201).json({
      id: docId,
      title: docTitle,
      fileName,
      fileType: parsed.fileType,
      pageCount: parsed.pageCount,
      chunkCount: parsed.chunks.length,
      imageCount: savedImages.length,
      images: savedImages,
      ...aiMeta,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Gagal memproses dokumen referensi.' });
  }
});

app.delete('/api/references/:id', requireAuth, (req: AuthRequest, res) => {
  const doc = sqlite.prepare('SELECT id, tenant_id, title FROM reference_documents WHERE id = ?').get(req.params.id) as any;
  if (!doc) return res.status(404).json({ error: 'Referensi tidak ditemukan.' });
  if (!assertTenantOwnership(req, doc.tenant_id)) return res.status(403).json({ error: 'Akses lintas lembaga ditolak.' });

  sqlite.prepare('DELETE FROM reference_documents WHERE id = ? AND tenant_id = ?').run(doc.id, doc.tenant_id);
  logActivity(doc.tenant_id, req.authUser!.id, 'DELETE_REFERENCE', 'reference_documents', doc.id, `Menghapus referensi "${doc.title}"`);
  res.json({ success: true });
});

// ============================================================================
// CP & TP (LEARNING OUTCOMES & OBJECTIVES)
// ============================================================================
app.get('/api/curriculum', requireAuth, (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;
  const cpList = sqlite.prepare('SELECT * FROM learning_outcomes WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
  const tpList = sqlite.prepare('SELECT * FROM learning_objectives WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
  res.json({ cpList, tpList });
});

app.post('/api/curriculum/cp', requireAuth, (req: AuthRequest, res) => {
  const { subject, phase, gradeLevel, code, description, referenceId } = req.body;
  if (!subject || !description) return res.status(400).json({ error: 'Mata pelajaran dan deskripsi CP wajib diisi.' });
  const id = 'cp-' + crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(
      `INSERT INTO learning_outcomes (id, tenant_id, user_id, reference_id, subject, phase, grade_level, code, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, req.authUser!.tenantId, req.authUser!.id, referenceId || null, subject, phase || 'Fase C', gradeLevel || 'Kelas VI', code || 'CP-1', description);
  res.status(201).json(sqlite.prepare('SELECT * FROM learning_outcomes WHERE id = ?').get(id));
});

app.post('/api/curriculum/tp', requireAuth, (req: AuthRequest, res) => {
  const { outcomeId, subject, gradeLevel, code, description, atpNotes } = req.body;
  if (!subject || !description) return res.status(400).json({ error: 'Mata pelajaran dan deskripsi TP wajib diisi.' });
  const id = 'tp-' + crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(
      `INSERT INTO learning_objectives (id, tenant_id, user_id, outcome_id, subject, grade_level, code, description, atp_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, req.authUser!.tenantId, req.authUser!.id, outcomeId || null, subject, gradeLevel || 'Kelas VI', code || 'TP-1', description, atpNotes || '');
  res.status(201).json(sqlite.prepare('SELECT * FROM learning_objectives WHERE id = ?').get(id));
});

app.post('/api/curriculum/extract-ai', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const { referenceId, subject, gradeLevel, phase } = req.body;
    const tenantId = req.authUser!.tenantId;
    const chunks = retrieveRagChunks(tenantId, [referenceId], subject || '', 12);
    if (!chunks.length) {
      return res.status(400).json({ error: 'Pilih dokumen referensi yang valid untuk mengekstrak CP dan TP.' });
    }
    const chunksText = chunks.map((c) => `[${c.chapter_title} Hal. ${c.page_number}]\n${c.content}`).join('\n\n');
    const result = await extractCpTpWithAI(tenantId, req.authUser!.id, subject, gradeLevel, phase || 'Fase C', chunksText);

    const cpCodeToId = new Map<string, string>();
    for (const cp of result.cpList) {
      const cpId = 'cp-' + crypto.randomUUID().slice(0, 8);
      sqlite
        .prepare(
          `INSERT INTO learning_outcomes (id, tenant_id, user_id, reference_id, subject, phase, grade_level, code, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(cpId, tenantId, req.authUser!.id, referenceId, subject, phase || 'Fase C', gradeLevel, cp.code, cp.description);
      cpCodeToId.set(cp.code, cpId);
    }

    for (const tp of result.tpList) {
      const tpId = 'tp-' + crypto.randomUUID().slice(0, 8);
      sqlite
        .prepare(
          `INSERT INTO learning_objectives (id, tenant_id, user_id, outcome_id, subject, grade_level, code, description, atp_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(tpId, tenantId, req.authUser!.id, cpCodeToId.get(tp.cpCode) || null, subject, gradeLevel, tp.code, tp.description, tp.atpNotes || '');
    }

    logActivity(tenantId, req.authUser!.id, 'EXTRACT_CP_TP', 'learning_outcomes', referenceId, `Mengekstrak ${result.cpList.length} CP & ${result.tpList.length} TP dengan AI`);
    res.json({ ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal mengekstrak CP & TP.' });
  }
});

app.delete('/api/curriculum/cp/:id', requireAuth, (req: AuthRequest, res) => {
  const row = sqlite.prepare('SELECT id, tenant_id FROM learning_outcomes WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'CP tidak ditemukan.' });
  if (!assertTenantOwnership(req, row.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });
  sqlite.prepare('DELETE FROM learning_outcomes WHERE id = ? AND tenant_id = ?').run(row.id, row.tenant_id);
  res.json({ success: true });
});

app.delete('/api/curriculum/tp/:id', requireAuth, (req: AuthRequest, res) => {
  const row = sqlite.prepare('SELECT id, tenant_id FROM learning_objectives WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'TP tidak ditemukan.' });
  if (!assertTenantOwnership(req, row.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });
  sqlite.prepare('DELETE FROM learning_objectives WHERE id = ? AND tenant_id = ?').run(row.id, row.tenant_id);
  res.json({ success: true });
});

// ============================================================================
// ASSESSMENT PROJECTS & AI GENERATOR PIPELINE
// ============================================================================
app.get('/api/assessments', requireAuth, (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;
  const rows = sqlite
    .prepare(
      `SELECT ap.*,
              (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.project_id = ap.id) AS question_count,
              (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.project_id = ap.id AND aq.is_approved = 1) AS approved_count
       FROM assessment_projects ap
       WHERE ap.tenant_id = ?
       ORDER BY ap.updated_at DESC`
    )
    .all(tenantId) as any[];

  res.json(
    rows.map((r) => ({
      ...r,
      cognitiveComposition: JSON.parse(r.cognitive_composition_json || '{}'),
      questionCounts: JSON.parse(r.question_counts_json || '{}'),
      referenceIds: JSON.parse(r.reference_ids_json || '[]'),
      selectedChapters: JSON.parse(r.selected_chapters_json || '[]'),
      qcSummary: JSON.parse(r.qc_summary_json || '{}'),
    }))
  );
});

app.get('/api/assessments/:id', requireAuth, (req: AuthRequest, res) => {
  const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
  if (!project) return res.status(404).json({ error: 'Proyek asesmen tidak ditemukan.' });
  if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses lintas lembaga ditolak.' });

  const blueprints = sqlite
    .prepare('SELECT * FROM assessment_blueprints WHERE project_id = ? AND tenant_id = ? ORDER BY row_number ASC')
    .all(project.id, project.tenant_id);

  const questionsRaw = sqlite
    .prepare(
      `SELECT aq.*, ak.correct_answer, ak.explanation,
              sr.ideal_answer, sr.scoring_guide, sr.criteria_json, sr.max_score
       FROM assessment_questions aq
       LEFT JOIN answer_keys ak ON ak.question_id = aq.id
       LEFT JOIN scoring_rubrics sr ON sr.question_id = aq.id
       WHERE aq.project_id = ? AND aq.tenant_id = ?
       ORDER BY aq.question_number ASC`
    )
    .all(project.id, project.tenant_id) as any[];

  const questions = questionsRaw.map((q) => ({
    ...q,
    options: JSON.parse(q.options_json || '[]'),
    matching_pairs: JSON.parse(q.matching_pairs_json || '[]'),
    criteria: JSON.parse(q.criteria_json || '[]'),
    is_approved: Boolean(q.is_approved),
  }));

  const cognitiveSummary = sqlite
    .prepare('SELECT * FROM cognitive_analysis WHERE project_id = ? AND tenant_id = ?')
    .get(project.id, project.tenant_id);

  res.json({
    project: {
      ...project,
      cognitiveComposition: JSON.parse(project.cognitive_composition_json || '{}'),
      questionCounts: JSON.parse(project.question_counts_json || '{}'),
      referenceIds: JSON.parse(project.reference_ids_json || '[]'),
      selectedChapters: JSON.parse(project.selected_chapters_json || '[]'),
      qcSummary: JSON.parse(project.qc_summary_json || '{}'),
    },
    blueprints,
    questions,
    cognitiveSummary,
  });
});

app.post('/api/assessments', requireAuth, (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;
  const userId = req.authUser!.id;
  const {
    title,
    educationLevel,
    gradeLevel,
    semester,
    academicYear,
    curriculum,
    subject,
    topic,
    assessmentType,
    durationMinutes,
    difficulty,
    cognitiveComposition,
    questionCounts,
    referenceIds,
    selectedChapters,
    templateId,
  } = req.body;

  if (!subject || !gradeLevel) {
    return res.status(400).json({ error: 'Mata pelajaran dan kelas wajib ditentukan.' });
  }

  const defaultTpl = sqlite
    .prepare('SELECT id FROM document_templates WHERE tenant_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1')
    .get(tenantId) as any;

  const projectId = 'proj-' + crypto.randomUUID().slice(0, 8);
  const projectTitle = title || `${assessmentType || 'Sumatif Akhir Semester (SAS)'} ${subject} ${gradeLevel}`;
  const cleanSelectedChapters = Array.isArray(selectedChapters) ? selectedChapters.filter(Boolean) : [];

  sqlite
    .prepare(
      `INSERT INTO assessment_projects (
        id, tenant_id, user_id, template_id, title, education_level, grade_level, semester, academic_year,
        curriculum, subject, topic, assessment_type, duration_minutes, difficulty, cognitive_composition_json,
        question_counts_json, reference_ids_json, selected_chapters_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`
    )
    .run(
      projectId,
      tenantId,
      userId,
      templateId || defaultTpl?.id || null,
      projectTitle,
      educationLevel || 'SD/MI',
      gradeLevel,
      semester || '1',
      academicYear || '2026/2027',
      curriculum || 'Kurikulum Merdeka',
      subject,
      topic || (cleanSelectedChapters.length ? cleanSelectedChapters.join(', ') : subject),
      assessmentType || 'Sumatif Akhir Semester (SAS)',
      Number(durationMinutes || 90),
      difficulty || 'Campuran Proporsional',
      JSON.stringify(cognitiveComposition || { mode: 'levels', selectedLevels: ['C1', 'C2', 'C3', 'C4'], levelCounts: {} }),
      JSON.stringify(questionCounts || { 'Pilihan Ganda': 10, 'Isian Singkat': 5, Uraian: 2 }),
      JSON.stringify(referenceIds || []),
      JSON.stringify(cleanSelectedChapters)
    );

  logActivity(tenantId, userId, 'CREATE_ASSESSMENT', 'assessment_projects', projectId, `Membuat proyek asesmen "${projectTitle}"`);
  res.status(201).json({ id: projectId, title: projectTitle });
});

app.post('/api/assessments/:id/generate-blueprint', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: 'Proyek asesmen tidak ditemukan.' });
    if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

    const tenantId = project.tenant_id;
    const referenceIds: string[] = JSON.parse(project.reference_ids_json || '[]');
    const selectedChapters: string[] = JSON.parse(project.selected_chapters_json || '[]');
    const chunks = retrieveRagChunks(
      tenantId,
      referenceIds,
      `${project.subject} ${project.topic} ${selectedChapters.join(' ')}`,
      16,
      selectedChapters
    );
    const ragContext = chunks.map((c) => `[${c.doc_title} | ${c.chapter_title} | Hal. ${c.page_number}]\n${c.content}`).join('\n\n');

    const cps = sqlite
      .prepare('SELECT code, description FROM learning_outcomes WHERE tenant_id = ? AND subject = ?')
      .all(tenantId, project.subject) as any[];
    const tps = sqlite
      .prepare('SELECT code, description FROM learning_objectives WHERE tenant_id = ? AND subject = ?')
      .all(tenantId, project.subject) as any[];
    const existingCpTp = [
      ...cps.map((c) => `CP (${c.code}): ${c.description}`),
      ...tps.map((t) => `TP (${t.code}): ${t.description}`),
    ].join('\n');

    const result = await generateBlueprintWithAI({
      tenantId,
      userId: req.authUser!.id,
      educationLevel: project.education_level,
      gradeLevel: project.grade_level,
      semester: project.semester,
      subject: project.subject,
      topic: project.topic,
      selectedChapters,
      assessmentType: project.assessment_type,
      difficulty: project.difficulty,
      cognitiveComposition: JSON.parse(project.cognitive_composition_json || '{"mode":"levels","selectedLevels":["C1","C2","C3","C4"]}'),
      questionCounts: JSON.parse(project.question_counts_json || '{}'),
      ragContext,
      existingCpTp,
    });

    sqlite.prepare('DELETE FROM assessment_blueprints WHERE project_id = ? AND tenant_id = ?').run(project.id, tenantId);
    const insertBp = sqlite.prepare(
      `INSERT INTO assessment_blueprints (id, tenant_id, project_id, row_number, cp, tp, materi, indikator_soal, level_kognitif, bentuk_soal, nomor_soal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const savedRows: any[] = [];
    for (let i = 0; i < result.blueprintRows.length; i++) {
      const b = result.blueprintRows[i];
      const id = 'bp-' + crypto.randomUUID().slice(0, 8);
      insertBp.run(id, tenantId, project.id, b.rowNumber || i + 1, b.cp, b.tp, b.materi, b.indikatorSoal, b.levelKognitif, b.bentukSoal, String(b.nomorSoal || i + 1));
      savedRows.push({ id, ...b });
    }

    sqlite
      .prepare(`UPDATE assessment_projects SET source_warning = ?, status = 'blueprint_ready', updated_at = datetime('now') WHERE id = ?`)
      .run(result.sourceWarning || '', project.id);

    logActivity(tenantId, req.authUser!.id, 'GENERATE_BLUEPRINT', 'assessment_blueprints', project.id, `Menghasilkan ${savedRows.length} baris kisi-kisi`);
    res.json({ blueprints: savedRows, sourceWarning: result.sourceWarning || '' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal menghasilkan kisi-kisi AI.' });
  }
});

app.put('/api/assessments/:id/blueprints', requireAuth, (req: AuthRequest, res) => {
  const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
  if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });
  if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

  const { blueprints } = req.body;
  if (!Array.isArray(blueprints)) return res.status(400).json({ error: 'Format kisi-kisi tidak valid.' });

  sqlite.prepare('DELETE FROM assessment_blueprints WHERE project_id = ? AND tenant_id = ?').run(project.id, project.tenant_id);
  const insertBp = sqlite.prepare(
    `INSERT INTO assessment_blueprints (id, tenant_id, project_id, row_number, cp, tp, materi, indikator_soal, level_kognitif, bentuk_soal, nomor_soal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  blueprints.forEach((b, idx) => {
    insertBp.run(
      b.id || 'bp-' + crypto.randomUUID().slice(0, 8),
      project.tenant_id,
      project.id,
      idx + 1,
      b.cp || '',
      b.tp || '',
      b.materi || '',
      b.indikator_soal || '',
      b.level_kognitif || 'C2',
      b.bentuk_soal || 'Pilihan Ganda',
      String(b.nomor_soal || idx + 1)
    );
  });

  res.json({ success: true });
});

app.post('/api/assessments/:id/generate-questions', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: 'Proyek asesmen tidak ditemukan.' });
    if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

    const tenantId = project.tenant_id;
    const blueprints = sqlite
      .prepare('SELECT * FROM assessment_blueprints WHERE project_id = ? AND tenant_id = ? ORDER BY row_number ASC')
      .all(project.id, tenantId) as any[];

    if (!blueprints.length) {
      return res.status(400).json({ error: 'Kisi-kisi belum dibuat. Buat kisi-kisi terlebih dahulu.' });
    }

    const settingsRow = sqlite.prepare('SELECT formatting_json FROM tenant_settings WHERE tenant_id = ?').get(tenantId) as any;
    const formatting = settingsRow ? JSON.parse(settingsRow.formatting_json || '{}') : DEFAULT_ASKARA_FORMATTING;

    const referenceIds: string[] = JSON.parse(project.reference_ids_json || '[]');
    const selectedChapters: string[] = JSON.parse(project.selected_chapters_json || '[]');
    const chunks = retrieveRagChunks(
      tenantId,
      referenceIds,
      `${project.subject} ${project.topic} ${selectedChapters.join(' ')}`,
      18,
      selectedChapters
    );
    const ragContext = chunks.map((c) => `[${c.doc_title} | ${c.chapter_title} | Hal. ${c.page_number}]\n${c.content}`).join('\n\n');

    const availableImages: Array<{ url: string; pageNumber: number; label: string }> = [];
    if (referenceIds.length > 0) {
      const ph = referenceIds.map(() => '?').join(',');
      const refDocs = sqlite
        .prepare(`SELECT images_json FROM reference_documents WHERE tenant_id = ? AND id IN (${ph})`)
        .all(tenantId, ...referenceIds) as Array<{ images_json: string }>;
      for (const rd of refDocs) {
        try {
          const imgs = JSON.parse(rd.images_json || '[]');
          if (Array.isArray(imgs)) availableImages.push(...imgs);
        } catch {
          // ignore
        }
      }
    }

    const bpItems = blueprints.map((b) => ({
      rowNumber: b.row_number,
      cp: b.cp,
      tp: b.tp,
      materi: b.materi,
      indikatorSoal: b.indikator_soal,
      levelKognitif: b.level_kognitif,
      bentukSoal: b.bentuk_soal,
      nomorSoal: b.nomor_soal,
    }));

    const batchSize = 15;
    const allGenerated: any[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < bpItems.length; i += batchSize) {
      const batch = bpItems.slice(i, i + batchSize);
      const batchRes = await generateQuestionsBatchWithAI({
        tenantId,
        userId: req.authUser!.id,
        gradeLevel: project.grade_level,
        semester: project.semester || '1',
        subject: project.subject,
        topic: project.topic,
        selectedChapters,
        assessmentType: project.assessment_type,
        lowercaseOptions: formatting.lowercaseOptions !== false,
        blueprintBatch: batch,
        ragContext,
        availableImages,
      });
      if (batchRes.insufficientSourceWarning) warnings.push(batchRes.insufficientSourceWarning);
      allGenerated.push(...batchRes.questions);
    }

    // Automatic Self-Contained & Anti-Ambiguity Guard: catch any vague "dalam buku" or missing-stimulus question and rewrite cleanly
    const ambiguousTargets = allGenerated
      .map((q, idx) => ({ idx, q, issues: detectAmbiguousQuestionIssues(q) }))
      .filter((item) => item.issues.length > 0)
      .slice(0, 8);

    if (ambiguousTargets.length > 0) {
      await Promise.allSettled(
        ambiguousTargets.map(async ({ idx, q, issues }) => {
          try {
            const repaired = await repairQuestionWithAI({
              tenantId,
              userId: req.authUser!.id,
              instruction: `Hilangkan keambiguan berikut agar soal mandiri dan jelas arahnya: ${issues.join(' ')}`,
              question: q,
              ragContext,
            });
            allGenerated[idx] = {
              ...repaired,
              questionNumber: q.questionNumber || repaired.questionNumber,
              questionType: q.questionType || repaired.questionType,
              imageUrl: q.imageUrl || repaired.imageUrl || '',
              imageCaption: q.imageCaption || repaired.imageCaption || '',
              needsIllustrationPrompt: q.needsIllustrationPrompt || '',
              imageSearchQueries: q.imageSearchQueries || [],
            };
          } catch (err) {
            console.warn(`[Anti-Ambiguity Auto-Repair Q${q.questionNumber}] Skipped:`, err);
          }
        })
      );
    }

    sqlite.prepare('DELETE FROM assessment_questions WHERE project_id = ? AND tenant_id = ?').run(project.id, tenantId);

    const insertQ = sqlite.prepare(
      `INSERT INTO assessment_questions (
        id, tenant_id, project_id, blueprint_id, question_number, question_type, materi, indikator_soal,
        cognitive_level, cognitive_tier, cognitive_rationale, difficulty, question_text, options_json,
        matching_pairs_json, source_reference, source_page, image_url, image_caption, qc_status, qc_notes, is_approved
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', 0)`
    );
    const insertKey = sqlite.prepare(
      `INSERT INTO answer_keys (id, tenant_id, project_id, question_id, correct_answer, explanation) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertRubric = sqlite.prepare(
      `INSERT INTO scoring_rubrics (id, tenant_id, project_id, question_id, ideal_answer, scoring_guide, criteria_json, max_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const allowedImageUrls = new Set(availableImages.map((i) => i.url));
    const usedBookUrls = new Set<string>();
    const preparedQuestions = allGenerated.map((q, idx) => {
      const qId = 'q-' + crypto.randomUUID().slice(0, 10);
      const bpMatch = blueprints[idx] || null;
      const qNum = q.questionNumber || idx + 1;
      const validImageUrl = q.imageUrl && allowedImageUrls.has(q.imageUrl) ? q.imageUrl : '';
      if (validImageUrl) usedBookUrls.add(validImageUrl);
      return {
        q,
        qId,
        bpMatch,
        qNum,
        imageUrl: validImageUrl,
        imageCaption: validImageUrl ? (q.imageCaption || '') : '',
      };
    });

    // Attach real images from book, authentic external reference (Wikimedia/Wikipedia + Vision), or clean textbook illustration automatically
    const explicitVisualCandidates = preparedQuestions.filter(
      (item) =>
        !item.imageUrl &&
        (String(item.q.needsIllustrationPrompt || '').trim().length > 4 ||
          (Array.isArray(item.q.imageSearchQueries) && item.q.imageSearchQueries.length > 0) ||
          /perhatikan gambar/i.test(String(item.q.questionText || '')))
    );

    const existingBookImageCount = preparedQuestions.filter((item) => Boolean(item.imageUrl)).length;
    const targetVisualMin = preparedQuestions.length >= 4 ? 2 : preparedQuestions.length >= 2 ? 1 : 0;
    const neededExtra = Math.max(0, targetVisualMin - (existingBookImageCount + explicitVisualCandidates.length));

    const autoPromotedCandidates: typeof preparedQuestions = [];
    if (neededExtra > 0) {
      const candidatePool = preparedQuestions
        .filter((item) => !item.imageUrl && !explicitVisualCandidates.includes(item))
        .map((item) => {
          const txt = `${item.q.materi || ''} ${item.q.questionText || ''}`.toLowerCase();
          let visualScore = 0;
          if (/pilihan ganda|isian|uraian/i.test(String(item.q.questionType || ''))) visualScore += 2;
          if (/\b(garuda|pancasila|bendera|upacara|rumah|adat|peta|hewan|tumbuhan|buah|bunga|jam|pukul|bangun|segitiga|persegi|lingkaran|kubus|gotong|royong|berkenalan|teman|sekolah|keluarga|siklus|air|matahari|organ|candi|pahlawan|uang|timbangan|penggaris)\b/i.test(txt)) {
            visualScore += 4;
          }
          if (txt.length >= 35 && txt.length <= 220) visualScore += 1;
          return { item, visualScore };
        })
        .sort((a, b) => b.visualScore - a.visualScore);

      for (const entry of candidatePool.slice(0, neededExtra)) {
        autoPromotedCandidates.push(entry.item);
      }
    }

    const visualCandidates = [...explicitVisualCandidates, ...autoPromotedCandidates].slice(0, 3);

    if (visualCandidates.length > 0) {
      const imgDir = path.resolve(process.cwd(), 'uploads', 'question-images', tenantId);
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

      await Promise.allSettled(
        visualCandidates.map(async (item) => {
          try {
            // Priority 1: Keyword-match any unused real image extracted from uploaded books
            const unusedBookImgs = availableImages.filter((img) => !usedBookUrls.has(img.url));
            if (unusedBookImgs.length > 0) {
              const targetTerms = `${item.q.materi || ''} ${item.q.needsIllustrationPrompt || ''} ${item.q.questionText || ''}`
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length > 3);
              let bestBookImg: { url: string; label: string } | null = null;
              let bestScore = 0;
              for (const bImg of unusedBookImgs) {
                const lbl = (bImg.label || '').toLowerCase();
                const hits = targetTerms.filter((t) => lbl.includes(t)).length;
                if (hits > bestScore) {
                  bestScore = hits;
                  bestBookImg = bImg;
                }
              }
              if (bestBookImg && bestScore >= 1) {
                usedBookUrls.add(bestBookImg.url);
                item.imageUrl = bestBookImg.url;
                item.imageCaption = bestBookImg.label;
                return;
              }
            }

            // Priority 2: Real authentic photo/diagram from Wikimedia Commons / Wikipedia verified via Gemini Vision
            const found = await findAuthenticReferenceImageForQuestion({
              tenantId,
              userId: req.authUser!.id,
              subject: project.subject,
              gradeLevel: project.grade_level,
              questionText: item.q.questionText,
              visualPrompt: item.q.needsIllustrationPrompt || item.q.questionText,
              searchQueries: Array.isArray(item.q.imageSearchQueries) ? item.q.imageSearchQueries : undefined,
            });
            if (found) {
              const fname = `ref-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${found.ext}`;
              fs.writeFileSync(path.join(imgDir, fname), found.buffer);
              item.imageUrl = `/uploads/question-images/${tenantId}/${fname}`;
              item.imageCaption = found.caption;
              return;
            }

            // Priority 3: Clean textbook-style vector PNG illustration fallback so question always has a visual
            const svgIllus = await generateEducationalSvgIllustration({
              tenantId,
              userId: req.authUser!.id,
              subject: project.subject,
              gradeLevel: project.grade_level,
              questionText: item.q.questionText,
              visualPrompt: item.q.needsIllustrationPrompt || `Ilustrasi edukatif buku pelajaran untuk: ${item.q.questionText}`,
            });
            if (svgIllus?.pngBuffer?.length) {
              const fname = `illus-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.png`;
              fs.writeFileSync(path.join(imgDir, fname), svgIllus.pngBuffer);
              item.imageUrl = `/uploads/question-images/${tenantId}/${fname}`;
              item.imageCaption = svgIllus.caption || `Ilustrasi ${item.q.materi || project.subject}`;
            }
          } catch (err) {
            console.warn('[Auto Reference Image] Skipping question image:', err);
          }
        })
      );
    }

    // Align question text with attached image automatically (add intro if missing when image exists, or strip dangling intro if none)
    for (const item of preparedQuestions) {
      const qTxt = String(item.q.questionText || '').trim();
      if (item.imageUrl) {
        if (!/\b(gambar|ilustrasi|foto|diagram|peta|bagan)\b/i.test(qTxt)) {
          item.q.questionText = `Perhatikan gambar berikut!\n${qTxt}`;
        }
      } else if (/^\s*perhatikan\s+gambar\b[^.!]*[.!]\s*/i.test(qTxt)) {
        item.q.questionText = qTxt
          .replace(/^\s*perhatikan\s+gambar\b[^.!]*[.!]\s*/i, '')
          .trim();
        if (item.q.questionText) {
          item.q.questionText = item.q.questionText.charAt(0).toUpperCase() + item.q.questionText.slice(1);
        }
      }
    }

    preparedQuestions.forEach(({ q, qId, bpMatch, qNum, imageUrl, imageCaption }) => {
      insertQ.run(
        qId,
        tenantId,
        project.id,
        bpMatch?.id || null,
        qNum,
        q.questionType || bpMatch?.bentuk_soal || 'Pilihan Ganda',
        q.materi || project.topic,
        q.indikatorSoal || bpMatch?.indikator_soal || '',
        q.cognitiveLevel || bpMatch?.level_kognitif || 'C2',
        q.cognitiveTier || 'MOTS',
        q.cognitiveRationale || '',
        q.difficulty || 'Sedang',
        q.questionText,
        JSON.stringify(q.options || []),
        JSON.stringify(q.matchingPairs || []),
        q.sourceReference || 'Referensi Terpilih',
        String(q.sourcePage || '-'),
        imageUrl,
        imageCaption
      );
      insertKey.run(crypto.randomUUID(), tenantId, project.id, qId, q.correctAnswer || '-', q.explanation || '');
      insertRubric.run(
        crypto.randomUUID(),
        tenantId,
        project.id,
        qId,
        q.idealAnswer || q.correctAnswer || '',
        q.scoringGuide || `Skor ${q.maxScore || 1} jika jawaban tepat.`,
        JSON.stringify(q.criteria || []),
        Number(q.maxScore || 1)
      );
    });

    recalculateCognitiveAnalysis(tenantId, project.id);
    const combinedWarning = warnings.filter(Boolean).join(' | ');
    sqlite
      .prepare(`UPDATE assessment_projects SET source_warning = ?, status = 'generated', updated_at = datetime('now') WHERE id = ?`)
      .run(combinedWarning || project.source_warning, project.id);

    logActivity(tenantId, req.authUser!.id, 'GENERATE_QUESTIONS', 'assessment_questions', project.id, `Menghasilkan ${allGenerated.length} butir soal AI`);
    res.json({ count: allGenerated.length, warning: combinedWarning });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal menghasilkan soal dengan AI.' });
  }
});

app.post('/api/questions/upload-image', requireAuth, uploadMemory.single('image'), (req: AuthRequest, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'File gambar tidak ditemukan.' });
  const ext = file.originalname.split('.').pop()?.toLowerCase() || 'png';
  if (!['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) {
    return res.status(400).json({ error: 'Format gambar harus PNG, JPG, JPEG, WebP, atau SVG.' });
  }
  const dir = path.resolve(process.cwd(), 'uploads', 'question-images', req.authUser!.tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fname = `qimg-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), file.buffer);
  res.json({ imageUrl: `/uploads/question-images/${req.authUser!.tenantId}/${fname}` });
});

app.post('/api/assessments/:id/questions/:qid/generate-image', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: 'Proyek asesmen tidak ditemukan.' });
    if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

    const q = sqlite
      .prepare('SELECT * FROM assessment_questions WHERE id = ? AND project_id = ?')
      .get(req.params.qid, req.params.id) as any;
    if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });

    const visualPrompt = String(req.body?.visualPrompt || '').trim() || q.question_text;
    const imgDir = path.resolve(process.cwd(), 'uploads', 'question-images', project.tenant_id);
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

    let imageUrl = '';
    let imageCaption = '';

    const found = await findAuthenticReferenceImageForQuestion({
      tenantId: project.tenant_id,
      userId: req.authUser!.id,
      subject: project.subject,
      gradeLevel: project.grade_level,
      questionText: String(req.body?.questionText || q.question_text),
      visualPrompt,
    });

    if (found) {
      const fname = `ref-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${found.ext}`;
      fs.writeFileSync(path.join(imgDir, fname), found.buffer);
      imageUrl = `/uploads/question-images/${project.tenant_id}/${fname}`;
      imageCaption = found.caption;
    } else {
      const svgIllus = await generateEducationalSvgIllustration({
        tenantId: project.tenant_id,
        userId: req.authUser!.id,
        subject: project.subject,
        gradeLevel: project.grade_level,
        questionText: String(req.body?.questionText || q.question_text),
        visualPrompt,
      });
      if (!svgIllus?.pngBuffer?.length) {
        return res.status(404).json({
          error: 'Gagal menyiapkan gambar otomatis. Coba isi kata kunci yang lebih spesifik atau unggah gambar sendiri.',
        });
      }
      const fname = `illus-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.png`;
      fs.writeFileSync(path.join(imgDir, fname), svgIllus.pngBuffer);
      imageUrl = `/uploads/question-images/${project.tenant_id}/${fname}`;
      imageCaption = svgIllus.caption;
    }

    sqlite
      .prepare(`UPDATE assessment_questions SET image_url = ?, image_caption = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(imageUrl, imageCaption, q.id);

    res.json({ imageUrl, imageCaption });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal mencari gambar referensi asli.' });
  }
});

app.patch('/api/assessments/:id/questions/:qid', requireAuth, (req: AuthRequest, res) => {
  const q = sqlite.prepare('SELECT * FROM assessment_questions WHERE id = ? AND project_id = ?').get(req.params.qid, req.params.id) as any;
  if (!q) return res.status(404).json({ error: 'Soal tidak ditemukan.' });
  if (!assertTenantOwnership(req, q.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

  const {
    questionText,
    options,
    cognitiveLevel,
    cognitiveTier,
    cognitiveRationale,
    difficulty,
    correctAnswer,
    explanation,
    idealAnswer,
    scoringGuide,
    maxScore,
    isApproved,
    imageUrl,
    imageCaption,
  } = req.body;

  sqlite
    .prepare(
      `UPDATE assessment_questions
       SET question_text = COALESCE(?, question_text),
           options_json = COALESCE(?, options_json),
           cognitive_level = COALESCE(?, cognitive_level),
           cognitive_tier = COALESCE(?, cognitive_tier),
           cognitive_rationale = COALESCE(?, cognitive_rationale),
           difficulty = COALESCE(?, difficulty),
           image_url = COALESCE(?, image_url),
           image_caption = COALESCE(?, image_caption),
           is_approved = COALESCE(?, is_approved),
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      questionText ?? null,
      options ? JSON.stringify(options) : null,
      cognitiveLevel ?? null,
      cognitiveTier ?? null,
      cognitiveRationale ?? null,
      difficulty ?? null,
      imageUrl !== undefined ? String(imageUrl) : null,
      imageCaption !== undefined ? String(imageCaption) : null,
      typeof isApproved === 'boolean' ? (isApproved ? 1 : 0) : null,
      q.id
    );

  if (correctAnswer !== undefined || explanation !== undefined) {
    sqlite
      .prepare(
        `UPDATE answer_keys
         SET correct_answer = COALESCE(?, correct_answer),
             explanation = COALESCE(?, explanation),
             updated_at = datetime('now')
         WHERE question_id = ?`
      )
      .run(correctAnswer ?? null, explanation ?? null, q.id);
  }

  if (idealAnswer !== undefined || scoringGuide !== undefined || maxScore !== undefined) {
    sqlite
      .prepare(
        `UPDATE scoring_rubrics
         SET ideal_answer = COALESCE(?, ideal_answer),
             scoring_guide = COALESCE(?, scoring_guide),
             max_score = COALESCE(?, max_score),
             updated_at = datetime('now')
         WHERE question_id = ?`
      )
      .run(idealAnswer ?? null, scoringGuide ?? null, maxScore ?? null, q.id);
  }

  recalculateCognitiveAnalysis(q.tenant_id, q.project_id);
  res.json({ success: true });
});

app.post('/api/assessments/:id/questions/:qid/repair', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
    const q = sqlite
      .prepare(
        `SELECT aq.*, ak.correct_answer, ak.explanation, sr.ideal_answer, sr.scoring_guide, sr.max_score
         FROM assessment_questions aq
         LEFT JOIN answer_keys ak ON ak.question_id = aq.id
         LEFT JOIN scoring_rubrics sr ON sr.question_id = aq.id
         WHERE aq.id = ? AND aq.project_id = ?`
      )
      .get(req.params.qid, req.params.id) as any;

    if (!project || !q) return res.status(404).json({ error: 'Soal atau proyek tidak ditemukan.' });
    if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

    const referenceIds: string[] = JSON.parse(project.reference_ids_json || '[]');
    const chunks = retrieveRagChunks(project.tenant_id, referenceIds, `${q.materi} ${q.question_text}`, 6);
    const ragContext = chunks.map((c) => `[${c.chapter_title} Hal. ${c.page_number}]\n${c.content}`).join('\n\n');

    const repaired = await repairQuestionWithAI({
      tenantId: project.tenant_id,
      userId: req.authUser!.id,
      instruction: req.body.instruction || 'Perbaiki kejelasan bahasa, ketepatan indikator, dan kualitas pengecoh agar memenuhi Quality Control.',
      question: {
        ...q,
        options: JSON.parse(q.options_json || '[]'),
      },
      ragContext,
    });

    sqlite
      .prepare(
        `UPDATE assessment_questions
         SET question_text = ?, options_json = ?, cognitive_level = ?, cognitive_tier = ?,
             cognitive_rationale = ?, difficulty = ?, source_reference = ?, source_page = ?,
             qc_status = 'passed', qc_notes = 'Telah diperbaiki oleh AI sesuai instruksi', updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        repaired.questionText,
        JSON.stringify(repaired.options || []),
        repaired.cognitiveLevel,
        repaired.cognitiveTier,
        repaired.cognitiveRationale,
        repaired.difficulty,
        repaired.sourceReference,
        String(repaired.sourcePage || '-'),
        q.id
      );

    sqlite
      .prepare(`UPDATE answer_keys SET correct_answer = ?, explanation = ?, updated_at = datetime('now') WHERE question_id = ?`)
      .run(repaired.correctAnswer, repaired.explanation, q.id);

    sqlite
      .prepare(`UPDATE scoring_rubrics SET ideal_answer = ?, scoring_guide = ?, max_score = ?, updated_at = datetime('now') WHERE question_id = ?`)
      .run(repaired.idealAnswer || repaired.correctAnswer, repaired.scoringGuide || '', repaired.maxScore || 1, q.id);

    recalculateCognitiveAnalysis(project.tenant_id, project.id);
    logActivity(project.tenant_id, req.authUser!.id, 'REPAIR_QUESTION', 'assessment_questions', q.id, `Memperbaiki soal no. ${q.question_number} via AI`);
    res.json({ success: true, repaired });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal memperbaiki soal.' });
  }
});

app.post('/api/assessments/:id/quality-control', requireAuth, aiLimiter, async (req: AuthRequest, res) => {
  try {
    const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
    if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });
    if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

    const questions = sqlite
      .prepare(
        `SELECT aq.*, ak.correct_answer
         FROM assessment_questions aq
         LEFT JOIN answer_keys ak ON ak.question_id = aq.id
         WHERE aq.project_id = ? AND aq.tenant_id = ?
         ORDER BY aq.question_number ASC`
      )
      .all(project.id, project.tenant_id) as any[];

    if (!questions.length) return res.status(400).json({ error: 'Belum ada soal untuk diperiksa.' });

    const qCounts = JSON.parse(project.question_counts_json || '{}');
    const expectedCount = Object.values(qCounts).reduce((a: number, b: any) => a + Number(b || 0), 0);
    const referenceIds: string[] = JSON.parse(project.reference_ids_json || '[]');
    const chunks = retrieveRagChunks(project.tenant_id, referenceIds, `${project.subject} ${project.topic}`, 8);
    const ragContext = chunks.map((c) => c.content).join('\n\n');

    const qcReport = await runQualityControlWithAI({
      tenantId: project.tenant_id,
      userId: req.authUser!.id,
      subject: project.subject,
      gradeLevel: project.grade_level,
      expectedCount: expectedCount || questions.length,
      questionsPayload: questions.map((q) => ({
        id: q.id,
        questionNumber: q.question_number,
        questionType: q.question_type,
        materi: q.materi,
        indikatorSoal: q.indikator_soal,
        cognitiveLevel: q.cognitive_level,
        difficulty: q.difficulty,
        questionText: q.question_text,
        options: JSON.parse(q.options_json || '[]'),
        correctAnswer: q.correct_answer || '',
      })),
      ragContext,
    });

    const qMap = new Map(questions.map((q) => [q.id, q]));
    const updateQ = sqlite.prepare(`UPDATE assessment_questions SET qc_status = ?, qc_notes = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`);
    const mergedReviews = (qcReport.questionReviews || []).map((review) => {
      const qRow = qMap.get(review.questionId);
      const localIssues = qRow ? detectAmbiguousQuestionIssues(qRow) : [];
      if (localIssues.length > 0) {
        const mergedIssues = Array.from(new Set([...(review.issues || []), ...localIssues]));
        const rec =
          review.recommendation ||
          'Klik Perbaiki AI agar soal dilengkapi cuplikan cerita/stimulus secara mandiri atau diubah menjadi pertanyaan konseptual yang jelas arahnya.';
        updateQ.run('needs_revision', [...mergedIssues, rec].filter(Boolean).join(' · '), review.questionId, project.tenant_id);
        return {
          ...review,
          status: 'needs_revision' as const,
          issues: mergedIssues,
          recommendation: rec,
        };
      }
      const notes = [...(review.issues || []), review.recommendation].filter(Boolean).join(' · ');
      updateQ.run(review.status === 'passed' ? 'passed' : 'needs_revision', notes, review.questionId, project.tenant_id);
      return review;
    });
    qcReport.questionReviews = mergedReviews;

    sqlite
      .prepare(`UPDATE assessment_projects SET qc_summary_json = ?, status = 'qc_reviewed', updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(qcReport), project.id);

    logActivity(project.tenant_id, req.authUser!.id, 'QUALITY_CONTROL', 'assessment_projects', project.id, `Menjalankan Quality Control 12 kriteria (${questions.length} soal)`);
    res.json(qcReport);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal menjalankan Quality Control.' });
  }
});

app.post('/api/assessments/:id/approve', requireAuth, (req: AuthRequest, res) => {
  const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
  if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });
  if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

  const { saveToBank } = req.body;
  sqlite.prepare(`UPDATE assessment_questions SET is_approved = 1, updated_at = datetime('now') WHERE project_id = ? AND tenant_id = ?`).run(project.id, project.tenant_id);
  sqlite.prepare(`UPDATE assessment_projects SET status = 'approved', updated_at = datetime('now') WHERE id = ?`).run(project.id);

  if (saveToBank !== false) {
    const qs = sqlite
      .prepare(
        `SELECT aq.*, ak.correct_answer, ak.explanation, sr.max_score
         FROM assessment_questions aq
         LEFT JOIN answer_keys ak ON ak.question_id = aq.id
         LEFT JOIN scoring_rubrics sr ON sr.question_id = aq.id
         WHERE aq.project_id = ? AND aq.tenant_id = ?`
      )
      .all(project.id, project.tenant_id) as any[];

    const insertBank = sqlite.prepare(
      `INSERT INTO question_banks (id, tenant_id, user_id, source_question_id, grade_level, subject, semester, academic_year, materi, cognitive_level, cognitive_tier, assessment_type, question_type, difficulty, question_text, options_json, correct_answer, explanation, image_url, image_caption, max_score, is_shared)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );
    for (const q of qs) {
      const exists = sqlite.prepare('SELECT id FROM question_banks WHERE source_question_id = ? AND tenant_id = ?').get(q.id, project.tenant_id);
      if (!exists) {
        insertBank.run(
          'qb-' + crypto.randomUUID().slice(0, 8),
          project.tenant_id,
          req.authUser!.id,
          q.id,
          project.grade_level,
          project.subject,
          project.semester,
          project.academic_year,
          q.materi,
          q.cognitive_level,
          q.cognitive_tier,
          project.assessment_type,
          q.question_type,
          q.difficulty,
          q.question_text,
          q.options_json,
          q.correct_answer || '-',
          q.explanation || '',
          q.image_url || '',
          q.image_caption || '',
          q.max_score || 1
        );
      }
    }
  }

  logActivity(project.tenant_id, req.authUser!.id, 'APPROVE_ASSESSMENT', 'assessment_projects', project.id, `Menyetujui naskah asesmen "${project.title}"`);
  res.json({ success: true });
});

app.delete('/api/assessments/:id', requireAuth, (req: AuthRequest, res) => {
  const project = sqlite.prepare('SELECT id, tenant_id, title FROM assessment_projects WHERE id = ?').get(req.params.id) as any;
  if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });
  if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });
  sqlite.prepare('DELETE FROM assessment_projects WHERE id = ? AND tenant_id = ?').run(project.id, project.tenant_id);
  logActivity(project.tenant_id, req.authUser!.id, 'DELETE_ASSESSMENT', 'assessment_projects', project.id, `Menghapus proyek "${project.title}"`);
  res.json({ success: true });
});

// ============================================================================
// QUESTION BANK ROUTES
// ============================================================================
app.get('/api/bank', requireAuth, (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;
  const { gradeLevel, subject, semester, academicYear, cognitiveLevel, assessmentType, search } = req.query;

  let sql = 'SELECT * FROM question_banks WHERE tenant_id = ?';
  const params: any[] = [tenantId];

  if (gradeLevel) { sql += ' AND grade_level = ?'; params.push(gradeLevel); }
  if (subject) { sql += ' AND subject = ?'; params.push(subject); }
  if (semester) { sql += ' AND semester = ?'; params.push(semester); }
  if (academicYear) { sql += ' AND academic_year = ?'; params.push(academicYear); }
  if (cognitiveLevel) { sql += ' AND cognitive_level = ?'; params.push(cognitiveLevel); }
  if (assessmentType) { sql += ' AND assessment_type = ?'; params.push(assessmentType); }
  if (search) {
    sql += ' AND (lower(question_text) LIKE ? OR lower(materi) LIKE ?)';
    const like = `%${String(search).toLowerCase()}%`;
    params.push(like, like);
  }
  sql += ' ORDER BY created_at DESC';

  const rows = sqlite.prepare(sql).all(...params) as any[];
  res.json(rows.map((r) => ({ ...r, options: JSON.parse(r.options_json || '[]') })));
});

app.post('/api/bank', requireAuth, (req: AuthRequest, res) => {
  const b = req.body;
  const id = 'qb-' + crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(
      `INSERT INTO question_banks (id, tenant_id, user_id, grade_level, subject, semester, academic_year, materi, cognitive_level, cognitive_tier, assessment_type, question_type, difficulty, question_text, options_json, correct_answer, explanation, image_url, image_caption, max_score, is_shared)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      req.authUser!.tenantId,
      req.authUser!.id,
      b.gradeLevel || 'Kelas VI',
      b.subject || 'Pendidikan Pancasila',
      b.semester || '1',
      b.academicYear || '2026/2027',
      b.materi || 'Umum',
      b.cognitiveLevel || 'C2',
      b.cognitiveTier || 'MOTS',
      b.assessmentType || 'Penilaian Harian',
      b.questionType || 'Pilihan Ganda',
      b.difficulty || 'Sedang',
      b.questionText,
      JSON.stringify(b.options || []),
      b.correctAnswer || '-',
      b.explanation || '',
      b.imageUrl || '',
      b.imageCaption || '',
      Number(b.maxScore || 1),
      b.isShared === false ? 0 : 1
    );
  res.status(201).json({ id });
});

app.post('/api/bank/:id/duplicate', requireAuth, (req: AuthRequest, res) => {
  const src = sqlite.prepare('SELECT * FROM question_banks WHERE id = ?').get(req.params.id) as any;
  if (!src) return res.status(404).json({ error: 'Soal bank tidak ditemukan.' });
  if (!assertTenantOwnership(req, src.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

  const newId = 'qb-' + crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(
      `INSERT INTO question_banks (id, tenant_id, user_id, grade_level, subject, semester, academic_year, materi, cognitive_level, cognitive_tier, assessment_type, question_type, difficulty, question_text, options_json, correct_answer, explanation, image_url, image_caption, max_score, is_shared)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId,
      src.tenant_id,
      req.authUser!.id,
      src.grade_level,
      src.subject,
      src.semester,
      src.academic_year,
      src.materi,
      src.cognitive_level,
      src.cognitive_tier,
      src.assessment_type,
      src.question_type,
      src.difficulty,
      `${src.question_text} (Salinan)`,
      src.options_json,
      src.correct_answer,
      src.explanation,
      src.image_url || '',
      src.image_caption || '',
      src.max_score,
      src.is_shared
    );
  res.status(201).json({ id: newId });
});

app.delete('/api/bank/:id', requireAuth, (req: AuthRequest, res) => {
  const src = sqlite.prepare('SELECT id, tenant_id FROM question_banks WHERE id = ?').get(req.params.id) as any;
  if (!src) return res.status(404).json({ error: 'Soal bank tidak ditemukan.' });
  if (!assertTenantOwnership(req, src.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });
  sqlite.prepare('DELETE FROM question_banks WHERE id = ? AND tenant_id = ?').run(src.id, src.tenant_id);
  res.json({ success: true });
});

app.post('/api/bank/assemble-project', requireAuth, (req: AuthRequest, res) => {
  const { title, questionIds, subject, gradeLevel, assessmentType } = req.body;
  if (!Array.isArray(questionIds) || !questionIds.length) {
    return res.status(400).json({ error: 'Pilih minimal 1 soal dari Bank Soal.' });
  }
  const tenantId = req.authUser!.tenantId;
  const userId = req.authUser!.id;
  const placeholders = questionIds.map(() => '?').join(',');
  const bankItems = sqlite
    .prepare(`SELECT * FROM question_banks WHERE tenant_id = ? AND id IN (${placeholders})`)
    .all(tenantId, ...questionIds) as any[];

  if (!bankItems.length) return res.status(404).json({ error: 'Soal terpilih tidak ditemukan pada lembaga ini.' });

  const defaultTpl = sqlite
    .prepare('SELECT id FROM document_templates WHERE tenant_id = ? ORDER BY is_default DESC LIMIT 1')
    .get(tenantId) as any;

  const projectId = 'proj-' + crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(
      `INSERT INTO assessment_projects (id, tenant_id, user_id, template_id, title, education_level, grade_level, semester, academic_year, subject, topic, assessment_type, status)
       VALUES (?, ?, ?, ?, ?, 'SD/MI', ?, ?, ?, ?, 'Gabungan Bank Soal', ?, 'generated')`
    )
    .run(
      projectId,
      tenantId,
      userId,
      defaultTpl?.id || null,
      title || `Paket Asesmen Bank Soal (${bankItems.length} Soal)`,
      gradeLevel || bankItems[0].grade_level,
      bankItems[0].semester,
      bankItems[0].academic_year,
      subject || bankItems[0].subject,
      assessmentType || bankItems[0].assessment_type
    );

  const insertBp = sqlite.prepare(
    `INSERT INTO assessment_blueprints (id, tenant_id, project_id, row_number, cp, tp, materi, indikator_soal, level_kognitif, bentuk_soal, nomor_soal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertQ = sqlite.prepare(
    `INSERT INTO assessment_questions (id, tenant_id, project_id, blueprint_id, question_number, question_type, materi, indikator_soal, cognitive_level, cognitive_tier, difficulty, question_text, options_json, image_url, image_caption, source_reference, qc_status, is_approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Bank Soal Sekolah', 'passed', 1)`
  );
  const insertKey = sqlite.prepare(`INSERT INTO answer_keys (id, tenant_id, project_id, question_id, correct_answer, explanation) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertRubric = sqlite.prepare(`INSERT INTO scoring_rubrics (id, tenant_id, project_id, question_id, ideal_answer, scoring_guide, max_score) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  bankItems.forEach((b, idx) => {
    const bpId = 'bp-' + crypto.randomUUID().slice(0, 8);
    const qId = 'q-' + crypto.randomUUID().slice(0, 10);
    insertBp.run(bpId, tenantId, projectId, idx + 1, '-', '-', b.materi, `Menjawab soal materi ${b.materi}`, b.cognitive_level, b.question_type, String(idx + 1));
    insertQ.run(qId, tenantId, projectId, bpId, idx + 1, b.question_type, b.materi, `Indikator ${b.materi}`, b.cognitive_level, b.cognitive_tier, b.difficulty, b.question_text, b.options_json, b.image_url || '', b.image_caption || '');
    insertKey.run(crypto.randomUUID(), tenantId, projectId, qId, b.correct_answer, b.explanation);
    insertRubric.run(crypto.randomUUID(), tenantId, projectId, qId, b.correct_answer, `Skor maksimal ${b.max_score || 1}`, b.max_score || 1);
  });

  recalculateCognitiveAnalysis(tenantId, projectId);
  logActivity(tenantId, userId, 'ASSEMBLE_FROM_BANK', 'assessment_projects', projectId, `Merakit paket asesmen baru dari ${bankItems.length} soal bank`);
  res.status(201).json({ projectId });
});

// ============================================================================
// KOP SURAT & DOCUMENT BRANDING ENGINE
// ============================================================================
app.get('/api/templates', requireAuth, (req: AuthRequest, res) => {
  const rows = sqlite
    .prepare('SELECT * FROM document_templates WHERE tenant_id = ? ORDER BY is_default DESC, created_at DESC')
    .all(req.authUser!.tenantId);
  res.json(rows);
});

app.post('/api/templates/upload-logo', requireAuth, uploadMemory.single('logo'), (req: AuthRequest, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Pilih file logo (PNG, JPG, atau SVG).' });
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'png';
    if (!['png', 'jpg', 'jpeg', 'svg'].includes(ext)) {
      return res.status(400).json({ error: 'Format logo harus PNG, JPG, atau SVG.' });
    }
    const tenantDir = path.join(uploadsLogosDir, req.authUser!.tenantId);
    if (!fs.existsSync(tenantDir)) fs.mkdirSync(tenantDir, { recursive: true });
    const filename = `logo-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(tenantDir, filename), file.buffer);
    const logoUrl = `/uploads/logos/${req.authUser!.tenantId}/${filename}`;
    res.json({ logoUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal mengunggah logo.' });
  }
});

app.post('/api/templates', requireAuth, (req: AuthRequest, res) => {
  const b = req.body;
  const tenantId = req.authUser!.tenantId;
  const id = 'tpl-' + crypto.randomUUID().slice(0, 8);
  if (b.isDefault) {
    sqlite.prepare('UPDATE document_templates SET is_default = 0 WHERE tenant_id = ?').run(tenantId);
  }
  sqlite
    .prepare(
      `INSERT INTO document_templates (id, tenant_id, name, logo_url, right_logo_url, logo_position, logo_size, pemkab_line, line_1, line_2, line_3, line_4, address_line, contact_line, border_style, font_family, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tenantId,
      b.name || 'Template Kop Baru',
      b.logoUrl || '',
      b.rightLogoUrl || '',
      b.logoPosition || 'dual',
      Number(b.logoSize || 96),
      b.pemkabLine || '',
      b.line1 || '',
      b.line2 || '',
      b.line3 || '',
      b.line4 || '',
      b.addressLine || '',
      b.contactLine || '',
      b.borderStyle || 'thick',
      b.fontFamily || 'Calibri',
      b.isDefault ? 1 : 0
    );
  res.status(201).json(sqlite.prepare('SELECT * FROM document_templates WHERE id = ?').get(id));
});

app.put('/api/templates/:id', requireAuth, (req: AuthRequest, res) => {
  const row = sqlite.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Template tidak ditemukan.' });
  if (!assertTenantOwnership(req, row.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

  const b = req.body;
  if (b.isDefault) {
    sqlite.prepare('UPDATE document_templates SET is_default = 0 WHERE tenant_id = ?').run(row.tenant_id);
  }
  sqlite
    .prepare(
      `UPDATE document_templates
       SET name = ?, logo_url = ?, right_logo_url = ?, logo_position = ?, logo_size = ?, pemkab_line = ?, line_1 = ?, line_2 = ?, line_3 = ?, line_4 = ?,
           address_line = ?, contact_line = ?, border_style = ?, font_family = ?, is_default = ?, updated_at = datetime('now')
       WHERE id = ? AND tenant_id = ?`
    )
    .run(
      b.name ?? row.name,
      b.logoUrl ?? row.logo_url,
      b.rightLogoUrl ?? row.right_logo_url ?? '',
      b.logoPosition ?? row.logo_position,
      Number(b.logoSize ?? row.logo_size),
      b.pemkabLine ?? row.pemkab_line ?? '',
      b.line1 ?? row.line_1,
      b.line2 ?? row.line_2,
      b.line3 ?? row.line_3,
      b.line4 ?? row.line_4,
      b.addressLine ?? row.address_line,
      b.contactLine ?? row.contact_line,
      b.borderStyle ?? row.border_style,
      b.fontFamily ?? row.font_family,
      b.isDefault ? 1 : row.is_default,
      row.id,
      row.tenant_id
    );

  // Keep school_profiles logos & pemkab synced when saving the default template
  if (b.isDefault || row.is_default === 1) {
    sqlite
      .prepare(
        `UPDATE school_profiles
         SET pemkab_name = COALESCE(NULLIF(?, ''), pemkab_name),
             pemkab_logo_url = ?,
             school_logo_url = ?,
             updated_at = datetime('now')
         WHERE tenant_id = ?`
      )
      .run(
        b.pemkabLine ?? row.pemkab_line ?? '',
        b.logoUrl ?? row.logo_url ?? '',
        b.rightLogoUrl ?? row.right_logo_url ?? '',
        row.tenant_id
      );
  }
  res.json(sqlite.prepare('SELECT * FROM document_templates WHERE id = ?').get(row.id));
});

app.post('/api/templates/:id/set-default', requireAuth, (req: AuthRequest, res) => {
  const row = sqlite.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Template tidak ditemukan.' });
  if (!assertTenantOwnership(req, row.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

  sqlite.prepare('UPDATE document_templates SET is_default = 0 WHERE tenant_id = ?').run(row.tenant_id);
  sqlite.prepare('UPDATE document_templates SET is_default = 1 WHERE id = ?').run(row.id);
  res.json({ success: true });
});

app.delete('/api/templates/:id', requireAuth, (req: AuthRequest, res) => {
  const row = sqlite.prepare('SELECT * FROM document_templates WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Template tidak ditemukan.' });
  if (!assertTenantOwnership(req, row.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });
  sqlite.prepare('DELETE FROM document_templates WHERE id = ? AND tenant_id = ?').run(row.id, row.tenant_id);
  res.json({ success: true });
});

// ============================================================================
// DOCUMENT EXPORT (WORD, PDF, EXCEL) & DOKUMEN SAYA
// ============================================================================
app.get('/api/documents', requireAuth, (req: AuthRequest, res) => {
  const docs = sqlite
    .prepare(
      `SELECT gd.*, ap.title AS project_title, u.full_name AS creator_name
       FROM generated_documents gd
       LEFT JOIN assessment_projects ap ON ap.id = gd.project_id
       LEFT JOIN users u ON u.id = gd.user_id
       WHERE gd.tenant_id = ?
       ORDER BY gd.created_at DESC
       LIMIT 60`
    )
    .all(req.authUser!.tenantId);
  res.json(docs);
});

app.get('/api/export/:projectId/:category/:format', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { projectId, category, format } = req.params;
    const project = sqlite.prepare('SELECT * FROM assessment_projects WHERE id = ?').get(projectId) as any;
    if (!project) return res.status(404).json({ error: 'Proyek asesmen tidak ditemukan.' });
    if (!assertTenantOwnership(req, project.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

    const tenantId = project.tenant_id;
    const template =
      (project.template_id && sqlite.prepare('SELECT * FROM document_templates WHERE id = ? AND tenant_id = ?').get(project.template_id, tenantId)) ||
      sqlite.prepare('SELECT * FROM document_templates WHERE tenant_id = ? ORDER BY is_default DESC LIMIT 1').get(tenantId);
    const settingsRow = sqlite.prepare('SELECT formatting_json FROM tenant_settings WHERE tenant_id = ?').get(tenantId) as any;
    const formatting = settingsRow ? JSON.parse(settingsRow.formatting_json || '{}') : DEFAULT_ASKARA_FORMATTING;
    const schoolProfile = sqlite.prepare('SELECT * FROM school_profiles WHERE tenant_id = ?').get(tenantId);
    const blueprints = sqlite.prepare('SELECT * FROM assessment_blueprints WHERE project_id = ? AND tenant_id = ? ORDER BY row_number ASC').all(projectId, tenantId);
    const questionsRaw = sqlite
      .prepare(
        `SELECT aq.*, ak.correct_answer, ak.explanation, sr.ideal_answer, sr.scoring_guide, sr.max_score
         FROM assessment_questions aq
         LEFT JOIN answer_keys ak ON ak.question_id = aq.id
         LEFT JOIN scoring_rubrics sr ON sr.question_id = aq.id
         WHERE aq.project_id = ? AND aq.tenant_id = ?
         ORDER BY aq.question_number ASC`
      )
      .all(projectId, tenantId) as any[];

    const questions = questionsRaw.map((q) => ({
      ...q,
      options: JSON.parse(q.options_json || '[]'),
      matching_pairs: JSON.parse(q.matching_pairs_json || '[]'),
    }));
    const cognitiveSummary = sqlite.prepare('SELECT * FROM cognitive_analysis WHERE project_id = ? AND tenant_id = ?').get(projectId, tenantId);

    const bundle = { project, template, formatting, schoolProfile, blueprints, questions, cognitiveSummary };
    const safeSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const fileName = `${safeSlug}-${category}.${format}`;

    sqlite
      .prepare(`INSERT INTO generated_documents (id, tenant_id, project_id, user_id, doc_category, format, title, file_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), tenantId, projectId, req.authUser!.id, category, format.toUpperCase(), `${project.title} (${category})`, fileName);

    logActivity(tenantId, req.authUser!.id, 'EXPORT_DOCUMENT', 'generated_documents', projectId, `Mengunduh ${fileName}`);

    if (format === 'docx') {
      const buf = await generateDocxBuffer(category, bundle);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(buf);
    } else if (format === 'pdf') {
      const buf = await generatePdfBuffer(category, bundle);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(buf);
    } else if (format === 'xlsx') {
      const buf = generateExcelBuffer(bundle);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(buf);
    } else {
      return res.status(400).json({ error: 'Format tidak didukung. Gunakan docx, pdf, atau xlsx.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal mengekspor dokumen.' });
  }
});

// ============================================================================
// TENANT ADMIN SETTINGS & TEACHER MANAGEMENT
// ============================================================================
app.put('/api/tenant/profile', requireAuth, requireRole('super_admin', 'tenant_admin'), (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;
  const {
    npsn,
    pemkabName,
    dinasName,
    schoolName,
    gugusName,
    address,
    phone,
    email,
    headmasterName,
    pemkabLogoUrl,
    schoolLogoUrl,
    regency,
    province,
    appName,
    slogan,
    logoUrl,
    primaryColor,
  } = req.body;

  sqlite
    .prepare(
      `UPDATE school_profiles
       SET npsn = COALESCE(?, npsn),
           pemkab_name = COALESCE(?, pemkab_name),
           dinas_name = COALESCE(?, dinas_name),
           school_name = COALESCE(?, school_name),
           gugus_name = COALESCE(?, gugus_name),
           address = COALESCE(?, address),
           phone = COALESCE(?, phone),
           email = COALESCE(?, email),
           headmaster_name = COALESCE(?, headmaster_name),
           pemkab_logo_url = COALESCE(?, pemkab_logo_url),
           school_logo_url = COALESCE(?, school_logo_url),
           regency = COALESCE(?, regency),
           province = COALESCE(?, province),
           updated_at = datetime('now')
       WHERE tenant_id = ?`
    )
    .run(
      npsn ?? null,
      pemkabName ?? null,
      dinasName ?? null,
      schoolName ?? null,
      gugusName ?? null,
      address ?? null,
      phone ?? null,
      email ?? null,
      headmasterName ?? null,
      pemkabLogoUrl ?? null,
      schoolLogoUrl ?? null,
      regency ?? null,
      province ?? null,
      tenantId
    );

  sqlite
    .prepare(
      `UPDATE tenant_branding
       SET app_name = COALESCE(?, app_name), slogan = COALESCE(?, slogan), logo_url = COALESCE(?, logo_url),
           primary_color = COALESCE(?, primary_color), updated_at = datetime('now')
       WHERE tenant_id = ?`
    )
    .run(appName ?? null, slogan ?? null, logoUrl ?? null, primaryColor ?? null, tenantId);

  if (schoolName) {
    sqlite.prepare(`UPDATE tenants SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(schoolName, tenantId);
  }

  // Auto-sync updated school profile (Pemkab, Dinas, Sekolah, Alamat, Email/Telp, dan Dual Logo) to default Kop Surat template
  const updatedSp = sqlite.prepare('SELECT * FROM school_profiles WHERE tenant_id = ?').get(tenantId) as any;
  const defTpl = sqlite
    .prepare('SELECT * FROM document_templates WHERE tenant_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1')
    .get(tenantId) as any;
  if (defTpl && updatedSp) {
    const syncedContact = [
      updatedSp.email ? `Email: ${String(updatedSp.email).trim()}` : '',
      updatedSp.phone ? `Telp: ${String(updatedSp.phone).trim()}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const nextLogoLeft = pemkabLogoUrl !== undefined ? pemkabLogoUrl : defTpl.logo_url;
    const nextLogoRight = schoolLogoUrl !== undefined ? schoolLogoUrl : defTpl.right_logo_url;
    const nextLogoPos = nextLogoRight ? 'dual' : defTpl.logo_position;

    sqlite
      .prepare(
        `UPDATE document_templates
         SET pemkab_line = ?,
             line_1 = COALESCE(NULLIF(?, ''), line_1),
             line_3 = COALESCE(NULLIF(?, ''), line_3),
             address_line = ?,
             contact_line = ?,
             logo_url = ?,
             right_logo_url = ?,
             logo_position = ?,
             updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?`
      )
      .run(
        pemkabName !== undefined ? String(pemkabName).trim() : defTpl.pemkab_line || updatedSp.pemkab_name || '',
        dinasName !== undefined ? String(dinasName).trim().toUpperCase() : '',
        schoolName !== undefined ? String(schoolName).trim().toUpperCase() : '',
        address !== undefined ? String(address).trim() : defTpl.address_line || '',
        email !== undefined || phone !== undefined ? syncedContact : defTpl.contact_line || '',
        nextLogoLeft,
        nextLogoRight,
        nextLogoPos,
        defTpl.id,
        tenantId
      );
  }

  logActivity(tenantId, req.authUser!.id, 'UPDATE_TENANT_PROFILE', 'school_profiles', tenantId, 'Memperbarui profil lembaga, kop surat, dan identitas branding');
  res.json(buildTenantBundle(req.authUser!.id));
});

app.put('/api/tenant/settings', requireAuth, requireRole('super_admin', 'tenant_admin'), (req: AuthRequest, res) => {
  const tenantId = req.authUser!.tenantId;
  const { academicYear, semester, curriculum, questionPresets, formatting } = req.body;

  sqlite
    .prepare(
      `UPDATE tenant_settings
       SET academic_year = COALESCE(?, academic_year),
           semester = COALESCE(?, semester),
           curriculum = COALESCE(?, curriculum),
           question_presets_json = COALESCE(?, question_presets_json),
           formatting_json = COALESCE(?, formatting_json),
           updated_at = datetime('now')
       WHERE tenant_id = ?`
    )
    .run(
      academicYear ?? null,
      semester ?? null,
      curriculum ?? null,
      questionPresets ? JSON.stringify(questionPresets) : null,
      formatting ? JSON.stringify(formatting) : null,
      tenantId
    );

  logActivity(tenantId, req.authUser!.id, 'UPDATE_TENANT_SETTINGS', 'tenant_settings', tenantId, 'Memperbarui pengaturan tahun pelajaran, preset soal, dan tata naskah');
  res.json(buildTenantBundle(req.authUser!.id));
});

app.get('/api/tenant/users', requireAuth, requireRole('super_admin', 'tenant_admin'), (req: AuthRequest, res) => {
  const rows = sqlite
    .prepare('SELECT id, tenant_id, role_id, full_name, email, status, is_active, last_login_at, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC')
    .all(req.authUser!.tenantId);
  res.json(rows);
});

app.post('/api/tenant/users', requireAuth, requireRole('super_admin', 'tenant_admin'), (req: AuthRequest, res) => {
  const { fullName, email, password, roleId } = req.body;
  if (!fullName || !email || !password) return res.status(400).json({ error: 'Nama, email, dan kata sandi wajib diisi.' });
  const cleanEmail = String(email).trim().toLowerCase();
  if (sqlite.prepare('SELECT id FROM users WHERE lower(email) = ?').get(cleanEmail)) {
    return res.status(409).json({ error: 'Email sudah terdaftar.' });
  }
  const safeRole = roleId === 'tenant_admin' ? 'tenant_admin' : 'teacher';
  const id = 'user-' + crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(`INSERT INTO users (id, tenant_id, role_id, full_name, email, password_hash, status, email_verified, is_active) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 1)`)
    .run(id, req.authUser!.tenantId, safeRole, fullName.trim(), cleanEmail, bcrypt.hashSync(String(password), 10));
  logActivity(req.authUser!.tenantId, req.authUser!.id, 'ADD_TEACHER', 'users', id, `Menambahkan anggota ${fullName.trim()} (${safeRole})`);
  res.status(201).json({ id });
});

app.patch('/api/tenant/users/:uid', requireAuth, requireRole('super_admin', 'tenant_admin'), (req: AuthRequest, res) => {
  const target = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(req.params.uid) as any;
  if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  if (!assertTenantOwnership(req, target.tenant_id)) return res.status(403).json({ error: 'Akses ditolak.' });

  const { roleId, isActive, status } = req.body;
  const safeRole = roleId === 'tenant_admin' || roleId === 'teacher' ? roleId : target.role_id;
  sqlite
    .prepare(`UPDATE users SET role_id = ?, is_active = COALESCE(?, is_active), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?`)
    .run(safeRole, typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null, status ?? null, target.id);
  res.json({ success: true });
});

// ============================================================================
// SUPER ADMIN CONSOLE (EXCLUSIVE TO MASTER ADMIN: ary.vandy@gmail.com)
// ============================================================================
app.get('/api/superadmin/overview', requireAuth, requireMasterAdmin, (_req, res) => {
  const tenants = sqlite
    .prepare(
      `SELECT t.*, s.plan_name, s.monthly_ai_limit, s.max_users, s.status AS sub_status, s.valid_until,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
              (SELECT COUNT(*) FROM assessment_projects ap WHERE ap.tenant_id = t.id) AS assessment_count,
              (SELECT COUNT(*) FROM ai_usage_logs al WHERE al.tenant_id = t.id) AS ai_calls
       FROM tenants t
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       ORDER BY CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END, t.created_at DESC`
    )
    .all();

  const users = sqlite
    .prepare(
      `SELECT u.id, u.tenant_id, u.full_name, u.email, u.role_id, u.status, u.is_active, u.access_expires_at, u.last_login_at, u.created_at, t.name AS tenant_name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       ORDER BY u.created_at DESC`
    )
    .all();

  const aiLogs = sqlite
    .prepare(
      `SELECT al.*, t.name AS tenant_name, u.full_name AS user_name
       FROM ai_usage_logs al
       LEFT JOIN tenants t ON t.id = al.tenant_id
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC
       LIMIT 40`
    )
    .all();

  const activityLogs = sqlite
    .prepare(
      `SELECT act.*, t.name AS tenant_name, u.full_name AS actor_name
       FROM activity_logs act
       LEFT JOIN tenants t ON t.id = act.tenant_id
       LEFT JOIN users u ON u.id = act.user_id
       ORDER BY act.created_at DESC
       LIMIT 50`
    )
    .all();

  const sysSettings = sqlite.prepare('SELECT * FROM system_settings').all() as Array<{ key: string; value: string; description: string }>;
  const settingsMap: Record<string, string> = {};
  for (const s of sysSettings) settingsMap[s.key] = s.value;

  res.json({ tenants, users, aiLogs, activityLogs, systemSettings: settingsMap, masterEmail: MASTER_ADMIN_EMAIL });
});

app.patch('/api/superadmin/tenants/:tenantId/status', requireAuth, requireMasterAdmin, (req: AuthRequest, res) => {
  const { status, isActive, validUntil } = req.body;
  const target = sqlite.prepare('SELECT id, name FROM tenants WHERE id = ?').get(req.params.tenantId) as any;
  if (!target) return res.status(404).json({ error: 'Tenant tidak ditemukan.' });
  if (target.id === 'tenant-gugus04' && (status === 'rejected' || isActive === false)) {
    return res.status(400).json({ error: 'Tenant utama Master Admin tidak dapat dinonaktifkan.' });
  }
  sqlite
    .prepare(`UPDATE tenants SET status = COALESCE(?, status), is_active = COALESCE(?, is_active), updated_at = datetime('now') WHERE id = ?`)
    .run(status ?? null, typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null, target.id);

  if (validUntil !== undefined && target.id !== 'tenant-gugus04') {
    const cleanDate = String(validUntil || '').trim().slice(0, 10);
    if (cleanDate && !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      return res.status(400).json({ error: 'Format tanggal batas penggunaan harus YYYY-MM-DD atau kosong untuk tanpa batas.' });
    }
    sqlite
      .prepare(`UPDATE subscriptions SET valid_until = ?, updated_at = datetime('now') WHERE tenant_id = ?`)
      .run(cleanDate, target.id);
  }

  logActivity('tenant-gugus04', req.authUser!.id, 'SUPERADMIN_TENANT_STATUS', 'tenants', target.id, `Status ${target.name} diubah menjadi ${status || (isActive ? 'aktif' : 'nonaktif')}${validUntil ? ` (berlaku s.d. ${validUntil})` : ''}`);
  res.json({ success: true });
});

app.patch('/api/superadmin/tenants/:tenantId/subscription', requireAuth, requireMasterAdmin, (req: AuthRequest, res) => {
  const { planName, monthlyAiLimit, maxUsers, status, validUntil } = req.body;
  const target = sqlite.prepare('SELECT id, name FROM tenants WHERE id = ?').get(req.params.tenantId) as any;
  if (!target) return res.status(404).json({ error: 'Tenant tidak ditemukan.' });

  let cleanValidUntil: string | null = null;
  if (validUntil !== undefined) {
    const raw = String(validUntil || '').trim().slice(0, 10);
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'Format tanggal batas waktu harus YYYY-MM-DD atau kosong untuk tanpa batas.' });
    }
    cleanValidUntil = target.id === 'tenant-gugus04' ? '' : raw;
  }

  sqlite
    .prepare(
      `UPDATE subscriptions
       SET plan_name = COALESCE(?, plan_name),
           monthly_ai_limit = COALESCE(?, monthly_ai_limit),
           max_users = COALESCE(?, max_users),
           status = COALESCE(?, status),
           valid_until = COALESCE(?, valid_until),
           updated_at = datetime('now')
       WHERE tenant_id = ?`
    )
    .run(planName ?? null, monthlyAiLimit ?? null, maxUsers ?? null, status ?? null, cleanValidUntil, req.params.tenantId);

  logActivity('tenant-gugus04', req.authUser!.id, 'SUPERADMIN_TENANT_EXPIRY', 'subscriptions', target.id, `Batas penggunaan ${target.name} diperbarui: ${cleanValidUntil === null ? 'pengaturan paket' : cleanValidUntil || 'Tanpa Batas'}`);
  res.json({ success: true });
});

app.delete('/api/superadmin/tenants/:tenantId', requireAuth, requireMasterAdmin, (req: AuthRequest, res) => {
  const target = sqlite.prepare('SELECT id, name FROM tenants WHERE id = ?').get(req.params.tenantId) as any;
  if (!target) return res.status(404).json({ error: 'Tenant tidak ditemukan.' });
  if (target.id === 'tenant-gugus04') {
    return res.status(400).json({ error: 'Tenant utama Master Admin tidak dapat dihapus.' });
  }
  sqlite.prepare('DELETE FROM tenants WHERE id = ?').run(target.id);
  logActivity('tenant-gugus04', req.authUser!.id, 'SUPERADMIN_DELETE_TENANT', 'tenants', target.id, `Menghapus lembaga ${target.name}`);
  res.json({ success: true });
});

app.patch('/api/superadmin/users/:userId', requireAuth, requireMasterAdmin, (req: AuthRequest, res) => {
  const target = sqlite.prepare('SELECT id, email, full_name, role_id FROM users WHERE id = ?').get(req.params.userId) as any;
  if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  if (String(target.email || '').toLowerCase() === MASTER_ADMIN_EMAIL) {
    return res.status(400).json({ error: 'Akun Master Pengendali utama tidak dapat diblokir atau dibatasi.' });
  }

  const { isActive, roleId, accessExpiresAt } = req.body;
  if (roleId === 'super_admin') {
    return res.status(403).json({ error: `Peran super_admin eksklusif hanya untuk ${MASTER_ADMIN_EMAIL}.` });
  }
  const safeRole = roleId === 'tenant_admin' || roleId === 'teacher' ? roleId : null;

  let cleanExpires: string | null = null;
  if (accessExpiresAt !== undefined) {
    const raw = String(accessExpiresAt || '').trim().slice(0, 10);
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'Format tanggal batas akses akun harus YYYY-MM-DD atau kosong untuk tanpa batas.' });
    }
    cleanExpires = raw;
  }

  sqlite
    .prepare(
      `UPDATE users
       SET is_active = COALESCE(?, is_active),
           role_id = COALESCE(?, role_id),
           access_expires_at = COALESCE(?, access_expires_at),
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null, safeRole, cleanExpires, req.params.userId);
  logActivity('tenant-gugus04', req.authUser!.id, 'SUPERADMIN_USER_CONTROL', 'users', target.id, `Memperbarui kontrol akses akun ${target.email}${cleanExpires !== null ? ` (batas: ${cleanExpires || 'Tanpa Batas'})` : ''}`);
  res.json({ success: true });
});

app.put('/api/superadmin/settings', requireAuth, requireMasterAdmin, (req: AuthRequest, res) => {
  const { aiModel, aiThinkingLevel, announcement, educationReferences } = req.body;
  const upsert = sqlite.prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  if (aiModel) upsert.run('ai_model', aiModel);
  if (aiThinkingLevel) upsert.run('ai_thinking_level', aiThinkingLevel);
  if (announcement !== undefined) upsert.run('system_announcement', announcement);
  if (educationReferences) upsert.run('education_references', typeof educationReferences === 'string' ? educationReferences : JSON.stringify(educationReferences));
  logActivity('tenant-gugus04', req.authUser!.id, 'UPDATE_GLOBAL_SETTINGS', 'system_settings', 'global', 'Master Admin memperbarui konfigurasi global AI & pengumuman');
  res.json({ success: true });
});

app.get('/api/superadmin/backup', requireAuth, requireMasterAdmin, (req: AuthRequest, res) => {
  const tables = [
    'tenants', 'users', 'roles', 'permissions', 'tenant_settings', 'tenant_branding',
    'school_profiles', 'reference_documents', 'reference_chunks', 'learning_outcomes',
    'learning_objectives', 'assessment_projects', 'assessment_blueprints', 'assessment_questions',
    'answer_keys', 'scoring_rubrics', 'cognitive_analysis', 'question_banks',
    'document_templates', 'generated_documents', 'ai_usage_logs', 'activity_logs',
    'subscriptions', 'system_settings',
  ];
  const backup: Record<string, any[]> = {};
  for (const tbl of tables) {
    backup[tbl] = sqlite.prepare(`SELECT * FROM ${tbl}`).all();
  }
  logActivity('tenant-gugus04', req.authUser!.id, 'BACKUP_DATABASE', 'system', 'all', 'Mengunduh backup penuh 24 tabel database ASKARA');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="askara-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), tables: backup }, null, 2));
});

// ============================================================================
// EXPRESS JSON ERROR HANDLER (MULTER / PAYLOAD / API ERRORS)
// ============================================================================
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Ukuran file terlalu besar. Maksimal ukuran file unggahan adalah 50 MB (untuk logo disarankan < 5 MB dan PDF buku < 30 MB).',
      });
    }
    return res.status(400).json({ error: `Gagal memproses unggahan file: ${err.message}` });
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Ukuran data permintaan melebihi batas maksimal server.' });
  }
  const status = Number(err.status || err.statusCode || 500);
  return res.status(status).json({ error: err.message || 'Terjadi kesalahan pada server.' });
});

// ============================================================================
// SERVER STARTUP (EXPRESS + VITE MIDDLEWARE)
// ============================================================================
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production' || (process.argv[1] || '').endsWith('server.mjs');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ASKARA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
