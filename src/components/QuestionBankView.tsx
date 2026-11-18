import React, { useEffect, useState } from 'react';
import { Search, Copy, Trash2, Layers, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { AuthBundle, NavKey } from '../types';

interface QuestionBankViewProps {
  bundle: AuthBundle;
  onNavigate: (nav: NavKey, projectId?: string) => void;
}

export const QuestionBankView: React.FC<QuestionBankViewProps> = ({ bundle, onNavigate }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [assembleTitle, setAssembleTitle] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [subject, setSubject] = useState('');
  const [semester, setSemester] = useState('');
  const [cognitiveLevel, setCognitiveLevel] = useState('');
  const [assessmentType, setAssessmentType] = useState('');

  // Manual add modal
  const [showAdd, setShowAdd] = useState(false);
  const [newQ, setNewQ] = useState({
    gradeLevel: 'Kelas VI',
    subject: 'Pendidikan Pancasila',
    semester: '1',
    academicYear: bundle.settings?.academic_year || '2026/2027',
    materi: '',
    cognitiveLevel: 'C2',
    cognitiveTier: 'MOTS',
    assessmentType: 'Sumatif Akhir Semester (SAS)',
    questionType: 'Pilihan Ganda',
    questionText: '',
    optionsText: '',
    correctAnswer: '',
    explanation: '',
  });

  const loadBank = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (gradeLevel) qs.set('gradeLevel', gradeLevel);
      if (subject) qs.set('subject', subject);
      if (semester) qs.set('semester', semester);
      if (cognitiveLevel) qs.set('cognitiveLevel', cognitiveLevel);
      if (assessmentType) qs.set('assessmentType', assessmentType);
      const data = await apiFetch<any[]>(`/api/bank?${qs.toString()}`);
      setItems(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBank();
  }, [gradeLevel, subject, semester, cognitiveLevel, assessmentType]);

  const handleAssemble = async () => {
    if (!selectedIds.length) return;
    setError('');
    try {
      const res = await apiFetch<{ projectId: string }>('/api/bank/assemble-project', {
        method: 'POST',
        body: JSON.stringify({
          title: assembleTitle || `Paket Soal Pilihan (${selectedIds.length} Butir)`,
          questionIds: selectedIds,
        }),
      });
      setSelectedIds([]);
      onNavigate('dokumen-saya', res.projectId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/bank', {
        method: 'POST',
        body: JSON.stringify({
          ...newQ,
          options: newQ.optionsText
            ? newQ.optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
            : [],
        }),
      });
      setShowAdd(false);
      setNotice('Soal baru ditambahkan ke Bank Soal.');
      loadBank();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Bank Soal Sekolah</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Penyimpanan permanen terisolasi untuk {bundle.user.tenantName}. Pilih beberapa soal untuk merakit paket asesmen baru.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold flex items-center gap-1.5 self-start shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Soal Manual</span>
        </button>
      </div>

      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>}

      {/* Filter Bar */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="relative lg:col-span-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadBank()}
              placeholder="Cari pertanyaan atau materi..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
            />
          </div>
          <button type="button" onClick={loadBank} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium">
            Cari
          </button>
        </div>

        <select value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
          <option value="">Semua Kelas</option>
          {['PAUD / TK A', 'PAUD / TK B', 'Kelas I', 'Kelas II', 'Kelas III', 'Kelas IV', 'Kelas V', 'Kelas VI', 'Kelas VII', 'Kelas VIII', 'Kelas IX', 'Kelas X', 'Kelas XI', 'Kelas XII', 'Umum / Lintas Kelas'].map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
          <option value="">Semua Mapel</option>
          {(bundle.educationReferences?.subjects || ['Pendidikan Pancasila', 'Bahasa Indonesia', 'Matematika', 'IPAS']).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={cognitiveLevel} onChange={(e) => setCognitiveLevel(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
          <option value="">Semua Level (C1–C6)</option>
          {['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select value={semester} onChange={(e) => setSemester(e.target.value)} className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
          <option value="">Semua Semester</option>
          <option value="1">Semester 1</option>
          <option value="2">Semester 2</option>
        </select>
      </div>

      {/* Multi-Select Assembly Action Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-gradient-to-r from-[#0f172a] via-[#1e3a8a] to-[#312e81] text-white rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="text-sm font-medium">
            <span className="font-mono font-bold text-amber-300">{selectedIds.length}</span> soal dipilih untuk dirakit menjadi paket baru
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={assembleTitle}
              onChange={(e) => setAssembleTitle(e.target.value)}
              placeholder="Nama paket baru..."
              className="px-3 py-1.5 rounded-xl text-slate-900 dark:text-slate-100 text-xs bg-white dark:bg-[#111a2e]"
            />
            <button
              type="button"
              onClick={handleAssemble}
              className="px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Buat Paket Asesmen</span>
            </button>
          </div>
        </div>
      )}

      {/* Bank Question List */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Memuat bank soal...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Bank soal masih kosong. Soal yang disetujui di Quality Control otomatis tersimpan di sini, atau tambahkan secara manual.
          </div>
        ) : (
          items.map((item) => {
            const checked = selectedIds.includes(item.id);
            return (
              <div key={item.id} className="p-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelectedIds((prev) => (prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]))
                    }
                    className="mt-1"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{item.subject}</span> · {item.grade_level} · Sem. {item.semester} · {item.question_type} · <span className="font-mono font-bold text-blue-700">{item.cognitive_level}</span> ({item.cognitive_tier})
                    </div>
                    <p className="text-sm text-slate-900 dark:text-slate-100">{item.question_text}</p>
                    <div className="text-xs text-emerald-700">Kunci: {item.correct_answer}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Duplikasi soal"
                    onClick={async () => { await apiFetch(`/api/bank/${item.id}/duplicate`, { method: 'POST' }); loadBank(); }}
                    className="p-1.5 rounded-md text-slate-400 hover:text-blue-700 hover:bg-blue-50"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title="Hapus dari bank"
                    onClick={async () => { await apiFetch(`/api/bank/${item.id}`, { method: 'DELETE' }); loadBank(); }}
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateManual} className="bg-white dark:bg-[#111a2e] rounded-xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Tambah Soal ke Bank Soal</h3>
            <div className="grid grid-cols-2 gap-3">
              <input value={newQ.subject} onChange={(e) => setNewQ({ ...newQ, subject: e.target.value })} placeholder="Mata Pelajaran" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
              <input value={newQ.gradeLevel} onChange={(e) => setNewQ({ ...newQ, gradeLevel: e.target.value })} placeholder="Kelas" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
              <input value={newQ.materi} onChange={(e) => setNewQ({ ...newQ, materi: e.target.value })} placeholder="Materi" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
              <div className="grid grid-cols-2 gap-2">
                <select value={newQ.semester} onChange={(e) => setNewQ({ ...newQ, semester: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
                  <option value="1">Semester 1</option>
                  <option value="2">Semester 2</option>
                </select>
                <select value={newQ.cognitiveLevel} onChange={(e) => setNewQ({ ...newQ, cognitiveLevel: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
                  {['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <textarea required rows={3} value={newQ.questionText} onChange={(e) => setNewQ({ ...newQ, questionText: e.target.value })} placeholder="Tulis pertanyaan..." className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
            <textarea rows={3} value={newQ.optionsText} onChange={(e) => setNewQ({ ...newQ, optionsText: e.target.value })} placeholder="Opsi jawaban (satu per baris, kosongkan untuk isian/uraian)" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
            <input required value={newQ.correctAnswer} onChange={(e) => setNewQ({ ...newQ, correctAnswer: e.target.value })} placeholder="Kunci jawaban" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">Batal</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-xs font-semibold">Simpan ke Bank</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
