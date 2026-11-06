import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Send, Undo2 } from 'lucide-react';
import { api, mediaUrl, PLATFORM_META, VERIFY_META, type Asset, type Content, type Platform } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Empty, KindBadge } from '../ui';

const FORMAT_FOR: Record<Platform, string> = { facebook: 'portrait', threads: 'portrait', zalo: 'landscape', tiktok: 'vertical' };
type Key = string; // `${storyId}:${platform}`

export function ApprovalPanel() {
  const { detail, campaigns, selectCampaign, notify, refreshDetail, user, setTab } = useStore();
  const [pick, setPick] = useState<Record<Key, string | null>>({});
  const [media, setMedia] = useState<Record<Key, string[]>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = user?.role !== 'viewer';

  const c = detail?.campaign;
  const gate = detail?.tasks.find((t) => t.type === 'approval' && t.status === 'awaiting_approval');
  const groups = useMemo(() => {
    const g = new Map<Key, Content[]>();
    for (const x of detail?.contents ?? []) {
      const k = `${x.storyId}:${x.platform}`;
      g.set(k, [...(g.get(k) ?? []), x]);
    }
    return g;
  }, [detail?.contents]);
  const edited = (detail?.assets ?? []).filter((a) => a.role === 'edited');
  const mediaOf = (storyId: string | null, p: Platform) => edited.filter((a) => a.meta?.storyId === storyId && ((a.kind === 'image' && a.meta?.format === FORMAT_FOR[p]) || (p === 'tiktok' && a.kind === 'video')));

  useEffect(() => {
    const p: typeof pick = {};
    const m: typeof media = {};
    for (const [k, list] of groups) {
      p[k] = list[0].id;
      const [sid, plat] = k.split(':') as [string, Platform];
      m[k] = mediaOf(sid, plat).slice(0, plat === 'tiktok' ? 2 : 1).map((a) => a.id);
    }
    setPick(p);
    setMedia(m);
  }, [detail?.campaign.id, detail?.contents.length]);

  const waiting = campaigns.filter((x) => x.status === 'awaiting_approval');
  if (!c || !gate) {
    return (
      <div className="space-y-3">
        <Empty>{waiting.length ? 'Chọn phiên đang chờ anh:' : 'Không có gì đang chờ duyệt.'}</Empty>
        {waiting.map((w) => <button key={w.id} className="btn-ghost w-full justify-between" onClick={() => selectCampaign(w.id)}>{w.title}<span>→</span></button>)}
      </div>
    );
  }
  if (gate.stepKey === 'select') {
    return (
      <div className="card space-y-2">
        <p className="text-sm">Phiên <b>{c.title}</b> đang chờ anh <b>chọn chủ đề</b>.</p>
        <button className="btn-primary" onClick={() => setTab('topics')}>Mở danh sách chủ đề →</button>
      </div>
    );
  }

  const storyOf = (sid: string) => detail!.stories.find((s) => s.id === sid);
  const chosenIds = Object.values(pick).filter(Boolean) as string[];
  const approve = async () => {
    setBusy(true);
    const mediaByContent: Record<string, string[]> = {};
    for (const [k, id] of Object.entries(pick)) if (id) mediaByContent[id] = media[k] ?? [];
    try {
      await api.post(`/api/campaigns/${c.id}/approve`, { contentIds: chosenIds, media: mediaByContent });
      notify('ok', `Đã duyệt ${chosenIds.length} bài — bắt đầu xuất bản`);
      await refreshDetail();
    } catch (e: any) { notify('err', e.message); } finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true);
    try { await api.post(`/api/campaigns/${c.id}/reject`, { feedback }); setFeedback(''); notify('ok', 'Đã gửi góp ý cho Biên tập viên'); await refreshDetail(); } catch (e: any) { notify('err', e.message); } finally { setBusy(false); }
  };

  const byStory = new Map<string, Key[]>();
  for (const k of groups.keys()) { const sid = k.split(':')[0]; byStory.set(sid, [...(byStory.get(sid) ?? []), k]); }

  return (
    <div className="space-y-5">
      <div className="card !p-3">
        <div className="font-bold">{c.title}</div>
        <p className="text-xs text-mute">Mỗi chủ đề: chọn 1 phương án và ảnh (hoặc "Không đăng"), sửa chữ nếu cần, rồi bấm Duyệt.</p>
      </div>
      {[...byStory.entries()].map(([sid, keys]) => {
        const st = storyOf(sid);
        return (
          <section key={sid} className="space-y-2">
            {st && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`chip ${VERIFY_META[st.verification][1]}`}>{VERIFY_META[st.verification][0]}</span>
                <h3 className="font-bold leading-snug">{st.title}</h3>
              </div>
            )}
            {keys.map((k) => {
              const plat = k.split(':')[1] as Platform;
              const list = groups.get(k)!;
              const meta = PLATFORM_META[plat];
              const opts = mediaOf(sid, plat);
              return (
                <div key={k} className="space-y-2 rounded-2xl border border-line p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded-md text-white text-xs" style={{ background: meta.color }}>{meta.emoji}</span>{meta.label}</span>
                    <label className="flex items-center gap-1 text-xs text-mute"><input type="radio" checked={pick[k] === null} onChange={() => setPick({ ...pick, [k]: null })} /> Không đăng</label>
                  </div>
                  {list.map((v) => (
                    <Variant key={v.id} v={v} active={pick[k] === v.id} editing={editing === v.id} canEdit={canEdit}
                      image={opts.find((m) => media[k]?.includes(m.id) && m.kind === 'image') ?? null}
                      onPick={() => setPick({ ...pick, [k]: v.id })} onEdit={() => setEditing(editing === v.id ? null : v.id)}
                      onSaved={async () => { setEditing(null); await refreshDetail(); }} />
                  ))}
                  {opts.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {opts.map((m) => {
                        const on = media[k]?.includes(m.id);
                        return (
                          <button key={m.id} className={`relative shrink-0 overflow-hidden rounded-lg border-2 ${on ? 'border-brand' : 'border-transparent opacity-60'}`}
                            onClick={() => { const others = (media[k] ?? []).filter((id) => edited.find((e) => e.id === id)?.kind !== m.kind); setMedia({ ...media, [k]: on ? others : [...others, m.id] }); }}>
                            {m.kind === 'video' ? <video src={mediaUrl(m.id)} className="h-28 w-auto" muted playsInline /> : <img src={mediaUrl(m.id)} alt={m.label} className="h-28 w-auto" loading="lazy" />}
                            {on && <span className="absolute right-1 top-1 rounded-full bg-brand p-0.5 text-white"><Check size={12} /></span>}
                            {m.meta?.illustration && <span className="absolute bottom-1 left-1 chip bg-black/60 text-white">Minh họa</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {canEdit && (
        <div className="card sticky bottom-0 space-y-2 !p-3 shadow-soft">
          <button className="btn-primary w-full" disabled={busy || !chosenIds.length} onClick={approve}><Send size={15} /> Duyệt & cho phép đăng {chosenIds.length} bài</button>
          <div className="flex gap-2">
            <input className="input" placeholder="Góp ý để viết lại (vd: hook mạnh hơn, ngắn gọn hơn)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
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
    try { await api.patch(`/api/contents/${v.id}`, { title, body, hashtags: tags.split(/\s+/).filter(Boolean) }); onSaved(); } catch (e: any) { notify('err', e.message); }
  };
  return (
    <div className={`rounded-xl border p-3 transition ${active ? 'border-brand ring-2 ring-brand/20 bg-brand/5' : 'border-line bg-card'}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="radio" checked={active} onChange={onPick} className="accent-[rgb(var(--brand))]" /> Phương án {v.variant}
          <KindBadge kind={v.resultKind} />
        </label>
        {canEdit && <button className="btn-ghost !px-2 !py-1" onClick={onEdit} aria-label="Sửa"><Pencil size={13} /></button>}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input min-h-[200px]" value={body} onChange={(e) => setBody(e.target.value)} />
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
          {active && image && <img src={mediaUrl(image.id)} alt="" className="h-24 w-20 shrink-0 rounded-lg object-cover" />}
        </div>
      )}
    </div>
  );
}
