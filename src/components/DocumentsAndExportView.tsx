import React, { useEffect, useState } from 'react';
import { Download, Printer, FileText, FileSpreadsheet } from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../lib/api';
import { AssessmentProject, AuthBundle, DocumentTemplate } from '../types';

interface DocumentsAndExportViewProps {
  bundle: AuthBundle;
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
}

const DOC_CATEGORIES = [
  { key: 'naskah_soal', label: '1. Naskah Soal' },
  { key: 'kisi_kisi', label: '2. Kisi-Kisi' },
  { key: 'kunci_rubrik', label: '3. Kunci & Rubrik' },
  { key: 'kunci_jawaban', label: '4. Kunci Jawaban' },
  { key: 'pedoman_penskoran', label: '5. Pedoman Skor' },
  { key: 'rubrik_penilaian', label: '6. Rubrik Uraian' },
  { key: 'analisis_kognitif', label: '7. Analisis Kognitif' },
  { key: 'rekap_kualitas', label: '8. Rekap QC' },
];

function resolveAssessmentHeading(assessmentType: string, semester: string): string {
  const raw = (assessmentType || 'SUMATIF AKHIR SEMESTER').trim();
  const semNum = semester === '2' ? '2' : '1';
  const cleaned = raw.replace(/\s*\([^)]*\)\s*$/g, '').trim().toUpperCase();
  if (
    cleaned.includes('SUMATIF AKHIR SEMESTER') ||
    cleaned.includes('SUMATIF TENGAH SEMESTER') ||
    cleaned.includes('PENILAIAN AKHIR SEMESTER') ||
    cleaned.includes('PENILAIAN TENGAH SEMESTER')
  ) {
    return `${cleaned} ${semNum}`;
  }
  return cleaned;
}

function formatGradeSemester(gradeLevel: string, semester: string): string {
  const semLabel = semester === '2' ? 'Genap' : 'Ganjil';
  let g = (gradeLevel || '').replace(/^kelas\s+/i, '').trim();
  const romanMap: Record<string, string> = {
    '1': 'I',
    '2': 'II',
    '3': 'III',
    '4': 'IV',
    '5': 'V',
    '6': 'VI',
    '7': 'VII',
    '8': 'VIII',
    '9': 'IX',
    '10': 'X',
    '11': 'XI',
    '12': 'XII',
  };
  if (romanMap[g]) g = romanMap[g];
  g = g.replace(/^PAUD\s*\/\s*/i, '');
  return `${g || '-'} / ${semLabel}`;
}

function sortSections(questions: any[]): Array<{ sectionType: string; items: any[] }> {
  const rank = (qType: string) => {
    const t = (qType || '').toLowerCase();
    if (t.includes('pilihan ganda kompleks')) return 2;
    if (t.includes('pilihan ganda')) return 1;
    if (t.includes('benar') || t.includes('salah')) return 3;
    if (t.includes('jodoh')) return 4;
    if (t.includes('isian') || t.includes('pendek')) return 5;
    return 6;
  };
  const ordered = [...questions].sort((a, b) => {
    const ra = rank(a.question_type || '');
    const rb = rank(b.question_type || '');
    if (ra !== rb) return ra - rb;
    return Number(a.question_number || 0) - Number(b.question_number || 0);
  });
  const grouped: Array<{ sectionType: string; items: any[] }> = [];
  for (const q of ordered) {
    const key = q.question_type || 'Pilihan Ganda';
    let entry = grouped.find((g) => g.sectionType === key);
    if (!entry) {
      entry = { sectionType: key, items: [] };
      grouped.push(entry);
    }
    entry.items.push(q);
  }
  return grouped;
}

function sectionInstruction(qType: string): string {
  const t = (qType || '').toLowerCase();
  if (t.includes('pilihan ganda kompleks')) return 'Berilah tanda centang (✓) pada lebih dari satu jawaban yang benar!';
  if (t.includes('pilihan ganda')) return 'Berilah tanda silang (x) pada huruf a, b, c atau d di depan jawaban yang paling benar!';
  if (t.includes('benar') || t.includes('salah')) return 'Tentukan pernyataan di bawah ini Benar atau Salah!';
  if (t.includes('jodoh')) return 'Jodohkan pernyataan di kolom kiri dengan pasangan yang sesuai di kolom kanan!';
  if (t.includes('isian') || t.includes('pendek')) return 'Isilah titik-titik di bawah ini dengan benar!';
  return 'Jawablah pertanyaan-pertanyaan di bawah ini dengan benar!';
}

export const DocumentsAndExportView: React.FC<DocumentsAndExportViewProps> = ({
  bundle,
  activeProjectId,
  onSelectProject,
}) => {
  const [projects, setProjects] = useState<AssessmentProject[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeCat, setActiveCat] = useState('naskah_soal');
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');

  const visibleProjects = semesterFilter ? projects.filter((p) => p.semester === semesterFilter) : projects;

  const loadAll = async () => {
    try {
      const [projList, tpls, docs] = await Promise.all([
        apiFetch<AssessmentProject[]>('/api/assessments'),
        apiFetch<DocumentTemplate[]>('/api/templates'),
        apiFetch<any[]>('/api/documents'),
      ]);
      setProjects(projList);
      setTemplates(tpls);
      setHistory(docs);
      if (!activeProjectId && projList.length > 0) {
        onSelectProject(projList[0].id);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      apiFetch<any>(`/api/assessments/${activeProjectId}`).then(setDetail).catch((e) => setError(e.message));
    }
  }, [activeProjectId]);

  const activeTemplate =
    templates.find((t) => t.id === detail?.project?.template_id) ||
    templates.find((t) => t.is_default === 1) ||
    templates[0];

  const handleDownload = async (category: string, format: 'docx' | 'pdf' | 'xlsx') => {
    if (!detail) return;
    setError('');
    setDownloading(`${category}.${format}`);
    try {
      await downloadAuthorizedFile(
        `/api/export/${detail.project.id}/${category}/${format}`,
        `${detail.project.title}-${category}.${format}`
      );
      const docs = await apiFetch<any[]>('/api/documents');
      setHistory(docs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloading('');
    }
  };

  const formatKopLine = (text: string) => {
    const year = detail?.project?.academic_year || bundle.settings?.academic_year || '2026/2027';
    const sem = detail?.project?.semester || bundle.settings?.semester || '1';
    const jenis = resolveAssessmentHeading(detail?.project?.assessment_type || 'Sumatif Akhir Semester', sem);
    return (text || '')
      .replace(/\[TAHUN PELAJARAN\]/gi, year)
      .replace(/\[SEMESTER\]/gi, sem)
      .replace(/\[JENIS ASESMEN\]/gi, jenis)
      .toUpperCase();
  };

  const renderOptionsBlock = (opts: string[]) => {
    if (!opts.length) return null;
    const letters = ['a', 'b', 'c', 'd', 'e'];
    const allowInline = bundle.settings?.formatting?.shortAnswerInline !== false;
    const maxLen = Math.max(...opts.map((o) => String(o || '').trim().length));

    if (allowInline && opts.length <= 4 && maxLen <= 14) {
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[13px]">
          {opts.map((o, idx) => (
            <div key={idx} className="flex items-start gap-1">
              <span>{letters[idx]}.</span>
              <span>{o}</span>
            </div>
          ))}
        </div>
      );
    }

    if (allowInline && opts.length <= 4 && maxLen <= 40) {
      // Matches 2-column exam layout (a/c top row, b/d bottom row)
      const pairs: Array<[number, number]> = [
        [0, 2],
        [1, 3],
      ];
      return (
        <div className="space-y-0.5 text-[13px]">
          {pairs
            .filter(([lIdx]) => lIdx < opts.length)
            .map(([lIdx, rIdx], r) => (
              <div key={r} className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <div className="flex items-start gap-1.5">
                  <span>{letters[lIdx]}.</span>
                  <span>{opts[lIdx]}</span>
                </div>
                {rIdx < opts.length && (
                  <div className="flex items-start gap-1.5">
                    <span>{letters[rIdx]}.</span>
                    <span>{opts[rIdx]}</span>
                  </div>
                )}
              </div>
            ))}
        </div>
      );
    }

    return (
      <div className="space-y-0.5 text-[13px]">
        {opts.map((o, idx) => (
          <div key={idx} className="flex items-start gap-1.5">
            <span>{letters[idx]}.</span>
            <span>{o}</span>
          </div>
        ))}
      </div>
    );
  };

  const isDualKop = Boolean(activeTemplate && (activeTemplate.logo_position === 'dual' || activeTemplate.right_logo_url));
  const kopBorderClass =
    activeTemplate?.border_style === 'double'
      ? 'border-b-4 border-double border-slate-900'
      : activeTemplate?.border_style === 'single'
        ? 'border-b border-slate-900'
        : 'border-b-[2.5px] border-slate-900';

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Dokumen Saya &amp; Pusat Ekspor (Word · PDF · Excel)</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Format resmi Naskah Soal: Kertas 21,5 × 33 cm · Margin 1/1/1/2 cm · Calibri · Dual Logo Pemkab &amp; Sekolah.
          </p>
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
              <option key={p.id} value={p.id}>
                {p.title} (Sem. {p.semester})
              </option>
            ))}
          </select>
          {detail && (
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak Langsung</span>
            </button>
          )}
        </div>
      </div>

      {error && <div className="no-print p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      {detail && (
        <>
          {/* Download Action Strip */}
          <div className="no-print bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm">
            <div className="flex flex-wrap gap-1.5">
              {DOC_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setActiveCat(c.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                    activeCat === c.key
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-800'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!!downloading}
                onClick={() => handleDownload(activeCat, 'docx')}
                className="px-3.5 py-2 rounded-xl bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Unduh Word (.docx)</span>
              </button>
              <button
                type="button"
                disabled={!!downloading}
                onClick={() => handleDownload(activeCat, 'pdf')}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh PDF</span>
              </button>
              <button
                type="button"
                disabled={!!downloading}
                onClick={() => handleDownload('all', 'docx')}
                className="px-3.5 py-2 rounded-xl border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-semibold whitespace-nowrap"
              >
                Paket Lengkap (.docx)
              </button>
              <button
                type="button"
                disabled={!!downloading}
                onClick={() => handleDownload('all', 'xlsx')}
                className="px-3 py-2 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
            </div>
          </div>

          {/* Paper Preview (21.5cm x 33cm ratio aesthetic) */}
          <div
            className="print-only-container bg-white border border-slate-300 rounded-xl shadow-sm max-w-[820px] mx-auto p-8 sm:p-12 text-slate-900"
            style={{ fontFamily: activeTemplate?.font_family || 'Calibri, sans-serif' }}
          >
            {/* Dynamic Tenant Dual-Logo Kop Surat */}
            {activeTemplate && (() => {
              const leftLogoUrl = activeTemplate.logo_url || bundle.schoolProfile?.pemkab_logo_url || '';
              const rightLogoUrl = activeTemplate.right_logo_url || bundle.schoolProfile?.school_logo_url || '';
              const pemkabText = activeTemplate.pemkab_line || bundle.schoolProfile?.pemkab_name || '';
              const addrText = activeTemplate.address_line || bundle.schoolProfile?.address || '';
              const profileContact = [
                bundle.schoolProfile?.email ? `Email: ${bundle.schoolProfile.email}` : '',
                bundle.schoolProfile?.phone ? `Telp: ${bundle.schoolProfile.phone}` : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const contactText = activeTemplate.contact_line || profileContact;
              const showDual = isDualKop || Boolean(rightLogoUrl);
              const boldLinesCount = [pemkabText, activeTemplate.line_1, activeTemplate.line_2, activeTemplate.line_3, activeTemplate.line_4].filter(Boolean).length;
              const smallLinesCount = [addrText, contactText].filter(Boolean).length;
              const estimatedKopPx = boldLinesCount * 17 + smallLinesCount * 13 + 6;
              const previewLogoH = Math.min(130, Math.max(Number(activeTemplate.logo_size || 96), Math.round(estimatedKopPx * 0.90)));

              return (
                <div className={`pb-2.5 mb-3 ${kopBorderClass}`}>
                  <div
                    className={`flex items-center justify-between gap-4 ${
                      activeTemplate.logo_position === 'center' && !showDual ? 'flex-col text-center' : ''
                    }`}
                  >
                    {leftLogoUrl ? (
                      <img
                        src={leftLogoUrl}
                        alt="Logo Pemkab / Dinas"
                        referrerPolicy="no-referrer"
                        style={{ height: previewLogoH, width: 'auto', maxWidth: 132 }}
                        className="object-contain shrink-0"
                      />
                    ) : (
                      showDual && <div style={{ width: previewLogoH, height: previewLogoH }} className="shrink-0" />
                    )}

                    <div className="flex-1 text-center leading-tight space-y-0.5">
                      {pemkabText && <div className="text-[13px] font-bold">{formatKopLine(pemkabText)}</div>}
                      {activeTemplate.line_1 && <div className="text-[14px] font-bold">{formatKopLine(activeTemplate.line_1)}</div>}
                      {activeTemplate.line_2 && <div className="text-[15px] font-bold">{formatKopLine(activeTemplate.line_2)}</div>}
                      {activeTemplate.line_3 && <div className="text-[14px] font-bold">{formatKopLine(activeTemplate.line_3)}</div>}
                      {activeTemplate.line_4 && <div className="text-[13px] font-bold">{formatKopLine(activeTemplate.line_4)}</div>}
                      {addrText && <div className="text-[11px] text-slate-600 pt-0.5">{addrText}</div>}
                      {contactText && <div className="text-[11px] text-slate-600">{contactText}</div>}
                    </div>

                    {showDual &&
                      (rightLogoUrl ? (
                        <img
                          src={rightLogoUrl}
                          alt="Logo Sekolah"
                          referrerPolicy="no-referrer"
                          style={{ height: previewLogoH, width: 'auto', maxWidth: 132 }}
                          className="object-contain shrink-0"
                        />
                      ) : (
                        <div style={{ width: previewLogoH, height: previewLogoH }} className="shrink-0" />
                      ))}
                  </div>
                </div>
              );
            })()}

            {/* Document Preview Content */}
            {activeCat === 'naskah_soal' && (
              <div className="space-y-4 text-[13.5px] leading-[1.2]">
                {/* Borderless Colon-Aligned Student Identity Header matching sample PDF */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 pb-2.5 border-b-[2.5px] border-slate-900 text-[12px] leading-relaxed">
                  <div className="space-y-0.5">
                    <div className="grid grid-cols-[105px_1fr]">
                      <span>Mata Pelajaran</span>
                      <span>: {String(detail.project.subject || '').toUpperCase()}</span>
                    </div>
                    <div className="grid grid-cols-[105px_1fr]">
                      <span>Kelas /Semester</span>
                      <span>: {formatGradeSemester(detail.project.grade_level, detail.project.semester)}</span>
                    </div>
                    <div className="grid grid-cols-[105px_1fr]">
                      <span>Hari / Tanggal</span>
                      <span>:</span>
                    </div>
                    <div className="grid grid-cols-[105px_1fr]">
                      <span>Waktu</span>
                      <span>: {detail.project.duration_minutes || 90} menit</span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="grid grid-cols-[75px_1fr]">
                      <span>Nama</span>
                      <span>: ..................................................</span>
                    </div>
                    <div className="grid grid-cols-[75px_1fr]">
                      <span>Nomor</span>
                      <span>: ..................................................</span>
                    </div>
                    <div className="grid grid-cols-[75px_1fr]">
                      <span>Nilai</span>
                      <span>: ..................................................</span>
                    </div>
                    <div className="grid grid-cols-[75px_1fr]">
                      <span>Paraf Guru</span>
                      <span>: ..................................................</span>
                    </div>
                  </div>
                </div>

                {/* Grouped Exam Sections */}
                <div className="space-y-5 pt-1">
                  {sortSections(detail.questions || []).map((sec, secIdx) => {
                    const romawi = ['I', 'II', 'III', 'IV', 'V', 'VI'];
                    const isGray = Boolean(bundle.settings?.formatting?.grayscaleImages);
                    return (
                      <div key={sec.sectionType} className="space-y-3">
                        <div className="font-bold text-[13.5px]">
                          {romawi[secIdx] || secIdx + 1}. {sectionInstruction(sec.sectionType)}
                        </div>

                        <div className="space-y-3">
                          {sec.items.map((q: any) => {
                            const opts: string[] = q.options || [];
                            return (
                              <div key={q.id} className="flex items-start gap-2.5">
                                <span className="w-6 shrink-0 text-left">{q.question_number}.</span>

                                {q.image_url ? (
                                  <div className="flex-1 flex flex-col sm:flex-row items-start gap-4">
                                    <div className="shrink-0">
                                      <img
                                        src={q.image_url}
                                        alt={q.image_caption || `Gambar Soal ${q.question_number}`}
                                        className={`w-36 max-h-28 object-contain border border-slate-300 bg-white ${
                                          isGray ? 'grayscale' : ''
                                        }`}
                                      />
                                    </div>
                                    <div className="flex-1 space-y-1.5">
                                      <div className="whitespace-pre-line">{q.question_text}</div>
                                      {renderOptionsBlock(opts)}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex-1 space-y-1.5">
                                    <div className="whitespace-pre-line">{q.question_text}</div>
                                    {renderOptionsBlock(opts)}
                                    {q.question_type?.includes('Menjodohkan') && Array.isArray(q.matching_pairs) && (
                                      <div className="space-y-0.5 text-[12.5px] pt-0.5">
                                        {q.matching_pairs.map((pair: any, pi: number) => (
                                          <div key={pi}>
                                            • {pair.left} ↔ {pair.right}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeCat === 'kisi_kisi' && (
              <div className="space-y-3">
                <h2 className="text-center font-bold text-sm">KISI-KISI PENULISAN SOAL — {detail.project.subject.toUpperCase()}</h2>
                <table className="w-full border-collapse border border-slate-400 text-[11px]">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-400 p-1.5">No</th>
                      <th className="border border-slate-400 p-1.5">CP</th>
                      <th className="border border-slate-400 p-1.5">TP</th>
                      <th className="border border-slate-400 p-1.5">Materi</th>
                      <th className="border border-slate-400 p-1.5">Indikator Soal</th>
                      <th className="border border-slate-400 p-1.5">Level</th>
                      <th className="border border-slate-400 p-1.5">Bentuk</th>
                      <th className="border border-slate-400 p-1.5">No. Soal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.blueprints.map((b: any) => (
                      <tr key={b.id}>
                        <td className="border border-slate-400 p-1.5 text-center">{b.row_number}</td>
                        <td className="border border-slate-400 p-1.5">{b.cp}</td>
                        <td className="border border-slate-400 p-1.5">{b.tp}</td>
                        <td className="border border-slate-400 p-1.5">{b.materi}</td>
                        <td className="border border-slate-400 p-1.5">{b.indikator_soal}</td>
                        <td className="border border-slate-400 p-1.5 text-center">{b.level_kognitif}</td>
                        <td className="border border-slate-400 p-1.5">{b.bentuk_soal}</td>
                        <td className="border border-slate-400 p-1.5 text-center">{b.nomor_soal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeCat === 'kunci_rubrik' && (
              <div className="space-y-3 text-xs">
                <h2 className="text-center font-bold text-sm">KUNCI JAWABAN, PEDOMAN PENSKORAN, DAN RUBRIK PENILAIAN</h2>
                <table className="w-full border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-400 p-1.5">No</th>
                      <th className="border border-slate-400 p-1.5">Bentuk</th>
                      <th className="border border-slate-400 p-1.5">Kunci Jawaban</th>
                      <th className="border border-slate-400 p-1.5">Pembahasan &amp; Jawaban Ideal</th>
                      <th className="border border-slate-400 p-1.5">Pedoman Penskoran</th>
                      <th className="border border-slate-400 p-1.5">Skor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.questions || []).map((q: any) => (
                      <tr key={q.id}>
                        <td className="border border-slate-400 p-1.5 text-center font-mono">{q.question_number}</td>
                        <td className="border border-slate-400 p-1.5">{q.question_type}</td>
                        <td className="border border-slate-400 p-1.5 font-semibold">{q.correct_answer || '-'}</td>
                        <td className="border border-slate-400 p-1.5">
                          {q.explanation}
                          {q.ideal_answer && q.ideal_answer !== q.correct_answer ? ` — Ideal: ${q.ideal_answer}` : ''}
                        </td>
                        <td className="border border-slate-400 p-1.5">{q.scoring_guide}</td>
                        <td className="border border-slate-400 p-1.5 text-center font-mono">{q.max_score || 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="font-bold pt-1">
                  Total Skor Maksimal:{' '}
                  {(detail.questions || []).reduce((acc: number, q: any) => acc + Number(q.max_score || 1), 0)} | Nilai
                  Akhir = (Skor Perolehan /{' '}
                  {(detail.questions || []).reduce((acc: number, q: any) => acc + Number(q.max_score || 1), 0)}) × 100
                </div>
              </div>
            )}

            {activeCat === 'kunci_jawaban' && (
              <div className="space-y-3 text-xs">
                <h2 className="text-center font-bold text-sm">KUNCI JAWABAN &amp; PEMBAHASAN</h2>
                {detail.questions.map((q: any) => (
                  <div key={q.id} className="border-b border-slate-200 pb-2">
                    <div>
                      <strong>
                        {q.question_number}. Kunci: {q.correct_answer}
                      </strong>{' '}
                      ({q.question_type})
                    </div>
                    <div className="text-slate-700">{q.explanation}</div>
                  </div>
                ))}
              </div>
            )}

            {(activeCat === 'pedoman_penskoran' || activeCat === 'rubrik_penilaian') && (
              <div className="space-y-3 text-xs">
                <h2 className="text-center font-bold text-sm">
                  {activeCat === 'rubrik_penilaian' ? 'RUBRIK PENILAIAN URAIAN' : 'PEDOMAN PENSKORAN'}
                </h2>
                <table className="w-full border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-400 p-1.5">No</th>
                      <th className="border border-slate-400 p-1.5">Bentuk</th>
                      <th className="border border-slate-400 p-1.5">Jawaban Ideal &amp; Pedoman Penskoran</th>
                      <th className="border border-slate-400 p-1.5">Skor Maks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.questions.map((q: any) => (
                      <tr key={q.id}>
                        <td className="border border-slate-400 p-1.5 text-center">{q.question_number}</td>
                        <td className="border border-slate-400 p-1.5">{q.question_type}</td>
                        <td className="border border-slate-400 p-1.5">
                          <div>
                            <strong>Jawaban Ideal:</strong> {q.ideal_answer || q.correct_answer}
                          </div>
                          <div>{q.scoring_guide}</div>
                        </td>
                        <td className="border border-slate-400 p-1.5 text-center font-mono">{q.max_score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeCat === 'analisis_kognitif' && (
              <div className="space-y-3 text-xs">
                <h2 className="text-center font-bold text-sm">ANALISIS LEVEL KOGNITIF (C1–C6)</h2>
                <div className="p-2 border border-slate-300 text-center font-mono">
                  C1={detail.cognitiveSummary?.c1_count ?? 0} · C2={detail.cognitiveSummary?.c2_count ?? 0} · C3=
                  {detail.cognitiveSummary?.c3_count ?? 0} · C4={detail.cognitiveSummary?.c4_count ?? 0} · C5=
                  {detail.cognitiveSummary?.c5_count ?? 0} · C6={detail.cognitiveSummary?.c6_count ?? 0} | LOTS=
                  {detail.cognitiveSummary?.lots_count ?? 0} · MOTS={detail.cognitiveSummary?.mots_count ?? 0} · HOTS=
                  {detail.cognitiveSummary?.hots_count ?? 0}
                </div>
                {detail.questions.map((q: any) => (
                  <div key={q.id} className="border-b border-slate-200 pb-1.5">
                    <strong>
                      No. {q.question_number} [{q.cognitive_level} · {q.cognitive_tier}]
                    </strong>{' '}
                    — {q.cognitive_rationale || '-'}
                  </div>
                ))}
              </div>
            )}

            {activeCat === 'rekap_kualitas' && (
              <div className="space-y-3 text-xs">
                <h2 className="text-center font-bold text-sm">REKAPITULASI QUALITY CONTROL SOAL</h2>
                {detail.questions.map((q: any) => (
                  <div key={q.id} className="border-b border-slate-200 pb-1.5">
                    <strong>No. {q.question_number}</strong> · {q.qc_status} · {q.is_approved ? 'Disetujui Guru' : 'Belum Disetujui'} —{' '}
                    {q.qc_notes || 'Memenuhi standar mutu.'}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Download History */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="text-base font-bold text-slate-900">Riwayat Ekspor Dokumen ({history.length})</h2>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500">Belum ada riwayat unduhan dokumen.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {history.map((h) => (
              <div key={h.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{h.file_name}</span>
                  <span className="text-slate-500 ml-2">
                    · {h.format} · {h.creator_name}
                  </span>
                </div>
                <span className="font-mono text-slate-500">{h.created_at.slice(0, 16).replace('T', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
