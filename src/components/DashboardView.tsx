import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Upload,
  FolderOpen,
  ArrowRight,
  Megaphone,
  FileCheck2,
  BookOpen,
  Layers,
  ShieldCheck,
  Download,
  Award,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useTheme } from '../lib/theme';
import { AuthBundle, NavKey } from '../types';

const CREATOR_PHOTO_URL = '/assets/aistudio/Potret_Resmi_PNS_Berseragam_Khaki_e09c0ee9.png';

interface DashboardViewProps {
  bundle: AuthBundle;
  onNavigate: (nav: NavKey, projectId?: string) => void;
}

interface DashboardStats {
  counts: {
    documents: number;
    questions: number;
    bankQuestions: number;
    references: number;
    assessments: number;
    cp: number;
    tp: number;
    aiUsedMonth: number;
  };
  bloom: { C1: number; C2: number; C3: number; C4: number; C5: number; C6: number };
  tiers: { LOTS: number; MOTS: number; HOTS: number };
  recentActivity: Array<{ id: string; action: string; details: string; actor_name?: string; created_at: string }>;
  recentAssessments: Array<{
    id: string;
    title: string;
    subject: string;
    grade_level: string;
    assessment_type: string;
    status: string;
    total_questions: number;
    updated_at: string;
  }>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ bundle, onNavigate }) => {
  const { theme } = useTheme();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatorImgBroken, setCreatorImgBroken] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<DashboardStats>('/api/dashboard/stats')
      .then((res) => {
        if (active) setStats(res);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const bloomEntries = stats ? Object.entries(stats.bloom) : [];
  const maxBloom = Math.max(1, ...bloomEntries.map(([, v]) => v));

  const heroGradient =
    theme === 'dark'
      ? 'bg-gradient-to-r from-[#0f172a] via-[#1e293b] to-[#134e4a] border border-slate-700/70'
      : theme === 'colorful'
        ? 'bg-gradient-to-r from-[#4f46e5] via-[#0ea5e9] to-[#10b981]'
        : 'bg-gradient-to-r from-[#1e3a8a] via-[#2563eb] to-[#0d9488]';

  const cardSurface =
    theme === 'colorful'
      ? 'bg-white/95 border-indigo-200/70'
      : 'bg-white dark:bg-[#111a2e] border-slate-200/90 dark:border-slate-800';

  return (
    <div className="space-y-6">
      {/* Vibrant Gradient Welcome Hero Strip */}
      <div className={`${heroGradient} text-white rounded-2xl p-6 sm:p-7 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5`}>
        <div className="space-y-2">
          <div className="text-xs font-medium text-teal-100 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {bundle.user.tenantName} · Tahun Pelajaran {bundle.settings?.academic_year || '2026/2027'} · Semester{' '}
              {bundle.settings?.semester || '1'}
            </span>
            {bundle.user.roleId !== 'super_admin' && (bundle.user.accessExpiresAt || bundle.subscription?.valid_until) && (
              <span className="px-2 py-0.5 rounded bg-white/15 text-amber-200 font-semibold">
                Masa Aktif s.d. {bundle.user.accessExpiresAt || bundle.subscription?.valid_until}
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white text-balance">
            Selamat datang, {bundle.user.fullName}
          </h1>
          <p className="text-sm text-blue-50/95 max-w-2xl leading-relaxed">
            {bundle.branding?.slogan || 'Berkarya dengan Inovasi, Berkualitas dalam Asesmen.'} Kelola buku referensi,
            susun kisi-kisi, soal bergambar otomatis, analisis kognitif, kunci &amp; rubrik, lalu unduh Word &amp; PDF siap cetak.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('upload-ref')}
            className="px-4 py-2.5 rounded-xl border border-white/30 bg-white/15 hover:bg-white/25 text-white text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Upload className="w-4 h-4 text-amber-200" />
            <span>Upload Referensi</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('generator')}
            className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-sm font-bold transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4 text-blue-900" />
            <span>Buat Soal AI</span>
          </button>
        </div>
      </div>

      {/* System Announcement from Super Admin */}
      {bundle.announcement && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl px-5 py-3.5 flex items-start gap-3">
          <Megaphone className="w-4 h-4 text-amber-700 dark:text-amber-300 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-950 dark:text-amber-100">
            <span className="font-semibold">Pengumuman Sistem: </span>
            {bundle.announcement}
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Effortless 4-Step Quick Workflow Guide */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Alur Cepat Penyusunan Asesmen (4 Langkah Mudah)</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">Klik langkah mana saja untuk langsung bekerja</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[
            {
              step: '01',
              title: 'Upload Materi Buku',
              desc: 'Unggah PDF/DOCX/PPTX agar soal akurat sesuai buku.',
              nav: 'upload-ref' as NavKey,
              icon: Upload,
              iconBg: 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300',
              hoverBorder: 'hover:border-emerald-400 dark:hover:border-emerald-500',
              stepText: 'text-emerald-700 dark:text-emerald-400',
            },
            {
              step: '02',
              title: 'Susun Kisi & Soal AI',
              desc: 'Pilih kelas, semester, jumlah soal & gambar otomatis.',
              nav: 'generator' as NavKey,
              icon: Sparkles,
              iconBg: 'bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300',
              hoverBorder: 'hover:border-blue-400 dark:hover:border-blue-500',
              stepText: 'text-blue-700 dark:text-blue-400',
            },
            {
              step: '03',
              title: 'Cek Mutu & Kognitif',
              desc: 'Audit mutu soal, Bloom C1–C6 & kunci jawaban.',
              nav: 'quality-control' as NavKey,
              icon: ShieldCheck,
              iconBg: 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300',
              hoverBorder: 'hover:border-amber-400 dark:hover:border-amber-500',
              stepText: 'text-amber-700 dark:text-amber-400',
            },
            {
              step: '04',
              title: 'Unduh Word & PDF',
              desc: 'Download naskah, kisi-kisi, kognitif & kunci rubrik.',
              nav: 'dokumen-saya' as NavKey,
              icon: Download,
              iconBg: 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300',
              hoverBorder: 'hover:border-rose-400 dark:hover:border-rose-500',
              stepText: 'text-rose-700 dark:text-rose-400',
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.step}
                type="button"
                onClick={() => onNavigate(item.nav)}
                className={`text-left ${cardSurface} border ${item.hoverBorder} rounded-2xl p-4 transition-all hover:shadow-sm flex items-start gap-3.5 group`}
              >
                <div className={`w-10 h-10 rounded-xl ${item.iconBg} flex items-center justify-center shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className={`text-[11px] font-mono font-bold ${item.stepText}`}>LANGKAH {item.step}</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-sky-300 transition-colors">
                    {item.title}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Primary KPI Grid with Color-Coded Icon Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Dokumen Diekspor',
            value: stats?.counts.documents ?? 0,
            sub: 'Word · PDF · Excel',
            nav: 'dokumen-saya' as NavKey,
            icon: FileCheck2,
            tile: 'bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300',
            accent: 'text-sky-700 dark:text-sky-400',
          },
          {
            label: 'Total Soal Dibuat',
            value: stats?.counts.questions ?? 0,
            sub: `${stats?.counts.bankQuestions ?? 0} tersimpan di Bank Soal`,
            nav: 'bank-soal' as NavKey,
            icon: Layers,
            tile: 'bg-violet-100 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300',
            accent: 'text-violet-700 dark:text-violet-400',
          },
          {
            label: 'Buku & Referensi',
            value: stats?.counts.references ?? 0,
            sub: `${stats?.counts.cp ?? 0} CP · ${stats?.counts.tp ?? 0} TP`,
            nav: 'bank-materi' as NavKey,
            icon: BookOpen,
            tile: 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300',
            accent: 'text-emerald-700 dark:text-emerald-400',
          },
          {
            label: 'Proyek Asesmen',
            value: stats?.counts.assessments ?? 0,
            sub: `${stats?.counts.aiUsedMonth ?? 0} proses AI bulan ini`,
            nav: 'generator' as NavKey,
            icon: Sparkles,
            tile: 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300',
            accent: 'text-amber-700 dark:text-amber-400',
          },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <button
              key={kpi.label}
              type="button"
              onClick={() => onNavigate(kpi.nav)}
              className={`text-left ${cardSurface} border hover:border-blue-400 dark:hover:border-sky-500 rounded-2xl p-5 transition-all hover:shadow-sm flex items-start justify-between gap-3`}
            >
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</div>
                <div className="mt-2 text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {loading ? '—' : kpi.value}
                </div>
                <div className={`mt-1.5 text-xs font-medium ${kpi.accent}`}>{kpi.sub}</div>
              </div>
              <div className={`w-10 h-10 rounded-xl ${kpi.tile} flex items-center justify-center shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Analytics & Activity Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Cognitive Distribution (C1 - C6 + LOTS/MOTS/HOTS) */}
        <div className={`lg:col-span-7 ${cardSurface} border rounded-2xl p-6 space-y-5`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Statistik Level Kognitif (Taksonomi Bloom Revisi)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Rekapitulasi riil seluruh butir soal pada ruang kerja {bundle.user.tenantName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analisis-kognitif')}
              className="text-xs font-semibold text-indigo-700 dark:text-sky-400 hover:underline flex items-center gap-1 whitespace-nowrap"
            >
              <span>Lihat &amp; Unduh</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200/70 dark:border-sky-800/50">
              <div className="text-xs font-medium text-sky-800 dark:text-sky-300">LOTS (C1–C2)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-sky-900 dark:text-sky-100 mt-0.5">
                {stats?.tiers.LOTS ?? 0}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/50">
              <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">MOTS (C3)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-900 dark:text-emerald-100 mt-0.5">
                {stats?.tiers.MOTS ?? 0}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-800/50">
              <div className="text-xs font-medium text-amber-800 dark:text-amber-300">HOTS (C4–C6)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-900 dark:text-amber-100 mt-0.5">
                {stats?.tiers.HOTS ?? 0}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {[
              { code: 'C1', name: 'Mengingat', bar: 'bg-sky-500' },
              { code: 'C2', name: 'Memahami', bar: 'bg-blue-600' },
              { code: 'C3', name: 'Mengaplikasikan', bar: 'bg-emerald-500' },
              { code: 'C4', name: 'Menganalisis', bar: 'bg-amber-500' },
              { code: 'C5', name: 'Mengevaluasi', bar: 'bg-orange-500' },
              { code: 'C6', name: 'Mencipta', bar: 'bg-rose-500' },
            ].map((item) => {
              const val = stats?.bloom[item.code as keyof typeof stats.bloom] ?? 0;
              const pct = Math.round((val / maxBloom) * 100);
              return (
                <div key={item.code} className="flex items-center gap-3">
                  <div className="w-32 text-xs font-medium text-slate-700 dark:text-slate-300 shrink-0">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{item.code}</span> · {item.name}
                  </div>
                  <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${item.bar}`}
                      style={{ width: `${val > 0 ? Math.max(6, pct) : 0}%` }}
                    />
                  </div>
                  <div className="w-10 text-right text-xs font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200">{val}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Assessments & Activity */}
        <div className="lg:col-span-5 space-y-6">
          <div className={`${cardSurface} border rounded-2xl p-6 space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Proyek Asesmen Terbaru</h2>
              <button
                type="button"
                onClick={() => onNavigate('dokumen-saya')}
                className="text-xs font-semibold text-indigo-700 dark:text-sky-400 hover:underline flex items-center gap-1"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Ekspor</span>
              </button>
            </div>

            {stats && stats.recentAssessments.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {stats.recentAssessments.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onNavigate('generator', p.id)}
                    className="w-full py-2.5 text-left hover:bg-indigo-50/40 dark:hover:bg-slate-800/60 rounded-xl px-2.5 -mx-2.5 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{p.title}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {p.subject} · {p.grade_level} · {p.total_questions} soal
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold shrink-0 ${
                        p.status === 'approved'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : p.status === 'qc_reviewed'
                            ? 'text-indigo-700 dark:text-sky-400'
                            : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {p.status === 'approved' ? 'Disetujui' : p.status === 'qc_reviewed' ? 'QC Selesai' : p.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Belum ada proyek asesmen. Klik <strong>Buat Soal AI</strong> untuk memulai.
              </div>
            )}
          </div>

          <div className={`${cardSurface} border rounded-2xl p-6 space-y-3`}>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Aktivitas Terbaru</h2>
            {stats && stats.recentActivity.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto">
                {stats.recentActivity.slice(0, 6).map((act) => (
                  <div key={act.id} className="py-2 text-xs">
                    <div className="text-slate-800 dark:text-slate-200 font-medium">{act.details}</div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {act.actor_name || 'Sistem'} ·{' '}
                      <span className="font-mono">{act.created_at.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Belum ada catatan aktivitas.</p>
            )}
          </div>
        </div>
      </div>

      {/* Prominent Creator & App Purpose Spotlight */}
      <section className={`${cardSurface} border rounded-2xl p-6 sm:p-7 flex flex-col md:flex-row items-center gap-6`}>
        <div className="shrink-0">
          {!creatorImgBroken ? (
            <img
              src={CREATOR_PHOTO_URL}
              alt="Taufik Hidayah — Penggagas & Pencipta Aplikasi ASKARA 04"
              referrerPolicy="no-referrer"
              onError={() => setCreatorImgBroken(true)}
              className="w-28 h-36 sm:w-32 sm:h-40 rounded-2xl object-cover object-top ring-2 ring-amber-400/70 shadow-sm bg-slate-100 dark:bg-slate-800"
            />
          ) : (
            <div className="w-28 h-36 sm:w-32 sm:h-40 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex flex-col items-center justify-center p-3 text-center">
              <Award className="w-8 h-8 text-amber-300 mb-1" />
              <span className="text-xs font-bold">Taufik Hidayah</span>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-2.5 text-center md:text-left">
          <div className="text-xs font-semibold tracking-wide text-indigo-700 dark:text-sky-400">
            Penggagas &amp; Pencipta Aplikasi ASKARA 04
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
            Taufik Hidayah
          </h2>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            &ldquo;Dirancang khusus untuk memudahkan guru dalam menyusun soal asesmen yang bermutu, terstruktur, dan siap cetak.&rdquo;
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
            ASKARA 04 hadir sebagai pendamping kerja pendidik untuk menghemat waktu penyiapan administrasi penilaian—mulai
            dari mengolah buku pelajaran menjadi kisi-kisi otomatis, merangkai butir soal lengkap dengan gambar relevan
            dan sebaran level kognitif (C1–C6), menyusun kunci jawaban serta rubrik penskoran, hingga mencetak naskah
            ujian Word &amp; PDF F4 lengkap dengan kop surat sekolah secara instan.
          </p>
        </div>
      </section>
    </div>
  );
};
