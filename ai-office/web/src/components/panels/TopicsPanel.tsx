import { useEffect, useState } from 'react';
import { ExternalLink, ImagePlus, RefreshCw, Sparkles } from 'lucide-react';
import { api, fmtTime, mediaUrl, STORY_STATUS, VERIFY_META, type Story } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Empty, Section } from '../ui';

function VerifyBadge({ v }: { v: Story['verification'] }) {
  const [l, c] = VERIFY_META[v];
  return <span className={`chip ${c}`}>{l}</span>;
}

export function StoryCard({ s, checked, onToggle, canSelect, campaignId }: { s: Story; checked?: boolean; onToggle?: () => void; canSelect?: boolean; campaignId?: string }) {
  const [open, setOpen] = useState(false);
  const { detail } = useStore();
  const photo = detail?.assets.find((a) => a.role === 'source' && a.meta?.storyId === s.id);
  return (
    <div className={`rounded-xl border p-3 text-sm transition ${checked ? 'border-brand ring-2 ring-brand/20 bg-brand/5' : 'border-line bg-card'}`}>
      <div className="flex items-start gap-2.5">
        {onToggle && <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]" checked={!!checked} disabled={!canSelect} onChange={onToggle} aria-label="Chọn chủ đề" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <VerifyBadge v={s.verification} />
            <span className="chip bg-bg text-mute" title="Điểm hấp dẫn — không phải độ tin cậy">🔥 {s.appealScore}/10</span>
            <span className="chip bg-bg text-mute">{s.angle}</span>
            {s.status !== 'proposed' && <span className="chip bg-bg text-mute">{STORY_STATUS[s.status]}</span>}
          </div>
          <button className="mt-1.5 text-left font-bold leading-snug hover:text-brand" onClick={() => setOpen(!open)}>{s.title}</button>
          <p className="mt-1 text-[13px] text-mute">{s.summary}</p>
          <p className="mt-1 text-[11px] text-mute">🕒 {s.when} · 📍 {s.where}{s.category ? ` · ${s.category}` : ''}</p>
          {s.checkNote && <p className="mt-1 text-[12px] italic">{s.checkNote}</p>}
          {open && (
            <div className="mt-2 space-y-2 text-[12px]">
              <p><b>Vì sao thu hút:</b> {s.appealReasons}</p>
              <List title="✅ Đã xác nhận" items={s.confirmedFacts} />
              <List title="🗣 Lời kể / chưa kiểm chứng" items={s.unverifiedClaims} />
              <List title="❓ Giả thuyết (chưa có kết luận)" items={s.hypotheses} />
              <List title="⚠ Rủi ro" items={s.risks} />
              {s.mediaNotes && <p><b>Hình ảnh:</b> {s.mediaNotes}</p>}
            </div>
          )}
          {s.sources.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {s.sources.map((x) => (
                <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-[12px] text-sky-600 dark:text-sky-400 break-all"><ExternalLink size={11} className="mt-0.5 shrink-0" />{x.title || x.url}{x.type ? ` (${x.type})` : ''}</a></li>
              ))}
            </ul>
          )}
          {campaignId && s.status !== 'rejected' && <PhotoUpload storyId={s.id} campaignId={campaignId} hasPhoto={!!photo} photoId={photo?.id} />}
        </div>
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><b>{title}</b><ul className="list-disc pl-4">{items.map((x) => <li key={x}>{x}</li>)}</ul></div>;
}

function PhotoUpload({ storyId, campaignId, hasPhoto, photoId }: { storyId: string; campaignId: string; hasPhoto: boolean; photoId?: string }) {
  const { notify, refreshDetail, user } = useStore();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [ok, setOk] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  if (user?.role === 'viewer') return null;
  const up = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('campaignId', campaignId);
    fd.append('storyId', storyId);
    fd.append('role', 'source');
    fd.append('source', source);
    fd.append('license', 'Ảnh có nguồn — đã kiểm tra quyền sử dụng');
    fd.append('rightsConfirmed', String(ok));
    fd.append('file', file);
    try { await api.upload('/api/assets/upload', fd); notify('ok', 'Đã gắn ảnh cho chủ đề'); setOpen(false); await refreshDetail(); } catch (e: any) { notify('err', e.message); }
  };
  return (
    <div className="mt-2">
      {hasPhoto && photoId && <img src={mediaUrl(photoId)} alt="" className="mb-1.5 h-16 rounded-lg" />}
      {!open ? (
        <button className="inline-flex items-center gap-1 text-[12px] text-mute hover:text-ink" onClick={() => setOpen(true)}><ImagePlus size={13} /> {hasPhoto ? 'Đổi ảnh có nguồn' : 'Thêm ảnh thật có nguồn (tùy chọn)'}</button>
      ) : (
        <div className="space-y-1.5 rounded-lg bg-bg p-2">
          <input className="input !py-1.5" placeholder="Nguồn ảnh (vd: Reuters / NASA / Ảnh: Nguyễn Văn A)" value={source} onChange={(e) => setSource(e.target.value)} />
          <input type="file" accept="image/*" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <label className="flex items-start gap-1.5 text-[11px]"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />Ảnh đúng sự kiện và tôi có quyền sử dụng.</label>
          <button className="btn-primary !py-1" disabled={!file || !ok || source.length < 2} onClick={up}>Tải lên</button>
        </div>
      )}
    </div>
  );
}

export function TopicsPanel() {
  const { detail, user, notify, refreshDetail, campaigns, selectCampaign } = useStore();
  const [picked, setPicked] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [view, setView] = useState<'campaign' | 'history'>('campaign');
  const [history, setHistory] = useState<Story[]>([]);
  const canEdit = user?.role !== 'viewer';

  useEffect(() => { setPicked([]); }, [detail?.campaign.id]);
  useEffect(() => { if (view === 'history') api.get<Story[]>('/api/stories').then(setHistory).catch(() => {}); }, [view, campaigns]);

  const waitingSelect = detail?.campaign.status === 'awaiting_approval' && detail.tasks.some((t) => t.stepKey === 'select' && t.status === 'awaiting_approval');
  const ss = detail?.stories ?? [];
  const proposed = ss.filter((s) => s.status === 'proposed');
  const chosen = ss.filter((s) => s.status === 'selected' || s.status === 'published');
  const held = ss.filter((s) => s.status === 'held' || s.status === 'candidate');
  const rejected = ss.filter((s) => s.status === 'rejected');

  const submit = async () => {
    try { await api.post(`/api/campaigns/${detail!.campaign.id}/select`, { storyIds: picked }); notify('ok', `Đã giao ${picked.length} chủ đề cho Biên tập viên`); await refreshDetail(); } catch (e: any) { notify('err', e.message); }
  };
  const again = async () => {
    try { await api.post(`/api/campaigns/${detail!.campaign.id}/reject`, { feedback }); setFeedback(''); notify('ok', 'Phóng viên đang săn lại'); await refreshDetail(); } catch (e: any) { notify('err', e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-card p-1 text-xs font-semibold">
        <button className={`flex-1 rounded-lg py-1.5 ${view === 'campaign' ? 'bg-panel shadow-soft' : 'text-mute'}`} onClick={() => setView('campaign')}>Phiên đang xem</button>
        <button className={`flex-1 rounded-lg py-1.5 ${view === 'history' ? 'bg-panel shadow-soft' : 'text-mute'}`} onClick={() => setView('history')}>Kho chủ đề (chống trùng)</button>
      </div>

      {view === 'history' ? (
        <Section title={`Tất cả chủ đề đã đề xuất (${history.length})`}>
          <p className="text-xs text-mute">Phóng viên tự bỏ qua những chủ đề trùng với danh sách này ở các phiên săn tin sau.</p>
          {!history.length && <Empty>Chưa có chủ đề nào.</Empty>}
          {history.map((s) => (
            <button key={s.id} onClick={() => { setView('campaign'); void selectCampaign(s.campaignId); }} className="block w-full rounded-xl border border-line bg-card p-2.5 text-left text-sm">
              <div className="flex flex-wrap items-center gap-1.5"><VerifyBadge v={s.verification} /><span className="chip bg-bg text-mute">{STORY_STATUS[s.status]}</span><span className="text-[11px] text-mute">{fmtTime(s.createdAt)}</span></div>
              <div className="mt-1 font-semibold">{s.title}</div>
            </button>
          ))}
        </Section>
      ) : !detail ? <Empty>Chọn hoặc tạo một phiên săn tin ở tab Chiến dịch.</Empty> : !ss.length ? (
        <Empty>{detail.campaign.status === 'running' ? 'Phóng viên đang săn tin…' : 'Phiên này chưa có chủ đề.'}</Empty>
      ) : (
        <>
          {waitingSelect && (
            <div className="card !p-3 space-y-1">
              <div className="flex items-center gap-2 font-bold"><Sparkles size={16} className="text-amber-500" /> Chọn chủ đề để viết bài</div>
              <p className="text-xs text-mute">Chỉ chủ đề đã qua kiểm chứng mới chọn được. Bấm tiêu đề để xem chi tiết kiểm chứng.</p>
            </div>
          )}
          {chosen.length > 0 && <Section title={`Đã chọn (${chosen.length})`}>{chosen.map((s) => <StoryCard key={s.id} s={s} campaignId={detail.campaign.id} />)}</Section>}
          <Section title={`Đề xuất (${proposed.length})`}>
            {!proposed.length && <Empty>Không có chủ đề nào đạt kiểm chứng.</Empty>}
            {proposed.map((s) => (
              <StoryCard key={s.id} s={s} campaignId={detail.campaign.id} checked={picked.includes(s.id)} canSelect={canEdit && waitingSelect}
                onToggle={waitingSelect ? () => setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id]) : undefined} />
            ))}
          </Section>
          {held.length > 0 && <Section title={`⏸ Chờ kiểm chứng (${held.length})`}><p className="text-xs text-mute">Chưa đủ bằng chứng → không phát triển thành bài.</p>{held.map((s) => <StoryCard key={s.id} s={s} />)}</Section>}
          {rejected.length > 0 && (
            <details><summary className="cursor-pointer text-sm font-bold">⛔ Đã loại ({rejected.length})</summary><div className="mt-2 space-y-2">{rejected.map((s) => <StoryCard key={s.id} s={s} />)}</div></details>
          )}
          {waitingSelect && canEdit && (
            <div className="card sticky bottom-0 space-y-2 !p-3 shadow-soft">
              <button className="btn-primary w-full" disabled={!picked.length} onClick={submit}>✍️ Phát triển {picked.length || ''} chủ đề thành bài</button>
              <div className="flex gap-2">
                <input className="input" placeholder="Góp ý để săn lại (vd: thêm chuyện khảo cổ, bớt tin công nghệ)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                <button className="btn-ghost shrink-0" disabled={feedback.length < 3} onClick={again}><RefreshCw size={14} /> Săn lại</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
