import React, { useEffect, useState } from 'react';
import { Upload, CheckCircle2, Plus, Trash2, Star, X } from 'lucide-react';
import { apiFetch, compressLogoIfNeeded } from '../lib/api';
import { AuthBundle, DocumentTemplate } from '../types';

export const KopSuratStudio: React.FC<{ bundle: AuthBundle }> = ({ bundle }) => {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const defaultContact = [
    bundle.schoolProfile?.email ? `Email: ${bundle.schoolProfile.email}` : '',
    bundle.schoolProfile?.phone ? `Telp: ${bundle.schoolProfile.phone}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const [editing, setEditing] = useState<Partial<DocumentTemplate>>({
    name: 'Template Kop Surat Baru',
    logo_url: bundle.schoolProfile?.pemkab_logo_url || '',
    right_logo_url: bundle.schoolProfile?.school_logo_url || bundle.branding?.logo_url || '',
    logo_position: 'dual',
    logo_size: 96,
    pemkab_line: bundle.schoolProfile?.pemkab_name || 'PEMERINTAH KABUPATEN SITUBONDO',
    line_1: bundle.schoolProfile?.dinas_name || 'DINAS PENDIDIKAN DAN KEBUDAYAAN',
    line_2: '[JENIS ASESMEN]',
    line_3: bundle.schoolProfile?.school_name || bundle.user.tenantName.toUpperCase(),
    line_4: 'TAHUN PELAJARAN [TAHUN PELAJARAN]',
    address_line: bundle.schoolProfile?.address || '',
    contact_line: defaultContact,
    border_style: 'thick',
    font_family: 'Calibri',
    is_default: 0,
  });
  const [saving, setSaving] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<'left' | 'right' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadTemplates = async () => {
    const list = await apiFetch<DocumentTemplate[]>('/api/templates');
    setTemplates(list);
    if (list.length > 0 && !editing.id) {
      setEditing(list[0]);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>, slot: 'left' | 'right') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setNotice('');
    setUploadingSlot(slot);
    try {
      const readyFile = await compressLogoIfNeeded(file);
      const formData = new FormData();
      formData.append('logo', readyFile);
      const res = await apiFetch<{ logoUrl: string }>('/api/templates/upload-logo', {
        method: 'POST',
        body: formData,
      });
      setEditing((prev) =>
        slot === 'left' ? { ...prev, logo_url: res.logoUrl } : { ...prev, right_logo_url: res.logoUrl }
      );
      setNotice(
        slot === 'left'
          ? 'Logo Pemkab / Dinas (Kiri) berhasil diunggah. Klik "Simpan Template Kop Surat" untuk menerapkan.'
          : 'Logo Sekolah / Lembaga (Kanan) berhasil diunggah. Klik "Simpan Template Kop Surat" untuk menerapkan.'
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingSlot(null);
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        name: editing.name,
        logoUrl: editing.logo_url || '',
        rightLogoUrl: editing.right_logo_url || '',
        logoPosition: editing.logo_position || 'dual',
        logoSize: editing.logo_size || 96,
        pemkabLine: editing.pemkab_line || '',
        line1: editing.line_1 || '',
        line2: editing.line_2 || '',
        line3: editing.line_3 || '',
        line4: editing.line_4 || '',
        addressLine: editing.address_line || '',
        contactLine: editing.contact_line || '',
        borderStyle: editing.border_style || 'thick',
        fontFamily: editing.font_family || 'Calibri',
        isDefault: Boolean(editing.is_default),
      };
      if (editing.id) {
        const updated = await apiFetch<DocumentTemplate>(`/api/templates/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setEditing(updated);
      } else {
        const created = await apiFetch<DocumentTemplate>('/api/templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setEditing(created);
      }
      setNotice('Template kop surat berhasil disimpan dan siap dipakai pada Word & PDF.');
      await loadTemplates();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatPreviewLine = (s?: string) =>
    (s || '')
      .replace(/\[TAHUN PELAJARAN\]/gi, bundle.settings?.academic_year || '2026/2027')
      .replace(/\[SEMESTER\]/gi, bundle.settings?.semester === '2' ? '2' : '1')
      .replace(/\[JENIS ASESMEN\]/gi, `SUMATIF AKHIR SEMESTER ${bundle.settings?.semester === '2' ? '2' : '1'}`)
      .toUpperCase();

  const isDual = editing.logo_position === 'dual' || Boolean(editing.right_logo_url);
  const boldKopCount = [
    editing.pemkab_line || bundle.schoolProfile?.pemkab_name,
    editing.line_1,
    editing.line_2,
    editing.line_3,
    editing.line_4,
  ].filter(Boolean).length;
  const smallKopCount = [editing.address_line, editing.contact_line].filter(Boolean).length;
  const estimatedKopPx = boldKopCount * 17 + smallKopCount * 13 + 6;
  const logoSizePx = Math.min(130, Math.max(Number(editing.logo_size || 96), Math.round(estimatedKopPx * 0.90)));
  const borderClass =
    editing.border_style === 'double'
      ? 'border-b-4 border-double border-slate-900'
      : editing.border_style === 'single'
        ? 'border-b border-slate-900'
        : 'border-b-[2.5px] border-slate-900';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Kop Surat Resmi — Dual Logo Pemkab &amp; Sekolah</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Unggah Logo Pemerintah Kabupaten/Dinas (Kiri) dan Logo Sekolah/Lembaga (Kanan) milik {bundle.user.tenantName} dalam format PNG, JPG, atau SVG.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setEditing({
              name: 'Template Kop Naskah Resmi',
              logo_url: templates[0]?.logo_url || bundle.schoolProfile?.pemkab_logo_url || '',
              right_logo_url: templates[0]?.right_logo_url || bundle.schoolProfile?.school_logo_url || bundle.branding?.logo_url || '',
              logo_position: 'dual',
              logo_size: 96,
              pemkab_line: bundle.schoolProfile?.pemkab_name || 'PEMERINTAH KABUPATEN SITUBONDO',
              line_1: bundle.schoolProfile?.dinas_name || 'DINAS PENDIDIKAN DAN KEBUDAYAAN',
              line_2: '[JENIS ASESMEN]',
              line_3: bundle.schoolProfile?.school_name || bundle.user.tenantName.toUpperCase(),
              line_4: 'TAHUN PELAJARAN [TAHUN PELAJARAN]',
              address_line: bundle.schoolProfile?.address || '',
              contact_line: defaultContact,
              border_style: 'thick',
              font_family: 'Calibri',
              is_default: 0,
            })
          }
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 self-start shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Buat Template Baru</span>
        </button>
      </div>

      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Template List Chips */}
      <div className="flex flex-wrap gap-2">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
              editing.id === tpl.id ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] text-slate-700 dark:text-slate-300'
            }`}
          >
            <button type="button" onClick={() => setEditing(tpl)} className="text-left">
              {tpl.name} {tpl.is_default ? '· Default' : ''}
            </button>
            {!tpl.is_default && (
              <>
                <button
                  type="button"
                  title="Jadikan default"
                  onClick={async () => {
                    await apiFetch(`/api/templates/${tpl.id}/set-default`, { method: 'POST' });
                    loadTemplates();
                  }}
                  className="text-amber-600 hover:text-amber-700"
                >
                  <Star className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Hapus template"
                  onClick={async () => {
                    await apiFetch(`/api/templates/${tpl.id}`, { method: 'DELETE' });
                    loadTemplates();
                  }}
                  className="text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Editor Form */}
        <form onSubmit={handleSave} className="lg:col-span-5 bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Template</label>
            <input
              required
              value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            />
          </div>

          {/* Dual Logo Upload Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Logo Pemkab / Dinas (Kiri)</span>
                {editing.logo_url && (
                  <button
                    type="button"
                    onClick={() => setEditing({ ...editing, logo_url: '' })}
                    className="text-slate-400 hover:text-red-600"
                    title="Hapus logo kiri"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-11 h-11 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] flex items-center justify-center overflow-hidden shrink-0">
                  {editing.logo_url ? (
                    <img src={editing.logo_url} alt="Logo Kiri" className="w-9 h-9 object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-400">Kosong</span>
                  )}
                </div>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] hover:bg-slate-100 text-[11px] font-medium cursor-pointer">
                  <Upload className="w-3 h-3 text-blue-600" />
                  <span>{uploadingSlot === 'left' ? 'Mengunggah...' : 'Unggah'}</span>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg"
                    onChange={(e) => handleUploadLogo(e, 'left')}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Logo Sekolah / Lembaga (Kanan)</span>
                {editing.right_logo_url && (
                  <button
                    type="button"
                    onClick={() => setEditing({ ...editing, right_logo_url: '' })}
                    className="text-slate-400 hover:text-red-600"
                    title="Hapus logo kanan"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-11 h-11 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] flex items-center justify-center overflow-hidden shrink-0">
                  {editing.right_logo_url ? (
                    <img src={editing.right_logo_url} alt="Logo Kanan" className="w-9 h-9 object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-400">Kosong</span>
                  )}
                </div>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] hover:bg-slate-100 text-[11px] font-medium cursor-pointer">
                  <Upload className="w-3 h-3 text-blue-600" />
                  <span>{uploadingSlot === 'right' ? 'Mengunggah...' : 'Unggah'}</span>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg"
                    onChange={(e) => handleUploadLogo(e, 'right')}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Posisi Logo</label>
              <select
                value={editing.logo_position || 'dual'}
                onChange={(e) => setEditing({ ...editing, logo_position: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]"
              >
                <option value="dual">Dua Logo (Kiri &amp; Kanan)</option>
                <option value="left">Satu Logo Kiri</option>
                <option value="center">Tengah Atas</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Tinggi Logo (px)</label>
              <input
                type="number"
                min={56}
                max={145}
                value={editing.logo_size || 96}
                onChange={(e) => setEditing({ ...editing, logo_size: Number(e.target.value) })}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Garis Kop</label>
              <select
                value={editing.border_style || 'thick'}
                onChange={(e) => setEditing({ ...editing, border_style: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]"
              >
                <option value="thick">Garis Tebal Resmi</option>
                <option value="double">Garis Ganda</option>
                <option value="single">Garis Tunggal</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Baris 0 (Pemerintah Kabupaten / Kota)</label>
            <input
              value={editing.pemkab_line ?? ''}
              onChange={(e) => setEditing({ ...editing, pemkab_line: e.target.value })}
              placeholder="PEMERINTAH KABUPATEN SITUBONDO"
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Baris 1 (Dinas Pendidikan)</label>
            <input
              value={editing.line_1 || ''}
              onChange={(e) => setEditing({ ...editing, line_1: e.target.value })}
              placeholder="DINAS PENDIDIKAN DAN KEBUDAYAAN"
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Baris 2 (Jenis Asesmen)</label>
            <input
              value={editing.line_2 || ''}
              onChange={(e) => setEditing({ ...editing, line_2: e.target.value })}
              placeholder="[JENIS ASESMEN]"
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Baris 3 (Nama Sekolah / Gugus)</label>
            <input
              value={editing.line_3 || ''}
              onChange={(e) => setEditing({ ...editing, line_3: e.target.value })}
              placeholder="SEKOLAH DASAR NEGERI ..."
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Baris 4 (Tahun Pelajaran)</label>
            <input
              value={editing.line_4 || ''}
              onChange={(e) => setEditing({ ...editing, line_4: e.target.value })}
              placeholder="TAHUN PELAJARAN [TAHUN PELAJARAN]"
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Token otomatis: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">[JENIS ASESMEN]</code> &amp;{' '}
              <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">[TAHUN PELAJARAN]</code> terisi otomatis sesuai proyek soal.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Alamat &amp; Email / Telepon Sekolah</label>
            <input
              value={editing.address_line || ''}
              onChange={(e) => setEditing({ ...editing, address_line: e.target.value })}
              placeholder="Alamat lengkap sekolah / lembaga"
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs mb-2"
            />
            <input
              value={editing.contact_line || ''}
              onChange={(e) => setEditing({ ...editing, contact_line: e.target.value })}
              placeholder="Email: sekolah@sch.id · Telp: (0338) ..."
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(editing.is_default)}
              onChange={(e) => setEditing({ ...editing, is_default: e.target.checked ? 1 : 0 })}
            />
            <span>Gunakan sebagai template default lembaga</span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-sm font-semibold"
          >
            {saving ? 'Menyimpan...' : 'Simpan Template Kop Surat'}
          </button>
        </form>

        {/* Live WYSIWYG Preview */}
        <div className="lg:col-span-7 bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Preview Langsung Lembar Naskah Soal (F4 · Calibri)</div>
          <div
            className="border border-slate-300 rounded-lg p-7 bg-white shadow-inner text-slate-900"
            style={{ fontFamily: editing.font_family || 'Calibri, sans-serif' }}
          >
            <div className={`pb-2.5 ${borderClass}`}>
              <div
                className={`flex items-center justify-between gap-3 ${
                  editing.logo_position === 'center' && !isDual ? 'flex-col text-center' : ''
                }`}
              >
                {editing.logo_url ? (
                  <img
                    src={editing.logo_url}
                    alt="Preview Logo Pemkab"
                    referrerPolicy="no-referrer"
                    style={{ height: logoSizePx, width: 'auto', maxWidth: 132 }}
                    className="object-contain shrink-0"
                  />
                ) : (
                  isDual && <div style={{ width: logoSizePx, height: logoSizePx }} className="shrink-0" />
                )}

                <div className="flex-1 text-center leading-tight text-slate-900 space-y-0.5">
                  {(editing.pemkab_line || bundle.schoolProfile?.pemkab_name) && (
                    <div className="text-[12.5px] font-bold">{formatPreviewLine(editing.pemkab_line || bundle.schoolProfile?.pemkab_name)}</div>
                  )}
                  {editing.line_1 && <div className="text-[13px] font-bold">{formatPreviewLine(editing.line_1)}</div>}
                  {editing.line_2 && <div className="text-[14px] font-bold">{formatPreviewLine(editing.line_2)}</div>}
                  {editing.line_3 && <div className="text-[13px] font-bold">{formatPreviewLine(editing.line_3)}</div>}
                  {editing.line_4 && <div className="text-[12.5px] font-bold">{formatPreviewLine(editing.line_4)}</div>}
                  {editing.address_line && <div className="text-[10.5px] text-slate-600 pt-0.5">{editing.address_line}</div>}
                  {editing.contact_line && <div className="text-[10.5px] text-slate-600">{editing.contact_line}</div>}
                </div>

                {isDual &&
                  (editing.right_logo_url ? (
                    <img
                      src={editing.right_logo_url}
                      alt="Preview Logo Sekolah"
                      referrerPolicy="no-referrer"
                      style={{ height: logoSizePx, width: 'auto', maxWidth: 132 }}
                      className="object-contain shrink-0"
                    />
                  ) : (
                    <div style={{ width: logoSizePx, height: logoSizePx }} className="shrink-0" />
                  ))}
              </div>
            </div>

            {/* Identity Table Preview matching attached PDF */}
            <div className="grid grid-cols-2 gap-x-6 pt-3 pb-2.5 border-b-[2.5px] border-slate-900 text-[11px] leading-relaxed">
              <div className="space-y-0.5">
                <div className="grid grid-cols-[95px_1fr]"><span>Mata Pelajaran</span><span>: PENDIDIKAN PANCASILA</span></div>
                <div className="grid grid-cols-[95px_1fr]"><span>Kelas /Semester</span><span>: VI / {bundle.settings?.semester === '2' ? 'Genap' : 'Ganjil'}</span></div>
                <div className="grid grid-cols-[95px_1fr]"><span>Hari / Tanggal</span><span>:</span></div>
                <div className="grid grid-cols-[95px_1fr]"><span>Waktu</span><span>: 90 menit</span></div>
              </div>
              <div className="space-y-0.5">
                <div className="grid grid-cols-[68px_1fr]"><span>Nama</span><span>: .....................................</span></div>
                <div className="grid grid-cols-[68px_1fr]"><span>Nomor</span><span>: .....................................</span></div>
                <div className="grid grid-cols-[68px_1fr]"><span>Nilai</span><span>: .....................................</span></div>
                <div className="grid grid-cols-[68px_1fr]"><span>Paraf Guru</span><span>: .....................................</span></div>
              </div>
            </div>

            <div className="pt-3 space-y-2 text-[11.5px] text-slate-800">
              <div className="font-bold">I. Berilah tanda silang (x) pada huruf a, b, c atau d di depan jawaban yang paling benar!</div>
              <div className="flex gap-2">
                <span>1.</span>
                <div className="space-y-1 flex-1">
                  <div className="h-2.5 bg-slate-100 rounded w-11/12" />
                  <div className="h-2.5 bg-slate-100 rounded w-3/4" />
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="h-2 bg-slate-100 rounded w-4/5" />
                    <div className="h-2 bg-slate-100 rounded w-4/5" />
                    <div className="h-2 bg-slate-100 rounded w-4/5" />
                    <div className="h-2 bg-slate-100 rounded w-4/5" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
