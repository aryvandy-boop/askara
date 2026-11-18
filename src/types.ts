export type RoleId = 'super_admin' | 'tenant_admin' | 'teacher';

export type NavKey =
  | 'dashboard'
  | 'generator'
  | 'upload-ref'
  | 'kisi-kisi'
  | 'bank-soal'
  | 'bank-materi'
  | 'cp-tp'
  | 'analisis-kognitif'
  | 'kunci-jawaban'
  | 'rubrik-penilaian'
  | 'quality-control'
  | 'dokumen-saya'
  | 'kop-surat'
  | 'manajemen-guru'
  | 'pengaturan-tenant'
  | 'profil-saya'
  | 'bantuan'
  | 'super-admin';

export interface SessionUser {
  id: string;
  tenantId: string;
  roleId: RoleId;
  fullName: string;
  email: string;
  status: string;
  emailVerified: boolean;
  accessExpiresAt?: string;
  tenantName: string;
  tenantSlug: string;
  institutionType: string;
  regency: string;
  province: string;
  tenantStatus: string;
}

export interface TenantBranding {
  id: string;
  tenant_id: string;
  app_name: string;
  slogan: string;
  logo_url: string;
  primary_color: string;
  navy_color: string;
  accent_color: string;
}

export interface SchoolProfile {
  id: string;
  tenant_id: string;
  npsn: string;
  pemkab_name?: string;
  dinas_name: string;
  school_name: string;
  gugus_name: string;
  address: string;
  phone: string;
  email: string;
  headmaster_name: string;
  pemkab_logo_url?: string;
  school_logo_url?: string;
  regency: string;
  province: string;
}

export interface DocumentFormatting {
  fontFamily: string;
  fontSizeClass12: number;
  fontSizeClass345: number;
  fontSizeClass6: number;
  paperWidthCm: number;
  paperHeightCm: number;
  marginTopCm: number;
  marginBottomCm: number;
  marginRightCm: number;
  marginLeftCm: number;
  lineSpacing: number;
  grayscaleImages: boolean;
  lowercaseOptions: boolean;
  shortAnswerInline: boolean;
  longAnswerVertical: boolean;
  noBlankPages: boolean;
}

export interface TenantSettings {
  academic_year: string;
  semester: string;
  curriculum: string;
  questionPresets: Record<string, { pilihan_ganda: number; isian: number; uraian: number; total: number }>;
  formatting: DocumentFormatting;
}

export interface AuthBundle {
  user: SessionUser;
  branding: TenantBranding;
  schoolProfile: SchoolProfile;
  settings: TenantSettings;
  subscription: any;
  announcement: string;
  educationReferences: {
    levels?: string[];
    curricula?: string[];
    subjects?: string[];
    assessmentTypes?: string[];
  };
}

export interface ReferenceImageItem {
  url: string;
  pageNumber: number;
  label: string;
  width?: number;
  height?: number;
}

export interface ReferenceDocument {
  id: string;
  tenant_id: string;
  title: string;
  file_name: string;
  file_type: string;
  file_size: number;
  subject: string;
  grade_level: string;
  semester?: string;
  page_count: number;
  summary: string;
  chapters: string[];
  concepts: string[];
  competencies: string[];
  images?: ReferenceImageItem[];
  chunk_count?: number;
  uploader_name?: string;
  created_at: string;
}

export interface AssessmentProject {
  id: string;
  tenant_id: string;
  title: string;
  education_level: string;
  grade_level: string;
  semester: string;
  academic_year: string;
  curriculum: string;
  subject: string;
  topic: string;
  assessment_type: string;
  duration_minutes: number;
  difficulty: string;
  cognitiveComposition:
    | { LOTS: number; MOTS: number; HOTS: number }
    | { mode: 'levels'; selectedLevels: string[]; levelCounts?: Record<string, number> };
  questionCounts: Record<string, number>;
  referenceIds: string[];
  selectedChapters?: string[];
  source_warning: string;
  status: string;
  qcSummary?: any;
  question_count?: number;
  approved_count?: number;
  created_at: string;
  updated_at: string;
}

export interface BlueprintRow {
  id: string;
  row_number: number;
  cp: string;
  tp: string;
  materi: string;
  indikator_soal: string;
  level_kognitif: string;
  bentuk_soal: string;
  nomor_soal: string;
}

export interface AssessmentQuestion {
  id: string;
  question_number: number;
  question_type: string;
  materi: string;
  indikator_soal: string;
  cognitive_level: string;
  cognitive_tier: string;
  cognitive_rationale: string;
  difficulty: string;
  question_text: string;
  options: string[];
  matching_pairs: Array<{ left: string; right: string }>;
  correct_answer: string;
  explanation: string;
  ideal_answer: string;
  scoring_guide: string;
  criteria: Array<{ aspect: string; maxScore: number; description: string }>;
  max_score: number;
  source_reference: string;
  source_page: string;
  image_url?: string;
  image_caption?: string;
  qc_status: string;
  qc_notes: string;
  is_approved: boolean;
}

export interface DocumentTemplate {
  id: string;
  tenant_id: string;
  name: string;
  logo_url: string;
  right_logo_url?: string;
  logo_position: string;
  logo_size: number;
  pemkab_line?: string;
  line_1: string;
  line_2: string;
  line_3: string;
  line_4: string;
  address_line: string;
  contact_line: string;
  border_style: string;
  font_family: string;
  is_default: number;
}
