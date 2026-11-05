import { useEffect } from 'react';
import { BarChart3, CheckSquare, FolderOpen, GitBranch, LogOut, Megaphone, Moon, Plug, ScrollText, Sun, Users, Wifi, WifiOff } from 'lucide-react';
import { useStore, type Tab } from './lib/store';
import { api } from './lib/api';
import { OfficeScene } from './components/office/OfficeScene';
import { AgentStrip } from './components/office/AgentStrip';
import { Login } from './components/Login';
import { CampaignsPanel } from './components/panels/CampaignsPanel';
import { ApprovalPanel } from './components/panels/ApprovalPanel';
import { ReportsPanel } from './components/panels/ReportsPanel';
import { AssetsPanel } from './components/panels/AssetsPanel';
import { IntegrationsPanel } from './components/panels/IntegrationsPanel';
import { AgentDrawer, LogsPanel, UsersPanel, WorkflowsPanel } from './components/panels/MiscPanels';

const TABS: { id: Tab; label: string; icon: typeof Megaphone; admin?: boolean }[] = [
  { id: 'campaigns', label: 'Chiến dịch', icon: Megaphone },
  { id: 'approval', label: 'Duyệt', icon: CheckSquare },
  { id: 'assets', label: 'Tư liệu', icon: FolderOpen },
  { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
  { id: 'integrations', label: 'Kết nối', icon: Plug },
  { id: 'workflows', label: 'Workflow', icon: GitBranch },
  { id: 'logs', label: 'Nhật ký', icon: ScrollText },
  { id: 'users', label: 'Người dùng', icon: Users, admin: true },
];

export default function App() {
  const s = useStore();
  const { user, authChecked, theme } = s;

  useEffect(() => { void s.checkAuth(); }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  useEffect(() => {
    if (!user) return;
    void s.loadAll();
    const close = s.connect();
    const q = new URLSearchParams(location.search);
    if (q.get('tab')) s.setTab(q.get('tab') as Tab);
    if (q.get('oauth')) {
      s.notify(q.get('oauth') === 'ok' ? 'ok' : 'err', q.get('msg') ?? '');
      history.replaceState(null, '', '/');
    }
    return close;
  }, [user?.id]);

  if (!authChecked) return <div className="grid h-full place-items-center text-mute">Đang tải…</div>;
  if (!user) return <Login />;

  const waiting = s.campaigns.filter((c) => c.status === 'awaiting_approval').length;
  const logout = async () => { await api.post('/api/auth/logout'); location.reload(); };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2">
        <div className="flex items-center gap-2 font-extrabold"><span className="text-xl">🏝️</span><span className="hidden sm:inline">AI Office</span></div>
        {s.system && (
          <span className={`chip ${s.system.mode === 'demo' ? 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'}`}>
            {s.system.mode === 'demo' ? 'DEMO MODE' : 'PRODUCTION'}
          </span>
        )}
        {s.system && !s.system.llm.active && <span className="chip hidden md:inline-flex bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">Chưa có Claude API — dùng mẫu</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <span title={s.connected ? 'Đang nhận cập nhật trực tiếp' : 'Mất kết nối realtime'} className={s.connected ? 'text-emerald-500' : 'text-rose-500'}>{s.connected ? <Wifi size={16} /> : <WifiOff size={16} />}</span>
          <button className="btn-ghost !p-2" onClick={s.toggleTheme} aria-label="Đổi giao diện sáng/tối">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
          <span className="hidden text-xs text-mute sm:inline">{user.name} · {user.role}</span>
          <button className="btn-ghost !p-2" onClick={logout} aria-label="Đăng xuất"><LogOut size={15} /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex shrink-0 flex-col lg:min-w-0 lg:flex-1">
          <main className="relative h-[46vh] lg:h-auto lg:flex-1">
            <OfficeScene />
            <AgentDrawer />
          </main>
          <AgentStrip />
        </div>
        <aside className="flex min-h-0 flex-1 flex-col border-t border-line bg-panel lg:w-[440px] lg:flex-none lg:border-l lg:border-t-0">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
            {TABS.filter((t) => !t.admin || user.role === 'admin').map((t) => (
              <button key={t.id} onClick={() => s.setTab(t.id)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${s.tab === t.id ? 'bg-brand text-white' : 'text-mute hover:bg-card hover:text-ink'}`}>
                <t.icon size={14} />{t.label}
                {t.id === 'approval' && waiting > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[10px] text-white">{waiting}</span>}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {s.tab === 'campaigns' && <CampaignsPanel />}
            {s.tab === 'approval' && <ApprovalPanel />}
            {s.tab === 'assets' && <AssetsPanel />}
            {s.tab === 'reports' && <ReportsPanel />}
            {s.tab === 'integrations' && <IntegrationsPanel />}
            {s.tab === 'workflows' && <WorkflowsPanel />}
            {s.tab === 'logs' && <LogsPanel />}
            {s.tab === 'users' && <UsersPanel />}
          </div>
        </aside>
      </div>

      {s.toast && (
        <div role="status" className={`fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-soft ${s.toast.kind === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
          {s.toast.text}
        </div>
      )}
    </div>
  );
}
