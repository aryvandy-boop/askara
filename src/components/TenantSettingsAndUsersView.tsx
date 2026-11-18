import React, { useEffect, useState } from 'react';
import { CheckCircle2, UserPlus, Upload, BookOpen, Building2, Mail, MapPin, RotateCcw, X } from 'lucide-react';
import { apiFetch, compressLogoIfNeeded } from '../lib/api';
import { AuthBundle } from '../types';

const DEFAULT_ASKARA_LOGO = '/assets/aistudio/Logo_ASKARA_04_Biru_Emas_8b6c2828.png';

interface TenantSettingsAndUsersViewProps {
  mode: 'manajemen-guru' | 'pengaturan-tenant' | 'profil-saya' | 'bantuan';
  bundle: AuthBundle;
  onRefreshBundle: () => Promise<void>;
}

const EXPANSION_MODULES = [
  'Generator Modul Ajar',
  'Generator RPP',
  'Generator ATP',
  'Generator Program Tahunan (Prota)',
  'Generator Program Semester (Promes)',
  'Generator Jurnal Pembelajaran',
  'Generator LKPD',
  'Generator Bahan Ajar',
  'Generator Media Pembelajaran',
  'Generator Analisis Hasil Asesmen',
  'Generator Remedial dan Pengayaan',
  'Generator Rapor & Deskripsi Capaian',
  'Generator Administrasi Guru',
  'Generator Laporan Pendidikan',
];

export const TenantSettingsAndUsersView: React.FC<TenantSettingsAndUsersViewProps> = ({
  mode,
  bundle,
  onRefreshBundle,
}) => {
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '', roleId: 'teacher' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  // Tenant Profile & Branding
  const [profile, setProfile] = useState({
    npsn: bundle.schoolProfile?.npsn || '',
    pemkabName: bundle.schoolProfile?.pemkab_name || 'PEMERINTAH KABUPATEN SITUBONDO',
    dinasName: bundle.schoolProfile?.dinas_name || '',
    schoolName: bundle.schoolProfile?.school_name || bundle.user.tenantName,
    gugusName: bundle.schoolProfile?.gugus_name || '',
    address: bundle.schoolProfile?.address || '',
    phone: bundle.schoolProfile?.phone || '',
    email: bundle.schoolProfile?.email || '',
    headmasterName: bundle.schoolProfile?.headmaster_name || '',
    pemkabLogoUrl: bundle.schoolProfile?.pemkab_logo_url || '',
    schoolLogoUrl: bundle.schoolProfile?.school_logo_url || '',
    appName: bundle.branding?.app_name || '',
    slogan: bundle.branding?.slogan || '',
    logoUrl: bundle.branding?.logo_url || DEFAULT_ASKARA_LOGO,
  });
  const [uploadingSlot, setUploadingSlot] = useState<'app' | 'pemkab' | 'school' | null>(null);

  // Tenant Settings & Presets
  const [academicYear, setAcademicYear] = useState(bundle.settings?.academic_year || '2026/2027');
  const [semester, setSemester] = useState(bundle.settings?.semester || '1');
  const [curriculum, setCurriculum] = useState(bundle.settings?.curriculum || 'Kurikulum Merdeka');
  const [presets, setPresets] = useState(bundle.settings?.questionPresets || {});
  const [formatting, setFormatting] = useState(bundle.settings?.formatting);

  // My Profile
  const [myFullName, setMyFullName] = useState(bundle.user.fullName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    setProfile({
      npsn: bundle.schoolProfile?.npsn || '',
      pemkabName: bundle.schoolProfile?.pemkab_name || 'PEMERINTAH KABUPATEN SITUBONDO',
      dinasName: bundle.schoolProfile?.dinas_name || '',
      schoolName: bundle.schoolProfile?.school_name || bundle.user.tenantName,
      gugusName: bundle.schoolProfile?.gugus_name || '',
      address: bundle.schoolProfile?.address || '',
      phone: bundle.schoolProfile?.phone || '',
      email: bundle.schoolProfile?.email || '',
      headmasterName: bundle.schoolProfile?.headmaster_name || '',
      pemkabLogoUrl: bundle.schoolProfile?.pemkab_logo_url || '',
      schoolLogoUrl: bundle.schoolProfile?.school_logo_url || '',
      appName: bundle.branding?.app_name || '',
      slogan: bundle.branding?.slogan || '',
      logoUrl: bundle.branding?.logo_url || DEFAULT_ASKARA_LOGO,
    });
  }, [bundle]);

  useEffect(() => {
    if (mode === 'manajemen-guru') {
      apiFetch<any[]>('/api/tenant/users').then(setUsers).catch((e) => setError(e.message));
    }
  }, [mode]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/tenant/users', { method: 'POST', body: JSON.stringify(newUser) });
      setNewUser({ fullName: '', email: '', password: '', roleId: 'teacher' });
      setNotice('Anggota guru berhasil ditambahkan ke ruang kerja lembaga.');
      const list = await apiFetch<any[]>('/api/tenant/users');
      setUsers(list);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleUser = async (uid: string, currentActive: number, roleId: string) => {
    await apiFetch(`/api/tenant/users/${uid}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !currentActive, roleId }),
    });
    const list = await apiFetch<any[]>('/api/tenant/users');
    setUsers(list);
  };

  const handleUploadLogoSlot = async (e: React.ChangeEvent<HTMLInputElement>, slot: 'app' | 'pemkab' | 'school') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setNotice('');
    setUploadingSlot(slot);
    try {
      const readyFile = await compressLogoIfNeeded(file);
      const fd = new FormData();
      fd.append('logo', readyFile);
      const res = await apiFetch<{ logoUrl: string }>('/api/templates/upload-logo', { method: 'POST', body: fd });
      if (slot === 'app') {
        setProfile((p) => ({ ...p, logoUrl: res.logoUrl }));
        setNotice('Logo Profil Aplikasi diunggah. Klik "Simpan Semua Pengaturan" untuk menerapkan.');
      } else if (slot === 'pemkab') {
        setProfile((p) => ({ ...p, pemkabLogoUrl: res.logoUrl }));
        setNotice('Logo Pemkab / Dinas berhasil diunggah. Klik "Simpan Semua Pengaturan" agar tampil di Kop Surat.');
      } else {
        setProfile((p) => ({ ...p, schoolLogoUrl: res.logoUrl }));
        setNotice('Logo Sekolah / Lembaga berhasil diunggah. Klik "Simpan Semua Pengaturan" agar tampil di Kop Surat.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingSlot(null);
      e.target.value = '';
    }
  };

  const handleSaveProfileAndSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/tenant/profile', { method: 'PUT', body: JSON.stringify(profile) });
      await apiFetch('/api/tenant/settings', {
        method: 'PUT',
        body: JSON.stringify({ academicYear, semester, curriculum, questionPresets: presets, formatting }),
      });
      await onRefreshBundle();
      setNotice('Pengaturan lembaga, format pengetikan, dan preset jumlah soal berhasil disimpan.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: myFullName, currentPassword: currentPassword || undefined, newPassword: newPassword || undefined }),
      });
      setCurrentPassword('');
      setNewPassword('');
      await onRefreshBundle();
      setNotice('Profil akun Anda berhasil diperbarui.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {mode === 'manajemen-guru' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Manajemen Guru & Anggota Lembaga</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Kelola akun guru dan hak akses di {bundle.user.tenantName}.</p>
          </div>

          <form onSubmit={handleAddUser} className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Lengkap</label>
              <input required value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} placeholder="Nama Guru" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
              <input type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="guru@sekolah.sch.id" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kata Sandi Awal</label>
              <input type="password" required minLength={6} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Min. 6 karakter" className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Peran</label>
              <select value={newUser.roleId} onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-[#111a2e]">
                <option value="teacher">Guru / Member</option>
                <option value="tenant_admin">Admin Tenant</option>
              </select>
            </div>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5" />
              <span>Tambah Guru</span>
            </button>
          </form>

          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                <tr>
                  <th className="py-3 px-4">Nama Lengkap</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Peran</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">{u.full_name}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{u.email}</td>
                    <td className="py-3 px-4">{u.role_id === 'tenant_admin' ? 'Admin Tenant' : 'Guru'}</td>
                    <td className="py-3 px-4">{u.is_active ? 'Aktif' : 'Nonaktif'}</td>
                    <td className="py-3 px-4 text-right">
                      {u.id !== bundle.user.id && (
                        <button
                          type="button"
                          onClick={() => handleToggleUser(u.id, u.is_active, u.role_id)}
                          className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 text-xs font-medium"
                        >
                          {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'pengaturan-tenant' && (
        <form onSubmit={handleSaveProfileAndSettings} className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Pengaturan Lembaga, Rambu Soal & Format Dokumen</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">Identitas lembaga, template jumlah soal per kelas/mapel, dan format pengetikan Word/PDF.</p>
            </div>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-sm font-semibold">
              {saving ? 'Menyimpan...' : 'Simpan Semua Pengaturan'}
            </button>
          </div>

          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Identitas Lembaga, Logo Aplikasi &amp; Kop Surat Resmi</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Data Pemerintah Kabupaten, Dinas, Sekolah, Alamat, Email, serta Logo Pemkab &amp; Sekolah otomatis tampil di Kop Surat Word/PDF.</p>
              </div>
            </div>

            {/* 3 Logo Upload Slots */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Slot 1: Logo Profil Aplikasi */}
              <div className="p-4 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-indigo-950">Logo Profil Aplikasi</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Tampil di Sidebar &amp; Portal</div>
                  </div>
                  {profile.logoUrl !== DEFAULT_ASKARA_LOGO && (
                    <button
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, logoUrl: DEFAULT_ASKARA_LOGO }))}
                      className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1"
                      title="Gunakan Logo Resmi ASKARA 04 Biru Emas"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>ASKARA 04</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-xl border border-indigo-200 bg-white dark:bg-[#111a2e] p-1.5 flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                    <img
                      src={profile.logoUrl || DEFAULT_ASKARA_LOGO}
                      alt="Logo Profil Aplikasi"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <label className="px-3 py-2 rounded-lg border border-indigo-300 bg-white dark:bg-[#111a2e] hover:bg-indigo-50 text-indigo-800 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingSlot === 'app' ? 'Mengunggah...' : 'Ganti Logo App'}</span>
                    <input type="file" accept=".png,.jpg,.jpeg,.svg" onChange={(e) => handleUploadLogoSlot(e, 'app')} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Slot 2: Logo Pemkab (Kiri Kop Surat) */}
              <div className="p-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/60 to-white space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-amber-950">Logo Pemkab / Dinas</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Posisi Kiri Kop Surat</div>
                  </div>
                  {profile.pemkabLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, pemkabLogoUrl: '' }))}
                      className="text-slate-400 hover:text-red-600"
                      title="Kosongkan logo Pemkab"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-xl border border-amber-200 bg-white dark:bg-[#111a2e] p-1.5 flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                    {profile.pemkabLogoUrl ? (
                      <img src={profile.pemkabLogoUrl} alt="Logo Pemkab" referrerPolicy="no-referrer" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-400 text-center">Belum diisi</span>
                    )}
                  </div>
                  <label className="px-3 py-2 rounded-lg border border-amber-300 bg-white dark:bg-[#111a2e] hover:bg-amber-50 text-amber-900 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingSlot === 'pemkab' ? 'Mengunggah...' : 'Upload Logo Pemkab'}</span>
                    <input type="file" accept=".png,.jpg,.jpeg,.svg" onChange={(e) => handleUploadLogoSlot(e, 'pemkab')} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Slot 3: Logo Sekolah (Kanan Kop Surat) */}
              <div className="p-4 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/60 to-white space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-teal-950">Logo Sekolah / Lembaga</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Posisi Kanan Kop Surat</div>
                  </div>
                  {profile.schoolLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, schoolLogoUrl: '' }))}
                      className="text-slate-400 hover:text-red-600"
                      title="Kosongkan logo sekolah"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-xl border border-teal-200 bg-white dark:bg-[#111a2e] p-1.5 flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                    {profile.schoolLogoUrl ? (
                      <img src={profile.schoolLogoUrl} alt="Logo Sekolah" referrerPolicy="no-referrer" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-400 text-center">Belum diisi</span>
                    )}
                  </div>
                  <label className="px-3 py-2 rounded-lg border border-teal-300 bg-white dark:bg-[#111a2e] hover:bg-teal-50 text-teal-900 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingSlot === 'school' ? 'Mengunggah...' : 'Upload Logo Sekolah'}</span>
                    <input type="file" accept=".png,.jpg,.jpeg,.svg" onChange={(e) => handleUploadLogoSlot(e, 'school')} className="hidden" />
                  </label>
                </div>
              </div>
            </div>

            {/* Institution & Kop Surat Identity Fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pemerintah Kabupaten / Kota <span className="text-indigo-600">(Tampil di Kop Surat)</span>
                </label>
                <input
                  value={profile.pemkabName}
                  onChange={(e) => setProfile({ ...profile, pemkabName: e.target.value })}
                  placeholder="PEMERINTAH KABUPATEN SITUBONDO"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-semibold uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Nama Dinas Pendidikan</label>
                <input
                  value={profile.dinasName}
                  onChange={(e) => setProfile({ ...profile, dinasName: e.target.value })}
                  placeholder="DINAS PENDIDIKAN DAN KEBUDAYAAN"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Nama Sekolah / Gugus</label>
                <input
                  value={profile.schoolName}
                  onChange={(e) => setProfile({ ...profile, schoolName: e.target.value })}
                  placeholder="SD NEGERI 7 JATISARI"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-rose-500" />
                  <span>Alamat Sekolah / Lembaga (Tampil di Kop Surat)</span>
                </label>
                <input
                  value={profile.address}
                  onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                  placeholder="Jl. Raya Desa Jatisari No. 15, Kec. Arjasa, Kab. Situbondo 68371"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  <span>Email Sekolah / Lembaga</span>
                </label>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  placeholder="sdn7jatisari@situbondo.sch.id"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Telepon / WhatsApp Lembaga</label>
                <input
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  placeholder="(0338) 675112"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Nama Aplikasi Tenant</label>
                <input
                  value={profile.appName}
                  onChange={(e) => setProfile({ ...profile, appName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">NPSN</label>
                <input
                  value={profile.npsn}
                  onChange={(e) => setProfile({ ...profile, npsn: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Tahun Pelajaran</label>
                <input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Semester Aktif</label>
                <select value={semester} onChange={(e) => setSemester(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
                  <option value="1">Semester 1 (Ganjil)</option>
                  <option value="2">Semester 2 (Genap)</option>
                </select>
              </div>
            </div>

            {/* Live Kop Surat Preview */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Preview Otomatis Kop Surat Naskah Soal</div>
              <div className="bg-white border border-slate-300 rounded-lg p-5 font-sans">
                <div className="flex items-center justify-between gap-4 pb-2.5 border-b-[2.5px] border-slate-900">
                  {profile.pemkabLogoUrl ? (
                    <img src={profile.pemkabLogoUrl} alt="Logo Pemkab" className="w-14 h-14 object-contain shrink-0" />
                  ) : (
                    <div className="w-14 h-14 shrink-0" />
                  )}
                  <div className="flex-1 text-center leading-tight space-y-0.5 text-slate-900">
                    {profile.pemkabName && <div className="text-xs font-bold uppercase">{profile.pemkabName}</div>}
                    {profile.dinasName && <div className="text-[13px] font-bold uppercase">{profile.dinasName}</div>}
                    <div className="text-[13.5px] font-bold uppercase">SUMATIF AKHIR SEMESTER {semester === '2' ? '2' : '1'}</div>
                    {profile.schoolName && <div className="text-[13px] font-bold uppercase">{profile.schoolName}</div>}
                    <div className="text-xs font-bold uppercase">TAHUN PELAJARAN {academicYear || '2026/2027'}</div>
                    {profile.address && <div className="text-[10.5px] text-slate-600 pt-0.5">{profile.address}</div>}
                    {(profile.email || profile.phone) && (
                      <div className="text-[10.5px] text-slate-600">
                        {[profile.email ? `Email: ${profile.email}` : '', profile.phone ? `Telp: ${profile.phone}` : ''].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  {profile.schoolLogoUrl ? (
                    <img src={profile.schoolLogoUrl} alt="Logo Sekolah" className="w-14 h-14 object-contain shrink-0" />
                  ) : (
                    <div className="w-14 h-14 shrink-0" />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Formatting Configuration (Bagian 8) */}
          {formatting && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Format Pengetikan Dokumen (Standar ASKARA 04)</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Huruf</label>
                  <input value={formatting.fontFamily} onChange={(e) => setFormatting({ ...formatting, fontFamily: e.target.value })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Ukuran Kelas 1–2 (pt)</label>
                  <input type="number" value={formatting.fontSizeClass12} onChange={(e) => setFormatting({ ...formatting, fontSizeClass12: Number(e.target.value) })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Ukuran Kelas 3–5 (pt)</label>
                  <input type="number" value={formatting.fontSizeClass345} onChange={(e) => setFormatting({ ...formatting, fontSizeClass345: Number(e.target.value) })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Ukuran Kelas 6 (pt)</label>
                  <input type="number" value={formatting.fontSizeClass6} onChange={(e) => setFormatting({ ...formatting, fontSizeClass6: Number(e.target.value) })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Lebar Kertas (cm)</label>
                  <input type="number" step="0.1" value={formatting.paperWidthCm} onChange={(e) => setFormatting({ ...formatting, paperWidthCm: Number(e.target.value) })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tinggi Kertas (cm)</label>
                  <input type="number" step="0.1" value={formatting.paperHeightCm} onChange={(e) => setFormatting({ ...formatting, paperHeightCm: Number(e.target.value) })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Margin Kiri (cm)</label>
                  <input type="number" step="0.5" value={formatting.marginLeftCm} onChange={(e) => setFormatting({ ...formatting, marginLeftCm: Number(e.target.value) })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Spasi Baris</label>
                  <input type="number" step="0.05" value={formatting.lineSpacing} onChange={(e) => setFormatting({ ...formatting, lineSpacing: Number(e.target.value) })} className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono" />
                </div>
              </div>
              <div className="flex flex-wrap gap-5 pt-2 text-xs text-slate-700">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={formatting.lowercaseOptions} onChange={(e) => setFormatting({ ...formatting, lowercaseOptions: e.target.checked })} />
                  <span>Pilihan jawaban huruf kecil (kapital nama diri/kota/awal kalimat)</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={formatting.shortAnswerInline} onChange={(e) => setFormatting({ ...formatting, shortAnswerInline: e.target.checked })} />
                  <span>Jawaban pendek ditulis menyamping</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={formatting.grayscaleImages} onChange={(e) => setFormatting({ ...formatting, grayscaleImages: e.target.checked })} />
                  <span>Gambar pada naskah soal grayscale</span>
                </label>
              </div>
            </div>
          )}

          {/* Question Count Presets Table (Bagian 6) */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 overflow-x-auto">
            <h2 className="text-base font-bold text-slate-900">Template Jumlah Soal per Kelas & Mata Pelajaran</h2>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">Kategori Kelas / Mapel</th>
                  <th className="py-2 px-3">Pilihan Ganda</th>
                  <th className="py-2 px-3">Isian</th>
                  <th className="py-2 px-3">Uraian</th>
                  <th className="py-2 px-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(presets).map(([key, val]: [string, any]) => (
                  <tr key={key}>
                    <td className="py-2 px-3 font-semibold">{key}</td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={val.pilihan_ganda}
                        onChange={(e) => {
                          const pg = Number(e.target.value);
                          setPresets({ ...presets, [key]: { ...val, pilihan_ganda: pg, total: pg + val.isian + val.uraian } });
                        }}
                        className="w-20 px-2 py-1 border border-slate-300 rounded font-mono"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={val.isian}
                        onChange={(e) => {
                          const isian = Number(e.target.value);
                          setPresets({ ...presets, [key]: { ...val, isian, total: val.pilihan_ganda + isian + val.uraian } });
                        }}
                        className="w-20 px-2 py-1 border border-slate-300 rounded font-mono"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={val.uraian}
                        onChange={(e) => {
                          const uraian = Number(e.target.value);
                          setPresets({ ...presets, [key]: { ...val, uraian, total: val.pilihan_ganda + val.isian + uraian } });
                        }}
                        className="w-20 px-2 py-1 border border-slate-300 rounded font-mono"
                      />
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-blue-700">{val.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {mode === 'profil-saya' && (
        <form onSubmit={handleSaveMyProfile} className="bg-white border border-slate-200 rounded-xl p-6 max-w-xl space-y-4">
          <h1 className="text-xl font-bold text-slate-900">Profil Akun Saya</h1>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
            <input value={myFullName} onChange={(e) => setMyFullName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
            <input disabled value={bundle.user.email} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500" />
          </div>
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="text-xs font-semibold text-slate-700">Ubah Kata Sandi (Opsional)</div>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Kata sandi saat ini" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Kata sandi baru (minimal 6 karakter)" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <button type="submit" className="px-5 py-2 rounded-lg bg-[#1d4ed8] text-white text-sm font-semibold">Simpan Profil</button>
        </form>
      )}

      {mode === 'bantuan' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-5">
            <img
              src="/assets/aistudio/Potret_Resmi_PNS_Berseragam_Khaki_e09c0ee9.png"
              alt="Taufik Hidayah — Penggagas & Pencipta ASKARA 04"
              referrerPolicy="no-referrer"
              className="w-24 h-30 rounded-xl object-cover object-top ring-2 ring-amber-400/70 shadow-sm shrink-0 bg-slate-100"
            />
            <div className="space-y-1.5 text-center sm:text-left">
              <div className="text-xs font-semibold text-indigo-700 dark:text-sky-400">
                Penggagas &amp; Pencipta Aplikasi ASKARA 04
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Taufik Hidayah</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Aplikasi ASKARA 04 dirancang khusus untuk memudahkan guru dalam membuat soal asesmen, kisi-kisi, analisis kognitif (C1–C6), kunci jawaban, rubrik penilaian, hingga dokumen Word dan PDF siap cetak secara cepat, rapi, dan terstandar.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Panduan &amp; Rambu-Rambu ASKARA 04</h1>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <li>Unggah dokumen referensi buku pelajaran atau modul ajar (PDF, DOCX, DOC, TXT, PPTX) melalui menu <strong>1. Referensi Buku</strong>.</li>
              <li>Atur kop surat serta logo Pemkab dan logo sekolah Anda di menu <strong>Kop Surat &amp; Logo</strong>.</li>
              <li>Buka <strong>2. Buat Soal AI</strong>, pilih referensi bab per semester, pilih level kognitif C1–C6, dan hasilkan soal bergambar otomatis.</li>
              <li>Tinjau kisi-kisi, analisis kognitif, kunci jawaban &amp; rubrik, serta jalankan <strong>Quality Control</strong>.</li>
              <li>Unduh naskah soal, kisi-kisi, analisis kognitif, dan kunci &amp; rubrik dalam format Microsoft Word (<code>.docx</code> F4), PDF, atau Excel melalui menu <strong>3. Unduh Word &amp; PDF</strong>.</li>
            </ol>
          </div>

          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-700 dark:text-sky-400" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Arsitektur Modul Pengembangan Lanjutan ASKARA</h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Infrastruktur multi-tenant dan RAG ASKARA telah disiapkan untuk perluasan modul perangkat ajar berikut:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {EXPANSION_MODULES.map((mod, idx) => (
                <div key={mod} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span>{String(idx + 1).padStart(2, '0')}. {mod}</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Siap Ekspansi</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
