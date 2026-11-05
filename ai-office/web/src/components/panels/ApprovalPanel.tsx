import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Send, Undo2 } from 'lucide-react';
import { api, mediaUrl, PLATFORM_META, type Asset, type Content, type Platform } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Empty, KindBadge } from '../ui';

const FORMAT_FOR: Record<Platform, string> = { facebook: 'square', zalo: 'landscape', threads: 'portrait', tiktok: 'vertical' };

export function ApprovalPanel() {
  const { detail, campaigns, selectCampaign, notify, refreshDetail, user } = useStore();
  const waiting = campaigns.filter((c) => c.status === 'awaiting_approval');
  const [sel, setSel] = useState<Partial<Record<Platform, { contentId: string; mediaIds: string[] }>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = user?.role !== 'viewer';

  const c = detail?.campaign;
  const isWaiting = c?.status === 'awaiting_approval';
  const byPlatform = useMemo(() => {
    const m: Partial<Record<Platform, Content[]>> = {};
    for (const x of detail?.contents ?? []) (m[x.platform] ??= []).push(x);
    return m;
  }, [detail?.contents]);
  const edited = (detail?.assets ?? []).filter((a) => a.role === 'edited');

  useEffect(() => {
    // default: first variant + matching media
    const s: typeof sel = {};
    for (const [p, list] of Object.entries(byPlatform) as [Platform, Content[]][]) {
      const img = edited.find((a) => a.kind === 'image' && a.meta?.format === FORMAT_FOR[p]);
      const vid = p === 'tiktok' ? edited.find((a) => a.kind === 'video') : undefined;
      s[p] = { contentId: list[0].id, mediaIds: [img?.id, vid?.id].filter(Boolean) as string[] };
    }
    setSel(s);
  }, [detail?.campaign.id, detail?.contents.length]);

  if (!c || !isWaiting) {
    return (
      <div className="space-y-3">
        <Empty>{waiting.length ? 'Chọn chiến dịch đang chờ duyệt:' : 'Không có nội dung nào đang chờ duyệt.'}</Empty>
        {waiting.map((w) => <button key={w.id} className="btn-ghost w-full justify-between" onClick={() => selectCampaign(w.id)}>{w.title}<span>→</span></button>)}
      </div>
    );
  }

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/api/campaigns/${c.id}/approve`, { selections: sel });
      notify('ok', 'Đã duyệt — các Publisher bắt đầu xuất bản');
      await refreshDetail();
    } catch (e: any) { notify('err', e.message); } finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true);
    try {
      await api.post(`/api/campaigns/${c.id}/reject`, { feedback });
      setFeedback('');
      notify('ok', 'Đã gửi góp ý cho Content Writer');
      await refreshDetail();
    } catch (e: any) { notify('err', e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card !p-3">
        <div className="font-bold">{c.title}</div>
        <p className="text-xs text-mute">Chọn 1 phương án + hình cho mỗi nền tảng, sửa chữ nếu cần, rồi bấm Duyệt.</p>
      </div>
      {(Object.entries(byPlatform) as [Platform, Content[]][]).map(([p, list]) => {
        const meta = PLATFORM_META[p];
        const chosen = sel[p];
        const media = edited.filter((a) => (a.kind === 'image' && a.meta?.format === FORMAT_FOR[p]) || (p === 'tiktok' && a.kind === 'video'));
        return (
          <section key={p} className="space-y-2">
            <h3 className="flex items-center gap-2 font-bold"><span className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: meta.color }}>{meta.emoji}</span>{meta.label}</h3>
            <div className="grid gap-2">
              {list.map((v) => (
                <Variant key={v.id} v={v} active={chosen?.contentId === v.id} editing={editing === v.id} canEdit={canEdit}
                  image={media.find((m) => chosen?.mediaIds.includes(m.id) && m.kind === 'image') ?? null}
                  onPick={() => setSel({ ...sel, [p]: { contentId: v.id, mediaIds: chosen?.mediaIds ?? [] } })}
                  onEdit={() => setEditing(editing === v.id ? null : v.id)}
                  onSaved={async () => { setEditing(null); await refreshDetail(); }} />
              ))}
            </div>
            {media.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {media.map((m) => {
                  const on = chosen?.mediaIds.includes(m.id);
                  return (
                    <button key={m.id} className={`relative shrink-0 rounded-lg border-2 overflow-hidden ${on ? 'border-brand' : 'border-transparent opacity-70'}`}
                      onClick={() => {
                        const others = (chosen?.mediaIds ?? []).filter((id) => edited.find((e) => e.id === id)?.kind !== m.kind);
                        setSel({ ...sel, [p]: { contentId: chosen!.contentId, mediaIds: on ? others : [...others, m.id] } });
                      }}>
                      {m.kind === 'video'
                        ? <video src={mediaUrl(m.id)} className="h-24 w-auto" muted playsInline controls={false} onMouseOver={(e) => e.currentTarget.play()} onMouseOut={(e) => e.currentTarget.pause()} />
                        : <img src={mediaUrl(m.id)} alt={m.label} className="h-24 w-auto" loading="lazy" />}
                      {on && <span className="absolute right-1 top-1 rounded-full bg-brand p-0.5 text-white"><Check size={12} /></span>}
                      {m.kind === 'video' && <span className="absolute left-1 bottom-1 chip bg-black/60 text-white">Video</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {canEdit && (
        <div className="card sticky bottom-0 space-y-2 !p-3 shadow-soft">
          <button className="btn-primary w-full" disabled={busy} onClick={approve}><Send size={15} /> Duyệt & cho phép xuất bản</button>
          <div className="flex gap-2">
            <input className="input" placeholder="Góp ý để viết lại (vd: thêm hotline, giọng trẻ hơn)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <button className="btn-ghost shrink-0" disabled={busy || feedback.length < 3} onClick={reject}><Undo2 size={14} /> Viết lại</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Variant({ v, active, editing, canEdit, image, onPick, onEdit, onSaved }: {
  v: Content; active: boolean; editing: boolean; canEdit: boolean; image: Asset | null; onPick: () => void; onEdit: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(v.title);
  const [body, setBody] = useState(v.body);
  const [tags, setTags] = useState(v.hashtags.join(' '));
  const { notify } = useStore();
  useEffect(() => { setTitle(v.title); setBody(v.body); setTags(v.hashtags.join(' ')); }, [v.id, v.body, v.title]);
  const save = async () => {
    try {
      await api.patch(`/api/contents/${v.id}`, { title, body, hashtags: tags.split(/\s+/).filter(Boolean) });
      onSaved();
    } catch (e: any) { notify('err', e.message); }
  };
  return (
    <div className={`rounded-xl border p-3 transition ${active ? 'border-brand ring-2 ring-brand/20 bg-brand/5' : 'border-line bg-card'}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
          <input type="radio" checked={active} onChange={onPick} className="accent-[rgb(var(--brand))]" /> Phương án {v.variant}
          <KindBadge kind={v.resultKind} />
        </label>
        {canEdit && <button className="btn-ghost !px-2 !py-1" onClick={onEdit} aria-label="Sửa"><Pencil size={13} /></button>}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input min-h-[120px]" value={body} onChange={(e) => setBody(e.target.value)} />
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#hashtag" />
          <div className="text-right text-[11px] text-mute">{body.length} ký tự</div>
          <button className="btn-primary" onClick={save}>Lưu</button>
        </div>
      ) : (
        <div className="mt-2 flex gap-3" onClick={onPick}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{v.title}</div>
            <p className="mt-1 whitespace-pre-line text-[13px] leading-snug">{v.body}</p>
            <p className="mt-1 text-[12px] text-sky-600 dark:text-sky-400">{v.hashtags.join(' ')}</p>
          </div>
          {active && image && <img src={mediaUrl(image.id)} alt="" className="h-20 w-20 rounded-lg object-cover shrink-0" />}
        </div>
      )}
    </div>
  );
}
