import { useEffect, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { api, mediaUrl, type Asset } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Empty, Section } from '../ui';

export function AssetsPanel() {
  const { detail, notify, user, refreshDetail } = useStore();
  const [library, setLibrary] = useState<Asset[]>([]);
  const [scope, setScope] = useState<'campaign' | 'library'>(detail ? 'campaign' : 'library');
  const [role, setRole] = useState<'source' | 'logo'>('source');
  const [license, setLicense] = useState('');
  const [source, setSource] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = user?.role !== 'viewer';

  const loadLib = () => api.get<Asset[]>('/api/assets?library=1').then(setLibrary).catch(() => {});
  useEffect(() => { void loadLib(); }, []);

  const upload = async () => {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    // text fields must come before files for the streaming parser
    if (scope === 'campaign' && detail) fd.append('campaignId', detail.campaign.id);
    fd.append('role', role);
    fd.append('license', license);
    fd.append('source', source || 'Người dùng tải lên');
    fd.append('rightsConfirmed', String(confirmed));
    for (const f of Array.from(files)) fd.append('file', f);
    try {
      const r = await api.upload<Asset[]>('/api/assets/upload', fd);
      notify('ok', `Đã tải ${r.length} tệp`);
      setFiles(null);
      await loadLib();
      await refreshDetail();
    } catch (e: any) { notify('err', e.message); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!confirm('Xóa tư liệu này?')) return;
    try { await api.del(`/api/assets/${id}`); await loadLib(); await refreshDetail(); } catch (e: any) { notify('err', e.message); }
  };

  const campaignAssets = detail?.assets ?? [];
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="card space-y-2.5">
          <h3 className="font-bold">Tải tư liệu lên</h3>
          <p className="text-xs text-mute">Ảnh/video từ nhóm Zalo: Zalo không có API đọc nhóm — hãy lưu tệp từ Zalo về máy rồi tải lên tại đây (ghi nguồn "Nhóm Zalo …").</p>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="library">Thư viện chung</option>
              <option value="campaign" disabled={!detail}>Chiến dịch đang chọn</option>
            </select>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="source">Ảnh/video sản phẩm</option>
              <option value="logo">Logo thương hiệu</option>
            </select>
          </div>
          <input className="input" placeholder="Nguồn (vd: Nhóm Zalo Kho hàng, chụp tại xưởng…)" value={source} onChange={(e) => setSource(e.target.value)} />
          <input className="input" placeholder="Giấy phép / quyền sử dụng (vd: Ảnh tự chụp)" value={license} onChange={(e) => setLicense(e.target.value)} />
          <input type="file" multiple accept="image/*,video/*,audio/*" className="text-sm" onChange={(e) => setFiles(e.target.files)} />
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />Tôi xác nhận có quyền sử dụng các tệp này cho mục đích quảng cáo.</label>
          <button className="btn-primary w-full" disabled={busy || !files?.length || !confirmed} onClick={upload}><Upload size={15} /> {busy ? 'Đang tải…' : 'Tải lên'}</button>
        </div>
      )}
      {detail && (
        <Section title={`Tư liệu chiến dịch (${campaignAssets.length})`}>
          {!campaignAssets.length ? <Empty>Chưa có — Asset Collector sẽ dùng thư viện chung.</Empty> : <Grid items={campaignAssets} onRemove={canEdit ? remove : undefined} />}
        </Section>
      )}
      <Section title={`Thư viện chung (${library.length})`}>
        {!library.length ? <Empty>Thư viện trống.</Empty> : <Grid items={library} onRemove={canEdit ? remove : undefined} />}
      </Section>
    </div>
  );
}

const ROLE: Record<string, string> = { source: 'Gốc', edited: 'Đã chỉnh', logo: 'Logo', report: 'Báo cáo' };

function Grid({ items, onRemove }: { items: Asset[]; onRemove?: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((a) => (
        <figure key={a.id} className="group relative overflow-hidden rounded-xl border border-line bg-card">
          {a.kind === 'image' ? <img src={mediaUrl(a.id)} alt={a.label} loading="lazy" className="aspect-square w-full object-cover" />
            : a.kind === 'video' ? <video src={mediaUrl(a.id)} className="aspect-square w-full object-cover bg-black" controls muted playsInline />
              : <a href={`${mediaUrl(a.id)}?download=1`} className="grid aspect-square place-items-center text-3xl">{a.mime.includes('pdf') ? '📄' : a.mime.includes('sheet') ? '📊' : '📁'}</a>}
          <figcaption className="p-1.5 text-[10px] leading-tight">
            <div className="font-semibold truncate" title={a.label}>{a.label}</div>
            <div className="text-mute truncate" title={a.license}>{ROLE[a.role] ?? a.role} · {a.license}</div>
          </figcaption>
          {onRemove && a.role !== 'report' && (
            <button className="absolute right-1 top-1 hidden group-hover:grid place-items-center rounded-lg bg-black/60 p-1 text-white" onClick={() => onRemove(a.id)} aria-label="Xóa"><Trash2 size={12} /></button>
          )}
        </figure>
      ))}
    </div>
  );
}
