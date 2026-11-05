import { useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, FileSpreadsheet, FileText } from 'lucide-react';
import { api, mediaUrl, PLATFORM_META, STATUS_LABEL, type Publication } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Empty, Section, StatusBadge } from '../ui';

interface Overview { campaigns: number; byStatus: Record<string, number>; byPlatform: Record<string, Record<string, number>>; publications: number }

export function ReportsPanel() {
  const { detail, notify, refreshDetail, user, campaigns } = useStore();
  const [ov, setOv] = useState<Overview | null>(null);
  useEffect(() => { api.get<Overview>('/api/reports/overview').then(setOv).catch(() => {}); }, [campaigns]);

  return (
    <div className="space-y-4">
      {ov && (
        <Section title="Tổng quan hệ thống">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Chiến dịch" value={ov.campaigns} />
            <Stat label="Hoàn tất" value={(ov.byStatus.completed ?? 0) + (ov.byStatus.completed_with_errors ?? 0)} />
            <Stat label="Bài đăng" value={ov.publications} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(ov.byPlatform).map(([p, s]) => (
              <div key={p} className="rounded-xl border border-line bg-card p-2.5 text-xs">
                <div className="font-semibold mb-1">{PLATFORM_META[p as keyof typeof PLATFORM_META]?.emoji} {PLATFORM_META[p as keyof typeof PLATFORM_META]?.label ?? p}</div>
                {Object.entries(s).map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-mute">{STATUS_LABEL[k] ?? k}</span><b>{v}</b></div>)}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!detail ? <Empty>Chọn một chiến dịch để xem báo cáo.</Empty> : (
        <Section title={`Báo cáo: ${detail.campaign.title}`} right={
          <div className="flex gap-1.5">
            <a className="btn-ghost !px-2 !py-1" href={`/api/reports/${detail.campaign.id}.xlsx`}><FileSpreadsheet size={14} /> Excel</a>
            <a className="btn-ghost !px-2 !py-1" href={`/api/reports/${detail.campaign.id}.pdf`}><FileText size={14} /> PDF</a>
          </div>
        }>
          {detail.campaign.mode === 'demo' && <p className="text-xs text-fuchsia-600 dark:text-fuchsia-300">Bài "Mô phỏng" chưa được đăng thật — không có link và số liệu.</p>}
          {!detail.publications.length && <Empty>Chưa có bài đăng nào cho chiến dịch này.</Empty>}
          <div className="space-y-2">
            {detail.publications.map((p) => (
              <PubCard key={p.id} p={p} canEdit={user?.role !== 'viewer'} content={detail.contents.find((c) => c.id === p.contentId)} onChange={refreshDetail} notify={notify} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-line bg-card p-3 text-center"><div className="text-2xl font-extrabold">{value}</div><div className="text-[11px] text-mute">{label}</div></div>;
}

function PubCard({ p, content, canEdit, onChange, notify }: { p: Publication; content?: { title: string; body: string; hashtags: string[] }; canEdit: boolean; onChange: () => void; notify: (k: 'ok' | 'err', t: string) => void }) {
  const [url, setUrl] = useState('');
  const meta = PLATFORM_META[p.platform];
  const mediaIds = Object.values(p.response?.media ?? {}).filter(Boolean) as string[];
  const text = content ? `${content.body}\n\n${content.hashtags.join(' ')}` : '';
  const done = async () => {
    try { await api.post(`/api/publications/${p.id}/manual-done`, { url }); onChange(); notify('ok', 'Đã ghi nhận link bài đăng'); } catch (e: any) { notify('err', e.message); }
  };
  return (
    <div className="rounded-xl border border-line bg-card p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{meta.emoji} {meta.label}</span>
        <StatusBadge status={p.status} />
      </div>
      {content && <div className="text-xs text-mute line-clamp-2">{content.title}</div>}
      {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-600 break-all"><ExternalLink size={12} /> {p.url}</a>}
      {p.metrics && <div className="flex flex-wrap gap-1.5">{Object.entries(p.metrics).map(([k, v]) => <span key={k} className="chip bg-bg">{k}: <b>{v}</b></span>)}</div>}
      {p.error && <p className="text-xs text-rose-600 break-words">{p.error}</p>}
      {(p.status === 'manual_pending' || (p.status === 'failed' && p.mode === 'real')) && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 p-2.5 space-y-2">
          <p className="text-xs">{p.response?.reason ?? 'Đăng tự động lỗi.'} Gói đăng thủ công:</p>
          <div className="flex flex-wrap gap-1.5">
            {text && <button className="btn-ghost !px-2 !py-1" onClick={() => navigator.clipboard.writeText(text).then(() => notify('ok', 'Đã copy caption'))}><Copy size={13} /> Copy caption</button>}
            {mediaIds.map((id) => <a key={id} className="btn-ghost !px-2 !py-1" href={`${mediaUrl(id)}?download=1`}><Download size={13} /> Tải media</a>)}
          </div>
          {canEdit && (
            <div className="flex gap-1.5">
              <input className="input !py-1.5" placeholder="Dán link bài đã đăng…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="btn-primary shrink-0" disabled={!url} onClick={done}>Xác nhận</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
