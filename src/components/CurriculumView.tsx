import React, { useEffect, useState } from 'react';
import { Sparkles, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { AuthBundle, ReferenceDocument } from '../types';

export const CurriculumView: React.FC<{ bundle: AuthBundle }> = ({ bundle }) => {
  const [cpList, setCpList] = useState<any[]>([]);
  const [tpList, setTpList] = useState<any[]>([]);
  const [refs, setRefs] = useState<ReferenceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedRefId, setSelectedRefId] = useState('');
  const [subject, setSubject] = useState(bundle.educationReferences?.subjects?.[0] || 'Pendidikan Pancasila');
  const [customSubject, setCustomSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('Kelas VI');
  const [phase, setPhase] = useState('Fase C');
  const activeSubject = subject === '__custom__' ? (customSubject.trim() || 'Mata Pelajaran Lainnya') : subject;

  const [newCpCode, setNewCpCode] = useState('CP-1');
  const [newCpDesc, setNewCpDesc] = useState('');
  const [newTpCode, setNewTpCode] = useState('TP-1');
  const [newTpDesc, setNewTpDesc] = useState('');
  const [selectedCpForTp, setSelectedCpForTp] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [curr, refDocs] = await Promise.all([
        apiFetch<{ cpList: any[]; tpList: any[] }>('/api/curriculum'),
        apiFetch<ReferenceDocument[]>('/api/references'),
      ]);
      setCpList(curr.cpList);
      setTpList(curr.tpList);
      setRefs(refDocs);
      if (refDocs.length && !selectedRefId) setSelectedRefId(refDocs[0].id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleExtractAI = async () => {
    if (!selectedRefId) return setError('Pilih dokumen referensi terlebih dahulu.');
    setError('');
    setAiLoading(true);
    try {
      await apiFetch('/api/curriculum/extract-ai', {
        method: 'POST',
        body: JSON.stringify({ referenceId: selectedRefId, subject: activeSubject, gradeLevel, phase }),
      });
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddCp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCpDesc.trim()) return;
    await apiFetch('/api/curriculum/cp', {
      method: 'POST',
      body: JSON.stringify({ subject: activeSubject, phase, gradeLevel, code: newCpCode, description: newCpDesc }),
    });
    setNewCpDesc('');
    loadData();
  };

  const handleAddTp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTpDesc.trim()) return;
    await apiFetch('/api/curriculum/tp', {
      method: 'POST',
      body: JSON.stringify({ outcomeId: selectedCpForTp || null, subject: activeSubject, gradeLevel, code: newTpCode, description: newTpDesc }),
    });
    setNewTpDesc('');
    loadData();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Capaian Pembelajaran (CP) & Tujuan Pembelajaran (TP)</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Kelola CP/TP manual atau ekstrak otomatis menggunakan AI berdasarkan buku referensi lembaga Anda.</p>
      </div>

      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      {/* AI Extractor Card */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Ekstraksi CP &amp; TP Otomatis dari Referensi (AI)</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select value={selectedRefId} onChange={(e) => setSelectedRefId(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
            <option value="">-- Pilih Referensi --</option>
            {refs.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <div className="space-y-2">
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
              {(bundle.educationReferences?.subjects || ['Pendidikan Pancasila', 'Bahasa Indonesia', 'Matematika', 'IPAS']).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="__custom__">+ Ketik Mata Pelajaran Lainnya...</option>
            </select>
            {subject === '__custom__' && (
              <input
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                placeholder="Nama mata pelajaran..."
                className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs"
              />
            )}
          </div>
          <select value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
            {['PAUD / TK A', 'PAUD / TK B', 'Kelas I', 'Kelas II', 'Kelas III', 'Kelas IV', 'Kelas V', 'Kelas VI', 'Kelas VII', 'Kelas VIII', 'Kelas IX', 'Kelas X', 'Kelas XI', 'Kelas XII', 'Umum / Lintas Kelas'].map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <select value={phase} onChange={(e) => setPhase(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
            {['Fase Fondasi', 'Fase A', 'Fase B', 'Fase C', 'Fase D', 'Fase E', 'Fase F'].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={aiLoading || !selectedRefId}
          onClick={handleExtractAI}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50 shadow-sm"
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>{aiLoading ? 'Menyusun CP & TP dari Referensi...' : 'Ekstrak CP & TP dengan AI'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CP Panel */}
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Daftar Capaian Pembelajaran ({cpList.length})</h2>
          <form onSubmit={handleAddCp} className="space-y-2.5 border-b border-slate-100 pb-4">
            <div className="flex gap-2">
              <input value={newCpCode} onChange={(e) => setNewCpCode(e.target.value)} placeholder="Kode CP" className="w-28 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-mono" />
              <input value={newCpDesc} onChange={(e) => setNewCpDesc(e.target.value)} placeholder="Tulis deskripsi CP baru..." className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Tambah
              </button>
            </div>
          </form>
          {loading ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">Memuat CP...</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
              {cpList.map((cp) => (
                <div key={cp.id} className="py-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      <span className="font-mono text-blue-700">{cp.code}</span> · {cp.subject} · {cp.phase} · {cp.grade_level}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{cp.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => { await apiFetch(`/api/curriculum/cp/${cp.id}`, { method: 'DELETE' }); loadData(); }}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* TP Panel */}
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Daftar Tujuan Pembelajaran ({tpList.length})</h2>
          <form onSubmit={handleAddTp} className="space-y-2 border-b border-slate-100 pb-4">
            <select value={selectedCpForTp} onChange={(e) => setSelectedCpForTp(e.target.value)} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
              <option value="">-- Kaitkan ke CP (Opsional) --</option>
              {cpList.map((cp) => <option key={cp.id} value={cp.id}>{cp.code} - {cp.subject}</option>)}
            </select>
            <div className="flex gap-2">
              <input value={newTpCode} onChange={(e) => setNewTpCode(e.target.value)} placeholder="Kode TP" className="w-28 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-mono" />
              <input value={newTpDesc} onChange={(e) => setNewTpDesc(e.target.value)} placeholder="Tulis deskripsi TP baru..." className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Tambah
              </button>
            </div>
          </form>
          {loading ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">Memuat TP...</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
              {tpList.map((tp) => (
                <div key={tp.id} className="py-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      <span className="font-mono text-blue-700">{tp.code}</span> · {tp.subject} · {tp.grade_level} {tp.atp_notes ? `· ${tp.atp_notes}` : ''}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{tp.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => { await apiFetch(`/api/curriculum/tp/${tp.id}`, { method: 'DELETE' }); loadData(); }}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
