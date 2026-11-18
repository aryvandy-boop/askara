import React, { useState } from 'react';
import { Eye, EyeOff, ArrowRight, CheckCircle2, KeyRound, Sun, Moon, Palette, Award } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api';
import { signInWithGooglePopup } from '../lib/firebase';
import { AppTheme, useTheme } from '../lib/theme';
import { AuthBundle } from '../types';
import askaraHero from '../assets/images/askara_login_visual_1794730209322.jpg';

const ASKARA_PROFILE_LOGO = '/assets/aistudio/Logo_ASKARA_04_Biru_Emas_8b6c2828.png';
const CREATOR_PHOTO_URL = '/assets/aistudio/Potret_Resmi_PNS_Berseragam_Khaki_e09c0ee9.png';

interface AuthPortalProps {
  onSuccess: (bundle: AuthBundle) => void;
}

type AuthMode = 'login' | 'register' | 'forgot';

const THEME_BUTTONS: Array<{ id: AppTheme; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'light', label: 'Terang', icon: Sun },
  { id: 'dark', label: 'Gelap', icon: Moon },
  { id: 'colorful', label: 'Warna-warni', icon: Palette },
];

export const AuthPortal: React.FC<AuthPortalProps> = ({ onSuccess }) => {
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [creatorImgBroken, setCreatorImgBroken] = useState(false);

  // Login fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register fields
  const [fullName, setFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [institutionType, setInstitutionType] = useState('Sekolah Mandiri');
  const [regency, setRegency] = useState('Kabupaten Situbondo');
  const [province, setProvince] = useState('Jawa Timur');
  const [adminName, setAdminName] = useState('');

  // Forgot password fields
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [issuedCodeHint, setIssuedCodeHint] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await apiFetch<AuthBundle & { token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAuthToken(data.token);
      onSuccess(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const { idToken } = await signInWithGooglePopup();
      const data = await apiFetch<AuthBundle & { token: string }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });
      setAuthToken(data.token);
      onSuccess(data);
    } catch (err: any) {
      if (err?.needsRegistration) {
        if (err.email) setRegEmail(err.email);
        if (err.fullName) setFullName(err.fullName);
        setMode('register');
        setNotice(`Akun Google (${err.email}) belum terdaftar. Lengkapi formulir berikut lalu tunggu persetujuan Master Admin (ary.vandy@gmail.com).`);
      } else {
        setError(err.message || 'Gagal masuk menggunakan Google.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await apiFetch<{ message: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email: regEmail,
          password: regPassword,
          schoolName,
          institutionType,
          regency,
          province,
          adminName: adminName || fullName,
        }),
      });
      setNotice(data.message);
      setMode('login');
      setEmail(regEmail);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ message: string; verificationCode: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      setIssuedCodeHint(res.verificationCode);
      setNotice(res.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail, code: resetCode, newPassword }),
      });
      setNotice(res.message);
      setIssuedCodeHint('');
      setMode('login');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const showcaseBg =
    theme === 'dark'
      ? 'bg-gradient-to-br from-[#070d1c] via-[#0f1f3d] to-[#0d4a44]'
      : theme === 'colorful'
        ? 'bg-gradient-to-br from-[#312e81] via-[#1d4ed8] to-[#0d9488]'
        : 'bg-gradient-to-br from-[#0f172a] via-[#1e3a8a] to-[#0f766e]';

  const outerBg =
    theme === 'dark'
      ? 'bg-[#0b1120] text-slate-100'
      : theme === 'colorful'
        ? 'bg-transparent text-slate-900'
        : 'bg-[#f4f7fb] text-slate-900';

  const inputClass =
    'w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600';

  return (
    <div className={`min-h-screen flex flex-col lg:flex-row ${outerBg}`}>
      {/* Left Brand & Creator Showcase Panel */}
      <div className={`lg:w-[48%] ${showcaseBg} text-white p-7 lg:p-11 flex flex-col justify-between relative overflow-hidden`}>
        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-20 h-14 rounded-2xl bg-white p-1.5 shrink-0 ring-2 ring-amber-300/70 shadow-md flex items-center justify-center">
              <img
                src={ASKARA_PROFILE_LOGO}
                alt="Logo Resmi ASKARA 04 Gugus 04 Arjasa"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">ASKARA 04</h1>
              <p className="text-xs text-amber-300 font-semibold tracking-wide">GUGUS 04 ARJASA · KABUPATEN SITUBONDO</p>
            </div>
          </div>

          <div className="max-w-lg">
            <h2 className="text-2xl lg:text-3xl font-bold leading-tight text-balance">
              Akselerasi Sistem Kreatif Asesmen dan Rekayasa Akademik
            </h2>
            <p className="mt-2.5 text-teal-100 text-sm lg:text-base leading-relaxed font-medium">
              &ldquo;Berkarya dengan Inovasi, Berkualitas dalam Asesmen.&rdquo;
            </p>
            <p className="mt-3 text-sm text-blue-100/90 leading-relaxed">
              Aplikasi ini dirancang untuk memudahkan guru menyusun kisi-kisi, soal bergambar otomatis berbasis buku referensi, analisis Taksonomi Bloom (C1–C6), kunci jawaban &amp; rubrik penskoran, hingga ekspor dokumen Word dan PDF F4 siap cetak.
            </p>
          </div>

          {/* Creator Portrait Spotlight ("Terpangpang") */}
          <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 p-4 flex items-center gap-4">
            {!creatorImgBroken ? (
              <img
                src={CREATOR_PHOTO_URL}
                alt="Taufik Hidayah — Pencipta Aplikasi ASKARA 04"
                referrerPolicy="no-referrer"
                onError={() => setCreatorImgBroken(true)}
                className="w-20 h-24 rounded-xl object-cover object-top ring-2 ring-amber-300/80 shadow-md shrink-0 bg-slate-800"
              />
            ) : (
              <div className="w-20 h-24 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                <Award className="w-7 h-7 text-amber-300" />
              </div>
            )}
            <div className="min-w-0 space-y-1">
              <div className="text-[11px] font-semibold tracking-wide text-amber-300">
                Penggagas &amp; Pencipta Aplikasi
              </div>
              <div className="text-base font-bold text-white">Taufik Hidayah</div>
              <p className="text-xs text-blue-50/90 leading-relaxed">
                Diciptakan untuk membantu guru bekerja lebih cepat, praktis, dan profesional dalam menyiapkan perangkat asesmen bermutu.
              </p>
            </div>
          </div>
        </div>

        <div className="my-6 relative z-10 rounded-2xl overflow-hidden border border-white/15 bg-slate-900/40 shadow-lg">
          <img
            src={askaraHero}
            alt="Ilustrasi Inovasi Kurikulum dan Asesmen ASKARA"
            referrerPolicy="no-referrer"
            className="w-full h-44 object-cover"
          />
          <div className="p-3.5 flex items-center justify-between text-xs text-blue-50 font-medium bg-slate-950/40">
            <span>Kisi-Kisi &amp; Soal Otomatis</span>
            <span className="text-amber-300">·</span>
            <span>Ekspor Word &amp; PDF F4</span>
            <span className="text-amber-300">·</span>
            <span>Bloom C1–C6</span>
          </div>
        </div>

        <div className="relative z-10 border-t border-white/15 pt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-blue-100/80">
          <span>Dinas Pendidikan Kabupaten Situbondo</span>
          <span>Standar Rambu-Rambu Asesmen ASKARA 04</span>
        </div>
      </div>

      {/* Right Interactive Auth Panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 lg:p-12">
        <div className="w-full max-w-md space-y-5">
          {/* Theme Switcher Row */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Pilih Tema Tampilan:</span>
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {THEME_BUTTONS.map((opt) => {
                const Icon = opt.icon;
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation Segmented Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Daftar Lembaga
            </button>
            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(''); }}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                mode === 'forgot' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Lupa Sandi
            </button>
          </div>

          {error && (
            <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {notice && (
            <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{notice}</span>
            </div>
          )}

          {mode === 'login' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Masuk ke Ruang Kerja</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Gunakan akun sekolah atau pengelola gugus Anda.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@sekolah.sch.id"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Kata Sandi</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Masukkan kata sandi"
                      className={`${inputClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      aria-label="Tampilkan sandi"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <span>{loading ? 'Memverifikasi...' : 'Masuk Sekarang'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-[#f4f7fb] dark:bg-[#0b1120] text-slate-500 dark:text-slate-400">atau masuk dengan</span>
                </div>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleSignIn}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <span>Masuk dengan Akun Google Terdaftar</span>
              </button>
            </div>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Daftarkan Lembaga Baru</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Setiap lembaga mendapat ruang kerja, database terisolasi, logo, dan kop surat sendiri.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Lengkap</label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Contoh: Rina Kartika, S.Pd."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Administrator</label>
                  <input
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="Kepala Sekolah / Ketua"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Email Lembaga / Akun</label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="admin@sekolah.sch.id"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kata Sandi</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Sekolah / Lembaga</label>
                <input
                  required
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  placeholder="Contoh: SDN 7 JATISARI"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Jenis Lembaga</label>
                <select
                  value={institutionType}
                  onChange={(e) => setInstitutionType(e.target.value)}
                  className={inputClass}
                >
                  <option value="Sekolah Mandiri">Sekolah Mandiri</option>
                  <option value="Gugus Sekolah">Gugus Sekolah</option>
                  <option value="KKG">KKG (Kelompok Kerja Guru)</option>
                  <option value="Lembaga Pendidikan">Lembaga Pendidikan Lainnya</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kabupaten / Kota</label>
                  <input
                    required
                    value={regency}
                    onChange={(e) => setRegency(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Provinsi</label>
                  <input
                    required
                    value={province}
                    onChange={(e) => setProvince(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {loading ? 'Mendaftarkan Ruang Kerja...' : 'Daftarkan Lembaga'}
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Setiap pendaftaran baru berstatus <strong>menunggu persetujuan</strong> Master Pengendali (<strong>ary.vandy@gmail.com</strong>). Setelah disetujui, Anda dapat langsung masuk dan mengatur logo/kop surat sekolah sendiri.
              </p>
            </form>
          )}

          {mode === 'forgot' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Atur Ulang Kata Sandi</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Masukkan email akun Anda untuk mendapatkan kode verifikasi pemulihan.</p>
              </div>

              <form onSubmit={handleRequestReset} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Email Terdaftar</label>
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="nama@sekolah.sch.id"
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100"
                >
                  Kirim Kode Verifikasi
                </button>
              </form>

              {issuedCodeHint && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>Kode verifikasi Anda: <strong className="font-mono">{issuedCodeHint}</strong></span>
                </div>
              )}

              <form onSubmit={handleConfirmReset} className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kode Verifikasi</label>
                  <input
                    required
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="Masukkan 8 karakter kode"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kata Sandi Baru</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-sm font-semibold"
                >
                  Simpan Kata Sandi Baru
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
