import React, { useEffect, useState } from 'react';
import { Menu, Sparkles, FolderOpen } from 'lucide-react';
import { apiFetch, getAuthToken, setAuthToken } from './lib/api';
import { testFirestoreConnection } from './lib/firebase';
import { ThemeProvider, useTheme } from './lib/theme';
import { AuthBundle, NavKey } from './types';
import { AuthPortal } from './components/AuthPortal';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { AiGeneratorWizard } from './components/AiGeneratorWizard';
import { ReferencesView } from './components/ReferencesView';
import { CurriculumView } from './components/CurriculumView';
import { ProjectWorkspaceViews } from './components/ProjectWorkspaceViews';
import { QuestionBankView } from './components/QuestionBankView';
import { DocumentsAndExportView } from './components/DocumentsAndExportView';
import { KopSuratStudio } from './components/KopSuratStudio';
import { TenantSettingsAndUsersView } from './components/TenantSettingsAndUsersView';
import { SuperAdminConsole } from './components/SuperAdminConsole';

const NAV_TITLES: Record<NavKey, string> = {
  dashboard: 'Beranda',
  generator: 'Buat Soal AI',
  'upload-ref': 'Referensi Buku',
  'kisi-kisi': 'Kisi-Kisi',
  'bank-soal': 'Bank Soal',
  'bank-materi': 'Bank Materi',
  'cp-tp': 'CP dan TP',
  'analisis-kognitif': 'Analisis Kognitif',
  'kunci-jawaban': 'Kunci & Rubrik',
  'rubrik-penilaian': 'Rubrik Penilaian',
  'quality-control': 'Quality Control',
  'dokumen-saya': 'Unduh Word & PDF',
  'kop-surat': 'Kop Surat & Logo',
  'manajemen-guru': 'Manajemen Guru',
  'pengaturan-tenant': 'Pengaturan Lembaga',
  'profil-saya': 'Profil Saya',
  bantuan: 'Panduan & Tentang',
  'super-admin': 'Master Pengendali',
};

function AppShell() {
  const { theme } = useTheme();
  const [bundle, setBundle] = useState<AuthBundle | null>(null);
  const [booting, setBooting] = useState(true);
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const loadSession = async () => {
    const token = getAuthToken();
    if (!token) {
      setBooting(false);
      return;
    }
    try {
      const me = await apiFetch<AuthBundle>('/api/auth/me');
      setBundle(me);
    } catch {
      setAuthToken(null);
      setBundle(null);
    } finally {
      setBooting(false);
    }
  };

  useEffect(() => {
    testFirestoreConnection();
    loadSession();
  }, []);

  const handleNavigate = (nav: NavKey, projectId?: string) => {
    if (projectId !== undefined) setActiveProjectId(projectId);
    setActiveNav(nav);
  };

  const handleLogout = () => {
    setAuthToken(null);
    setBundle(null);
    setActiveProjectId(null);
    setActiveNav('dashboard');
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0b1120] flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600 dark:text-slate-300">Memuat ruang kerja ASKARA...</div>
      </div>
    );
  }

  if (!bundle) {
    return (
      <AuthPortal
        onSuccess={(authBundle) => {
          setBundle(authBundle);
          setActiveNav('dashboard');
        }}
      />
    );
  }

  const shellCanvasClass =
    theme === 'dark'
      ? 'bg-[#0b1120] text-slate-100'
      : theme === 'colorful'
        ? 'bg-transparent text-slate-900'
        : 'bg-[#f4f7fb] text-slate-900';

  const headerClass =
    theme === 'dark'
      ? 'bg-[#0f172a]/95 border-slate-800'
      : theme === 'colorful'
        ? 'bg-white/85 border-indigo-200/70'
        : 'bg-white/95 border-slate-200/80';

  return (
    <div className={`min-h-screen flex ${shellCanvasClass}`}>
      <Sidebar
        bundle={bundle}
        activeNav={activeNav}
        onSelectNav={(nav) => handleNavigate(nav)}
        onLogout={handleLogout}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Single-Row Top Bar Contract */}
        <header className={`no-print sticky top-0 z-30 backdrop-blur-sm border-b px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 ${headerClass}`}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Buka navigasi"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
              <span className="font-medium text-indigo-700 dark:text-sky-400">{bundle.branding?.app_name || bundle.user.tenantName}</span>
              <span className="mx-2 text-slate-300 dark:text-slate-600">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{NAV_TITLES[activeNav]}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeNav !== 'dokumen-saya' && (
              <button
                type="button"
                onClick={() => handleNavigate('dokumen-saya')}
                className="hidden sm:flex px-3.5 py-2 rounded-xl border border-indigo-200 dark:border-slate-700 bg-indigo-50/70 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-slate-700 text-indigo-800 dark:text-sky-300 text-xs font-semibold transition-colors items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5 text-indigo-600 dark:text-sky-400" />
                <span>Dokumen &amp; Ekspor</span>
              </button>
            )}
            {activeNav !== 'generator' && (
              <button
                type="button"
                onClick={() => handleNavigate('generator')}
                className={`px-4 py-2 rounded-xl text-white text-xs font-semibold transition-all shadow-sm flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  theme === 'colorful'
                    ? 'bg-gradient-to-r from-indigo-600 via-blue-600 to-teal-600 hover:opacity-95'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Buat Soal AI</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1360px] w-full mx-auto">
          {activeNav === 'dashboard' && <DashboardView bundle={bundle} onNavigate={handleNavigate} />}
          {activeNav === 'generator' && (
            <AiGeneratorWizard
              bundle={bundle}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onNavigate={handleNavigate}
            />
          )}
          {activeNav === 'upload-ref' && (
            <ReferencesView bundle={bundle} mode="upload" onGoToGenerator={() => handleNavigate('generator')} />
          )}
          {activeNav === 'bank-materi' && (
            <ReferencesView bundle={bundle} mode="bank" onGoToGenerator={() => handleNavigate('generator')} />
          )}
          {activeNav === 'cp-tp' && <CurriculumView bundle={bundle} />}
          {(activeNav === 'kisi-kisi' ||
            activeNav === 'analisis-kognitif' ||
            activeNav === 'kunci-jawaban' ||
            activeNav === 'rubrik-penilaian' ||
            activeNav === 'quality-control') && (
            <ProjectWorkspaceViews
              mode={activeNav}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onNavigate={handleNavigate}
            />
          )}
          {activeNav === 'bank-soal' && <QuestionBankView bundle={bundle} onNavigate={handleNavigate} />}
          {activeNav === 'dokumen-saya' && (
            <DocumentsAndExportView bundle={bundle} activeProjectId={activeProjectId} onSelectProject={setActiveProjectId} />
          )}
          {activeNav === 'kop-surat' && <KopSuratStudio bundle={bundle} />}
          {(activeNav === 'manajemen-guru' ||
            activeNav === 'pengaturan-tenant' ||
            activeNav === 'profil-saya' ||
            activeNav === 'bantuan') && (
            <TenantSettingsAndUsersView
              mode={activeNav}
              bundle={bundle}
              onRefreshBundle={async () => {
                await loadSession();
              }}
            />
          )}
          {activeNav === 'super-admin' &&
            bundle.user.roleId === 'super_admin' &&
            bundle.user.email.toLowerCase() === 'ary.vandy@gmail.com' && <SuperAdminConsole />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
