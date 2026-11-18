import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  Edit3,
  AlertCircle,
  Download,
  FileText,
  FileSpreadsheet,
  FolderOpen,
  Upload,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../lib/api';
import { AssessmentProject, AssessmentQuestion, BlueprintRow, NavKey, ReferenceDocument, ReferenceImageItem } from '../types';

interface ProjectWorkspaceViewsProps {
  mode: 'kisi-kisi' | 'analisis-kognitif' | 'kunci-jawaban' | 'rubrik-penilaian' | 'quality-control';
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onNavigate: (nav: NavKey, projectId?: string) => void;
}

export const ProjectWorkspaceViews: React.FC<ProjectWorkspaceViewsProps> = ({
  mode,
  activeProjectId,
  onSelectProject,
  onNavigate,
}) => {
  const [projects, setProjects] = useState<AssessmentProject[]>([]);
  const [references, setReferences] = useState<ReferenceDocument[]>([]);
  const [detail, setDetail] = useState<{
    project: AssessmentProject;
    blueprints: BlueprintRow[];
    questions: AssessmentQuestion[];
    cognitiveSummary: any;
  } | null>(null);
  const [busy, setBusy] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);
  const [generatingAiImg, setGeneratingAiImg] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveToBankOnApprove, setSaveToBankOnApprove] = useState(true);
  const [editingQuestion, setEditingQuestion] = useState<AssessmentQuestion | null>(null);
  const [semesterFilter, setSemesterFilter] = useState('');

  const visibleProjects = semesterFilter ? projects.filter((p) => p.semester === semesterFilter) : projects;

  const loadList = async () => {
    const [list, refList] = await Promise.all([
      apiFetch<AssessmentProject[]>('/api/assessments'),
      apiFetch<ReferenceDocument[]>('/api/references').catch(() => [] as ReferenceDocument[]),
    ]);
    setProjects(list);
    setReferences(refList);
    if (!activeProjectId && list.length > 0) {
      onSelectProject(list[0].id);
    }
  };

  const loadDetail = async (id: string) => {
    try {
      const res = await apiFetch<any>(`/api/assessments/${id}`);
      setDetail(res);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (activeProjectId) loadDetail(activeProjectId);
  }, [activeProjectId]);

  const handleRunQC = async () => {
    if (!detail) return;
    setError('');
    setNotice('');
    setBusy('Menjalankan pemeriksaan 12 parameter Quality Control dengan AI...');
    try {
      await apiFetch(`/api/assessments/${detail.project.id}/quality-control`, { method: 'POST' });
      await loadDetail(detail.project.id);
      setNotice('Pemeriksaan Quality Control selesai. Tinjau rekomendasi perbaikan atau setujui soal.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRepairQuestion = async (qId: string, instruction: string) => {
    if (!detail) return;
    setBusy('Memperbaiki soal dengan AI...');
    try {
      await apiFetch(`/api/assessments/${detail.project.id}/questions/${qId}/repair`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      });
      await loadDetail(detail.project.id);
      setNotice('Soal diperbarui dan lolos pemeriksaan.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleApproveAll = async () => {
    if (!detail) return;
    setBusy('Menyetujui paket soal...');
    try {
      await apiFetch(`/api/assessments/${detail.project.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ saveToBank: saveToBankOnApprove }),
      });
      await loadDetail(detail.project.id);
      setNotice('Seluruh soal disetujui dan siap diunduh dalam format Word, PDF, dan Excel!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleUpdateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion || !detail) return;
    setBusy('Menyimpan...');
    try {
      await apiFetch(`/api/assessments/${detail.project.id}/questions/${editingQuestion.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          questionText: editingQuestion.question_text,
          correctAnswer: editingQuestion.correct_answer,
          explanation: editingQuestion.explanation,
          idealAnswer: editingQuestion.ideal_answer,
          scoringGuide: editingQuestion.scoring_guide,
          maxScore: editingQuestion.max_score,
          imageUrl: editingQuestion.image_url || '',
          imageCaption: editingQuestion.image_caption || '',
        }),
      });
      setEditingQuestion(null);
      await loadDetail(detail.project.id);
      setNotice('Perubahan tersimpan.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleQuestionImageUpload = async (file: File) => {
    if (!editingQuestion) return;
    setUploadingImg(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await apiFetch<{ imageUrl: string }>('/api/questions/upload-image', {
        method: 'POST',
        body: fd,
      });
      setEditingQuestion({
        ...editingQuestion,
        image_url: res.imageUrl,
        image_caption: editingQuestion.image_caption || file.name.replace(/\.[^.]+$/, ''),
      });
    } catch (err: any) {
      setError(err.message || 'Gagal mengunggah gambar soal.');
    } finally {
      setUploadingImg(false);
    }
  };

  const handleGenerateAiImage = async () => {
    if (!editingQuestion || !detail) return;
    setGeneratingAiImg(true);
    setError('');
    try {
      const res = await apiFetch<{ imageUrl: string; imageCaption: string }>(
        `/api/assessments/${detail.project.id}/questions/${editingQuestion.id}/generate-image`,
        {
          method: 'POST',
          body: JSON.stringify({
            questionText: editingQuestion.question_text,
            visualPrompt: editingQuestion.image_caption || editingQuestion.question_text,
          }),
        }
      );
      setEditingQuestion({
        ...editingQuestion,
        image_url: res.imageUrl,
        image_caption: res.imageCaption,
      });
      await loadDetail(detail.project.id);
      setNotice(`Ilustrasi otomatis untuk Soal No. ${editingQuestion.question_number} berhasil dibuat.`);
    } catch (err: any) {
      setError(err.message || 'Gagal membuat gambar ilustrasi AI.');
    } finally {
      setGeneratingAiImg(false);
    }
  };

  const handleExport = async (category: string, format: 'docx' | 'pdf' | 'xlsx') => {
    if (!detail) return;
    setError('');
    setBusy(`Menyiapkan unduhan ${format.toUpperCase()}...`);
    try {
      const suffix = category === 'all' ? 'paket-lengkap' : category;
      await downloadAuthorizedFile(
        `/api/export/${detail.project.id}/${category}/${format}`,
        `${detail.project.title}-${suffix}.${format}`
      );
    } catch (err: any) {
      setError(err.message || `Gagal mengunduh format ${format.toUpperCase()}.`);
    } finally {
      setBusy('');
    }
  };

  const exportCategoryMap: Record<ProjectWorkspaceViewsProps['mode'], string> = {
    'kisi-kisi': 'kisi_kisi',
    'analisis-kognitif': 'analisis_kognitif',
    'kunci-jawaban': 'kunci_jawaban',
    'rubrik-penilaian': 'rubrik_penilaian',
    'quality-control': 'naskah_soal',
  };
  const activeExportCat = exportCategoryMap[mode];
  const isApproved = Boolean(
    detail && (detail.project.status === 'approved' || detail.questions.some((q) => q.is_approved))
  );
  const availableRefImages: ReferenceImageItem[] = detail
    ? references
        .filter((r) => detail.project.referenceIds?.includes(r.id))
        .flatMap((r) => r.images || [])
    : [];

  const titles = {
    'kisi-kisi': 'Kisi-Kisi Penulisan Soal',
    'analisis-kognitif': 'Analisis Level Kognitif (Taksonomi Bloom Revisi)',
    'kunci-jawaban': 'Kunci Jawaban & Pembahasan',
    'rubrik-penilaian': 'Rubrik Penilaian & Pedoman Penskoran',
    'quality-control': 'AI Quality Control (12 Kriteria Pemeriksaan Mutu)',
  };

  return (
    <div className="space-y-6">
      {/* Shared Project Selector Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{titles[mode]}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Pilih proyek asesmen untuk meninjau, menyunting, atau mengunduh perangkat terkait.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={semesterFilter}
            onChange={(e) => {
              const sem = e.target.value;
              setSemesterFilter(sem);
              const next = sem ? projects.filter((p) => p.semester === sem) : projects;
              if (next.length > 0 && !next.some((p) => p.id === activeProjectId)) {
                onSelectProject(next[0].id);
              }
            }}
            className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-sm"
          >
            <option value="">Semua Semester</option>
            <option value="1">Semester 1 (Ganjil)</option>
            <option value="2">Semester 2 (Genap)</option>
          </select>
          <select
            value={activeProjectId || ''}
            onChange={(e) => onSelectProject(e.target.value || null)}
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-sm max-w-xs"
          >
            {visibleProjects.length === 0 && <option value="">Belum ada proyek pada filter ini</option>}
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.title} (Sem. {p.semester})</option>
            ))}
          </select>
          {detail && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => handleExport(activeExportCat, 'docx')}
                className="px-3 py-2 rounded-xl bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Word (.docx)</span>
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => handleExport(activeExportCat, 'pdf')}
                className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF (.pdf)</span>
              </button>
              {(mode === 'kunci-jawaban' || mode === 'rubrik-penilaian') && (
                <>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => handleExport('kunci_rubrik', 'docx')}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Kunci &amp; Rubrik (.docx)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => handleExport('kunci_rubrik', 'pdf')}
                    className="px-3 py-2 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Kunci &amp; Rubrik (.pdf)</span>
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={!!busy}
                onClick={() => handleExport('all', 'xlsx')}
                className="px-3 py-2 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('dokumen-saya', detail.project.id)}
                className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Pratinjau &amp; Cetak</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {busy && <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">{busy}</div>}
      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>}

      {!detail ? (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">Belum ada proyek asesmen aktif di ruang kerja ini.</p>
          <button type="button" onClick={() => onNavigate('generator')} className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-xs font-semibold">
            Buat Asesmen di AI Generator
          </button>
        </div>
      ) : (
        <>
          {mode === 'kisi-kisi' && (
            <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 overflow-x-auto shadow-sm">
              <table className="w-full text-xs text-left">
                <thead className="bg-indigo-50/80 border-b border-indigo-100 text-slate-800 dark:text-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">No</th>
                    <th className="py-2.5 px-3">CP</th>
                    <th className="py-2.5 px-3">TP</th>
                    <th className="py-2.5 px-3">Materi</th>
                    <th className="py-2.5 px-3">Indikator Soal</th>
                    <th className="py-2.5 px-3">Level Kognitif</th>
                    <th className="py-2.5 px-3">Bentuk Soal</th>
                    <th className="py-2.5 px-3">No. Soal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {detail.blueprints.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono">{b.row_number}</td>
                      <td className="py-2.5 px-3">{b.cp}</td>
                      <td className="py-2.5 px-3">{b.tp}</td>
                      <td className="py-2.5 px-3 font-medium">{b.materi}</td>
                      <td className="py-2.5 px-3">{b.indikator_soal}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">{b.level_kognitif}</td>
                      <td className="py-2.5 px-3">{b.bentuk_soal}</td>
                      <td className="py-2.5 px-3 font-mono">{b.nomor_soal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {mode === 'analisis-kognitif' && (
            <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="grid grid-cols-3 sm:grid-cols-9 gap-3">
                {[
                  { lbl: 'C1', v: detail.cognitiveSummary?.c1_count ?? 0, style: 'bg-sky-50 border-sky-200 text-sky-900' },
                  { lbl: 'C2', v: detail.cognitiveSummary?.c2_count ?? 0, style: 'bg-blue-50 border-blue-200 text-blue-900' },
                  { lbl: 'C3', v: detail.cognitiveSummary?.c3_count ?? 0, style: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
                  { lbl: 'C4', v: detail.cognitiveSummary?.c4_count ?? 0, style: 'bg-amber-50 border-amber-200 text-amber-900' },
                  { lbl: 'C5', v: detail.cognitiveSummary?.c5_count ?? 0, style: 'bg-orange-50 border-orange-200 text-orange-900' },
                  { lbl: 'C6', v: detail.cognitiveSummary?.c6_count ?? 0, style: 'bg-rose-50 border-rose-200 text-rose-900' },
                  { lbl: 'LOTS', v: detail.cognitiveSummary?.lots_count ?? 0, style: 'bg-sky-100/70 border-sky-300 text-sky-950' },
                  { lbl: 'MOTS', v: detail.cognitiveSummary?.mots_count ?? 0, style: 'bg-emerald-100/70 border-emerald-300 text-emerald-950' },
                  { lbl: 'HOTS', v: detail.cognitiveSummary?.hots_count ?? 0, style: 'bg-amber-100/70 border-amber-300 text-amber-950' },
                ].map((item) => (
                  <div key={item.lbl} className={`p-3 rounded-xl border text-center ${item.style}`}>
                    <div className="text-[11px] font-bold">{item.lbl}</div>
                    <div className="text-xl font-bold font-mono tabular-nums mt-0.5">{item.v}</div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-indigo-50/80 border-b border-indigo-100 text-slate-800 dark:text-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">No</th>
                      <th className="py-2.5 px-3">Bentuk</th>
                      <th className="py-2.5 px-3">Level</th>
                      <th className="py-2.5 px-3">Kategori</th>
                      <th className="py-2.5 px-3">Alasan Klasifikasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {detail.questions.map((q) => (
                      <tr key={q.id} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 font-mono">{q.question_number}</td>
                        <td className="py-2 px-3">{q.question_type}</td>
                        <td className="py-2 px-3 font-mono font-bold text-indigo-700">{q.cognitive_level}</td>
                        <td className="py-2 px-3 font-semibold">{q.cognitive_tier}</td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{q.cognitive_rationale || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mode === 'kunci-jawaban' && (
            <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 divide-y divide-slate-100 dark:divide-slate-800">
              {detail.questions.map((q) => (
                <div key={q.id} className="py-3.5 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      No. {q.question_number} · {q.question_type} · Kunci: <span className="text-emerald-700">{q.correct_answer}</span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">{q.explanation}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingQuestion(q)}
                    className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 shrink-0"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}

          {mode === 'rubrik-penilaian' && (
            <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 divide-y divide-slate-100 dark:divide-slate-800">
              {detail.questions.map((q) => (
                <div key={q.id} className="py-4 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      No. {q.question_number} · {q.question_type} · Skor Maksimal: <span className="font-mono text-blue-700">{q.max_score}</span>
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300"><strong>Jawaban Ideal:</strong> {q.ideal_answer || q.correct_answer}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400"><strong>Pedoman Penskoran:</strong> {q.scoring_guide}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingQuestion(q)}
                    className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 shrink-0"
                  >
                    Ubah Skor/Rubrik
                  </button>
                </div>
              ))}
            </div>
          )}

          {mode === 'quality-control' && (
            <div className="space-y-5">
              <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Panel Kontrol Mutu & Persetujuan Guru</div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Soal tidak diterbitkan secara otomatis sebelum diperiksa dan disetujui guru. Jalankan audit 12 parameter AI di bawah ini.
                  </p>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 pt-1">
                    <input
                      type="checkbox"
                      checked={saveToBankOnApprove}
                      onChange={(e) => setSaveToBankOnApprove(e.target.checked)}
                    />
                    <span>Simpan otomatis seluruh soal yang disetujui ke Bank Soal sekolah</span>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={handleRunQC}
                    className="px-4 py-2 rounded-lg bg-[#0a192f] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-4 h-4 text-amber-300" />
                    <span>Periksa Kualitas</span>
                  </button>
                  <button
                    type="button"
                    disabled={!!busy || !detail.questions.length}
                    onClick={handleApproveAll}
                    className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Setujui Soal & Terbitkan</span>
                  </button>
                </div>
              </div>

              {isApproved && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-emerald-950 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>Paket Asesmen Disetujui — Siap Diunduh &amp; Dicetak</span>
                    </div>
                    <p className="text-xs text-emerald-800">
                      Unduh Naskah Soal maupun Paket Lengkap (Kisi-Kisi, Soal, Kunci, Rubrik, Analisis Kognitif) dalam format Word (.docx), PDF (.pdf), atau Excel (.xlsx).
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => handleExport('naskah_soal', 'docx')}
                      className="px-3 py-2 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Naskah Soal (.docx)</span>
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => handleExport('naskah_soal', 'pdf')}
                      className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Naskah Soal (.pdf)</span>
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => handleExport('all', 'docx')}
                      className="px-3 py-2 rounded-lg border border-amber-500 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-semibold"
                    >
                      Paket Lengkap (.docx)
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => handleExport('all', 'pdf')}
                      className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] hover:bg-slate-50 text-slate-800 dark:text-slate-200 text-xs font-semibold"
                    >
                      Paket Lengkap (.pdf)
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => handleExport('all', 'xlsx')}
                      className="px-3 py-2 rounded-lg border border-emerald-600 bg-white dark:bg-[#111a2e] hover:bg-emerald-100 text-emerald-900 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Excel (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('dokumen-saya', detail.project.id)}
                      className="px-3 py-2 rounded-lg border border-emerald-700 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Buka Pratinjau Kop Surat</span>
                    </button>
                  </div>
                </div>
              )}

              {detail.project.qcSummary?.overallSummary && (
                <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Ringkasan Laporan Quality Control</h3>
                  <p className="text-xs text-slate-700 dark:text-slate-300">{detail.project.qcSummary.overallSummary}</p>
                  {Array.isArray(detail.project.qcSummary.criteriaSummary) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
                      {detail.project.qcSummary.criteriaSummary.map((c: any, i: number) => (
                        <div key={i} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{c.criterion} · <span className="text-blue-700">{c.status}</span></div>
                          <div className="text-slate-600 dark:text-slate-400 mt-0.5">{c.notes}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {detail.questions.map((q) => (
                  <div key={q.id} className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">Soal {q.question_number}</span>
                        <span className="text-slate-500 dark:text-slate-400">· {q.question_type} · {q.cognitive_level}</span>
                        <span className={`font-semibold ${q.qc_status === 'passed' ? 'text-emerald-700' : q.qc_status === 'needs_revision' ? 'text-amber-700' : 'text-slate-500 dark:text-slate-400'}`}>
                          · {q.qc_status === 'passed' ? 'Lolos QC' : q.qc_status === 'needs_revision' ? 'Perlu Perbaikan' : 'Belum Diperiksa'}
                        </span>
                        {q.is_approved && <span className="text-emerald-700 font-semibold">· Disetujui</span>}
                      </div>
                      <p className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-line">{q.question_text}</p>
                      {q.image_url && (
                        <div className="pt-1">
                          <img
                            src={q.image_url}
                            alt={q.image_caption || `Gambar Soal ${q.question_number}`}
                            className="max-h-36 w-auto rounded-lg border border-slate-200 dark:border-slate-800 object-contain bg-white dark:bg-[#111a2e]"
                          />
                          {q.image_caption && (
                            <div className="text-[11px] italic text-slate-500 dark:text-slate-400 mt-0.5">{q.image_caption}</div>
                          )}
                        </div>
                      )}
                      {q.qc_notes && (
                        <div className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                          <span>{q.qc_notes}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => handleRepairQuestion(q.id, q.qc_notes || 'Perbaiki agar lolos 12 kriteria Quality Control.')}
                        className="px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-800 text-xs font-medium flex items-center gap-1"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Perbaiki Soal</span>
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => handleRepairQuestion(q.id, 'Buat ulang (regenerate) soal baru dengan indikator yang sama namun kalimat dan stimulus berbeda.')}
                        className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium"
                      >
                        Regenerate Soal
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingQuestion(q)}
                        className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit Manual</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {editingQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form onSubmit={handleUpdateQuestion} className="bg-white dark:bg-[#111a2e] rounded-xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Edit Soal & Kunci No. {editingQuestion.question_number}</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Pertanyaan</label>
              <textarea rows={3} value={editingQuestion.question_text} onChange={(e) => setEditingQuestion({ ...editingQuestion, question_text: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
            </div>

            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">Gambar Stimulus Soal (Opsional)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={generatingAiImg || uploadingImg}
                    onClick={handleGenerateAiImage}
                    className="px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{generatingAiImg ? 'Membuat Gambar...' : 'Buat Gambar AI'}</span>
                  </button>
                  <label className="px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] hover:bg-slate-50 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingImg ? 'Mengunggah...' : 'Unggah Gambar'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      disabled={uploadingImg}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleQuestionImageUpload(f);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {editingQuestion.image_url && (
                    <button
                      type="button"
                      onClick={() => setEditingQuestion({ ...editingQuestion, image_url: '', image_caption: '' })}
                      className="px-2.5 py-1.5 rounded-md border border-red-200 bg-red-50 text-red-700 text-xs font-medium flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus</span>
                    </button>
                  )}
                </div>
              </div>

              {editingQuestion.image_url && (
                <div className="flex flex-col sm:flex-row gap-3 items-start">
                  <img
                    src={editingQuestion.image_url}
                    alt="Preview Gambar Soal"
                    className="h-24 w-auto rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] object-contain"
                  />
                  <div className="flex-1 w-full">
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Keterangan / Caption Gambar</label>
                    <input
                      value={editingQuestion.image_caption || ''}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, image_caption: e.target.value })}
                      placeholder="Contoh: Diagram daur air pada buku teks hal. 42"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-xs"
                    />
                  </div>
                </div>
              )}

              {availableRefImages.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">Atau pilih gambar dari buku referensi proyek:</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {availableRefImages.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setEditingQuestion({ ...editingQuestion, image_url: img.url, image_caption: img.label })}
                        className={`shrink-0 p-1 rounded border text-left ${editingQuestion.image_url === img.url ? 'border-blue-600 bg-blue-50' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] hover:border-slate-400'}`}
                      >
                        <img src={img.url} alt={img.label} className="h-12 w-16 object-contain" />
                        <div className="text-[10px] text-slate-600 dark:text-slate-400 truncate w-16 mt-0.5">{img.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kunci Jawaban</label>
                <input value={editingQuestion.correct_answer} onChange={(e) => setEditingQuestion({ ...editingQuestion, correct_answer: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Skor Maksimal</label>
                <input type="number" min={1} value={editingQuestion.max_score} onChange={(e) => setEditingQuestion({ ...editingQuestion, max_score: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Pembahasan</label>
              <textarea rows={2} value={editingQuestion.explanation} onChange={(e) => setEditingQuestion({ ...editingQuestion, explanation: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Jawaban Ideal & Pedoman Penskoran</label>
              <textarea rows={2} value={editingQuestion.scoring_guide} onChange={(e) => setEditingQuestion({ ...editingQuestion, scoring_guide: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditingQuestion(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm">Batal</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-sm font-semibold">Simpan</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
