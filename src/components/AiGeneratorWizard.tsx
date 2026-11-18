import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  RefreshCw,
  ShieldCheck,
  FolderOpen,
  Plus,
  Save,
  Download,
  FileText,
  FileSpreadsheet,
  Upload,
  Trash2,
  BookOpen,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../lib/api';
import {
  AssessmentProject,
  AssessmentQuestion,
  AuthBundle,
  BlueprintRow,
  NavKey,
  ReferenceDocument,
  ReferenceImageItem,
} from '../types';

interface AiGeneratorWizardProps {
  bundle: AuthBundle;
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onNavigate: (nav: NavKey, projectId?: string) => void;
}

const QUESTION_TYPES = [
  'Pilihan Ganda',
  'Pilihan Ganda Kompleks',
  'Benar atau Salah',
  'Menjodohkan',
  'Isian Singkat',
  'Jawaban Pendek',
  'Uraian',
  'HOTS',
];

const COGNITIVE_LEVEL_OPTIONS = [
  {
    code: 'C1',
    name: 'Mengingat',
    tier: 'LOTS',
    desc: 'Fakta, definisi, istilah dasar',
    activeClass: 'border-sky-500 bg-sky-50/90 ring-1 ring-sky-400',
    badgeClass: 'bg-sky-600 text-white',
    tierClass: 'bg-sky-100 text-sky-800',
  },
  {
    code: 'C2',
    name: 'Memahami',
    tier: 'LOTS',
    desc: 'Menjelaskan, contoh, merangkum',
    activeClass: 'border-blue-500 bg-blue-50/90 ring-1 ring-blue-400',
    badgeClass: 'bg-blue-600 text-white',
    tierClass: 'bg-blue-100 text-blue-800',
  },
  {
    code: 'C3',
    name: 'Menerapkan',
    tier: 'MOTS',
    desc: 'Menerapkan konsep pada kasus',
    activeClass: 'border-emerald-500 bg-emerald-50/90 ring-1 ring-emerald-400',
    badgeClass: 'bg-emerald-600 text-white',
    tierClass: 'bg-emerald-100 text-emerald-800',
  },
  {
    code: 'C4',
    name: 'Menganalisis',
    tier: 'HOTS',
    desc: 'Membandingkan, pola, sebab-akibat',
    activeClass: 'border-amber-500 bg-amber-50/90 ring-1 ring-amber-400',
    badgeClass: 'bg-amber-600 text-white',
    tierClass: 'bg-amber-100 text-amber-900',
  },
  {
    code: 'C5',
    name: 'Mengevaluasi',
    tier: 'HOTS',
    desc: 'Menilai, mengkritisi, argumen',
    activeClass: 'border-orange-500 bg-orange-50/90 ring-1 ring-orange-400',
    badgeClass: 'bg-orange-600 text-white',
    tierClass: 'bg-orange-100 text-orange-900',
  },
  {
    code: 'C6',
    name: 'Mencipta',
    tier: 'HOTS',
    desc: 'Merancang solusi, gagasan baru',
    activeClass: 'border-rose-500 bg-rose-50/90 ring-1 ring-rose-400',
    badgeClass: 'bg-rose-600 text-white',
    tierClass: 'bg-rose-100 text-rose-900',
  },
] as const;

function splitChaptersBySemester(chapters: string[], targetSem: '1' | '2' | 'all'): string[] {
  if (!chapters.length) return [];
  if (targetSem === 'all') return chapters;

  const hasSem1Tag = chapters.some((c) => /\b(semester\s*1|sem\.?\s*1|ganjil)\b/i.test(c));
  const hasSem2Tag = chapters.some((c) => /\b(semester\s*2|sem\.?\s*2|genap)\b/i.test(c));
  if (hasSem1Tag && hasSem2Tag) {
    return chapters.filter((c) =>
      targetSem === '1'
        ? /\b(semester\s*1|sem\.?\s*1|ganjil)\b/i.test(c)
        : /\b(semester\s*2|sem\.?\s*2|genap)\b/i.test(c)
    );
  }

  const mid = Math.ceil(chapters.length / 2);
  return targetSem === '1' ? chapters.slice(0, mid) : chapters.slice(mid);
}

function distributeCountsToLevels(levels: string[], total: number): Record<string, number> {
  const result: Record<string, number> = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0 };
  if (!levels.length || total <= 0) return result;
  const base = Math.floor(total / levels.length);
  let rem = total % levels.length;
  for (const lvl of levels) {
    result[lvl] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
  }
  return result;
}

export const AiGeneratorWizard: React.FC<AiGeneratorWizardProps> = ({
  bundle,
  activeProjectId,
  onSelectProject,
  onNavigate,
}) => {
  const [step, setStep] = useState<number>(1);
  const [projects, setProjects] = useState<AssessmentProject[]>([]);
  const [references, setReferences] = useState<ReferenceDocument[]>([]);
  const [projectDetail, setProjectDetail] = useState<{
    project: AssessmentProject;
    blueprints: BlueprintRow[];
    questions: AssessmentQuestion[];
    cognitiveSummary: any;
  } | null>(null);

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Form state for new project (Steps 1 & 2)
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [educationLevel, setEducationLevel] = useState('SD/MI');
  const [gradeLevel, setGradeLevel] = useState('Kelas VI');
  const [semester, setSemester] = useState(bundle.settings?.semester || '1');
  const [academicYear, setAcademicYear] = useState(bundle.settings?.academic_year || '2026/2027');
  const [curriculum, setCurriculum] = useState(bundle.settings?.curriculum || 'Kurikulum Merdeka');
  const [subject, setSubject] = useState('Pendidikan Pancasila');
  const [customSubject, setCustomSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const activeSubject = subject === '__custom__' ? (customSubject.trim() || 'Mata Pelajaran Lainnya') : subject;
  const [assessmentType, setAssessmentType] = useState('Sumatif Akhir Semester (SAS)');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [difficulty, setDifficulty] = useState('Campuran Proporsional');
  const [selectedLevels, setSelectedLevels] = useState<string[]>(['C1', 'C2', 'C3', 'C4']);
  const [levelCounts, setLevelCounts] = useState<Record<string, number>>({
    C1: 4,
    C2: 5,
    C3: 5,
    C4: 4,
    C5: 0,
    C6: 0,
  });
  const [counts, setCounts] = useState<Record<string, number>>({
    'Pilihan Ganda': 10,
    'Pilihan Ganda Kompleks': 0,
    'Benar atau Salah': 0,
    Menjodohkan: 0,
    'Isian Singkat': 5,
    'Jawaban Pendek': 0,
    Uraian: 3,
    HOTS: 0,
  });

  // Question editor modal state
  const [editingQ, setEditingQ] = useState<AssessmentQuestion | null>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [generatingAiImg, setGeneratingAiImg] = useState(false);

  const syncTopicFromSelections = (chapters: string[], materials: string[]) => {
    const parts = [...chapters, ...materials];
    if (parts.length > 0) {
      setTopic(parts.join('; '));
    }
  };

  const applyChaptersFromRefs = (
    refs: ReferenceDocument[],
    refIds: string[],
    targetSem: '1' | '2' | 'all' | 'none'
  ) => {
    const activeRefs = refs.filter((r) => refIds.includes(r.id));
    if (targetSem === 'none') {
      setSelectedChapters([]);
      setSelectedMaterials([]);
      setTopic('');
      return;
    }
    const nextChapters = activeRefs.flatMap((r) =>
      splitChaptersBySemester(r.chapters || [], targetSem)
    );
    const nextMaterials =
      targetSem === 'all' ? activeRefs.flatMap((r) => r.concepts || []) : [];
    setSelectedChapters(nextChapters);
    setSelectedMaterials(nextMaterials);
    syncTopicFromSelections(nextChapters, nextMaterials);
  };

  const loadBase = async () => {
    try {
      const [projList, refList] = await Promise.all([
        apiFetch<AssessmentProject[]>('/api/assessments'),
        apiFetch<ReferenceDocument[]>('/api/references'),
      ]);
      setProjects(projList);
      setReferences(refList);
      if (refList.length && selectedRefIds.length === 0) {
        const defaultIds = [refList[0].id];
        setSelectedRefIds(defaultIds);
        const semMode: '1' | '2' = semester === '2' ? '2' : '1';
        const initialChapters = splitChaptersBySemester(refList[0].chapters || [], semMode);
        const initialMaterials = (refList[0].concepts || []).slice(0, 4);
        setSelectedChapters(initialChapters);
        setSelectedMaterials(initialMaterials);
        syncTopicFromSelections(initialChapters, initialMaterials);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const loadProjectDetail = async (id: string) => {
    try {
      const detail = await apiFetch<any>(`/api/assessments/${id}`);
      setProjectDetail(detail);
      if (detail.questions.length > 0) setStep(4);
      else if (detail.blueprints.length > 0) setStep(3);
      else setStep(2);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      loadProjectDetail(activeProjectId);
    } else {
      setProjectDetail(null);
    }
  }, [activeProjectId]);

  const applyAskaraPreset = (key: string) => {
    const preset = bundle.settings?.questionPresets?.[key];
    if (!preset) return;
    const nextCounts = {
      'Pilihan Ganda': preset.pilihan_ganda || 0,
      'Pilihan Ganda Kompleks': 0,
      'Benar atau Salah': 0,
      Menjodohkan: 0,
      'Isian Singkat': preset.isian || 0,
      'Jawaban Pendek': 0,
      Uraian: preset.uraian || 0,
      HOTS: 0,
    };
    setCounts(nextCounts);
    const nextTotal = Object.values(nextCounts).reduce((a, b) => a + Number(b || 0), 0);
    setLevelCounts(distributeCountsToLevels(selectedLevels, nextTotal));
    setNotice(`Template rambu-rambu ASKARA 04 (${key}: ${preset.pilihan_ganda} PG, ${preset.isian} Isian, ${preset.uraian} Uraian) diterapkan.`);
  };

  const totalQuestionTarget = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);
  const totalCognitiveAllocated = selectedLevels.reduce(
    (sum, lvl) => sum + Number(levelCounts[lvl] || 0),
    0
  );

  const toggleCognitiveLevel = (code: string) => {
    const isSelected = selectedLevels.includes(code);
    if (isSelected) {
      if (selectedLevels.length === 1) {
        setError('Minimal pilih 1 level kognitif (C1–C6).');
        return;
      }
      setError('');
      const next = selectedLevels.filter((l) => l !== code);
      setSelectedLevels(next);
      setLevelCounts((prev) => ({ ...prev, [code]: 0 }));
    } else {
      setError('');
      const next = [...selectedLevels, code].sort();
      setSelectedLevels(next);
      setLevelCounts((prev) => ({
        ...prev,
        [code]: prev[code] > 0 ? prev[code] : Math.max(1, Math.floor(totalQuestionTarget / next.length)),
      }));
    }
  };

  const applyCognitivePreset = (levels: string[], label: string) => {
    setError('');
    setSelectedLevels(levels);
    setLevelCounts(distributeCountsToLevels(levels, totalQuestionTarget));
    setNotice(`Target level kognitif disetel ke ${label} (${levels.join(', ')}).`);
  };

  const handleToggleChapter = (chapterTitle: string) => {
    const next = selectedChapters.includes(chapterTitle)
      ? selectedChapters.filter((c) => c !== chapterTitle)
      : [...selectedChapters, chapterTitle];
    setSelectedChapters(next);
    syncTopicFromSelections(next, selectedMaterials);
  };

  const handleToggleMaterial = (materialName: string) => {
    const next = selectedMaterials.includes(materialName)
      ? selectedMaterials.filter((m) => m !== materialName)
      : [...selectedMaterials, materialName];
    setSelectedMaterials(next);
    syncTopicFromSelections(selectedChapters, next);
  };

  const handleCreateProjectAndBlueprint = async () => {
    if (totalQuestionTarget < 1) return setError('Jumlah total soal minimal 1 butir.');
    if (selectedLevels.length < 1) return setError('Pilih minimal 1 level kognitif (C1–C6).');
    setError('');
    setNotice('');
    setBusy('Menyimpan proyek & menyusun kisi-kisi AI dari bab/materi buku referensi...');
    try {
      const normalizedLevelCounts: Record<string, number> = {};
      for (const lvl of selectedLevels) {
        normalizedLevelCounts[lvl] = Math.max(0, Number(levelCounts[lvl] || 0));
      }
      const computedTopic =
        topic.trim() ||
        [...selectedChapters, ...selectedMaterials].join('; ') ||
        `${activeSubject} Semester ${semester}`;

      const created = await apiFetch<{ id: string }>('/api/assessments', {
        method: 'POST',
        body: JSON.stringify({
          title: title || `${assessmentType} ${activeSubject} ${gradeLevel}`,
          educationLevel,
          gradeLevel,
          semester,
          academicYear,
          curriculum,
          subject: activeSubject,
          topic: computedTopic,
          selectedChapters,
          assessmentType,
          durationMinutes,
          difficulty,
          cognitiveComposition: {
            mode: 'levels',
            selectedLevels,
            levelCounts: normalizedLevelCounts,
          },
          questionCounts: counts,
          referenceIds: selectedRefIds,
        }),
      });
      await apiFetch(`/api/assessments/${created.id}/generate-blueprint`, { method: 'POST' });
      onSelectProject(created.id);
      await loadBase();
      await loadProjectDetail(created.id);
      setStep(3);
      setNotice('Kisi-kisi berhasil dibuat berdasarkan bab & materi buku referensi terpilih!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRegenerateBlueprint = async () => {
    if (!projectDetail) return;
    setError('');
    setBusy('Menghasilkan ulang kisi-kisi berbasis RAG...');
    try {
      await apiFetch(`/api/assessments/${projectDetail.project.id}/generate-blueprint`, { method: 'POST' });
      await loadProjectDetail(projectDetail.project.id);
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleSaveBlueprintEdits = async () => {
    if (!projectDetail) return;
    setError('');
    setBusy('Menyimpan perubahan kisi-kisi...');
    try {
      await apiFetch(`/api/assessments/${projectDetail.project.id}/blueprints`, {
        method: 'PUT',
        body: JSON.stringify({ blueprints: projectDetail.blueprints }),
      });
      setNotice('Perubahan kisi-kisi tersimpan.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleGenerateQuestions = async () => {
    if (!projectDetail) return;
    setError('');
    setNotice('');
    setBusy(`Menghasilkan ${projectDetail.blueprints.length} butir soal, analisis kognitif, kunci jawaban, dan rubrik via Gemini AI...`);
    try {
      const res = await apiFetch<{ count: number; warning: string }>(
        `/api/assessments/${projectDetail.project.id}/generate-questions`,
        { method: 'POST' }
      );
      await loadProjectDetail(projectDetail.project.id);
      setStep(4);
      setNotice(`Berhasil menghasilkan ${res.count} butir soal lengkap beserta kunci, pembahasan, dan analisis kognitif.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleSaveEditedQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQ || !projectDetail) return;
    setBusy('Menyimpan perubahan soal...');
    try {
      await apiFetch(`/api/assessments/${projectDetail.project.id}/questions/${editingQ.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          questionText: editingQ.question_text,
          options: editingQ.options,
          cognitiveLevel: editingQ.cognitive_level,
          cognitiveTier: editingQ.cognitive_tier,
          cognitiveRationale: editingQ.cognitive_rationale,
          difficulty: editingQ.difficulty,
          correctAnswer: editingQ.correct_answer,
          explanation: editingQ.explanation,
          idealAnswer: editingQ.ideal_answer,
          scoringGuide: editingQ.scoring_guide,
          maxScore: editingQ.max_score,
          imageUrl: editingQ.image_url || '',
          imageCaption: editingQ.image_caption || '',
        }),
      });
      setEditingQ(null);
      await loadProjectDetail(projectDetail.project.id);
      setNotice('Soal diperbarui.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleUploadEditingImage = async (file: File) => {
    if (!editingQ) return;
    setUploadingImg(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await apiFetch<{ imageUrl: string }>('/api/questions/upload-image', {
        method: 'POST',
        body: fd,
      });
      setEditingQ({
        ...editingQ,
        image_url: res.imageUrl,
        image_caption: editingQ.image_caption || file.name.replace(/\.[^.]+$/, ''),
      });
    } catch (err: any) {
      setError(err.message || 'Gagal mengunggah gambar soal.');
    } finally {
      setUploadingImg(false);
    }
  };

  const handleGenerateAiImage = async () => {
    if (!editingQ || !projectDetail) return;
    setGeneratingAiImg(true);
    setError('');
    try {
      const res = await apiFetch<{ imageUrl: string; imageCaption: string }>(
        `/api/assessments/${projectDetail.project.id}/questions/${editingQ.id}/generate-image`,
        {
          method: 'POST',
          body: JSON.stringify({
            questionText: editingQ.question_text,
            visualPrompt: editingQ.image_caption || editingQ.question_text,
          }),
        }
      );
      setEditingQ({
        ...editingQ,
        image_url: res.imageUrl,
        image_caption: res.imageCaption,
      });
      await loadProjectDetail(projectDetail.project.id);
      setNotice(`Gambar asli untuk Soal No. ${editingQ.question_number} berhasil ditemukan dan dipasang.`);
    } catch (err: any) {
      setError(err.message || 'Gagal mencari gambar referensi asli.');
    } finally {
      setGeneratingAiImg(false);
    }
  };

  const handleQuickExport = async (category: string, format: 'docx' | 'pdf' | 'xlsx') => {
    if (!projectDetail) return;
    setError('');
    setBusy(`Menyiapkan unduhan ${format.toUpperCase()}...`);
    try {
      await downloadAuthorizedFile(
        `/api/export/${projectDetail.project.id}/${category}/${format}`,
        `${projectDetail.project.title}-${category}.${format}`
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const availableRefImages: ReferenceImageItem[] = projectDetail
    ? references
        .filter((r) => projectDetail.project.referenceIds?.includes(r.id))
        .flatMap((r) => r.images || [])
    : [];

  const handleRepairSingleQuestion = async (qid: string, instruction: string) => {
    if (!projectDetail) return;
    setBusy('Memperbaiki soal dengan AI...');
    try {
      await apiFetch(`/api/assessments/${projectDetail.project.id}/questions/${qid}/repair`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      });
      await loadProjectDetail(projectDetail.project.id);
      setNotice('Soal berhasil diperbarui AI.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const steps = [
    { num: 1, label: '1. Referensi' },
    { num: 2, label: '2. Pengaturan' },
    { num: 3, label: '3. Kisi-Kisi' },
    { num: 4, label: '4. Soal AI' },
    { num: 5, label: '5. Kognitif' },
    { num: 6, label: '6. Kunci & Rubrik' },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Project Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">AI Generator Perangkat Asesmen</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Alur terpandu 6 langkah berbasis RAG dari buku referensi hingga siap cetak.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeProjectId || ''}
            onChange={(e) => onSelectProject(e.target.value || null)}
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-sm max-w-xs"
          >
            <option value="">+ Buat Proyek Asesmen Baru</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.question_count || 0} soal)
              </option>
            ))}
          </select>
          {activeProjectId && (
            <button
              type="button"
              onClick={() => {
                onSelectProject(null);
                setStep(1);
              }}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] hover:bg-slate-50 text-sm font-medium flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Baru</span>
            </button>
          )}
        </div>
      </div>

      {/* Step Indicator */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2 flex flex-wrap gap-1.5 shadow-sm">
        {steps.map((s) => {
          const disabled = s.num >= 3 && !projectDetail;
          const isCurrent = step === s.num;
          const isDone =
            !disabled &&
            ((s.num === 1 && step > 1) ||
              (s.num === 2 && Boolean(projectDetail)) ||
              (s.num === 3 && Boolean(projectDetail?.blueprints.length)) ||
              (s.num >= 4 && s.num <= 6 && Boolean(projectDetail?.questions.length) && step > s.num));
          return (
            <button
              key={s.num}
              type="button"
              disabled={disabled}
              onClick={() => setStep(s.num)}
              className={`flex-1 min-w-[115px] py-2.5 px-3 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center justify-center gap-1.5 ${
                isCurrent
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
                  : disabled
                    ? 'text-slate-300 cursor-not-allowed bg-slate-50/40'
                    : isDone
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-indigo-50/60 hover:text-indigo-900'
              }`}
            >
              {isDone && !isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {busy && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-900 flex items-center gap-3">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-700 shrink-0" />
          <span className="font-medium">{busy}</span>
        </div>
      )}

      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {projectDetail?.project.source_warning && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-sm text-amber-950 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Peringatan Cakupan Sumber Referensi</div>
            <p className="mt-0.5 text-xs leading-relaxed">{projectDetail.project.source_warning}</p>
          </div>
        </div>
      )}

      {/* STEP 1: SELECT REFERENCES */}
      {step === 1 && (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Langkah 1 — Pilih Dokumen Sumber Referensi (RAG)</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                AI hanya akan menyusun soal berdasarkan materi pada referensi yang dipilih. Jika referensi kosong atau kurang relevan, sistem akan menampilkan peringatan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('upload-ref')}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 whitespace-nowrap"
            >
              + Upload Referensi Baru
            </button>
          </div>

          {references.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
              <p className="text-sm text-slate-600 dark:text-slate-400">Belum ada buku atau modul ajar di lembaga ini.</p>
              <button
                type="button"
                onClick={() => onNavigate('upload-ref')}
                className="mt-3 px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-xs font-semibold"
              >
                Upload Dokumen Referensi Sekarang
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {references.map((ref) => {
                const checked = selectedRefIds.includes(ref.id);
                return (
                  <label
                    key={ref.id}
                    className={`p-4 rounded-xl border cursor-pointer transition-colors flex items-start gap-3 ${
                      checked ? 'border-blue-600 bg-blue-50/40' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const nextIds = checked
                          ? selectedRefIds.filter((x) => x !== ref.id)
                          : [...selectedRefIds, ref.id];
                        setSelectedRefIds(nextIds);
                        const semMode: '1' | '2' = semester === '2' ? '2' : '1';
                        applyChaptersFromRefs(references, nextIds, semMode);
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ref.title}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {ref.subject} · {ref.grade_level} · {ref.page_count} hal · {ref.chunk_count || 0} chunk
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">{ref.summary}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-5 py-2.5 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-sm font-semibold"
            >
              Lanjut ke Pengaturan Asesmen
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: ASSESSMENT SETTINGS & QUESTION COUNT TEMPLATES */}
      {step === 2 && (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Langkah 2 — Pengaturan Asesmen & Jumlah Soal</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Tentukan identitas asesmen, komposisi kognitif, dan gunakan preset jumlah soal ASKARA 04 atau sesuaikan sendiri.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Judul Paket Asesmen</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${assessmentType} ${activeSubject} ${gradeLevel}`}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Jenis Asesmen</label>
              <select
                value={assessmentType}
                onChange={(e) => setAssessmentType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]"
              >
                {(bundle.educationReferences?.assessmentTypes || [
                  'Sumatif Akhir Semester (SAS)',
                  'Sumatif Tengah Semester (STS)',
                  'Sumatif Akhir Tahun (SAT)',
                  'Penilaian Harian',
                  'Asesmen Diagnostik',
                  'Asesmen Formatif',
                  'Asesmen Sumatif',
                  'Latihan Soal',
                  'Asesmen Lainnya',
                ]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Jenjang Pendidikan</label>
              <select
                value={educationLevel}
                onChange={(e) => {
                  const lvl = e.target.value;
                  setEducationLevel(lvl);
                  if (lvl === 'PAUD/TK') setGradeLevel('PAUD / TK B');
                  else if (lvl === 'SD/MI') setGradeLevel('Kelas VI');
                  else if (lvl === 'SMP/MTs') setGradeLevel('Kelas VII');
                  else if (lvl === 'SMA/MA' || lvl === 'SMK') setGradeLevel('Kelas X');
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]"
              >
                {(bundle.educationReferences?.levels || ['PAUD/TK', 'SD/MI', 'SMP/MTs', 'SMA/MA', 'SMK', 'Madrasah / Keagamaan', 'Umum / Lainnya']).map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kelas</label>
              <select value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
                {['PAUD / TK A', 'PAUD / TK B', 'Kelas I', 'Kelas II', 'Kelas III', 'Kelas IV', 'Kelas V', 'Kelas VI', 'Kelas VII', 'Kelas VIII', 'Kelas IX', 'Kelas X', 'Kelas XI', 'Kelas XII', 'Umum / Lintas Kelas'].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Mata Pelajaran</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
                {(bundle.educationReferences?.subjects || [
                  'Pendidikan Pancasila', 'Bahasa Indonesia', 'Matematika', 'IPAS (Ilmu Pengetahuan Alam dan Sosial)',
                  'PAIBP (Pendidikan Agama Islam dan Budi Pekerti)', 'PJOK', 'Bahasa Inggris', 'Bahasa Madura', 'Seni Rupa',
                ]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="__custom__">+ Ketik Mata Pelajaran Lainnya...</option>
              </select>
              {subject === '__custom__' && (
                <input
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                  placeholder="Tulis nama mata pelajaran..."
                  className="w-full mt-2 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Semester & Tahun Pelajaran</label>
              <div className="flex gap-2">
                <select
                  value={semester}
                  onChange={(e) => {
                    const nextSem = e.target.value;
                    setSemester(nextSem);
                    if (nextSem === '1' || nextSem === '2') {
                      applyChaptersFromRefs(references, selectedRefIds, nextSem);
                    }
                  }}
                  className="w-28 px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]"
                >
                  <option value="1">Sem. 1</option>
                  <option value="2">Sem. 2</option>
                </select>
                <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kurikulum & Waktu (Menit)</label>
              <div className="flex gap-2">
                <select value={curriculum} onChange={(e) => setCurriculum(e.target.value)} className="flex-1 px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
                  {(bundle.educationReferences?.curricula || ['Kurikulum Merdeka', 'Kurikulum 2013', 'Kemenag (KMA)', 'Kustom Lembaga']).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input type="number" min={15} max={240} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} className="w-20 px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Tingkat Kesulitan</label>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
                <option value="Campuran Proporsional">Campuran Proporsional</option>
                <option value="Mudah - Sedang">Dominan Mudah – Sedang</option>
                <option value="Sedang - Sukar (HOTS)">Menengah ke Sukar (HOTS)</option>
              </select>
            </div>

            {/* Interactive Chapter & Material Picker per Book (Semester 1 / Semester 2) */}
            <div className="md:col-span-3 rounded-xl border border-indigo-200/80 bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/50 p-4 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Materi / Bab Fokus Asesmen (Pilah Bab &amp; Materi Semester 1 / 2)
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      Centang bab dan materi dari buku referensi yang masuk Semester {semester}. Pembuatan soal akan otomatis mengambil materi dari bab terpilih saja.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => applyChaptersFromRefs(references, selectedRefIds, '1')}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                      semester === '1'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-blue-200 bg-white dark:bg-[#111a2e] text-blue-700 hover:bg-blue-50'
                    }`}
                  >
                    Bab Sem. 1 (Awal)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyChaptersFromRefs(references, selectedRefIds, '2')}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                      semester === '2'
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-indigo-200 bg-white dark:bg-[#111a2e] text-indigo-700 hover:bg-indigo-50'
                    }`}
                  >
                    Bab Sem. 2 (Akhir)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyChaptersFromRefs(references, selectedRefIds, 'all')}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] hover:bg-slate-50 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Pilih Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => applyChaptersFromRefs(references, selectedRefIds, 'none')}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] hover:bg-rose-50 hover:text-rose-700 text-[11px] font-medium text-slate-600 dark:text-slate-400"
                  >
                    Kosongkan
                  </button>
                </div>
              </div>

              {selectedRefIds.length === 0 ? (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
                  <span>Belum ada buku referensi yang dipilih di Langkah 1. Pilih buku agar daftar Bab &amp; Materi muncul otomatis.</span>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-3 py-1 rounded-md bg-amber-600 text-white font-semibold text-[11px]"
                  >
                    Pilih Buku di Langkah 1
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {references
                    .filter((r) => selectedRefIds.includes(r.id))
                    .map((ref) => {
                      const chapters = ref.chapters || [];
                      const concepts = ref.concepts || [];
                      const sem1Set = new Set(splitChaptersBySemester(chapters, '1'));
                      return (
                        <div key={ref.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] p-3.5 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div>
                              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{ref.title}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {ref.subject} · {ref.grade_level} · {chapters.length} bab terdeteksi · {concepts.length} materi kunci
                              </div>
                            </div>
                            <span className="text-[11px] font-mono font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                              {chapters.filter((c) => selectedChapters.includes(c)).length}/{chapters.length} bab dipilih
                            </span>
                          </div>

                          {chapters.length > 0 ? (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Pilih Bab / Unit dari Buku:</div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {chapters.map((chap, idx) => {
                                  const isChecked = selectedChapters.includes(chap);
                                  const semHint = sem1Set.has(chap) ? 'Sem. 1' : 'Sem. 2';
                                  return (
                                    <label
                                      key={`${ref.id}-ch-${idx}`}
                                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all text-xs ${
                                        isChecked
                                          ? 'border-blue-500 bg-blue-50/70 text-slate-900 dark:text-slate-100 shadow-xs'
                                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => handleToggleChapter(chap)}
                                        className="mt-0.5 shrink-0"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="font-medium leading-snug">{chap}</div>
                                        <span
                                          className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                            semHint === 'Sem. 1'
                                              ? 'bg-sky-100 text-sky-800'
                                              : 'bg-violet-100 text-violet-800'
                                          }`}
                                        >
                                          Saran {semHint}
                                        </span>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                              Daftar bab terstruktur belum terdeteksi di buku ini — AI tetap membaca seluruh chunk buku dan fokus pada catatan materi di bawah.
                            </div>
                          )}

                          {concepts.length > 0 && (
                            <div className="space-y-1.5 pt-1 border-t border-slate-100">
                              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Pilih Pokok Materi / Konsep Kunci:</div>
                              <div className="flex flex-wrap gap-1.5">
                                {concepts.map((concept, idx) => {
                                  const active = selectedMaterials.includes(concept);
                                  return (
                                    <button
                                      key={`${ref.id}-c-${idx}`}
                                      type="button"
                                      onClick={() => handleToggleMaterial(concept)}
                                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                                        active
                                          ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold'
                                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                                      }`}
                                    >
                                      <span className={`w-2 h-2 rounded-sm ${active ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                                      <span>{concept}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ringkasan Materi Terpilih / Fokus Tambahan (bisa disunting manual)
                </label>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Otomatis terisi dari Bab & Materi yang dicentang di atas, atau tulis subtopik khusus..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-sm"
                />
              </div>
            </div>
          </div>

          {/* Cognitive Target Selection (Direct C1 - C6 without percentages) */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Target Level Kognitif (Pilih C1 – C6 &amp; Alokasi Butir Soal)
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Centang level kognitif yang ingin dimunculkan pada kisi-kisi &amp; soal beserta target jumlah butirnya (tanpa persentase).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyCognitivePreset(['C1', 'C2', 'C3', 'C4'], 'SD/MI Standar')}
                  className="px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[11px] font-semibold text-blue-800"
                >
                  Preset SD/MI (C1–C4)
                </button>
                <button
                  type="button"
                  onClick={() => applyCognitivePreset(['C3', 'C4', 'C5', 'C6'], 'Dominan HOTS')}
                  className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-[11px] font-semibold text-amber-900"
                >
                  Preset HOTS (C3–C6)
                </button>
                <button
                  type="button"
                  onClick={() => applyCognitivePreset(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'], 'Lengkap C1–C6')}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                >
                  Pilih Semua (C1–C6)
                </button>
                <button
                  type="button"
                  onClick={() => setLevelCounts(distributeCountsToLevels(selectedLevels, totalQuestionTarget))}
                  className="px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-semibold text-emerald-800"
                >
                  Bagi Merata ({totalQuestionTarget} soal)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {COGNITIVE_LEVEL_OPTIONS.map((item) => {
                const isActive = selectedLevels.includes(item.code);
                return (
                  <div
                    key={item.code}
                    className={`rounded-xl border p-3 transition-all ${
                      isActive ? item.activeClass : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => toggleCognitiveLevel(item.code)}
                          className="mt-1 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold ${isActive ? item.badgeClass : 'bg-slate-300 text-slate-700 dark:text-slate-300'}`}>
                              {item.code}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{item.name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${item.tierClass}`}>
                              {item.tier}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{item.desc}</div>
                        </div>
                      </label>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-slate-200/70 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Target Jumlah Soal:</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={60}
                          disabled={!isActive}
                          value={isActive ? (levelCounts[item.code] ?? 0) : 0}
                          onChange={(e) =>
                            setLevelCounts({
                              ...levelCounts,
                              [item.code]: Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-16 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-xs font-mono font-bold text-center disabled:bg-slate-100 disabled:text-slate-400"
                        />
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">butir</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800 text-xs">
              <div>
                Level aktif: <strong className="font-mono text-indigo-700">{selectedLevels.join(', ')}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span>
                  Alokasi level: <strong className="font-mono text-slate-900 dark:text-slate-100">{totalCognitiveAllocated}</strong> /{' '}
                  <strong className="font-mono text-blue-700">{totalQuestionTarget}</strong> total soal
                </span>
                {totalCognitiveAllocated !== totalQuestionTarget && totalQuestionTarget > 0 && (
                  <span className="text-[11px] text-amber-700 font-medium">
                    (klik &ldquo;Bagi Merata&rdquo; bila ingin disamakan)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ASKARA 04 Question Count Presets */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Rincian Bentuk & Jumlah Soal · Total: <span className="font-mono text-blue-700">{totalQuestionTarget} soal</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(bundle.settings?.questionPresets || {}).map((presetKey) => (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => applyAskaraPreset(presetKey)}
                    className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 hover:bg-blue-50 hover:border-blue-300 text-[11px] font-medium text-slate-700 dark:text-slate-300"
                  >
                    Preset {presetKey}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {QUESTION_TYPES.map((qType) => (
                <div key={qType} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 truncate">{qType}</label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={counts[qType] || 0}
                    onChange={(e) => setCounts({ ...counts, [qType]: Math.max(0, Number(e.target.value)) })}
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-sm font-mono tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={() => setStep(1)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300">
              Kembali
            </button>
            <button
              type="button"
              disabled={!!busy || totalQuestionTarget < 1}
              onClick={handleCreateProjectAndBlueprint}
              className="px-5 py-2.5 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Buat Proyek & Generate Kisi-Kisi AI</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: BLUEPRINT (KISI-KISI) */}
      {step === 3 && projectDetail && (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Langkah 3 — Kisi-Kisi Penulisan Soal ({projectDetail.blueprints.length} Baris)</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Sunting kisi-kisi atau langsung unduh format Word / PDF sebelum menyusun soal.</p>
              {projectDetail.project.selectedChapters && projectDetail.project.selectedChapters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[11px] font-semibold text-indigo-800">Fokus Bab (Sem. {projectDetail.project.semester}):</span>
                  {projectDetail.project.selectedChapters.map((ch, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] font-medium text-indigo-900"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy || !projectDetail.blueprints.length}
                onClick={() => handleQuickExport('kisi_kisi', 'docx')}
                className="px-3 py-2 rounded-xl bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Word (.docx)</span>
              </button>
              <button
                type="button"
                disabled={!!busy || !projectDetail.blueprints.length}
                onClick={() => handleQuickExport('kisi_kisi', 'pdf')}
                className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF (.pdf)</span>
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={handleRegenerateBlueprint}
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 flex items-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Regenerate</span>
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={handleSaveBlueprintEdits}
                className="px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Simpan Edit</span>
              </button>
              <button
                type="button"
                disabled={!!busy || !projectDetail.blueprints.length}
                onClick={handleGenerateQuestions}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Generate Soal dari Kisi-Kisi</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-indigo-50/80 border-b border-indigo-100 text-slate-800 dark:text-slate-200">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">No</th>
                  <th className="py-2.5 px-3 font-semibold min-w-[160px]">CP</th>
                  <th className="py-2.5 px-3 font-semibold min-w-[160px]">TP</th>
                  <th className="py-2.5 px-3 font-semibold min-w-[120px]">Materi</th>
                  <th className="py-2.5 px-3 font-semibold min-w-[200px]">Indikator Soal</th>
                  <th className="py-2.5 px-3 font-semibold">Level</th>
                  <th className="py-2.5 px-3 font-semibold">Bentuk</th>
                  <th className="py-2.5 px-3 font-semibold">No. Soal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {projectDetail.blueprints.map((row, idx) => (
                  <tr key={row.id || idx} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono tabular-nums">{row.row_number}</td>
                    <td className="py-2 px-3">
                      <input
                        value={row.cp}
                        onChange={(e) => {
                          const next = [...projectDetail.blueprints];
                          next[idx] = { ...row, cp: e.target.value };
                          setProjectDetail({ ...projectDetail, blueprints: next });
                        }}
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-0.5"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        value={row.tp}
                        onChange={(e) => {
                          const next = [...projectDetail.blueprints];
                          next[idx] = { ...row, tp: e.target.value };
                          setProjectDetail({ ...projectDetail, blueprints: next });
                        }}
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-0.5"
                      />
                    </td>
                    <td className="py-2 px-3">{row.materi}</td>
                    <td className="py-2 px-3">
                      <input
                        value={row.indikator_soal}
                        onChange={(e) => {
                          const next = [...projectDetail.blueprints];
                          next[idx] = { ...row, indikator_soal: e.target.value };
                          setProjectDetail({ ...projectDetail, blueprints: next });
                        }}
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-0.5"
                      />
                    </td>
                    <td className="py-2 px-3 font-mono font-semibold text-blue-700">{row.level_kognitif}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{row.bentuk_soal}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">{row.nomor_soal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STEP 4: GENERATED QUESTIONS */}
      {step === 4 && projectDetail && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Langkah 4 — Butir Soal Terhasil ({projectDetail.questions.length} Soal)</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">Tinjau soal, ubah secara manual, atau perbaiki langsung dengan AI sebelum Quality Control.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('quality-control', projectDetail.project.id)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              >
                <ShieldCheck className="w-4 h-4 text-amber-200" />
                <span>Lanjut ke Quality Control</span>
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => handleQuickExport('naskah_soal', 'docx')}
                className="px-3 py-2 rounded-xl bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Word (.docx)</span>
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => handleQuickExport('naskah_soal', 'pdf')}
                className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF (.pdf)</span>
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => handleQuickExport('all', 'xlsx')}
                className="px-3 py-2 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('dokumen-saya', projectDetail.project.id)}
                className="px-4 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Preview &amp; Export</span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {projectDetail.questions.map((q) => (
              <div key={q.id} className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-2.5">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm mr-2">Soal {q.question_number}</span>
                    {q.question_type} · {q.cognitive_level} ({q.cognitive_tier}) · {q.difficulty} · {q.materi}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingQ(q)}
                      className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => handleRepairSingleQuestion(q.id, 'Tingkatkan kejelasan kalimat dan pastikan sesuai indikator serta level kognitif.')}
                      className="px-2.5 py-1 rounded-md border border-blue-200 bg-blue-50/60 hover:bg-blue-100 text-xs font-medium text-blue-800 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Perbaiki AI</span>
                    </button>
                  </div>
                </div>

                <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed font-medium whitespace-pre-line">{q.question_text}</p>

                {q.image_url && (
                  <div className="py-1">
                    <img
                      src={q.image_url}
                      alt={q.image_caption || `Gambar Soal ${q.question_number}`}
                      className="max-h-48 w-auto rounded-lg border border-slate-200 dark:border-slate-800 object-contain bg-white dark:bg-[#111a2e]"
                    />
                    {q.image_caption && (
                      <div className="text-[11px] italic text-slate-500 dark:text-slate-400 mt-1">{q.image_caption}</div>
                    )}
                  </div>
                )}

                {q.options?.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-2 text-sm text-slate-700 dark:text-slate-300">
                    {q.options.map((opt, idx) => {
                      const letter = ['a', 'b', 'c', 'd', 'e'][idx];
                      return (
                        <div key={idx} className="py-1 px-2.5 rounded-md bg-slate-50 dark:bg-slate-800/70 border border-slate-100">
                          <span className="font-mono font-semibold mr-1.5">{letter}.</span>
                          {opt}
                        </div>
                      );
                    })}
                  </div>
                )}

                {q.matching_pairs?.length > 0 && (
                  <div className="space-y-1 pl-2 text-xs text-slate-700 dark:text-slate-300">
                    {q.matching_pairs.map((p, idx) => (
                      <div key={idx}>{p.left} ↔ {p.right}</div>
                    ))}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  <div>
                    <strong className="text-emerald-700">Kunci Jawaban:</strong> {q.correct_answer} · <strong>Skor Maks:</strong> <span className="font-mono">{q.max_score}</span>
                  </div>
                  <div><strong>Pembahasan:</strong> {q.explanation}</div>
                  <div className="text-slate-500 dark:text-slate-400">
                    Indikator: {q.indikator_soal} · Sumber: {q.source_reference} (Hal. {q.source_page})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 5: COGNITIVE ANALYSIS */}
      {step === 5 && projectDetail && (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Langkah 5 — Analisis Kognitif (C1–C6 &amp; LOTS / MOTS / HOTS)</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Rekap distribusi Taksonomi Bloom Revisi beserta alasan klasifikasi tiap butir soal.</p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                disabled={!!busy || !projectDetail.questions.length}
                onClick={() => handleQuickExport('analisis_kognitif', 'docx')}
                className="px-3 py-2 rounded-xl bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Word (.docx)</span>
              </button>
              <button
                type="button"
                disabled={!!busy || !projectDetail.questions.length}
                onClick={() => handleQuickExport('analisis_kognitif', 'pdf')}
                className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF (.pdf)</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-9 gap-3">
            {[
              { label: 'C1', val: projectDetail.cognitiveSummary?.c1_count ?? 0, style: 'bg-sky-50 border-sky-200 text-sky-900' },
              { label: 'C2', val: projectDetail.cognitiveSummary?.c2_count ?? 0, style: 'bg-blue-50 border-blue-200 text-blue-900' },
              { label: 'C3', val: projectDetail.cognitiveSummary?.c3_count ?? 0, style: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
              { label: 'C4', val: projectDetail.cognitiveSummary?.c4_count ?? 0, style: 'bg-amber-50 border-amber-200 text-amber-900' },
              { label: 'C5', val: projectDetail.cognitiveSummary?.c5_count ?? 0, style: 'bg-orange-50 border-orange-200 text-orange-900' },
              { label: 'C6', val: projectDetail.cognitiveSummary?.c6_count ?? 0, style: 'bg-rose-50 border-rose-200 text-rose-900' },
              { label: 'LOTS', val: projectDetail.cognitiveSummary?.lots_count ?? 0, style: 'bg-sky-100/70 border-sky-300 text-sky-950' },
              { label: 'MOTS', val: projectDetail.cognitiveSummary?.mots_count ?? 0, style: 'bg-emerald-100/70 border-emerald-300 text-emerald-950' },
              { label: 'HOTS', val: projectDetail.cognitiveSummary?.hots_count ?? 0, style: 'bg-amber-100/70 border-amber-300 text-amber-950' },
            ].map((item) => (
              <div key={item.label} className={`p-3 rounded-xl border text-center ${item.style}`}>
                <div className="text-[11px] font-bold">{item.label}</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-1">{item.val}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-indigo-50/80 border-b border-indigo-100 text-slate-800 dark:text-slate-200">
                <tr>
                  <th className="py-2.5 px-3">No</th>
                  <th className="py-2.5 px-3">Level</th>
                  <th className="py-2.5 px-3">Kategori</th>
                  <th className="py-2.5 px-3">Kesulitan</th>
                  <th className="py-2.5 px-3">Alasan Klasifikasi Kognitif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {projectDetail.questions.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono">{q.question_number}</td>
                    <td className="py-2 px-3 font-mono font-bold text-indigo-700">{q.cognitive_level}</td>
                    <td className="py-2 px-3 font-semibold">{q.cognitive_tier}</td>
                    <td className="py-2 px-3">{q.difficulty}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{q.cognitive_rationale || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STEP 6: ANSWER KEYS & SCORING RUBRICS */}
      {step === 6 && projectDetail && (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Langkah 6 — Kunci Jawaban &amp; Rubrik Penilaian</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">Sunting kunci atau langsung unduh Kunci Jawaban &amp; Rubrik lengkap dalam format Word atau PDF.</p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                disabled={!!busy || !projectDetail.questions.length}
                onClick={() => handleQuickExport('kunci_rubrik', 'docx')}
                className="px-3 py-2 rounded-xl bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Kunci &amp; Rubrik (.docx)</span>
              </button>
              <button
                type="button"
                disabled={!!busy || !projectDetail.questions.length}
                onClick={() => handleQuickExport('kunci_rubrik', 'pdf')}
                className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Kunci &amp; Rubrik (.pdf)</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('quality-control', projectDetail.project.id)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-200" />
                <span>Quality Control &amp; Setujui</span>
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {projectDetail.questions.map((q) => (
              <div key={q.id} className="py-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    No. {q.question_number} · {q.question_type} · Skor Maks: <span className="font-mono text-indigo-700">{q.max_score}</span>
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300"><strong className="text-emerald-700">Kunci:</strong> {q.correct_answer}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400"><strong>Jawaban Ideal / Rubrik:</strong> {q.ideal_answer || '-'} — {q.scoring_guide}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingQ(q)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 shrink-0"
                >
                  Ubah Kunci &amp; Skor
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual Edit Question Modal */}
      {editingQ && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveEditedQuestion} className="bg-white dark:bg-[#111a2e] rounded-xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Edit Manual Soal No. {editingQ.question_number}</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Teks Pertanyaan</label>
              <textarea
                rows={3}
                value={editingQ.question_text}
                onChange={(e) => setEditingQ({ ...editingQ, question_text: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              />
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
                    <span>{generatingAiImg ? 'Mencari Gambar Asli...' : 'Cari Gambar Asli'}</span>
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
                        if (f) handleUploadEditingImage(f);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {editingQ.image_url && (
                    <button
                      type="button"
                      onClick={() => setEditingQ({ ...editingQ, image_url: '', image_caption: '' })}
                      className="px-2.5 py-1.5 rounded-md border border-red-200 bg-red-50 text-red-700 text-xs font-medium flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus</span>
                    </button>
                  )}
                </div>
              </div>

              {error && (
                <div className="p-2 rounded-md bg-red-50 border border-red-200 text-[11px] text-red-700">
                  {error}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 items-start">
                {editingQ.image_url && (
                  <img
                    src={editingQ.image_url}
                    alt="Preview Gambar Soal"
                    className="h-24 w-auto rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] object-contain shrink-0"
                  />
                )}
                <div className="flex-1 w-full">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Kata Kunci Pencarian Gambar Asli / Keterangan Gambar
                  </label>
                  <input
                    value={editingQ.image_caption || ''}
                    onChange={(e) => setEditingQ({ ...editingQ, image_caption: e.target.value })}
                    placeholder="Contoh: Garuda Pancasila, Candi Borobudur, atau Diagram Siklus Air"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-xs"
                  />
                </div>
              </div>

              {availableRefImages.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">Atau pilih gambar terekstrak dari buku referensi proyek:</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {availableRefImages.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setEditingQ({ ...editingQ, image_url: img.url, image_caption: img.label })}
                        className={`shrink-0 p-1 rounded border text-left ${editingQ.image_url === img.url ? 'border-blue-600 bg-blue-50' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] hover:border-slate-400'}`}
                      >
                        <img src={img.url} alt={img.label} className="h-12 w-16 object-contain" />
                        <div className="text-[10px] text-slate-600 dark:text-slate-400 truncate w-16 mt-0.5">{img.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {editingQ.options?.length > 0 && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Pilihan Jawaban</label>
                {editingQ.options.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="font-mono text-xs w-5">{['a', 'b', 'c', 'd', 'e'][idx]}.</span>
                    <input
                      value={opt}
                      onChange={(e) => {
                        const next = [...editingQ.options];
                        next[idx] = e.target.value;
                        setEditingQ({ ...editingQ, options: next });
                      }}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Level Kognitif</label>
                <select
                  value={editingQ.cognitive_level}
                  onChange={(e) => setEditingQ({ ...editingQ, cognitive_level: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]"
                >
                  {['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kategori</label>
                <select
                  value={editingQ.cognitive_tier}
                  onChange={(e) => setEditingQ({ ...editingQ, cognitive_tier: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]"
                >
                  {['LOTS', 'MOTS', 'HOTS'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Skor Maksimal</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={editingQ.max_score}
                  onChange={(e) => setEditingQ({ ...editingQ, max_score: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kunci Jawaban</label>
              <input
                value={editingQ.correct_answer}
                onChange={(e) => setEditingQ({ ...editingQ, correct_answer: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Pembahasan</label>
              <textarea
                rows={2}
                value={editingQ.explanation}
                onChange={(e) => setEditingQ({ ...editingQ, explanation: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Pedoman Penskoran / Rubrik</label>
              <textarea
                rows={2}
                value={editingQ.scoring_guide}
                onChange={(e) => setEditingQ({ ...editingQ, scoring_guide: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingQ(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm">
                Batal
              </button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-sm font-semibold">
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
