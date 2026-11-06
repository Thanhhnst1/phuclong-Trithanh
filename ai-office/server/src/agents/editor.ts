import fs from 'node:fs';
import path from 'node:path';
import type { AgentImpl } from './types.js';
import { assets, settings, stories } from '../db/index.js';
import { FatalError, type Platform } from '../core/types.js';
import { absPath, FORMATS, hasFfmpeg, makeSlideshow, renderCard, storeAsset, type FormatKey } from '../media/index.js';

/** Which image format each platform uses. */
export const PLATFORM_FORMATS: Record<Platform, FormatKey[]> = {
  facebook: ['portrait'],
  threads: ['portrait'],
  zalo: ['landscape'],
  tiktok: ['vertical'],
};

export interface EditOutput {
  cards: { assetId: string; format: FormatKey; storyId: string; illustration: boolean }[];
  videos: { assetId: string; storyId: string }[];
  videoNote: string | null;
}

/** Image designer: one card per selected story and platform format. Uses the user's sourced photo when provided. */
export const editor: AgentImpl = {
  async run(ctx) {
    const selected = stories.forCampaign(ctx.campaign.id).filter((s) => s.status === 'selected');
    if (!selected.length) throw new FatalError('Chưa có chủ đề nào được chọn');
    const formats = [...new Set(ctx.campaign.platforms.flatMap((p) => PLATFORM_FORMATS[p]))];
    const brand = settings.get('brand.name');

    for (const old of assets.list({ campaignId: ctx.campaign.id, role: 'edited' })) {
      try { fs.unlinkSync(absPath(old.path)); } catch { /* ignore */ }
      assets.remove(old.id);
    }
    const uploads = assets.list({ campaignId: ctx.campaign.id, role: 'source' }).filter((a) => a.kind === 'image');
    const cards: EditOutput['cards'] = [];
    const total = selected.length * formats.length;
    let i = 0;
    for (const s of selected) {
      const photo = uploads.find((a) => a.meta?.storyId === s.id);
      if (!photo) ctx.log(`"${s.title.slice(0, 50)}": chưa có ảnh có nguồn → dùng thẻ chữ gắn nhãn "Ảnh minh họa".`);
      for (const f of formats) {
        i++;
        ctx.progress(0.05 + (0.7 * i) / total, `Đang thiết kế ảnh ${FORMATS[f].label} (${i}/${total})…`);
        const buf = await renderCard({
          format: f, title: s.title, category: s.category || 'Chuyện lạ', brand,
          photo: photo ? fs.readFileSync(absPath(photo.path)) : null, credit: photo?.source ?? null,
        });
        const a = await storeAsset({
          buffer: buf, filename: `${f}.jpg`, campaignId: ctx.campaign.id, role: 'edited',
          source: photo ? `Ảnh gốc: ${photo.source}` : 'Thẻ chữ tự thiết kế (ảnh minh họa)', license: photo?.license ?? 'Tự thiết kế',
          label: `${FORMATS[f].label} · ${s.title.slice(0, 40)}`, derivedFrom: photo?.id ?? null,
          meta: { format: f, storyId: s.id, illustration: !photo },
        });
        cards.push({ assetId: a.id, format: f, storyId: s.id, illustration: !photo });
        await ctx.pace();
      }
    }

    const videos: EditOutput['videos'] = [];
    let videoNote: string | null = null;
    if (ctx.campaign.platforms.includes('tiktok')) {
      if (await hasFfmpeg()) {
        for (const s of selected) {
          ctx.progress(0.85, 'Đang dựng video 9:16…');
          const vert = cards.filter((c) => c.storyId === s.id && c.format === 'vertical').map((c) => absPath(assets.get(c.assetId)!.path));
          if (!vert.length) continue;
          const rel = path.join(ctx.campaign.id, `video-${Date.now()}.mp4`);
          await makeSlideshow(vert, absPath(rel), { secondsPerImage: 6, signal: ctx.signal });
          const v = await storeAsset({
            buffer: fs.readFileSync(absPath(rel)), filename: 'video.mp4', campaignId: ctx.campaign.id, role: 'edited',
            source: 'Dựng tự động từ thẻ ảnh', license: 'Tự thiết kế', label: `Video 9:16 · ${s.title.slice(0, 40)}`, meta: { format: 'vertical', storyId: s.id },
          });
          fs.unlinkSync(absPath(rel));
          videos.push({ assetId: v.id, storyId: s.id });
        }
      } else {
        videoNote = 'Không tìm thấy ffmpeg nên chưa dựng được video TikTok.';
        ctx.log(videoNote, 'warn');
      }
    }
    return {
      output: { cards, videos, videoNote } satisfies EditOutput,
      resultKind: 'real',
      summary: `Thiết kế ${cards.length} ảnh${videos.length ? ` + ${videos.length} video` : ''}`,
    };
  },
};
