import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Sparkles,
  Upload,
  TableProperties,
  Library,
  BookOpen,
  Target,
  BrainCircuit,
  Key,
  ClipboardCheck,
  ShieldCheck,
  FolderOpen,
  FileText,
  Users,
  Settings,
  UserCircle,
  HelpCircle,
  Crown,
  LogOut,
  X,
  ChevronDown,
  Sun,
  Moon,
  Palette,
} from 'lucide-react';
import { AuthBundle, NavKey } from '../types';
import { AppTheme, useTheme } from '../lib/theme';

interface SidebarProps {
  bundle: AuthBundle;
  activeNav: NavKey;
  onSelectNav: (nav: NavKey) => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface MenuItem {
  key: NavKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  roles?: Array<'super_admin' | 'tenant_admin' | 'teacher'>;
}

const PRIMARY_WORKFLOW: MenuItem[] = [
  { key: 'dashboard', label: 'Beranda', icon: LayoutDashboard, iconColor: 'text-sky-400' },
  { key: 'upload-ref', label: '1. Referensi Buku', icon: Upload, iconColor: 'text-emerald-400' },
  { key: 'generator', label: '2. Buat Soal AI', icon: Sparkles, iconColor: 'text-amber-300' },
  { key: 'dokumen-saya', label: '3. Unduh Word & PDF', icon: FolderOpen, iconColor: 'text-rose-300' },
];

const CURRICULUM_ITEMS: MenuItem[] = [
  { key: 'bank-materi', label: 'Bank Materi', icon: BookOpen, iconColor: 'text-teal-300' },
  { key: 'cp-tp', label: 'CP dan TP', icon: Target, iconColor: 'text-cyan-300' },
  { key: 'bank-soal', label: 'Bank Soal', icon: Library, iconColor: 'text-pink-300' },
];

const WORKSPACE_DETAILS: MenuItem[] = [
  { key: 'kisi-kisi', label: 'Kisi-Kisi', icon: TableProperties, iconColor: 'text-indigo-300' },
  { key: 'analisis-kognitif', label: 'Analisis Kognitif', icon: BrainCircuit, iconColor: 'text-violet-300' },
  { key: 'kunci-jawaban', label: 'Kunci & Rubrik', icon: Key, iconColor: 'text-amber-300' },
  { key: 'rubrik-penilaian', label: 'Rubrik Penilaian', icon: ClipboardCheck, iconColor: 'text-orange-300' },
  { key: 'quality-control', label: 'Quality Control', icon: ShieldCheck, iconColor: 'text-emerald-300' },
];

const ACCOUNT_ITEMS: MenuItem[] = [
  { key: 'kop-surat', label: 'Kop Surat & Logo', icon: FileText, iconColor: 'text-sky-300' },
  { key: 'manajemen-guru', label: 'Manajemen Guru', icon: Users, iconColor: 'text-teal-300', roles: ['super_admin', 'tenant_admin'] },
  { key: 'pengaturan-tenant', label: 'Pengaturan Lembaga', icon: Settings, iconColor: 'text-slate-300', roles: ['super_admin', 'tenant_admin'] },
  { key: 'profil-saya', label: 'Profil Saya', icon: UserCircle, iconColor: 'text-indigo-300' },
  { key: 'bantuan', label: 'Panduan & Tentang', icon: HelpCircle, iconColor: 'text-amber-200' },
];

const DETAIL_KEYS = new Set<NavKey>(WORKSPACE_DETAILS.map((d) => d.key));

const THEME_CHOICES: Array<{ id: AppTheme; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'light', label: 'Terang', icon: Sun },
  { id: 'dark', label: 'Gelap', icon: Moon },
  { id: 'colorful', label: 'Warna', icon: Palette },
];

export const Sidebar: React.FC<SidebarProps> = ({
  bundle,
  activeNav,
  onSelectNav,
  onLogout,
  mobileOpen,
  onCloseMobile,
}) => {
  const { user, branding } = bundle;
  const { theme, setTheme } = useTheme();
  const [detailsOpen, setDetailsOpen] = useState(() => DETAIL_KEYS.has(activeNav));

  useEffect(() => {
    if (DETAIL_KEYS.has(activeNav)) {
      setDetailsOpen(true);
    }
  }, [activeNav]);

  const sidebarBg =
    theme === 'dark'
      ? 'bg-gradient-to-b from-[#060b16] via-[#0b1325] to-[#0f172a] border-slate-800/90'
      : theme === 'colorful'
        ? 'bg-gradient-to-b from-[#1e1b4b] via-[#1d4ed8] to-[#0f766e] border-indigo-900/50'
        : 'bg-gradient-to-b from-[#0b1530] via-[#13224a] to-[#1a2c5b] border-indigo-950/60';

  const renderMenuButton = (item: MenuItem) => {
    const Icon = item.icon;
    const active = activeNav === item.key;
    const activeClass =
      theme === 'colorful'
        ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 font-semibold shadow-sm'
        : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm';
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          onSelectNav(item.key);
          onCloseMobile();
        }}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-all whitespace-nowrap ${
          active ? activeClass : 'text-slate-200/90 hover:text-white hover:bg-white/10'
        }`}
      >
        <Icon
          className={`w-4 h-4 shrink-0 ${
            active ? (theme === 'colorful' ? 'text-slate-950' : 'text-amber-300') : item.iconColor || 'text-slate-300'
          }`}
        />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  const visibleAccountItems = ACCOUNT_ITEMS.filter((it) => !it.roles || it.roles.includes(user.roleId));

  const content = (
    <div className={`h-full flex flex-col ${sidebarBg} text-slate-100 w-[268px] shrink-0 select-none border-r`}>
      {/* Tenant Identity Header */}
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-2 bg-white/[0.03]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-10 rounded-xl bg-white p-1 shrink-0 overflow-hidden flex items-center justify-center ring-2 ring-amber-400/60 shadow-sm">
            <img
              src={branding?.logo_url || '/assets/aistudio/Logo_ASKARA_04_Biru_Emas_8b6c2828.png'}
              alt={`Logo ${branding?.app_name || 'ASKARA 04'}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-sm text-white truncate">
              {branding?.app_name || user.tenantName}
            </div>
            <div className="text-[11px] text-amber-300 truncate font-medium">
              {user.tenantName}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10"
          aria-label="Tutup menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Exclusive Super Admin Banner Button */}
      {user.roleId === 'super_admin' && user.email.toLowerCase() === 'ary.vandy@gmail.com' && (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => {
              onSelectNav('super-admin');
              onCloseMobile();
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              activeNav === 'super-admin'
                ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-[#0f172a] shadow-sm'
                : 'bg-white/10 text-amber-300 hover:bg-white/15 border border-amber-400/30'
            }`}
          >
            <Crown className="w-4 h-4 shrink-0" />
            <span className="truncate">Master Pengendali</span>
          </button>
        </div>
      )}

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* 1. Primary 4-Step Flow */}
        <div>
          <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider text-indigo-200/70">
            Alur Utama Guru
          </div>
          <div className="space-y-1">{PRIMARY_WORKFLOW.map(renderMenuButton)}</div>
        </div>

        {/* 2. Curriculum & Bank + Collapsible Perangkat Detail */}
        <div>
          <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider text-indigo-200/70">
            Kurikulum &amp; Koleksi
          </div>
          <div className="space-y-1">
            {CURRICULUM_ITEMS.map(renderMenuButton)}
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[13px] font-medium text-indigo-200/90 hover:text-white hover:bg-white/10 transition-all"
            >
              <span className="truncate">Detail Perangkat Soal</span>
              <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
            </button>
            {detailsOpen && (
              <div className="pl-2 space-y-1 border-l border-white/15 ml-3">
                {WORKSPACE_DETAILS.map(renderMenuButton)}
              </div>
            )}
          </div>
        </div>

        {/* 3. School Settings & Account */}
        <div>
          <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider text-indigo-200/70">
            Sekolah &amp; Akun
          </div>
          <div className="space-y-1">{visibleAccountItems.map(renderMenuButton)}</div>
        </div>
      </nav>

      {/* Theme Switcher Strip */}
      <div className="px-3 py-2.5 border-t border-white/10 bg-white/[0.03]">
        <div className="text-[11px] text-indigo-200/80 font-medium px-1 mb-1.5">Tema Tampilan</div>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/25">
          {THEME_CHOICES.map((opt) => {
            const Icon = opt.icon;
            const selected = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTheme(opt.id)}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                  selected
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom User Strip */}
      <div className="p-3 border-t border-white/10 bg-black/20">
        <div className="px-2 py-1 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">{user.fullName}</div>
            <div className="text-[11px] text-indigo-200/80 truncate">
              {user.roleId === 'super_admin'
                ? 'Master Pengendali'
                : user.roleId === 'tenant_admin'
                  ? 'Admin Tenant'
                  : 'Guru / Member'}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Keluar dari akun"
            className="p-2 rounded-lg text-indigo-200 hover:text-white hover:bg-rose-500/20 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block h-screen sticky top-0">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/60" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
};
