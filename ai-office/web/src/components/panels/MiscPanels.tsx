import { useEffect, useState } from 'react';
import { ArrowDown, Copy, Save, Trash2, UserPlus, X } from 'lucide-react';
import { api, fmtTime, type LogRow, type User, type Workflow } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Empty, Progress, Section, StatusBadge } from '../ui';

const LEVEL: Record<string, string> = { info: 'text-mute', warn: 'text-amber-600 dark:text-amber-300', error: 'text-rose-600', success: 'text-emerald-600 dark:text-emerald-400' };

export function LogList({ agent, campaignId, limit = 100 }: { agent?: string; campaignId?: string; limit?: number }) {
  const { logVersion, agents } = useStore();
  const [rows, setRows] = useState<LogRow[]>([]);
  useEffect(() => {
    const p = new URLSearchParams({ limit: String(limit), ...(agent && { agent }), ...(campaignId && { campaignId }) });
    const t = setTimeout(() => api.get<LogRow[]>(`/api/logs?${p}`).then(setRows).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [agent, campaignId, logVersion, limit]);
  if (!rows.length) return <Empty>Chưa có hoạt động.</Empty>;
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const a = agents.find((x) => x.id === r.agent);
        return (
          <li key={r.id} className="flex gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-card">
            <span className="shrink-0 tabular-nums text-mute">{new Date(r.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="shrink-0">{a?.emoji ?? '⚙️'}</span>
            <span className={`${LEVEL[r.level] ?? ''} break-words`}>{r.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function LogsPanel() {
  const { agents, selectedCampaignId } = useStore();
  const [agent, setAgent] = useState('');
  const [onlyCampaign, setOnlyCampaign] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select className="input" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Mọi agent</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </select>
        <label className="flex shrink-0 items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyCampaign} onChange={(e) => setOnlyCampaign(e.target.checked)} disabled={!selectedCampaignId} />Chiến dịch đang chọn</label>
      </div>
      <LogList agent={agent || undefined} campaignId={onlyCampaign ? selectedCampaignId ?? undefined : undefined} limit={300} />
    </div>
  );
}

export function AgentDrawer() {
  const { selectedAgent, selectAgent, agents, detail } = useStore();
  const a = agents.find((x) => x.id === selectedAgent);
  if (!a) return null;
  const tasks = (detail?.tasks ?? []).filter((t) => t.agent === a.id);
  return (
    <div className="absolute inset-x-2 bottom-2 z-20 max-h-[70%] overflow-y-auto rounded-2xl border border-line bg-panel/95 p-4 shadow-soft backdrop-blur sm:inset-x-auto sm:right-14 sm:top-3 sm:bottom-auto sm:w-[360px] sm:max-h-[calc(100%-24px)]">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `${a.color}26` }}>{a.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">{a.name}</div>
          <div className="text-xs text-mute">{a.role}</div>
        </div>
        <button className="btn-ghost !p-1.5" onClick={() => selectAgent(null)} aria-label="Đóng"><X size={15} /></button>
      </div>
      <div className="mt-3 rounded-xl bg-card p-3 text-sm">
        <div className="flex items-center justify-between"><span className="label">Hiện tại</span><span className="text-[11px] text-mute">{fmtTime(a.state.updatedAt)}</span></div>
        <p className="mt-1">{a.state.message}</p>
        {a.state.status === 'working' && <div className="mt-2"><Progress value={a.state.progress} color={a.color} /></div>}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">{a.duties.map((d) => <span key={d} className="chip bg-bg text-mute">{d}</span>)}</div>
      {tasks.length > 0 && (
        <Section title="Nhiệm vụ trong chiến dịch đang xem">
          <ul className="space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id} className="rounded-lg border border-line p-2 text-xs">
                <div className="flex items-center justify-between gap-2"><b>{t.title}</b><StatusBadge status={t.status} /></div>
                {t.message && <div className="mt-0.5 text-mute">{t.message}</div>}
                {t.error && <div className="mt-0.5 text-rose-600">{t.error}</div>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <div className="mt-3"><Section title="Nhật ký hoạt động"><LogList agent={a.id} limit={30} /></Section></div>
    </div>
  );
}

const AGENT_IDS = ['orchestrator', 'researcher', 'factchecker', 'editor', 'writer', 'zalo', 'facebook', 'tiktok', 'threads', 'reporter'];

export function WorkflowsPanel() {
  const { notify, user, agents } = useStore();
  const [list, setList] = useState<Workflow[]>([]);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const load = () => api.get<Workflow[]>('/api/workflows').then(setList);
  useEffect(() => { void load(); }, []);
  const canEdit = user?.role !== 'viewer';

  const save = async () => {
    if (!draft) return;
    try {
      const body = { ...draft, id: draft.builtin || draft.id.startsWith('new') ? undefined : draft.id };
      await api.post('/api/workflows', body);
      setDraft(null);
      await load();
      notify('ok', 'Đã lưu workflow');
    } catch (e: any) { notify('err', e.message); }
  };
  const upd = (i: number, patch: any) => setDraft((d) => d && { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  if (draft) {
    return (
      <div className="space-y-3">
        <input className="input font-semibold" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <ol className="space-y-1.5">
          {draft.steps.map((s, i) => (
            <li key={s.key} className={`rounded-xl border border-line bg-card p-2.5 text-xs space-y-1.5 ${s.enabled === false ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={s.enabled !== false} onChange={(e) => upd(i, { enabled: e.target.checked })} aria-label="Bật bước" />
                <input className="input !py-1" value={s.title} onChange={(e) => upd(i, { title: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <select className="input !py-1" value={s.agent} onChange={(e) => upd(i, { agent: e.target.value })} disabled={s.type === 'approval'}>
                  {AGENT_IDS.map((id) => <option key={id} value={id}>{agents.find((a) => a.id === id)?.name ?? id}</option>)}
                </select>
                <label className="flex items-center gap-1">Thử <input type="number" min={1} max={10} className="input !py-1" value={s.maxAttempts ?? 3} onChange={(e) => upd(i, { maxAttempts: Number(e.target.value) })} /></label>
                <select className="input !py-1" value={s.fallbackAgent ?? ''} onChange={(e) => upd(i, { fallbackAgent: e.target.value || undefined })} title="Agent dự phòng khi thất bại">
                  <option value="">Không dự phòng</option>
                  {AGENT_IDS.map((id) => <option key={id} value={id}>↪ {id}</option>)}
                </select>
              </div>
              <div className="text-mute">Sau: {s.deps.join(', ') || 'bắt đầu'}{s.depMode === 'settled' ? ' (chạy cả khi bước trước lỗi)' : ''}</div>
              {i < draft.steps.length - 1 && <ArrowDown size={12} className="mx-auto text-mute" />}
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save}><Save size={14} /> Lưu {draft.builtin ? 'thành bản mới' : ''}</button>
          <button className="btn-ghost" onClick={() => setDraft(null)}>Hủy</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AutoHuntCard workflows={list} />
      <p className="text-xs text-mute">Workflow là chuỗi bước Orchestrator dùng để giao việc. Nhân bản để tùy chỉnh (bật/tắt bước, số lần thử, agent dự phòng) và tái sử dụng khi tạo chiến dịch.</p>
      {list.map((w) => (
        <div key={w.id} className="rounded-xl border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm">{w.name} {w.builtin && <span className="chip bg-bg text-mute">mặc định</span>}</div>
            {canEdit && (
              <div className="flex gap-1">
                <button className="btn-ghost !px-2 !py-1" onClick={() => setDraft({ ...structuredClone(w), id: w.builtin ? 'new' : w.id, name: w.builtin ? `${w.name} (tùy chỉnh)` : w.name, builtin: false })}><Copy size={13} /> {w.builtin ? 'Nhân bản' : 'Sửa'}</button>
                {!w.builtin && <button className="btn-ghost !px-2 !py-1 text-rose-600" onClick={async () => { await api.del(`/api/workflows/${w.id}`); await load(); }} aria-label="Xóa"><Trash2 size={13} /></button>}
              </div>
            )}
          </div>
          <p className="mt-1 text-xs text-mute">{w.description}</p>
          <div className="mt-2 flex flex-wrap gap-1">{w.steps.filter((s) => s.enabled !== false).map((s) => <span key={s.key} className="chip bg-bg">{agents.find((a) => a.id === s.agent)?.emoji} {s.title}</span>)}</div>
        </div>
      ))}
    </div>
  );
}

export function UsersPanel() {
  const { user, notify } = useStore();
  const [list, setList] = useState<User[]>([]);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'editor' });
  const load = () => api.get<User[]>('/api/users').then(setList);
  useEffect(() => { void load(); }, []);
  if (user?.role !== 'admin') return <Empty>Chỉ quản trị viên quản lý người dùng.</Empty>;
  const add = async () => {
    try { await api.post('/api/users', form); setForm({ email: '', name: '', password: '', role: 'editor' }); await load(); notify('ok', 'Đã thêm người dùng'); } catch (e: any) { notify('err', e.message); }
  };
  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <h3 className="font-bold">Thêm người dùng</h3>
        <input className="input" placeholder="Họ tên" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="input" type="password" placeholder="Mật khẩu (≥ 8 ký tự)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="admin">Quản trị — mọi quyền, cấu hình kết nối</option>
          <option value="editor">Biên tập — tạo chiến dịch, duyệt, đăng</option>
          <option value="viewer">Xem — chỉ theo dõi</option>
        </select>
        <button className="btn-primary" onClick={add}><UserPlus size={14} /> Thêm</button>
      </div>
      {list.map((u) => (
        <div key={u.id} className="flex items-center gap-2 rounded-xl border border-line bg-card p-2.5 text-sm">
          <div className="min-w-0 flex-1"><div className="font-semibold">{u.name}</div><div className="text-xs text-mute">{u.email}</div></div>
          <select className="input !w-auto !py-1" value={u.role} disabled={u.id === user.id} onChange={async (e) => { await api.patch(`/api/users/${u.id}`, { role: e.target.value }); await load(); }}>
            <option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option>
          </select>
          {u.id !== user.id && <button className="btn-ghost !p-1.5 text-rose-600" onClick={async () => { if (confirm('Xóa người dùng?')) { await api.del(`/api/users/${u.id}`); await load(); } }} aria-label="Xóa"><Trash2 size={13} /></button>}
        </div>
      ))}
    </div>
  );
}

interface AutoHunt { enabled: boolean; time: string; goal: string; platforms: string[]; workflowId: string; options: { count: number; categories: string[]; region: string }; lastRun: string | null }

function AutoHuntCard({ workflows }: { workflows: Workflow[] }) {
  const { notify, user } = useStore();
  const [a, setA] = useState<AutoHunt | null>(null);
  useEffect(() => { api.get<AutoHunt>('/api/autohunt').then(setA).catch(() => {}); }, []);
  if (!a) return null;
  const save = async () => {
    try { setA(await api.put<AutoHunt>('/api/autohunt', a)); notify('ok', a.enabled ? `Sẽ tự săn tin lúc ${a.time} mỗi ngày` : 'Đã tắt săn tin tự động'); } catch (e: any) { notify('err', e.message); }
  };
  return (
    <div className="card space-y-2 !p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">⏰ Săn tin tự động hằng ngày</h3>
        <label className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={a.enabled} disabled={user?.role === 'viewer'} onChange={(e) => setA({ ...a, enabled: e.target.checked })} /> Bật</label>
      </div>
      <textarea className="input min-h-[60px]" value={a.goal} onChange={(e) => setA({ ...a, goal: e.target.value })} />
      <div className="grid grid-cols-3 gap-2">
        <input type="time" className="input !py-1.5" value={a.time} onChange={(e) => setA({ ...a, time: e.target.value })} aria-label="Giờ chạy" />
        <select className="input !py-1.5" value={a.options.count} onChange={(e) => setA({ ...a, options: { ...a.options, count: Number(e.target.value) } })} aria-label="Số chủ đề">
          {[5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n} chủ đề</option>)}
        </select>
        <select className="input !py-1.5" value={a.workflowId} onChange={(e) => setA({ ...a, workflowId: e.target.value })} aria-label="Workflow">
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <p className="text-xs text-mute">Mỗi ngày tạo 1 phiên săn tin, chủ đề không lặp lại chủ đề cũ. Bài vẫn chờ anh chọn & duyệt trước khi đăng.{a.lastRun ? ` Lần chạy gần nhất: ${a.lastRun}.` : ''}</p>
      {user?.role !== 'viewer' && <button className="btn-primary" onClick={save}>Lưu lịch</button>}
    </div>
  );
}
