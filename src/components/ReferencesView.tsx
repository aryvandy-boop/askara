import React, { useEffect, useState } from 'react';
import { Upload, FileText, Trash2, Search, BookOpen, CheckCircle2, Eye } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { AuthBundle, ReferenceDocument } from '../types';

interface ReferencesViewProps {
  bundle: AuthBundle;
  mode: 'upload' | 'bank';
  onGoToGenerator: () => void;
}

export const ReferencesView: React.FC<ReferencesViewProps> = ({ bundle, mode, onGoToGenerator }) => {
  const [docs, setDocs] = useState<ReferenceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<(ReferenceDocument & { chunks?: any[] }) | null>(null);
  const [search, setSearch] = useState('');
  const [filterSemester, setFilterSemester] = useState('');

  // Upload form
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState(bundle.educationReferences?.subjects?.[0] || 'Pendidikan Pancasila');
  const [customSubject, setCustomSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('Kelas VI');
  const [refSemester, setRefSemester] = useState('Semua');
  const [rawText, setRawText] = useState('');
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');

  const loadDocs = async () => {
    setLoading(true);
    try {
      const list = await apiFetch<ReferenceDocument[]>('/api/references');
      setDocs(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setUploading(true);
    try {
      const formData = new FormData();
      const activeSubject = subject === '__custom__' ? (customSubject.trim() || 'Mata Pelajaran Lainnya') : subject;
      formData.append('title', title);
      formData.append('subject', activeSubject);
      formData.append('gradeLevel', gradeLevel);
      formData.append('semester', refSemester);
      if (inputMode === 'file' && file) {
        formData.append('file', file);
      } else {
        formData.append('rawText', rawText);
      }
      const res = await apiFetch<any>('/api/references/upload', {
        method: 'POST',
        body: formData,
      });
      setSuccessMsg(
        `Berhasil mengekstrak "${res.title}" (${res.chunkCount} potongan materi RAG${res.imageCount ? `, ${res.imageCount} gambar materi` : ''} siap digunakan AI).`
      );
      setFile(null);
      setTitle('');
      setRawText('');
      await loadDocs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleInspect = async (docId: string) => {
    try {
      const detail = await apiFetch<any>(`/api/references/${docId}`);
      setSelectedDoc(detail);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      await apiFetch(`/api/references/${docId}`, { method: 'DELETE' });
      if (selectedDoc?.id === docId) setSelectedDoc(null);
      await loadDocs();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredDocs = docs.filter((d) => {
    const matchText =
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.subject.toLowerCase().includes(search.toLowerCase()) ||
      d.grade_level.toLowerCase().includes(search.toLowerCase());
    const docSem = d.semester || 'Semua';
    const matchSemester = !filterSemester || docSem === filterSemester || docSem === 'Semua';
    return matchText && matchSemester;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {mode === 'upload' ? 'Upload Referensi & Ekstraksi Materi' : 'Bank Materi & Potongan RAG'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Unggah buku pelajaran, modul ajar, atau ringkasan materi (PDF, DOCX, DOC, TXT, PPTX). AI akan mengenali bab, konsep kunci, dan mengindeks untuk RAG.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToGenerator}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold whitespace-nowrap self-start shadow-sm"
        >
          Lanjut ke AI Generator
        </button>
      </div>

      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {successMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Upload Form */}
      <form onSubmit={handleUpload} className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Tambah Dokumen Sumber Baru</h2>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setInputMode('file')}
              className={`px-3 py-1 text-xs font-medium rounded-md ${inputMode === 'file' ? 'bg-white dark:bg-[#111a2e] text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              Upload File (PDF/DOCX/PPTX)
            </button>
            <button
              type="button"
              onClick={() => setInputMode('text')}
              className={`px-3 py-1 text-xs font-medium rounded-md ${inputMode === 'text' ? 'bg-white dark:bg-[#111a2e] text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              Tempel Teks Materi
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Judul Buku / Modul</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Buku IPAS Kelas V Bab 3"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Mata Pelajaran</label>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
              {(bundle.educationReferences?.subjects || ['Pendidikan Pancasila', 'Bahasa Indonesia', 'Matematika', 'IPAS', 'PAIBP', 'PJOK', 'Bahasa Inggris', 'Bahasa Madura']).map((s) => (
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
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kelas</label>
            <select value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
              {['PAUD / TK A', 'PAUD / TK B', 'Kelas I', 'Kelas II', 'Kelas III', 'Kelas IV', 'Kelas V', 'Kelas VI', 'Kelas VII', 'Kelas VIII', 'Kelas IX', 'Kelas X', 'Kelas XI', 'Kelas XII', 'Umum / Lintas Kelas'].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Cakupan Semester</label>
            <select value={refSemester} onChange={(e) => setRefSemester(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
              <option value="Semua">Semua Semester (1 &amp; 2)</option>
              <option value="1">Semester 1 (Ganjil)</option>
              <option value="2">Semester 2 (Genap)</option>
            </select>
          </div>
        </div>

        {inputMode === 'file' ? (
          <div className="border-2 border-dashed border-indigo-200 rounded-2xl p-6 text-center bg-gradient-to-br from-sky-50/60 to-indigo-50/40 hover:border-indigo-400 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center mx-auto mb-2.5">
              <Upload className="w-6 h-6" />
            </div>
            <label className="cursor-pointer block">
              <span className="text-sm font-semibold text-indigo-700 hover:underline">
                {file ? file.name : 'Pilih file buku referensi (.pdf, .docx, .doc, .txt, .pptx)'}
              </span>
              <input
                type="file"
                accept=".pdf,.docx,.doc,.txt,.pptx"
                onChange={(e) => {
                  const picked = e.target.files?.[0] || null;
                  if (picked && picked.size > 50 * 1024 * 1024) {
                    setError(`Ukuran file "${picked.name}" (${(picked.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimal 50 MB. Kompres PDF atau pecah per bab terlebih dahulu.`);
                    setFile(null);
                    e.target.value = '';
                    return;
                  }
                  setError('');
                  setFile(picked);
                }}
                className="hidden"
              />
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {file
                ? `Ukuran file: ${(file.size / (1024 * 1024)).toFixed(2)} MB · Siap diekstrak`
                : 'Maksimal 50 MB (disarankan ≤ 30 MB) · Otomatis dibaca, diringkas, dan dipecah menjadi indeks RAG'}
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Salin / Ketik Isi Materi Buku Referensi</label>
            <textarea
              rows={5}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Tempelkan materi pembelajaran atau isi bab buku di sini..."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm"
            />
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={uploading || (inputMode === 'file' ? !file : rawText.trim().length < 30)}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2 shadow-sm"
          >
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Mengekstrak & Menganalisis AI...' : 'Proses & Simpan ke Bank Materi'}</span>
          </button>
        </div>
      </form>

      {/* Bank Materi List & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Daftar Referensi Tersimpan ({filteredDocs.length})</h2>
            <div className="flex items-center gap-2">
              <select
                value={filterSemester}
                onChange={(e) => setFilterSemester(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]"
              >
                <option value="">Semua Semester</option>
                <option value="1">Semester 1</option>
                <option value="2">Semester 2</option>
              </select>
              <div className="relative w-48">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari referensi..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Memuat bank materi...</div>
          ) : filteredDocs.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Belum ada dokumen referensi di lembaga ini.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredDocs.map((doc) => (
                <div key={doc.id} className="py-3.5 flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="truncate">{doc.title}</span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {doc.subject} · {doc.grade_level} · {doc.semester === '1' ? 'Sem. 1' : doc.semester === '2' ? 'Sem. 2' : 'Sem. 1 & 2'} · {doc.file_type} · <span className="font-mono">{doc.page_count} hal</span> · <span className="font-mono">{doc.chunk_count || 0} chunk RAG</span>
                      {(doc.images?.length || 0) > 0 && (
                        <> · <span className="font-mono text-blue-700">{doc.images!.length} gambar</span></>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{doc.summary}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleInspect(doc.id)}
                      className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Detail</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                      title="Hapus referensi"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          {selectedDoc ? (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{selectedDoc.title}</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {selectedDoc.subject} · {selectedDoc.grade_level} · {selectedDoc.page_count} halaman
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Ringkasan Materi</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{selectedDoc.summary}</p>
              </div>

              {selectedDoc.chapters?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Bab & Subbab Terdeteksi</h4>
                  <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-4">
                    {selectedDoc.chapters.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}

              {selectedDoc.concepts?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Konsep Penting</h4>
                  <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-4">
                    {selectedDoc.concepts.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}

              {selectedDoc.images && selectedDoc.images.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Gambar / Ilustrasi Terekstrak ({selectedDoc.images.length})
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                    {selectedDoc.images.map((img, idx) => (
                      <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 p-1.5 space-y-1">
                        <img
                          src={img.url}
                          alt={img.label || `Gambar ${idx + 1}`}
                          className="w-full h-24 object-contain bg-white dark:bg-[#111a2e] rounded border border-slate-100"
                        />
                        <div className="text-[10px] text-slate-600 dark:text-slate-400 truncate font-medium">
                          {img.label || `Hal. ${img.pageNumber}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Indeks Potongan RAG ({selectedDoc.chunks?.length || 0})</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {selectedDoc.chunks?.map((ch) => (
                    <div key={ch.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800 text-xs">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {ch.chapter_title} · Hal. {ch.page_number}
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 mt-1 line-clamp-3">{ch.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-64 flex flex-col items-center justify-center text-center text-slate-500 dark:text-slate-400">
              <BookOpen className="w-8 h-8 text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Inspektur Materi RAG</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">Pilih &ldquo;Detail&rdquo; pada salah satu referensi di sebelah kiri untuk melihat bab, konsep penting, dan potongan indeks RAG.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
