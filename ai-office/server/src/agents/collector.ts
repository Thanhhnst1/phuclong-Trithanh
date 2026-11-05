import type { AgentImpl } from './types.js';
import { assets } from '../db/index.js';
import { FatalError, type Asset } from '../core/types.js';
import { fold } from '../core/util.js';
import { hamming, storeAsset } from '../media/index.js';
import { isConfigured } from '../integrations/registry.js';
import { listDriveMedia, downloadDriveFile } from '../integrations/gdrive.js';
import { pexelsSearch } from '../integrations/research.js';

export interface CollectOutput {
  selected: string[];
  duplicates: { assetId: string; duplicateOf: string; distance: number }[];
  bySource: Record<string, number>;
  licenseWarnings: string[];
}

const MAX_SELECTED = 4;

export const collector: AgentImpl = {
  async run(ctx) {
    const plan = ctx.campaign.plan!;
    const cid = ctx.campaign.id;
    ctx.progress(0.1, 'Đang kiểm tra tư liệu đã tải lên...');

    // 1) Google Drive (copy into the campaign so they are tracked with source + license)
    if (isConfigured('gdrive')) {
      ctx.progress(0.2, 'Đang lấy ảnh từ Google Drive...');
      try {
        const files = (await listDriveMedia(ctx.signal)).filter((f) => f.mimeType.startsWith('image/')).slice(0, 10);
        const existing = new Set(assets.list({ campaignId: cid }).map((a) => a.meta?.driveId));
        for (const f of files) {
          if (existing.has(f.id)) continue;
          const buf = await downloadDriveFile(f.id, ctx.signal);
          await storeAsset({ buffer: buf, filename: f.name, campaignId: cid, role: 'source', source: 'Google Drive', license: 'Tài liệu nội bộ (Drive)', meta: { driveId: f.id } });
        }
        ctx.log(`Google Drive: ${files.length} ảnh`);
      } catch (e: any) {
        ctx.log(`Google Drive lỗi: ${e.message}`, 'warn');
      }
    }

    // 2) Campaign uploads + local library
    const campaignAssets = assets.list({ campaignId: cid, role: 'source' }).filter((a) => a.kind === 'image');
    const library = assets.list({ library: true }).filter((a) => a.kind === 'image' && a.role === 'source');
    ctx.progress(0.35, `Đang phân loại ${campaignAssets.length + library.length} tư liệu...`);
    await ctx.pace();

    const kw = [plan.product, ...plan.searchKeywords].flatMap((k) => fold(k).split(' ')).filter((w) => w.length > 2);
    const score = (a: Asset) => kw.reduce((s, w) => s + (fold(a.label).includes(w) ? 1 : 0), 0);
    // Campaign uploads always rank first; library items by keyword relevance.
    let candidates = [...campaignAssets, ...library.sort((a, b) => score(b) - score(a))];

    // 3) Pexels for illustrative imagery when there is nothing else.
    if (!candidates.length && isConfigured('pexels')) {
      ctx.progress(0.5, 'Đang tìm ảnh có giấy phép trên Pexels...');
      const photos = (await pexelsSearch(plan.searchKeywords[0] ?? plan.product, 4, ctx.signal)) ?? [];
      for (const p of photos) {
        const res = await fetch(p.url, { signal: ctx.signal });
        if (!res.ok) continue;
        const a = await storeAsset({
          buffer: Buffer.from(await res.arrayBuffer()), filename: `pexels-${p.id}.jpg`, campaignId: cid, role: 'source',
          source: `Pexels — ${p.author} (${p.page})`, license: 'Pexels License (dùng thương mại, không cần ghi công)', label: p.alt || `pexels ${p.id}`,
        });
        candidates.push(a);
      }
    }

    if (!candidates.length) {
      throw new FatalError('Không có tư liệu nào: hãy tải ảnh sản phẩm lên (tab Tư liệu) hoặc kết nối Google Drive / Pexels rồi chạy lại bước này.');
    }

    // 4) Duplicate detection (perceptual hash)
    ctx.progress(0.7, 'Đang phát hiện ảnh trùng lặp...');
    const selected: Asset[] = [];
    const duplicates: CollectOutput['duplicates'] = [];
    for (const a of candidates) {
      const dup = a.hash ? selected.find((s) => s.hash && hamming(s.hash, a.hash!) <= 6) : null;
      if (dup) {
        duplicates.push({ assetId: a.id, duplicateOf: dup.id, distance: hamming(dup.hash!, a.hash!) });
        continue;
      }
      if (selected.length < MAX_SELECTED) selected.push(a);
    }
    if (duplicates.length) ctx.log(`Bỏ qua ${duplicates.length} ảnh trùng lặp`, 'info', duplicates);
    await ctx.pace();

    // 5) License check
    const licenseWarnings = selected
      .filter((a) => !a.license || /chưa rõ|unknown/i.test(a.license))
      .map((a) => `"${a.label}" chưa rõ giấy phép — cần xác minh trước khi đăng`);
    for (const w of licenseWarnings) ctx.log(w, 'warn');

    const bySource: Record<string, number> = {};
    for (const a of selected) bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    ctx.progress(0.95, `Đã chọn ${selected.length} ảnh được phép sử dụng`);
    return {
      output: { selected: selected.map((a) => a.id), duplicates, bySource, licenseWarnings } satisfies CollectOutput,
      resultKind: 'real',
      summary: `Chọn ${selected.length} ảnh, loại ${duplicates.length} ảnh trùng`,
    };
  },
};
