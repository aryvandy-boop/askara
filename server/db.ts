import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'askara.sqlite');
export const sqlite = new DatabaseSync(dbPath);
export const MASTER_ADMIN_EMAIL = 'ary.vandy@gmail.com';

sqlite.exec('PRAGMA busy_timeout = 5000;');
sqlite.exec('PRAGMA foreign_keys = ON;');
try {
  sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
} catch {
  // Ignore if not currently in WAL mode
}
sqlite.exec('PRAGMA journal_mode = DELETE;');

export function initSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      institution_type TEXT NOT NULL DEFAULT 'Sekolah Mandiri',
      regency TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      admin_name TEXT NOT NULL DEFAULT '',
      admin_email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      firebase_uid TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      email_verified INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      access_expires_at TEXT NOT NULL DEFAULT '',
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tenant_settings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      academic_year TEXT NOT NULL DEFAULT '2026/2027',
      semester TEXT NOT NULL DEFAULT '1',
      curriculum TEXT NOT NULL DEFAULT 'Kurikulum Merdeka',
      question_presets_json TEXT NOT NULL,
      formatting_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tenant_branding (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      app_name TEXT NOT NULL,
      slogan TEXT NOT NULL DEFAULT 'Berkarya dengan Inovasi, Berkualitas dalam Asesmen.',
      logo_url TEXT NOT NULL DEFAULT '',
      primary_color TEXT NOT NULL DEFAULT '#1d4ed8',
      navy_color TEXT NOT NULL DEFAULT '#0a192f',
      accent_color TEXT NOT NULL DEFAULT '#d4af37',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS school_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      npsn TEXT NOT NULL DEFAULT '',
      pemkab_name TEXT NOT NULL DEFAULT '',
      dinas_name TEXT NOT NULL DEFAULT '',
      school_name TEXT NOT NULL DEFAULT '',
      gugus_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      headmaster_name TEXT NOT NULL DEFAULT '',
      headmaster_nip TEXT NOT NULL DEFAULT '',
      pemkab_logo_url TEXT NOT NULL DEFAULT '',
      school_logo_url TEXT NOT NULL DEFAULT '',
      regency TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_templates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      logo_url TEXT NOT NULL DEFAULT '',
      right_logo_url TEXT NOT NULL DEFAULT '',
      logo_position TEXT NOT NULL DEFAULT 'dual',
      logo_size INTEGER NOT NULL DEFAULT 96,
      pemkab_line TEXT NOT NULL DEFAULT '',
      line_1 TEXT NOT NULL DEFAULT '',
      line_2 TEXT NOT NULL DEFAULT '',
      line_3 TEXT NOT NULL DEFAULT '',
      line_4 TEXT NOT NULL DEFAULT '',
      address_line TEXT NOT NULL DEFAULT '',
      contact_line TEXT NOT NULL DEFAULT '',
      border_style TEXT NOT NULL DEFAULT 'thick',
      font_family TEXT NOT NULL DEFAULT 'Calibri',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reference_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL DEFAULT '',
      grade_level TEXT NOT NULL DEFAULT '',
      semester TEXT NOT NULL DEFAULT 'Semua',
      page_count INTEGER NOT NULL DEFAULT 1,
      extracted_text TEXT NOT NULL DEFAULT '',
      chapters_json TEXT NOT NULL DEFAULT '[]',
      concepts_json TEXT NOT NULL DEFAULT '[]',
      competencies_json TEXT NOT NULL DEFAULT '[]',
      images_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reference_chunks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL DEFAULT '',
      page_number INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES reference_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS learning_outcomes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reference_id TEXT,
      subject TEXT NOT NULL,
      phase TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS learning_objectives (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      outcome_id TEXT,
      subject TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      atp_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (outcome_id) REFERENCES learning_outcomes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS assessment_projects (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      template_id TEXT,
      title TEXT NOT NULL,
      education_level TEXT NOT NULL DEFAULT 'SD/MI',
      grade_level TEXT NOT NULL,
      semester TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      curriculum TEXT NOT NULL DEFAULT 'Kurikulum Merdeka',
      subject TEXT NOT NULL,
      topic TEXT NOT NULL,
      assessment_type TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 90,
      difficulty TEXT NOT NULL DEFAULT 'Campuran Proporsional',
      cognitive_composition_json TEXT NOT NULL DEFAULT '{"LOTS":30,"MOTS":50,"HOTS":20}',
      question_counts_json TEXT NOT NULL DEFAULT '{}',
      reference_ids_json TEXT NOT NULL DEFAULT '[]',
      selected_chapters_json TEXT NOT NULL DEFAULT '[]',
      source_warning TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      qc_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS assessment_blueprints (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      cp TEXT NOT NULL,
      tp TEXT NOT NULL,
      materi TEXT NOT NULL,
      indikator_soal TEXT NOT NULL,
      level_kognitif TEXT NOT NULL,
      bentuk_soal TEXT NOT NULL,
      nomor_soal TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES assessment_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_questions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      blueprint_id TEXT,
      question_number INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      materi TEXT NOT NULL,
      indikator_soal TEXT NOT NULL,
      cognitive_level TEXT NOT NULL,
      cognitive_tier TEXT NOT NULL DEFAULT 'MOTS',
      cognitive_rationale TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'Sedang',
      question_text TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      matching_pairs_json TEXT NOT NULL DEFAULT '[]',
      source_reference TEXT NOT NULL DEFAULT '',
      source_page TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      image_caption TEXT NOT NULL DEFAULT '',
      qc_status TEXT NOT NULL DEFAULT 'pending',
      qc_notes TEXT NOT NULL DEFAULT '',
      is_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES assessment_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS answer_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      question_id TEXT NOT NULL UNIQUE,
      correct_answer TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES assessment_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scoring_rubrics (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      question_id TEXT NOT NULL UNIQUE,
      ideal_answer TEXT NOT NULL DEFAULT '',
      scoring_guide TEXT NOT NULL DEFAULT '',
      criteria_json TEXT NOT NULL DEFAULT '[]',
      max_score INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES assessment_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cognitive_analysis (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL UNIQUE,
      c1_count INTEGER NOT NULL DEFAULT 0,
      c2_count INTEGER NOT NULL DEFAULT 0,
      c3_count INTEGER NOT NULL DEFAULT 0,
      c4_count INTEGER NOT NULL DEFAULT 0,
      c5_count INTEGER NOT NULL DEFAULT 0,
      c6_count INTEGER NOT NULL DEFAULT 0,
      lots_count INTEGER NOT NULL DEFAULT 0,
      mots_count INTEGER NOT NULL DEFAULT 0,
      hots_count INTEGER NOT NULL DEFAULT 0,
      summary_notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES assessment_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_banks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      source_question_id TEXT,
      grade_level TEXT NOT NULL,
      subject TEXT NOT NULL,
      semester TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      materi TEXT NOT NULL,
      cognitive_level TEXT NOT NULL,
      cognitive_tier TEXT NOT NULL DEFAULT 'MOTS',
      assessment_type TEXT NOT NULL,
      question_type TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'Sedang',
      question_text TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      correct_answer TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      image_caption TEXT NOT NULL DEFAULT '',
      max_score INTEGER NOT NULL DEFAULT 1,
      is_shared INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS generated_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      doc_category TEXT NOT NULL,
      format TEXT NOT NULL,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES assessment_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      model_name TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      plan_name TEXT NOT NULL DEFAULT 'Standar Sekolah',
      monthly_ai_limit INTEGER NOT NULL DEFAULT 500,
      max_users INTEGER NOT NULL DEFAULT 25,
      max_references INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'active',
      valid_until TEXT NOT NULL DEFAULT '2027-12-31',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export const DEFAULT_ASKARA_PRESETS = {
  'Kelas I': { pilihan_ganda: 20, isian: 10, uraian: 0, total: 30 },
  'Kelas II': { pilihan_ganda: 20, isian: 10, uraian: 0, total: 30 },
  'Kelas III': { pilihan_ganda: 20, isian: 10, uraian: 5, total: 35 },
  'Kelas IV': { pilihan_ganda: 25, isian: 10, uraian: 5, total: 40 },
  'Kelas V': { pilihan_ganda: 25, isian: 10, uraian: 5, total: 40 },
  'Kelas VI': { pilihan_ganda: 25, isian: 10, uraian: 5, total: 40 },
  'Matematika': { pilihan_ganda: 20, isian: 10, uraian: 5, total: 35 },
  'Bahasa Inggris': { pilihan_ganda: 20, isian: 10, uraian: 0, total: 30 },
  'Bahasa Madura': { pilihan_ganda: 25, isian: 10, uraian: 5, total: 40 },
  'PAIBP': { pilihan_ganda: 25, isian: 10, uraian: 5, total: 40 },
  'PJOK': { pilihan_ganda: 25, isian: 10, uraian: 5, total: 40 },
};

export const DEFAULT_ASKARA_FORMATTING = {
  fontFamily: 'Calibri',
  fontSizeClass12: 14,
  fontSizeClass345: 12,
  fontSizeClass6: 12,
  paperWidthCm: 21.5,
  paperHeightCm: 33,
  marginTopCm: 1,
  marginBottomCm: 1,
  marginRightCm: 1,
  marginLeftCm: 2,
  lineSpacing: 1.15,
  grayscaleImages: true,
  lowercaseOptions: true,
  shortAnswerInline: true,
  longAnswerVertical: true,
  noBlankPages: true,
};

export const DEFAULT_APP_PROFILE_LOGO = '/assets/aistudio/Logo_ASKARA_04_Biru_Emas_8b6c2828.png';

export const DEFAULT_PEMKAB_LOGO_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#ffffff"/><path d="M60 12 L100 28 L96 72 C92 94 74 106 60 112 C46 106 28 94 24 72 L20 28 Z" fill="#f8fafc" stroke="#111827" stroke-width="5"/><path d="M60 22 L90 34 L87 69 C84 86 70 96 60 101 C50 96 36 86 33 69 L30 34 Z" fill="none" stroke="#111827" stroke-width="2"/><polygon points="60,29 63.5,39 74,39 65.5,45.5 68.5,56 60,49.5 51.5,56 54.5,45.5 46,39 56.5,39" fill="#111827"/><path d="M40 66 Q60 56 80 66 L80 80 Q60 72 40 80 Z" fill="none" stroke="#111827" stroke-width="2.5"/><line x1="60" y1="61" x2="60" y2="76" stroke="#111827" stroke-width="2"/></svg>`
)}`;

export function seedInitialData() {
  const existingTenant = sqlite.prepare('SELECT id FROM tenants WHERE id = ?').get('tenant-gugus04');
  if (existingTenant) return;

  // Roles
  const insertRole = sqlite.prepare('INSERT INTO roles (id, name, label, description) VALUES (?, ?, ?, ?)');
  insertRole.run('super_admin', 'super_admin', 'Super Admin ASKARA 04', 'Pengendali utama seluruh sistem multi-tenant ASKARA 04 Gugus 04 Arjasa');
  insertRole.run('tenant_admin', 'tenant_admin', 'Admin Sekolah / Lembaga', 'Administrator pengelola profil, logo, kop surat, dan guru internal tenant');
  insertRole.run('teacher', 'teacher', 'Guru / Anggota', 'Pendidik pembuat perangkat asesmen, referensi, bank soal, dan ekspor dokumen');

  // Permissions
  const insertPerm = sqlite.prepare('INSERT INTO permissions (id, role_id, resource, action) VALUES (?, ?, ?, ?)');
  const perms: [string, string, string][] = [
    ['super_admin', 'platform', 'manage_all'],
    ['super_admin', 'tenants', 'approve_suspend'],
    ['super_admin', 'ai_config', 'configure'],
    ['super_admin', 'backup', 'export'],
    ['tenant_admin', 'tenant_settings', 'manage'],
    ['tenant_admin', 'branding', 'manage'],
    ['tenant_admin', 'teachers', 'manage'],
    ['tenant_admin', 'assessments', 'manage_all'],
    ['teacher', 'references', 'create_read'],
    ['teacher', 'assessments', 'generate_edit_approve'],
    ['teacher', 'question_bank', 'read_create'],
    ['teacher', 'documents', 'export'],
  ];
  for (const [roleId, resource, action] of perms) {
    insertPerm.run(crypto.randomUUID(), roleId, resource, action);
  }

  // System settings
  const insertSys = sqlite.prepare('INSERT INTO system_settings (key, value, description) VALUES (?, ?, ?)');
  insertSys.run('ai_model', 'gemini-4-hydrogen', 'Model AI utama yang digunakan oleh platform ASKARA');
  insertSys.run('ai_thinking_level', 'LOW', 'Kedalaman penalaran AI default (LOW / MEDIUM / HIGH)');
  insertSys.run(
    'system_announcement',
    'Rambu-rambu penyusunan naskah SAS Semester 1 Tahun Pelajaran 2026/2027 Gugus 04 Arjasa telah aktif: Calibri 14pt (Kls 1-2) / 12pt (Kls 3-6), kertas F4 21,5 × 33 cm, margin kiri 2 cm.',
    'Pengumuman resmi Super Admin untuk seluruh tenant'
  );
  const expandedEduRefs = {
    levels: ['PAUD/TK', 'SD/MI', 'SMP/MTs', 'SMA/MA', 'SMK', 'Madrasah / Keagamaan', 'Umum / Lainnya'],
    curricula: ['Kurikulum Merdeka', 'Kurikulum 2013', 'Kemenag (KMA)', 'Kustom Lembaga'],
    subjects: [
      'Pendidikan Pancasila',
      'Bahasa Indonesia',
      'Matematika',
      'IPAS (Ilmu Pengetahuan Alam dan Sosial)',
      'IPA (Ilmu Pengetahuan Alam)',
      'IPS (Ilmu Pengetahuan Sosial)',
      'PAIBP (Pendidikan Agama Islam dan Budi Pekerti)',
      'Pendidikan Agama & Budi Pekerti Lainnya',
      'PJOK',
      'Bahasa Inggris',
      'Bahasa Madura',
      'Bahasa Jawa',
      'Bahasa Sunda',
      'Seni Rupa',
      'Seni Musik',
      'Seni Tari & Teater',
      'Prakarya & Kewirausahaan',
      'Informatika / Koding & AI',
      'Fisika',
      'Kimia',
      'Biologi',
      'Ekonomi',
      'Sosiologi',
      'Geografi',
      'Sejarah',
      'Antropologi',
      'Bahasa Arab',
      'Al-Qur\'an Hadis',
      'Akidah Akhlak',
      'Fikih',
      'Sejarah Kebudayaan Islam (SKI)',
      'Dasar Program Keahlian SMK',
      'Teknik Komputer & Jaringan (TJKT)',
      'Akuntansi & Keuangan Lembaga',
      'Teknik Otomotif',
    ],
    assessmentTypes: [
      'Sumatif Akhir Semester (SAS)',
      'Sumatif Tengah Semester (STS)',
      'Sumatif Akhir Tahun (SAT)',
      'Penilaian Harian',
      'Asesmen Diagnostik',
      'Asesmen Formatif',
      'Asesmen Sumatif',
      'Latihan Soal',
      'Asesmen Lainnya',
    ],
  };
  insertSys.run(
    'education_references',
    JSON.stringify(expandedEduRefs),
    'Referensi jenjang, kurikulum, mata pelajaran, dan jenis asesmen nasional'
  );

  // Tenant 1: ASKARA 04 - Gugus 04 Arjasa
  const insertTenant = sqlite.prepare(`
    INSERT INTO tenants (id, name, slug, institution_type, regency, province, admin_name, admin_email, status, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertTenant.run(
    'tenant-gugus04',
    'ASKARA 04 – Gugus 04 Arjasa',
    'gugus-04-arjasa',
    'Gugus Sekolah',
    'Kabupaten Situbondo',
    'Jawa Timur',
    'Ketua Gugus 04 Arjasa',
    'admin@gugus04arjasa.id',
    'approved',
    1
  );

  sqlite.prepare(`
    INSERT INTO tenant_branding (id, tenant_id, app_name, slogan, logo_url, primary_color, navy_color, accent_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'tenant-gugus04',
    'ASKARA 04',
    'Berkarya dengan Inovasi, Berkualitas dalam Asesmen.',
    DEFAULT_APP_PROFILE_LOGO,
    '#1d4ed8',
    '#0a192f',
    '#d4af37'
  );

  sqlite.prepare(`
    INSERT INTO school_profiles (id, tenant_id, npsn, pemkab_name, dinas_name, school_name, gugus_name, address, phone, email, headmaster_name, pemkab_logo_url, school_logo_url, regency, province)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'tenant-gugus04',
    '20522604',
    'PEMERINTAH KABUPATEN SITUBONDO',
    'DINAS PENDIDIKAN DAN KEBUDAYAAN',
    'GUGUS 04 ARJASA',
    'GUGUS 04 ARJASA',
    'Jl. Raya Arjasa Km. 12, Kec. Arjasa, Kab. Situbondo 68371',
    '(0338) 674004',
    'sekretariat@gugus04arjasa.id',
    'Drs. H. Ahmad Fauzan, M.Pd.',
    DEFAULT_PEMKAB_LOGO_SVG,
    DEFAULT_APP_PROFILE_LOGO,
    'Kabupaten Situbondo',
    'Jawa Timur'
  );

  sqlite.prepare(`
    INSERT INTO tenant_settings (id, tenant_id, academic_year, semester, curriculum, question_presets_json, formatting_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'tenant-gugus04',
    '2026/2027',
    '1',
    'Kurikulum Merdeka',
    JSON.stringify(DEFAULT_ASKARA_PRESETS),
    JSON.stringify(DEFAULT_ASKARA_FORMATTING)
  );

  sqlite.prepare(`
    INSERT INTO document_templates (id, tenant_id, name, logo_url, right_logo_url, logo_position, logo_size, pemkab_line, line_1, line_2, line_3, line_4, address_line, contact_line, border_style, font_family, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'tpl-gugus04-default',
    'tenant-gugus04',
    'Kop Resmi ASKARA 04 – SAS Gugus 04 Arjasa',
    DEFAULT_PEMKAB_LOGO_SVG,
    DEFAULT_APP_PROFILE_LOGO,
    'dual',
    96,
    'PEMERINTAH KABUPATEN SITUBONDO',
    'DINAS PENDIDIKAN DAN KEBUDAYAAN',
    '[JENIS ASESMEN]',
    'GUGUS 04 ARJASA',
    'TAHUN PELAJARAN [TAHUN PELAJARAN]',
    'Jl. Raya Arjasa Km. 12, Kec. Arjasa, Kab. Situbondo 68371',
    'Email: sekretariat@gugus04arjasa.id · Telp: (0338) 674004',
    'thick',
    'Calibri',
    1
  );

  sqlite.prepare(`
    INSERT INTO subscriptions (id, tenant_id, plan_name, monthly_ai_limit, max_users, max_references, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), 'tenant-gugus04', 'Master Gugus Unlimited', 5000, 100, 500, 'active');

  // Tenant 2: SDN 7 Jatisari (Isolated School Tenant)
  insertTenant.run(
    'tenant-sdn1jatisari',
    'SDN 7 Jatisari',
    'sdn-7-jatisari',
    'Sekolah Mandiri',
    'Kabupaten Situbondo',
    'Jawa Timur',
    'H. Budi Santoso, S.Pd., M.Pd.',
    'admin@sdn7jatisari.sch.id',
    'approved',
    1
  );

  const jatisariSvgLogo = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="20" fill="#0f766e"/><path d="M60 18 L96 36 L96 68 C96 88 76 102 60 108 C44 102 24 88 24 68 L24 36 Z" fill="#ffffff" fill-opacity="0.14" stroke="#facc15" stroke-width="4"/><text x="60" y="68" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="24" fill="#ffffff">SDN 7</text><text x="60" y="88" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#fde047">JATISARI</text></svg>`
  )}`;

  sqlite.prepare(`
    INSERT INTO tenant_branding (id, tenant_id, app_name, slogan, logo_url, primary_color, navy_color, accent_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'tenant-sdn1jatisari',
    'ASKARA 04 · SDN 7 Jatisari',
    'Berkarya dengan Inovasi, Berkualitas dalam Asesmen.',
    DEFAULT_APP_PROFILE_LOGO,
    '#0f766e',
    '#0a192f',
    '#d4af37'
  );

  sqlite.prepare(`
    INSERT INTO school_profiles (id, tenant_id, npsn, pemkab_name, dinas_name, school_name, gugus_name, address, phone, email, headmaster_name, pemkab_logo_url, school_logo_url, regency, province)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'tenant-sdn1jatisari',
    '20522699',
    'PEMERINTAH KABUPATEN SITUBONDO',
    'DINAS PENDIDIKAN DAN KEBUDAYAAN',
    'SD NEGERI 7 JATISARI',
    'KORWIL BIDANG PENDIDIKAN KECAMATAN ARJASA',
    'Jl. Desa Jatisari No. 15, Kec. Arjasa, Kab. Situbondo',
    '(0338) 675112',
    'sdn7jatisari@situbondo.sch.id',
    'H. Budi Santoso, S.Pd., M.Pd.',
    DEFAULT_PEMKAB_LOGO_SVG,
    jatisariSvgLogo,
    'Kabupaten Situbondo',
    'Jawa Timur'
  );

  sqlite.prepare(`
    INSERT INTO tenant_settings (id, tenant_id, academic_year, semester, curriculum, question_presets_json, formatting_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'tenant-sdn1jatisari',
    '2026/2027',
    '1',
    'Kurikulum Merdeka',
    JSON.stringify(DEFAULT_ASKARA_PRESETS),
    JSON.stringify(DEFAULT_ASKARA_FORMATTING)
  );

  sqlite.prepare(`
    INSERT INTO document_templates (id, tenant_id, name, logo_url, right_logo_url, logo_position, logo_size, pemkab_line, line_1, line_2, line_3, line_4, address_line, contact_line, border_style, font_family, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'tpl-sdn1jatisari-default',
    'tenant-sdn1jatisari',
    'Kop Resmi SDN 7 Jatisari',
    DEFAULT_PEMKAB_LOGO_SVG,
    jatisariSvgLogo,
    'dual',
    96,
    'PEMERINTAH KABUPATEN SITUBONDO',
    'DINAS PENDIDIKAN DAN KEBUDAYAAN',
    '[JENIS ASESMEN]',
    'SEKOLAH DASAR NEGERI 7 JATISARI',
    'TAHUN PELAJARAN [TAHUN PELAJARAN]',
    'Jl. Desa Jatisari No. 15, Kec. Arjasa, Kab. Situbondo',
    'Email: sdn7jatisari@situbondo.sch.id · Telp: (0338) 675112',
    'thick',
    'Calibri',
    1
  );

  sqlite.prepare(`
    INSERT INTO subscriptions (id, tenant_id, plan_name, monthly_ai_limit, max_users, max_references, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), 'tenant-sdn1jatisari', 'Sekolah Pro', 1500, 40, 150, 'active');

  // Seed Users
  const insertUser = sqlite.prepare(`
    INSERT INTO users (id, tenant_id, role_id, full_name, email, password_hash, status, email_verified, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(
    'user-superadmin',
    'tenant-gugus04',
    'super_admin',
    'Master Pengendali ASKARA 04 (Ary Vandy)',
    MASTER_ADMIN_EMAIL,
    bcrypt.hashSync('Askara04!Admin', 10),
    'active',
    1,
    1
  );

  insertUser.run(
    'user-admin-gugus04',
    'tenant-gugus04',
    'tenant_admin',
    'Admin Gugus 04 Arjasa',
    'admin@gugus04arjasa.id',
    bcrypt.hashSync('Gugus04!Admin', 10),
    'active',
    1,
    1
  );

  insertUser.run(
    'user-admin-jatisari',
    'tenant-sdn1jatisari',
    'tenant_admin',
    'H. Budi Santoso, S.Pd., M.Pd.',
    'admin@sdn7jatisari.sch.id',
    bcrypt.hashSync('AdminSD!2026', 10),
    'active',
    1,
    1
  );

  insertUser.run(
    'user-guru-jatisari',
    'tenant-sdn1jatisari',
    'teacher',
    'Siti Aminah, S.Pd.',
    'guru@sdn7jatisari.sch.id',
    bcrypt.hashSync('GuruSD!2026', 10),
    'active',
    1,
    1
  );

  // Seed 1 authentic Reference Document for SDN 7 Jatisari (Pendidikan Pancasila Kelas VI)
  const sampleRefText = `BAB 1: BELAJAR PANCASILA DENGAN MENYENANGKAN
Halaman 1-14
Pancasila merupakan dasar negara Republik Indonesia sekaligus pandangan hidup bangsa. Kelima sila Pancasila saling berkaitan dan merupakan satu kesatuan yang utuh dan tidak dapat dipisahkan. Sila pertama Ketuhanan Yang Maha Esa menjiwai sila kedua, ketiga, keempat, dan kelima.

A. Hubungan Antarsila dalam Pancasila
Dalam kehidupan sehari-hari di sekolah dan masyarakat, pengamalan satu sila selalu berkaitan dengan sila lainnya. Contohnya: ketika siswa bermusyawarah memilih ketua kelas (sila keempat), mereka menghargai pendapat teman tanpa membeda-bedakan suku atau agama (sila kedua dan sila ketiga), berdoa sebelum rapat dimulai (sila pertama), dan melaksanakan hasil keputusan secara adil bagi seluruh warga kelas (sila kelima).

B. Mengamalkan Pancasila sebagai Pandangan Hidup Bangsa
Gotong royong merupakan ciri khas kepribadian bangsa Indonesia yang mencerminkan sila ketiga Persatuan Indonesia dan sila kelima Keadilan Sosial bagi Seluruh Rakyat Indonesia. Sikap toleransi antarumat beragama mencerminkan sila pertama, sedangkan membantu korban bencana alam tanpa pamrih mencerminkan sila kedua Kemanusiaan yang Adil dan Beradab.

BAB 2: MENGAMALKAN PANCASILA UNTUK KEBAHAGIAAN BERSAMA
Halaman 15-28
Norma adalah aturan atau kaidah yang berlaku dalam kehidupan bermasyarakat untuk menciptakan ketertiban, kedamaian, dan keadilan. Terdapat empat macam norma:
1. Norma Agama: bersumber dari wahyu Tuhan Yang Maha Esa, sanksinya berupa dosa dan penyesalan batin.
2. Norma Kesusilaan: bersumber dari hati nurani manusia, contohnya berkata jujur dan tidak menyontek saat ujian.
3. Norma Kesopanan: bersumber dari tata pergaulan masyarakat setempat, contohnya mengucapkan salam, menghormati orang tua dan guru.
4. Norma Hukum: dibuat oleh lembaga berwenang negara, bersifat memaksa dan memiliki sanksi tegas seperti denda atau pidana penjara (contoh: memakai helm saat berkendara, menaati rambu lalu lintas).

Hak adalah segala sesuatu yang mutlak menjadi milik kita sejak lahir, sedangkan kewajiban adalah segala sesuatu yang harus dilaksanakan dengan penuh tanggung jawab. Pelaksanaan hak dan kewajiban harus seimbang. Di sekolah, siswa berhak mendapatkan pelajaran dan bimbingan guru, serta berkewajiban menjaga kebersihan kelas, menghormati guru, dan menaati tata tertib sekolah.

BAB 3: PENJELAJAHAN MUSYAWARAH UNTUK MUFAKAT
Halaman 29-42
Musyawarah adalah pembahasan bersama untuk mencapai keputusan penyelesaian masalah secara mufakat. Prinsip utama musyawarah adalah mengutamakan kepentingan bersama di atas kepentingan pribadi atau golongan, menghargai perbedaan pendapat, tidak memaksakan kehendak, dan melaksanakan keputusan bersama dengan iktikad baik dan tanggung jawab. Apabila mufakat belum tercapai melalui diskusi, keputusan dapat diambil melalui pemungutan suara terbanyak (voting) sesuai asas demokrasi Pancasila.`;

  const sampleRefId = 'ref-pancasila-k6-jatisari';
  sqlite.prepare(`
    INSERT INTO reference_documents (id, tenant_id, user_id, title, file_name, file_type, file_size, subject, grade_level, page_count, extracted_text, chapters_json, concepts_json, competencies_json, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sampleRefId,
    'tenant-sdn1jatisari',
    'user-guru-jatisari',
    'Buku Siswa Pendidikan Pancasila Kelas VI SD/MI (Kurikulum Merdeka)',
    'Pendidikan_Pancasila_Kelas_6_SD.txt',
    'TXT',
    sampleRefText.length,
    'Pendidikan Pancasila',
    'Kelas VI',
    42,
    sampleRefText,
    JSON.stringify([
      'Bab 1: Belajar Pancasila dengan Menyenangkan (Hal. 1-14)',
      'Bab 2: Mengamalkan Pancasila untuk Kebahagiaan Bersama (Hal. 15-28)',
      'Bab 3: Penjelajahan Musyawarah untuk Mufakat (Hal. 29-42)',
    ]),
    JSON.stringify([
      'Keterkaitan dan kesatuan utuh kelima sila Pancasila',
      'Gotong royong dan toleransi dalam kehidupan sehari-hari',
      'Empat jenis norma (Agama, Kesusilaan, Kesopanan, Hukum)',
      'Keseimbangan hak dan kewajiban di sekolah dan masyarakat',
      'Prinsip musyawarah mufakat dan voting',
    ]),
    JSON.stringify([
      'Memahami hubungan antarsila Pancasila sebagai satu kesatuan utuh',
      'Menganalisis bentuk norma, hak, dan kewajiban warga sekolah/masyarakat',
      'Menerapkan prinsip musyawarah mufakat dalam pengambilan keputusan',
    ]),
    'Buku referensi ini membahas keterkaitan antarsila Pancasila sebagai dasar negara dan pandangan hidup bangsa, penerapan norma (agama, kesusilaan, kesopanan, hukum), keseimbangan hak dan kewajiban, serta praktik musyawarah untuk mufakat pada jenjang SD Kelas VI.'
  );

  const chunks = [
    {
      idx: 0,
      chapter: 'Bab 1: Belajar Pancasila dengan Menyenangkan',
      page: 4,
      content:
        'Pancasila merupakan dasar negara Republik Indonesia sekaligus pandangan hidup bangsa. Kelima sila Pancasila saling berkaitan dan merupakan satu kesatuan yang utuh. Sila pertama Ketuhanan Yang Maha Esa menjiwai sila kedua hingga kelima. Gotong royong mencerminkan sila ketiga dan kelima; toleransi antarumat beragama mencerminkan sila pertama; membantu korban bencana mencerminkan sila kedua.',
      keywords: 'pancasila hubungan antarsila gotong royong toleransi ketuhanan kemanusiaan persatuan',
    },
    {
      idx: 1,
      chapter: 'Bab 2: Mengamalkan Pancasila — Norma, Hak, dan Kewajiban',
      page: 18,
      content:
        'Norma adalah aturan atau kaidah dalam masyarakat: Norma Agama (wahyu Tuhan, sanksi dosa), Norma Kesusilaan (hati nurani, contoh jujur tidak menyontek), Norma Kesopanan (tata pergaulan, menghormati guru dan orang tua), dan Norma Hukum (lembaga negara, sanksi tegas denda/penjara). Hak dan kewajiban harus dilaksanakan secara seimbang.',
      keywords: 'norma agama kesusilaan kesopanan hukum sanksi hak kewajiban tanggung jawab',
    },
    {
      idx: 2,
      chapter: 'Bab 3: Penjelajahan Musyawarah untuk Mufakat',
      page: 31,
      content:
        'Musyawarah adalah pembahasan bersama untuk mencapai mufakat. Prinsipnya mengutamakan kepentingan bersama, menghargai perbedaan pendapat, tidak memaksakan kehendak, serta melaksanakan keputusan bersama dengan tanggung jawab. Jika mufakat tidak tercapai, dapat ditempuh pemungutan suara terbanyak (voting).',
      keywords: 'musyawarah mufakat demokrasi voting keputusan bersama menghargai pendapat',
    },
  ];

  const insertChunk = sqlite.prepare(`
    INSERT INTO reference_chunks (id, tenant_id, document_id, chunk_index, chapter_title, page_number, content, keywords)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ch of chunks) {
    insertChunk.run(crypto.randomUUID(), 'tenant-sdn1jatisari', sampleRefId, ch.idx, ch.chapter, ch.page, ch.content, ch.keywords);
  }

  // Seed initial CP & TP for SDN 1 Jatisari
  const cpId = 'cp-pancasila-c-jatisari';
  sqlite.prepare(`
    INSERT INTO learning_outcomes (id, tenant_id, user_id, reference_id, subject, phase, grade_level, code, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cpId,
    'tenant-sdn1jatisari',
    'user-guru-jatisari',
    sampleRefId,
    'Pendidikan Pancasila',
    'Fase C',
    'Kelas VI',
    'CP-PP-C1',
    'Peserta didik mampu memahami kronologi sejarah kelahiran Pancasila; meneladani sikap para perumus Pancasila; menghubungkan sila-sila dalam Pancasila sebagai suatu kesatuan yang utuh; serta menyajikan hasil identifikasi bentuk-bentuk norma, hak, dan kewajiban dalam kedudukannya sebagai warga sekolah dan masyarakat.'
  );

  const insertTp = sqlite.prepare(`
    INSERT INTO learning_objectives (id, tenant_id, user_id, outcome_id, subject, grade_level, code, description, atp_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertTp.run('tp-pp-1', 'tenant-sdn1jatisari', 'user-guru-jatisari', cpId, 'Pendidikan Pancasila', 'Kelas VI', 'TP-6.1', 'Menganalisis hubungan antarsila Pancasila sebagai satu kesatuan yang utuh dalam kehidupan sehari-hari.', 'Pertemuan 1–3');
  insertTp.run('tp-pp-2', 'tenant-sdn1jatisari', 'user-guru-jatisari', cpId, 'Pendidikan Pancasila', 'Kelas VI', 'TP-6.2', 'Membedakan macam-macam norma (agama, kesusilaan, kesopanan, hukum) beserta contoh dan sanksinya.', 'Pertemuan 4–6');
  insertTp.run('tp-pp-3', 'tenant-sdn1jatisari', 'user-guru-jatisari', cpId, 'Pendidikan Pancasila', 'Kelas VI', 'TP-6.3', 'Menerapkan keseimbangan pelaksanaan hak dan kewajiban serta prinsip musyawarah untuk mufakat.', 'Pertemuan 7–9');

  sqlite.prepare(`
    INSERT INTO activity_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'tenant-sdn1jatisari',
    'user-guru-jatisari',
    'UPLOAD_REFERENCE',
    'reference_documents',
    sampleRefId,
    'Mengunggah buku referensi Pendidikan Pancasila Kelas VI (3 bab terindeks untuk RAG)'
  );
}

function migrateSeededSchoolAndReferences() {
  const refCols = sqlite.prepare("PRAGMA table_info(reference_documents)").all() as Array<{ name: string }>;
  if (!refCols.some((c) => c.name === 'semester')) {
    sqlite.exec("ALTER TABLE reference_documents ADD COLUMN semester TEXT NOT NULL DEFAULT 'Semua'");
  }
  if (!refCols.some((c) => c.name === 'images_json')) {
    sqlite.exec("ALTER TABLE reference_documents ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'");
  }
  const qCols = sqlite.prepare("PRAGMA table_info(assessment_questions)").all() as Array<{ name: string }>;
  if (!qCols.some((c) => c.name === 'image_url')) {
    sqlite.exec("ALTER TABLE assessment_questions ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
  }
  if (!qCols.some((c) => c.name === 'image_caption')) {
    sqlite.exec("ALTER TABLE assessment_questions ADD COLUMN image_caption TEXT NOT NULL DEFAULT ''");
  }
  const qbCols = sqlite.prepare("PRAGMA table_info(question_banks)").all() as Array<{ name: string }>;
  if (!qbCols.some((c) => c.name === 'image_url')) {
    sqlite.exec("ALTER TABLE question_banks ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
  }
  if (!qbCols.some((c) => c.name === 'image_caption')) {
    sqlite.exec("ALTER TABLE question_banks ADD COLUMN image_caption TEXT NOT NULL DEFAULT ''");
  }
  const userCols = sqlite.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'access_expires_at')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN access_expires_at TEXT NOT NULL DEFAULT ''");
  }

  // Ensure ary.vandy@gmail.com is the sole Master Super Admin
  const masterUser = sqlite
    .prepare('SELECT id, email, role_id FROM users WHERE lower(email) = ?')
    .get(MASTER_ADMIN_EMAIL) as any;

  if (masterUser) {
    sqlite
      .prepare(`UPDATE users SET role_id = 'super_admin', status = 'active', is_active = 1, access_expires_at = '' WHERE id = ?`)
      .run(masterUser.id);
    sqlite
      .prepare(`UPDATE users SET role_id = 'tenant_admin' WHERE role_id = 'super_admin' AND id != ?`)
      .run(masterUser.id);
  } else {
    const legacySuper = sqlite.prepare(`SELECT id FROM users WHERE id = 'user-superadmin' OR role_id = 'super_admin' LIMIT 1`).get() as any;
    if (legacySuper) {
      sqlite
        .prepare(
          `UPDATE users SET email = ?, full_name = 'Master Pengendali ASKARA 04 (Ary Vandy)', role_id = 'super_admin', status = 'active', is_active = 1, access_expires_at = '', updated_at = datetime('now') WHERE id = ?`
        )
        .run(MASTER_ADMIN_EMAIL, legacySuper.id);
      sqlite
        .prepare(`UPDATE users SET role_id = 'tenant_admin' WHERE role_id = 'super_admin' AND id != ?`)
        .run(legacySuper.id);
    }
  }
  sqlite
    .prepare(`UPDATE subscriptions SET valid_until = '' WHERE tenant_id = 'tenant-gugus04'`)
    .run();

  const projCols = sqlite.prepare("PRAGMA table_info(assessment_projects)").all() as Array<{ name: string }>;
  if (!projCols.some((c) => c.name === 'selected_chapters_json')) {
    sqlite.exec("ALTER TABLE assessment_projects ADD COLUMN selected_chapters_json TEXT NOT NULL DEFAULT '[]'");
  }

  const tplCols = sqlite.prepare("PRAGMA table_info(document_templates)").all() as Array<{ name: string }>;
  if (!tplCols.some((c) => c.name === 'right_logo_url')) {
    sqlite.exec("ALTER TABLE document_templates ADD COLUMN right_logo_url TEXT NOT NULL DEFAULT ''");
  }
  if (!tplCols.some((c) => c.name === 'pemkab_line')) {
    sqlite.exec("ALTER TABLE document_templates ADD COLUMN pemkab_line TEXT NOT NULL DEFAULT ''");
  }

  const spCols = sqlite.prepare("PRAGMA table_info(school_profiles)").all() as Array<{ name: string }>;
  if (!spCols.some((c) => c.name === 'pemkab_name')) {
    sqlite.exec("ALTER TABLE school_profiles ADD COLUMN pemkab_name TEXT NOT NULL DEFAULT ''");
  }
  if (!spCols.some((c) => c.name === 'pemkab_logo_url')) {
    sqlite.exec("ALTER TABLE school_profiles ADD COLUMN pemkab_logo_url TEXT NOT NULL DEFAULT ''");
  }
  if (!spCols.some((c) => c.name === 'school_logo_url')) {
    sqlite.exec("ALTER TABLE school_profiles ADD COLUMN school_logo_url TEXT NOT NULL DEFAULT ''");
  }

  const jatisari7Svg = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="20" fill="#0f766e"/><path d="M60 18 L96 36 L96 68 C96 88 76 102 60 108 C44 102 24 88 24 68 L24 36 Z" fill="#ffffff" fill-opacity="0.14" stroke="#facc15" stroke-width="4"/><text x="60" y="68" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="24" fill="#ffffff">SDN 7</text><text x="60" y="88" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#fde047">JATISARI</text></svg>`
  )}`;

  // Ensure default app profile logo uses ASKARA 04 Biru Emas for seeded tenants still on old defaults
  sqlite
    .prepare(
      `UPDATE tenant_branding
       SET logo_url = ?
       WHERE (tenant_id = 'tenant-gugus04' AND (logo_url = '' OR logo_url = '/assets/askara-emblem.jpg'))
          OR (tenant_id = 'tenant-sdn1jatisari' AND (logo_url = '' OR logo_url LIKE 'data:image/svg+xml%'))`
    )
    .run(DEFAULT_APP_PROFILE_LOGO);

  // Upgrade unedited seeded templates to standard dual-logo official exam paper layout
  sqlite
    .prepare(
      `UPDATE document_templates
        SET logo_url = ?, right_logo_url = ?, logo_position = 'dual', logo_size = 96,
            pemkab_line = CASE WHEN pemkab_line = '' THEN 'PEMERINTAH KABUPATEN SITUBONDO' ELSE pemkab_line END,
            line_1 = 'DINAS PENDIDIKAN DAN KEBUDAYAAN', line_2 = '[JENIS ASESMEN]',
            line_3 = 'SEKOLAH DASAR NEGERI 7 JATISARI', line_4 = 'TAHUN PELAJARAN [TAHUN PELAJARAN]',
            address_line = CASE WHEN address_line = '' THEN 'Jl. Desa Jatisari No. 15, Kec. Arjasa, Kab. Situbondo' ELSE address_line END,
            contact_line = CASE WHEN contact_line = '' THEN 'Email: sdn7jatisari@situbondo.sch.id · Telp: (0338) 675112' ELSE contact_line END,
            border_style = 'thick'
        WHERE id = 'tpl-sdn1jatisari-default' AND right_logo_url = '' AND logo_position = 'left'`
    )
    .run(DEFAULT_PEMKAB_LOGO_SVG, jatisari7Svg);

  sqlite
    .prepare(
      `UPDATE document_templates
       SET logo_url = ?, right_logo_url = ?, logo_position = 'dual', logo_size = 96,
           pemkab_line = CASE WHEN pemkab_line = '' THEN 'PEMERINTAH KABUPATEN SITUBONDO' ELSE pemkab_line END,
           line_2 = '[JENIS ASESMEN]', border_style = 'thick'
       WHERE id = 'tpl-gugus04-default' AND right_logo_url = '' AND logo_position = 'left'`
    )
    .run(DEFAULT_PEMKAB_LOGO_SVG, DEFAULT_APP_PROFILE_LOGO);

  sqlite
    .prepare(
      `UPDATE document_templates
       SET right_logo_url = ?
       WHERE id = 'tpl-gugus04-default' AND right_logo_url = '/assets/askara-emblem.jpg'`
    )
    .run(DEFAULT_APP_PROFILE_LOGO);

  // Upgrade legacy small default logo_size (68px) to 96px so Kop Surat logos match kop text height
  sqlite
    .prepare(`UPDATE document_templates SET logo_size = 96 WHERE logo_size <= 72`)
    .run();

  // Backfill school_profiles pemkab_name, pemkab_logo_url, school_logo_url and default template lines
  const allProfiles = sqlite.prepare('SELECT * FROM school_profiles').all() as any[];
  for (const sp of allProfiles) {
    const defTpl = sqlite
      .prepare('SELECT * FROM document_templates WHERE tenant_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1')
      .get(sp.tenant_id) as any;

    const resolvedPemkab =
      sp.pemkab_name ||
      (sp.regency ? `PEMERINTAH ${String(sp.regency).toUpperCase()}` : 'PEMERINTAH KABUPATEN SITUBONDO');
    const resolvedPemkabLogo = sp.pemkab_logo_url || defTpl?.logo_url || DEFAULT_PEMKAB_LOGO_SVG;
    const resolvedSchoolLogo = sp.school_logo_url || defTpl?.right_logo_url || (sp.tenant_id === 'tenant-sdn1jatisari' ? jatisari7Svg : DEFAULT_APP_PROFILE_LOGO);

    if (!sp.pemkab_name || !sp.pemkab_logo_url || !sp.school_logo_url) {
      sqlite
        .prepare(
          `UPDATE school_profiles
           SET pemkab_name = ?, pemkab_logo_url = ?, school_logo_url = ?
           WHERE id = ?`
        )
        .run(resolvedPemkab, resolvedPemkabLogo, resolvedSchoolLogo, sp.id);
    }

    if (defTpl) {
      const nextPemkabLine = defTpl.pemkab_line || resolvedPemkab;
      const nextAddr = defTpl.address_line || sp.address || '';
      const computedContact = [sp.email ? `Email: ${sp.email}` : '', sp.phone ? `Telp: ${sp.phone}` : '']
        .filter(Boolean)
        .join(' · ');
      const nextContact = defTpl.contact_line || computedContact;
      if (!defTpl.pemkab_line || !defTpl.address_line || !defTpl.contact_line) {
        sqlite
          .prepare(
            `UPDATE document_templates
             SET pemkab_line = ?, address_line = ?, contact_line = ?
             WHERE id = ?`
          )
          .run(nextPemkabLine, nextAddr, nextContact, defTpl.id);
      }
    }
  }

  const existingOldTenant = sqlite
    .prepare("SELECT id FROM tenants WHERE id = 'tenant-sdn1jatisari' AND name = 'SDN 1 Jatisari'")
    .get();
  if (existingOldTenant) {
    sqlite
      .prepare("UPDATE tenants SET name = 'SDN 7 Jatisari', slug = 'sdn-7-jatisari', admin_email = 'admin@sdn7jatisari.sch.id' WHERE id = 'tenant-sdn1jatisari'")
      .run();
    sqlite
      .prepare("UPDATE tenant_branding SET app_name = 'ASKARA 04 · SDN 7 Jatisari', logo_url = ? WHERE tenant_id = 'tenant-sdn1jatisari'")
      .run(DEFAULT_APP_PROFILE_LOGO);
    sqlite
      .prepare("UPDATE school_profiles SET school_name = 'SD NEGERI 7 JATISARI', email = 'sdn7jatisari@situbondo.sch.id' WHERE tenant_id = 'tenant-sdn1jatisari'")
      .run();
    sqlite
      .prepare("UPDATE users SET email = 'admin@sdn7jatisari.sch.id' WHERE id = 'user-admin-jatisari' AND email = 'admin@sdn1jatisari.sch.id'")
      .run();
    sqlite
      .prepare("UPDATE users SET email = 'guru@sdn7jatisari.sch.id' WHERE id = 'user-guru-jatisari' AND email = 'guru@sdn1jatisari.sch.id'")
      .run();
  }

  const eduRow = sqlite.prepare("SELECT value FROM system_settings WHERE key = 'education_references'").get() as { value: string } | undefined;
  if (eduRow) {
    try {
      const parsed = JSON.parse(eduRow.value);
      if (!Array.isArray(parsed.subjects) || parsed.subjects.length < 15) {
        sqlite
          .prepare("UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = 'education_references'")
          .run(
            JSON.stringify({
              levels: ['PAUD/TK', 'SD/MI', 'SMP/MTs', 'SMA/MA', 'SMK', 'Madrasah / Keagamaan', 'Umum / Lainnya'],
              curricula: ['Kurikulum Merdeka', 'Kurikulum 2013', 'Kemenag (KMA)', 'Kustom Lembaga'],
              subjects: [
                'Pendidikan Pancasila',
                'Bahasa Indonesia',
                'Matematika',
                'IPAS (Ilmu Pengetahuan Alam dan Sosial)',
                'IPA (Ilmu Pengetahuan Alam)',
                'IPS (Ilmu Pengetahuan Sosial)',
                'PAIBP (Pendidikan Agama Islam dan Budi Pekerti)',
                'Pendidikan Agama & Budi Pekerti Lainnya',
                'PJOK',
                'Bahasa Inggris',
                'Bahasa Madura',
                'Bahasa Jawa',
                'Bahasa Sunda',
                'Seni Rupa',
                'Seni Musik',
                'Seni Tari & Teater',
                'Prakarya & Kewirausahaan',
                'Informatika / Koding & AI',
                'Fisika',
                'Kimia',
                'Biologi',
                'Ekonomi',
                'Sosiologi',
                'Geografi',
                'Sejarah',
                'Antropologi',
                'Bahasa Arab',
                'Al-Qur\'an Hadis',
                'Akidah Akhlak',
                'Fikih',
                'Sejarah Kebudayaan Islam (SKI)',
                'Dasar Program Keahlian SMK',
                'Teknik Komputer & Jaringan (TJKT)',
                'Akuntansi & Keuangan Lembaga',
                'Teknik Otomotif',
              ],
              assessmentTypes: parsed.assessmentTypes || [
                'Sumatif Akhir Semester (SAS)',
                'Sumatif Tengah Semester (STS)',
                'Sumatif Akhir Tahun (SAT)',
                'Penilaian Harian',
                'Asesmen Diagnostik',
                'Asesmen Formatif',
                'Asesmen Sumatif',
                'Latihan Soal',
                'Asesmen Lainnya',
              ],
            })
          );
      }
    } catch {
      // ignore parse errors
    }
  }
}

initSchema();
seedInitialData();
migrateSeededSchoolAndReferences();
