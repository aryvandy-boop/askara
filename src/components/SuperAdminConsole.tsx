import React, { useEffect, useState } from 'react';
import { Crown, Download, CheckCircle2, XCircle, ShieldAlert, CalendarClock, Trash2, Clock } from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../lib/api';

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isExpiredDate(dateStr?: string | null): boolean {
  const clean = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return false;
  return new Date().toISOString().slice(0, 10) > clean;
}

export const SuperAdminConsole: React.FC = () => {
  const [data, setData] = useState<{
    tenants: any[];
    users: any[];
    aiLogs: any[];
    activityLogs: any[];
    systemSettings: Record<string, string>;
    masterEmail?: string;
  } | null>(null);
  const [tab, setTab] = useState<'tenants' | 'users' | 'ai' | 'logs'>('tenants');
  const [tenantDates, setTenantDates] = useState<Record<string, string>>({});
  const [userDates, setUserDates] = useState<Record<string, string>>({});
  const [aiModel, setAiModel] = useState('gemini-4-hydrogen');
  const [thinkingLevel, setThinkingLevel] = useState('LOW');
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadOverview = async () => {
    try {
      const res = await apiFetch<any>('/api/superadmin/overview');
      setData(res);
      setAiModel(res.systemSettings?.ai_model || 'gemini-4-hydrogen');
      setThinkingLevel(res.systemSettings?.ai_thinking_level || 'LOW');
      setAnnouncement(res.systemSettings?.system_announcement || '');

      const nextTenantDates: Record<string, string> = {};
      for (const t of res.tenants || []) {
        nextTenantDates[t.id] = String(t.valid_until || '').slice(0, 10);
      }
      setTenantDates(nextTenantDates);

      const nextUserDates: Record<string, string> = {};
      for (const u of res.users || []) {
        nextUserDates[u.id] = String(u.access_expires_at || '').slice(0, 10);
      }
      setUserDates(nextUserDates);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleTenantStatus = async (tenantId: string, status: string, isActive: boolean, validUntil?: string) => {
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/superadmin/tenants/${tenantId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, isActive, validUntil }),
      });
      setNotice(
        status === 'approved' && validUntil
          ? `Lembaga disetujui dengan batas penggunaan s.d. ${validUntil}.`
          : 'Status lembaga berhasil diperbarui.'
      );
      loadOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveTenantExpiry = async (tenantId: string, validUntilValue: string) => {
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/superadmin/tenants/${tenantId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify({ validUntil: validUntilValue }),
      });
      setNotice(
        validUntilValue
          ? `Batas penggunaan aplikasi disimpan s.d. ${validUntilValue}.`
          : 'Batas waktu penggunaan diatur menjadi Tanpa Batas.'
      );
      loadOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteTenant = async (tenantId: string, name: string) => {
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/superadmin/tenants/${tenantId}`, { method: 'DELETE' });
      setNotice(`Data lembaga "${name}" berhasil dihapus.`);
      loadOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveUserExpiry = async (userId: string, accessExpiresAt: string) => {
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/superadmin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ accessExpiresAt }),
      });
      setNotice(
        accessExpiresAt
          ? `Batas akses akun disimpan s.d. ${accessExpiresAt}.`
          : 'Batas akses akun diatur menjadi mengikuti batas lembaga (Tanpa Batas).'
      );
      loadOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/superadmin/settings', {
        method: 'PUT',
        body: JSON.stringify({ aiModel, aiThinkingLevel: thinkingLevel, announcement }),
      });
      setNotice('Konfigurasi AI dan pengumuman global berhasil disimpan.');
      loadOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const pendingTenants = data ? data.tenants.filter((t) => t.status === 'pending') : [];
  const masterEmail = data?.masterEmail || 'ary.vandy@gmail.com';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
            <Crown className="w-4 h-4" />
            <span>KONTROL MASTER TUNGGAL · {masterEmail}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">Konsol Pengendali Utama &amp; Masa Aktif</h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Setujui pendaftar baru, atur tanggal batas penggunaan aplikasi per lembaga/akun, atau nonaktifkan akses kapan saja.
          </p>
        </div>

        <button
          type="button"
          onClick={() => downloadAuthorizedFile('/api/superadmin/backup', 'askara-backup.json')}
          className="px-4 py-2.5 rounded-lg bg-[#0a192f] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 self-start"
        >
          <Download className="w-4 h-4 text-amber-300" />
          <span>Backup Database (24 Tabel JSON)</span>
        </button>
      </div>

      {error && <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>}

      {/* Pending Approval Highlight Banner */}
      {pendingTenants.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-amber-950">
                Ada {pendingTenants.length} Pendaftaran Baru Menunggu Persetujuan Anda
              </div>
              <div className="text-xs text-amber-900 mt-0.5">
                Tentukan batas tanggal penggunaan (opsional) lalu klik <strong>Setujui</strong> pada tabel di bawah agar pendaftar bisa masuk.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab('tenants')}
            className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shrink-0"
          >
            Tinjau Pendaftar
          </button>
        </div>
      )}

      {/* Top Metrics */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Lembaga Terdaftar</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">{data.tenants.length}</div>
          </div>
          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Menunggu Persetujuan</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">{pendingTenants.length}</div>
          </div>
          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Akun Pengguna</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">{data.users.length}</div>
          </div>
          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Log Pemanggilan AI</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1">{data.aiLogs.length}</div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg w-fit">
        {[
          { key: 'tenants', label: `Persetujuan & Batas Lembaga (${data?.tenants.length || 0})` },
          { key: 'users', label: `Kontrol & Batas Akun (${data?.users.length || 0})` },
          { key: 'ai', label: 'Konfigurasi AI & Pengumuman' },
          { key: 'logs', label: 'Riwayat AI & Audit Aktivitas' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as any)}
            className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors ${
              tab === t.key ? 'bg-white dark:bg-[#111a2e] text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {data && tab === 'tenants' && (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
              <tr>
                <th className="py-3 px-4">Lembaga / Pendaftar</th>
                <th className="py-3 px-4">Jenis &amp; Wilayah</th>
                <th className="py-3 px-4">Statistik</th>
                <th className="py-3 px-4">Batas Penggunaan (Tanggal)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Kontrol Master</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.tenants.map((t) => {
                const isMasterHome = t.id === 'tenant-gugus04';
                const curDate = tenantDates[t.id] ?? '';
                const expired = !isMasterHome && isExpiredDate(t.valid_until);
                return (
                  <tr key={t.id} className={t.status === 'pending' ? 'bg-amber-50/40' : ''}>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{t.name}</div>
                      <div className="text-slate-500 dark:text-slate-400">{t.admin_email}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      <div>{t.institution_type}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.regency}, {t.province}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {t.user_count} akun · {t.assessment_count} proyek · {t.ai_calls} AI
                    </td>
                    <td className="py-3 px-4">
                      {isMasterHome ? (
                        <span className="inline-flex items-center gap-1 text-indigo-700 font-semibold">
                          <Crown className="w-3.5 h-3.5" /> Ruang Master (Tanpa Batas)
                        </span>
                      ) : (
                        <div className="space-y-1.5 min-w-[235px]">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="date"
                              value={curDate}
                              onChange={(e) => setTenantDates((prev) => ({ ...prev, [t.id]: e.target.value }))}
                              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveTenantExpiry(t.id, curDate)}
                              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                            >
                              Simpan
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {[
                              { label: '+30 Hr', days: 30 },
                              { label: '+3 Bln', days: 90 },
                              { label: '+1 Thn', days: 365 },
                            ].map((p) => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => setTenantDates((prev) => ({ ...prev, [t.id]: addDaysIso(p.days) }))}
                                className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 text-[10px] font-medium text-slate-700 dark:text-slate-300"
                              >
                                {p.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setTenantDates((prev) => ({ ...prev, [t.id]: '' }));
                                handleSaveTenantExpiry(t.id, '');
                              }}
                              className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111a2e] hover:bg-slate-100 text-[10px] font-medium text-slate-600 dark:text-slate-400"
                            >
                              Tanpa Batas
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      {t.status === 'pending' && <span className="text-amber-700">Menunggu Persetujuan</span>}
                      {t.status === 'approved' && expired ? <span className="text-rose-700">Kedaluwarsa ({t.valid_until})</span> : null}
                      {t.status === 'approved' && !expired && t.is_active ? (
                        <span className="text-emerald-700">
                          Aktif {t.valid_until ? `(s.d. ${t.valid_until})` : '(Tanpa Batas)'}
                        </span>
                      ) : null}
                      {t.status === 'approved' && !t.is_active ? <span className="text-red-700">Dinonaktifkan</span> : null}
                      {t.status === 'rejected' && <span className="text-red-700">Ditolak</span>}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {t.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleTenantStatus(t.id, 'approved', true, curDate)}
                            className="px-2.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Setujui
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTenantStatus(t.id, 'rejected', false)}
                            className="px-2.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold inline-flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Tolak
                          </button>
                        </>
                      )}
                      {t.status === 'approved' && !isMasterHome && (
                        <button
                          type="button"
                          onClick={() => handleTenantStatus(t.id, 'approved', !t.is_active)}
                          className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 font-medium inline-flex items-center gap-1"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>{t.is_active ? 'Nonaktifkan' : 'Aktifkan'}</span>
                        </button>
                      )}
                      {t.status === 'rejected' && !isMasterHome && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleTenantStatus(t.id, 'approved', true, curDate)}
                            className="px-2.5 py-1 rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-semibold inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Setujui Ulang
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTenant(t.id, t.name)}
                            className="px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                            title="Hapus permanen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === 'users' && (
        <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Nama</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Lembaga</th>
                <th className="py-3 px-4">Peran</th>
                <th className="py-3 px-4">Batas Akses Akun</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.users.map((u) => {
                const isMaster = String(u.email || '').toLowerCase() === masterEmail.toLowerCase();
                const uDate = userDates[u.id] ?? '';
                const uExpired = !isMaster && isExpiredDate(u.access_expires_at);
                return (
                  <tr key={u.id} className={isMaster ? 'bg-amber-50/40' : ''}>
                    <td className="py-2.5 px-4 font-semibold">{u.full_name}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{u.email}</td>
                    <td className="py-2.5 px-4">{u.tenant_name}</td>
                    <td className="py-2.5 px-4 font-mono">
                      {isMaster ? 'MASTER PENGENDALI' : u.role_id}
                    </td>
                    <td className="py-2.5 px-4">
                      {isMaster ? (
                        <span className="text-amber-700 font-semibold">Tanpa Batas (Terkunci)</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={uDate}
                            onChange={(e) => setUserDates((prev) => ({ ...prev, [u.id]: e.target.value }))}
                            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-xs font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveUserExpiry(u.id, uDate)}
                            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                          >
                            Simpan
                          </button>
                          {u.access_expires_at && (
                            <button
                              type="button"
                              onClick={() => {
                                setUserDates((prev) => ({ ...prev, [u.id]: '' }));
                                handleSaveUserExpiry(u.id, '');
                              }}
                              className="px-1.5 py-1 rounded border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                              title="Hapus batas individu"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">
                      {uExpired ? (
                        <span className="text-rose-700">Kedaluwarsa ({u.access_expires_at})</span>
                      ) : u.is_active ? (
                        <span className="text-emerald-700">Aktif</span>
                      ) : (
                        <span className="text-red-700">Diblokir</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {!isMaster && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/superadmin/users/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ isActive: !u.is_active }),
                            });
                            loadOverview();
                          }}
                          className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 text-xs font-medium"
                        >
                          {u.is_active ? 'Blokir' : 'Aktifkan'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && tab === 'ai' && (
        <form onSubmit={handleSaveGlobalSettings} className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-6 max-w-2xl space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-indigo-600" />
            <span>Konfigurasi Model AI &amp; Pengumuman Global</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Model AI Platform</label>
              <select value={aiModel} onChange={(e) => setAiModel(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
                <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Cepat & Seimbang)</option>
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Hemat & Ringan)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Kedalaman Penalaran (Thinking Level)</label>
              <select value={thinkingLevel} onChange={(e) => setThinkingLevel(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-[#111a2e]">
                <option value="LOW">LOW (Respons Cepat)</option>
                <option value="MEDIUM">MEDIUM (Seimbang)</option>
                <option value="HIGH">HIGH (Penalaran HOTS Mendalam)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Pengumuman Sistem (Tampil di Dashboard Seluruh Tenant)</label>
            <textarea rows={3} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm" />
          </div>

          <button type="submit" className="px-5 py-2.5 rounded-lg bg-[#1d4ed8] hover:bg-blue-800 text-white text-sm font-semibold">
            Simpan Pengaturan Global
          </button>
        </form>
      )}

      {data && tab === 'logs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Riwayat Penggunaan AI ({data.aiLogs.length})</h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto text-xs">
              {data.aiLogs.map((l) => (
                <div key={l.id} className="py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{l.operation} · {l.tenant_name}</div>
                    <div className="text-slate-500 dark:text-slate-400">{l.model_name} · <span className="font-mono">{l.prompt_tokens + l.output_tokens} tok · {l.duration_ms}ms</span></div>
                  </div>
                  <span className={l.status === 'success' ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>{l.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Log Audit Aktivitas Sistem ({data.activityLogs.length})</h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto text-xs">
              {data.activityLogs.map((a) => (
                <div key={a.id} className="py-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{a.details}</div>
                  <div className="text-slate-500 dark:text-slate-400">{a.tenant_name} · {a.actor_name || 'Sistem'} · <span className="font-mono">{a.created_at.slice(0, 16)}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
