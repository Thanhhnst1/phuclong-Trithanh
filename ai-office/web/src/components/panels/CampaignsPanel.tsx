import { useEffect, useState } from 'react';
import { Play, Pause, Square, RotateCcw, Rocket, Search, Trash2 } from 'lucide-react';
import { api, fmtTime, PLATFORMS, PLATFORM_META, type Platform, type Workflow, STATUS_LABEL } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Empty, KindBadge, Progress, Section, StatusBadge } from '../ui';

const EXAMPLES = [
  'Quảng bá bộ quà Tết này lên Zalo, Facebook, TikTok và Threads.',
  'Giới thiệu răng gầu K100 chính hãng tới khách hàng trên Facebook và Zalo.',
];

export function CampaignComposer() {
  const { user, system, notify, loadCampaigns, selectCampaign } = useStore();
  const [goal, setGoal] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [auto, setAuto] = useState(true);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [wf, setWf] = useState('wf_full');
  const [scheduledAt, setScheduledAt] = useState('');
  const [publishAt, setPublishAt] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = user?.role !== 'viewer';

  useEffect(() => { api.get<Workflow[]>('/api/workflows').then(setWorkflows).catch(() => {}); }, []);
  useEffect(() => {
    if (!auto || goal.length < 4) return;
    const t = setTimeout(() => api.post<{ platforms: Platform[] }>('/api/campaigns/preview', { goal }).then((r) => setPlatforms(r.platforms)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [goal, auto]);

  const submit = async () => {
    setBusy(true);
    try {
      const c = await api.post<{ id: string }>('/api/campaigns', {
        goal, workflowId: wf, platforms,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        publishAt: publishAt ? new Date(publishAt).toISOString() : null,
      });
      setGoal('');
      notify('ok', 'Đã giao nhiệm vụ cho Orchestrator');
      await loadCampaigns();
      await selectCampaign(c.id);
    } catch (e: any) {
      notify('err', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Giao nhiệm vụ mới</h3>
        {system && (
          <span className={`chip ${system.mode === 'demo' ? 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' : 'bg-emerald-100 text-emerald-700'}`}>
            {system.mode === 'demo' ? 'DEMO — không đăng thật' : 'PRODUCTION'}
          </span>
        )}
      </div>
      <textarea
        className="input min-h-[84px] resize-y"
        placeholder="Ví dụ: Quảng bá bộ quà Tết này lên Zalo, Facebook, TikTok và Threads."
        value={goal}
        onChange={(e) => { setGoal(e.target.value); setAuto(true); }}
        disabled={!canEdit}
      />
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((x) => <button key={x} className="chip bg-card border border-line text-mute hover:text-ink" onClick={() => { setGoal(x); setAuto(true); }}>{x.slice(0, 38)}…</button>)}
      </div>
      <div>
        <div className="label mb-1">Nền tảng {auto && <span className="normal-case font-normal">(tự nhận diện, bấm để chỉnh)</span>}</div>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => {
            const on = platforms.includes(p);
            return (
              <button key={p} type="button" onClick={() => { setAuto(false); setPlatforms(on ? platforms.filter((x) => x !== p) : [...platforms, p]); }}
                className={`chip !px-2.5 !py-1 border ${on ? 'text-white border-transparent' : 'border-line text-mute'}`} style={on ? { background: PLATFORM_META[p].color } : {}}>
                {PLATFORM_META[p].emoji} {PLATFORM_META[p].label}
              </button>
            );
          })}
        </div>
        {!platforms.length && goal.length > 4 && <p className="mt-1 text-xs text-mute">Không nhắc nền tảng nào → sẽ dùng cả 4.</p>}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-mute">Tùy chọn: workflow & lịch</summary>
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1"><span className="label">Workflow</span>
            <select className="input" value={wf} onChange={(e) => setWf(e.target.value)}>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1"><span className="label">Hẹn giờ bắt đầu</span>
            <input type="datetime-local" className="input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </label>
          <label className="grid gap-1"><span className="label">Hẹn giờ đăng (sau khi duyệt)</span>
            <input type="datetime-local" className="input" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
            <span className="text-xs text-mute">Mẹo: tránh khung 20:00 nếu đó là giờ đăng video chính của page.</span>
          </label>
        </div>
      </details>
      <button className="btn-primary w-full" disabled={!canEdit || busy || goal.trim().length < 5} onClick={submit}>
        <Rocket size={16} /> {busy ? 'Đang gửi…' : 'Giao việc cho đội AI'}
      </button>
      {!canEdit && <p className="text-xs text-mute">Tài khoản xem (viewer) không tạo được chiến dịch.</p>}
    </div>
  );
}

export function CampaignList() {
  const { campaigns, selectedCampaignId, selectCampaign, agents } = useStore();
  const [status, setStatus] = useState('');
  const [agent, setAgent] = useState('');
  const [q, setQ] = useState('');
  const [filtered, setFiltered] = useState(campaigns);

  useEffect(() => {
    if (!agent) {
      setFiltered(campaigns.filter((c) => (!status || c.status === status) && (!q || (c.title + c.goal).toLowerCase().includes(q.toLowerCase()))));
      return;
    }
    const params = new URLSearchParams({ ...(status && { status }), agent, ...(q && { q }) });
    api.get<typeof campaigns>(`/api/campaigns?${params}`).then(setFiltered).catch(() => {});
  }, [campaigns, status, agent, q]);

  return (
    <Section title={`Chiến dịch (${filtered.length})`}>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input className="input !pl-8" placeholder="Tìm chiến dịch…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
          <option value="">Mọi trạng thái</option>
          {['running', 'awaiting_approval', 'scheduled', 'paused', 'completed', 'completed_with_errors', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Lọc theo agent">
          <option value="">Mọi agent</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </select>
      </div>
      {!filtered.length && <Empty>Chưa có chiến dịch nào.</Empty>}
      <ul className="space-y-1.5">
        {filtered.map((c) => (
          <li key={c.id}>
            <button onClick={() => selectCampaign(c.id)} className={`w-full text-left rounded-xl border p-2.5 transition ${selectedCampaignId === c.id ? 'border-brand bg-brand/5' : 'border-line bg-card hover:border-brand/50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm line-clamp-1">{c.title}</div>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
                <span>{fmtTime(c.createdAt)}</span>
                <span>{c.platforms.map((p) => PLATFORM_META[p].emoji).join(' ')}</span>
                {c.mode === 'demo' && <span className="text-fuchsia-500 font-semibold">DEMO</span>}
              </div>
              <div className="mt-1.5"><Progress value={c.progress ?? 0} /></div>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function CampaignDetailView() {
  const { detail, agents, notify, refreshDetail, user, setTab, selectCampaign, loadCampaigns } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  if (!detail) return null;
  const { campaign: c, tasks } = detail;
  const canEdit = user?.role !== 'viewer';
  const act = async (action: string) => {
    try {
      await api.post(`/api/campaigns/${c.id}/${action}`);
      await refreshDetail();
    } catch (e: any) { notify('err', e.message); }
  };
  const retry = async (tid: string) => {
    try { await api.post(`/api/campaigns/${c.id}/tasks/${tid}/retry`); await refreshDetail(); } catch (e: any) { notify('err', e.message); }
  };
  const remove = async () => {
    if (!confirm('Xóa vĩnh viễn chiến dịch này và toàn bộ tư liệu của nó?')) return;
    try { await api.del(`/api/campaigns/${c.id}`); await loadCampaigns(); await selectCampaign(null); } catch (e: any) { notify('err', e.message); }
  };
  const ag = (id: string) => agents.find((a) => a.id === id);
  const finished = ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(c.status);

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold leading-tight">{c.title}</h3>
          <p className="text-xs text-mute mt-0.5">{c.goal}</p>
        </div>
        <StatusBadge status={c.status} />
      </div>
      {c.mode === 'demo' && <p className="rounded-lg bg-fuchsia-50 dark:bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-700 dark:text-fuchsia-300">Chiến dịch DEMO: bước đăng bài chỉ mô phỏng, không gọi API mạng xã hội.</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {['draft', 'scheduled'].includes(c.status) && <button className="btn-primary" onClick={() => act('start')}><Play size={14} /> Bắt đầu ngay</button>}
          {['running', 'awaiting_approval', 'scheduled'].includes(c.status) && <button className="btn-ghost" onClick={() => act('pause')}><Pause size={14} /> Tạm dừng</button>}
          {c.status === 'paused' && <button className="btn-primary" onClick={() => act('resume')}><Play size={14} /> Tiếp tục</button>}
          {!finished && <button className="btn-ghost text-rose-600" onClick={() => confirm('Hủy chiến dịch này?') && act('cancel')}><Square size={14} /> Hủy</button>}
          {c.status === 'awaiting_approval' && <button className="btn-primary" onClick={() => setTab('approval')}>Duyệt nội dung →</button>}
          {finished && user?.role === 'admin' && <button className="btn-ghost text-rose-600" onClick={remove}><Trash2 size={14} /> Xóa</button>}
        </div>
      )}
      {c.plan && (
        <details className="rounded-xl bg-card border border-line p-2.5 text-sm">
          <summary className="cursor-pointer font-semibold">Kế hoạch {c.plan.generatedBy && <KindBadge kind={c.plan.generatedBy} />}</summary>
          <div className="mt-2 space-y-1 text-xs">
            <p><b>Sản phẩm:</b> {c.plan.product}</p>
            <p><b>Đối tượng:</b> {c.plan.audience}</p>
            <p><b>Giọng điệu:</b> {c.plan.tone}</p>
            <p><b>Thông điệp:</b> {c.plan.keyMessages?.join(' · ')}</p>
            {c.plan.revisionNotes?.length > 0 && <p><b>Góp ý đã gửi:</b> {c.plan.revisionNotes.join(' | ')}</p>}
          </div>
        </details>
      )}
      <ol className="space-y-1.5">
        {tasks.map((t) => {
          const a = ag(t.agent);
          return (
            <li key={t.id} className="rounded-xl border border-line bg-card">
              <button className="w-full p-2.5 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg text-sm" style={{ background: `${a?.color}22` }}>{a?.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">{t.title}</span>
                      <KindBadge kind={t.resultKind} />
                    </div>
                    <div className="text-[11px] text-mute truncate">{t.message ?? a?.name}{t.attempts > 1 ? ` · lần ${t.attempts}` : ''}</div>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                {t.status === 'running' && <div className="mt-2"><Progress value={t.progress} color={a?.color} /></div>}
              </button>
              {open === t.id && (
                <div className="border-t border-line p-2.5 text-xs space-y-1.5">
                  <p><b>Agent:</b> {a?.name} · <b>Phụ thuộc:</b> {t.deps.join(', ') || '—'} · <b>Thử tối đa:</b> {t.maxAttempts}</p>
                  <p><b>Bắt đầu:</b> {fmtTime(t.startedAt)} · <b>Kết thúc:</b> {fmtTime(t.finishedAt)}{t.runAfter && <> · <b>Hẹn chạy:</b> {fmtTime(t.runAfter)}</>}</p>
                  {t.error && <p className="text-rose-600 break-words"><b>Lỗi:</b> {t.error}</p>}
                  {t.output && <pre className="max-h-48 overflow-auto rounded-lg bg-bg p-2 text-[11px] whitespace-pre-wrap break-words">{JSON.stringify(t.output, null, 2)}</pre>}
                  {canEdit && ['failed', 'blocked', 'cancelled'].includes(t.status) && t.type !== 'approval' && (
                    <button className="btn-ghost" onClick={() => retry(t.id)}><RotateCcw size={13} /> Chạy lại bước này</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function CampaignsPanel() {
  return (
    <div className="space-y-4">
      <CampaignComposer />
      <CampaignDetailView />
      <CampaignList />
    </div>
  );
}
