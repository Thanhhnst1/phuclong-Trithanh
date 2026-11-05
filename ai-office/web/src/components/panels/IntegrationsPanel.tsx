import { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, KeyRound, Link2, Plug, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Section } from '../ui';

interface Field { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; help?: string }
interface Integration {
  key: string; name: string; category: string; description: string; capabilities: string[]; limitations: string[]; permissions: string[];
  docs: string; fields: Field[]; oauth?: boolean; configured: boolean; publicUrlMissing: boolean; envKey: boolean;
  values: Record<string, { set: boolean; preview: string | null; updatedAt: string | null }>;
}
interface Resp { integrations: Integration[]; mcpServers: { name: string; url: string; hasToken: boolean }[]; facebookPages: { id: string; name: string }[]; oauthCallbackBase: string | null }

export function IntegrationsPanel() {
  const { user, system, notify, loadAll } = useStore();
  const [data, setData] = useState<Resp | null>(null);
  const isAdmin = user?.role === 'admin';
  const load = () => api.get<Resp>('/api/integrations').then(setData).catch((e) => notify('err', e.message));
  useEffect(() => { void load(); }, []);

  const setMode = async (mode: 'demo' | 'production') => {
    if (mode === 'production' && !confirm('Chế độ PRODUCTION sẽ đăng bài THẬT lên các nền tảng đã kết nối (sau khi anh duyệt). Tiếp tục?')) return;
    try { await api.put('/api/settings', { mode }); await loadAll(); notify('ok', `Đã chuyển sang ${mode.toUpperCase()}`); } catch (e: any) { notify('err', e.message); }
  };

  if (!data || !system) return <div className="text-sm text-mute">Đang tải…</div>;
  const groups: [string, string][] = [['ai', 'Bộ não AI'], ['research', 'Nghiên cứu'], ['assets', 'Nguồn tư liệu'], ['publish', 'Nền tảng xuất bản']];

  return (
    <div className="space-y-5">
      <div className="card space-y-2">
        <h3 className="font-bold">Chế độ vận hành</h3>
        <div className="grid grid-cols-2 gap-2">
          {(['demo', 'production'] as const).map((m) => (
            <button key={m} disabled={!isAdmin} onClick={() => setMode(m)}
              className={`rounded-xl border p-3 text-left text-sm transition ${system.mode === m ? 'border-brand bg-brand/10' : 'border-line bg-card'}`}>
              <div className="font-bold">{m === 'demo' ? '🧪 Demo' : '🚀 Production'}</div>
              <div className="text-xs text-mute">{m === 'demo' ? 'Chạy trọn quy trình, đăng bài chỉ MÔ PHỎNG' : 'Đăng thật qua API; nền tảng chưa kết nối → quy trình thủ công'}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-1 text-xs text-mute">
          <span>AI: {system.llm.active ? `✅ Claude (${system.llm.model})` : '⚪ chưa có API key → nội dung dùng mẫu demo'}</span>
          <span>ffmpeg (dựng video): {system.ffmpeg ? '✅ có' : '⚠ chưa cài'}</span>
          <span>PUBLIC_BASE_URL: {system.publicBaseUrl ?? '⚠ chưa đặt (OAuth, ảnh Threads, Zalo OA cần URL công khai)'}</span>
          <span>Khóa mã hóa: {system.vaultKeySource === 'env' ? '✅ APP_SECRET' : '⚠ file cục bộ data/.master-key'}</span>
        </div>
        {isAdmin && <ModelSetting current={system.llm.model} onSaved={loadAll} />}
      </div>

      {groups.map(([cat, title]) => (
        <Section key={cat} title={title}>
          {data.integrations.filter((i) => i.category === cat).map((i) => (
            <IntegrationCard key={i.key} i={i} isAdmin={isAdmin} reload={async () => { await load(); await loadAll(); }} fbPages={i.key === 'facebook' ? data.facebookPages : []} />
          ))}
        </Section>
      ))}

      <McpServers servers={data.mcpServers} isAdmin={isAdmin} reload={load} />
      {data.oauthCallbackBase && <p className="text-xs text-mute">OAuth redirect URI cần đăng ký: <code className="break-all">{data.oauthCallbackBase}</code></p>}
    </div>
  );
}

function ModelSetting({ current, onSaved }: { current: string; onSaved: () => void }) {
  const [m, setM] = useState(current);
  const { notify } = useStore();
  return (
    <div className="flex gap-2 pt-1">
      <input className="input !py-1.5" value={m} onChange={(e) => setM(e.target.value)} aria-label="Model Claude" />
      <button className="btn-ghost shrink-0" disabled={m === current} onClick={async () => { await api.put('/api/settings', { model: m }); onSaved(); notify('ok', 'Đã đổi model'); }}>Lưu model</button>
    </div>
  );
}

function IntegrationCard({ i, isAdmin, reload, fbPages }: { i: Integration; isAdmin: boolean; reload: () => Promise<void>; fbPages: { id: string; name: string }[] }) {
  const { notify } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try { await api.put(`/api/integrations/${i.key}`, form); setForm({}); await reload(); notify('ok', 'Đã lưu (mã hóa)'); } catch (e: any) { notify('err', e.message); } finally { setBusy(false); }
  };
  const runTest = async () => {
    setBusy(true);
    try { setTest(await api.post(`/api/integrations/${i.key}/test`)); } finally { setBusy(false); }
  };
  const oauth = async () => {
    try { const r = await api.get<{ url: string }>(`/api/oauth/${i.key}/start`); window.location.href = r.url; } catch (e: any) { notify('err', e.message); }
  };
  const disconnect = async () => {
    if (!confirm(`Xóa toàn bộ thông tin xác thực ${i.name}?`)) return;
    await api.del(`/api/integrations/${i.key}`);
    await reload();
  };

  return (
    <div className="rounded-xl border border-line bg-card">
      <button className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(!open)}>
        {i.configured ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" size={18} /> : <CircleDashed className="mt-0.5 shrink-0 text-mute" size={18} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-semibold text-sm">{i.name}{i.envKey && <span className="chip bg-bg">từ biến môi trường</span>}</div>
          <div className="text-xs text-mute">{i.description}</div>
        </div>
        <span className={`chip ${i.configured ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300'}`}>{i.configured ? 'Đã cấu hình' : 'Chưa kết nối'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3 text-xs">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><div className="label mb-1">API cho phép</div><ul className="list-disc pl-4 space-y-0.5">{i.capabilities.map((c) => <li key={c}>{c}</li>)}</ul></div>
            <div><div className="label mb-1">Giới hạn</div><ul className="list-disc pl-4 space-y-0.5 text-amber-700 dark:text-amber-300">{i.limitations.map((c) => <li key={c}>{c}</li>)}</ul></div>
          </div>
          <div><span className="label">Quyền cần cấp: </span>{i.permissions.join(', ')} · <a className="text-sky-600" href={i.docs} target="_blank" rel="noreferrer">Tài liệu</a></div>
          {i.publicUrlMissing && <p className="text-amber-700 dark:text-amber-300">⚠ Cần PUBLIC_BASE_URL để nền tảng tải được ảnh.</p>}
          {isAdmin ? (
            <div className="space-y-2">
              {i.fields.map((f) => (
                <label key={f.key} className="grid gap-1">
                  <span className="font-semibold">{f.label}{f.required && ' *'}</span>
                  <input className="input !py-1.5" type={f.secret ? 'password' : 'text'} autoComplete="off"
                    placeholder={i.values[f.key]?.set ? `Đã lưu: ${i.values[f.key].preview ?? '••••'} (để trống = giữ nguyên)` : f.placeholder ?? ''}
                    value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  {f.help && <span className="text-mute">{f.help}</span>}
                </label>
              ))}
              <div className="flex flex-wrap gap-1.5">
                <button className="btn-primary" disabled={busy || !Object.values(form).some(Boolean)} onClick={save}><KeyRound size={13} /> Lưu</button>
                {i.oauth && <button className="btn-ghost" onClick={oauth}><Link2 size={13} /> Kết nối bằng OAuth</button>}
                <button className="btn-ghost" disabled={busy || !i.configured} onClick={runTest}><Plug size={13} /> Kiểm tra</button>
                {i.configured && <button className="btn-ghost text-rose-600" onClick={disconnect}><Trash2 size={13} /> Ngắt</button>}
              </div>
              {fbPages.length > 1 && (
                <label className="grid gap-1"><span className="font-semibold">Chọn Page để đăng</span>
                  <select className="input" onChange={async (e) => { await api.post('/api/integrations/facebook/page', { pageId: e.target.value }); await reload(); }} value={i.values.pageId?.preview ?? ''}>
                    {fbPages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {test && <p className={test.ok ? 'text-emerald-600' : 'text-rose-600'}>{test.ok ? '✅' : '❌'} {test.message}</p>}
            </div>
          ) : <p className="text-mute">Chỉ quản trị viên được cấu hình kết nối.</p>}
        </div>
      )}
    </div>
  );
}

function McpServers({ servers, isAdmin, reload }: { servers: Resp['mcpServers']; isAdmin: boolean; reload: () => void }) {
  const { notify } = useStore();
  const [rows, setRows] = useState(servers.map((s) => ({ name: s.name, url: s.url, token: '' })));
  const [msg, setMsg] = useState<Record<string, string>>({});
  useEffect(() => setRows(servers.map((s) => ({ name: s.name, url: s.url, token: '' }))), [servers]);
  const save = async () => {
    try { await api.put('/api/mcp-servers', rows.filter((r) => r.name && r.url)); reload(); notify('ok', 'Đã lưu MCP server'); } catch (e: any) { notify('err', e.message); }
  };
  return (
    <Section title="MCP Servers (công cụ ngoài cho Researcher)">
      <p className="text-xs text-mute">Server MCP từ xa (HTTPS) được Claude gọi trực tiếp qua MCP connector khi nghiên cứu. Cần Claude API key.</p>
      {rows.map((r, idx) => (
        <div key={idx} className="grid gap-1.5 rounded-xl border border-line bg-card p-2.5">
          <div className="flex gap-1.5">
            <input className="input !py-1.5" placeholder="ten-server" value={r.name} disabled={!isAdmin} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} />
            {isAdmin && <button className="btn-ghost !px-2" onClick={() => setRows(rows.filter((_, i) => i !== idx))} aria-label="Xóa"><Trash2 size={13} /></button>}
          </div>
          <input className="input !py-1.5" placeholder="https://mcp.example.com/mcp" value={r.url} disabled={!isAdmin} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)))} />
          {isAdmin && <input className="input !py-1.5" type="password" placeholder="Bearer token (tùy chọn, để trống = giữ)" value={r.token} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, token: e.target.value } : x)))} />}
          {isAdmin && servers.some((s) => s.name === r.name) && (
            <button className="btn-ghost justify-self-start !py-1" onClick={async () => { const t = await api.post<{ ok: boolean; message: string }>(`/api/mcp-servers/${r.name}/test`); setMsg({ ...msg, [r.name]: (t.ok ? '✅ ' : '❌ ') + t.message }); }}>Kiểm tra</button>
          )}
          {msg[r.name] && <p className="text-xs">{msg[r.name]}</p>}
        </div>
      ))}
      {isAdmin && (
        <div className="flex gap-1.5">
          <button className="btn-ghost" onClick={() => setRows([...rows, { name: '', url: '', token: '' }])}><Plus size={13} /> Thêm</button>
          <button className="btn-primary" onClick={save}>Lưu MCP</button>
        </div>
      )}
    </Section>
  );
}
