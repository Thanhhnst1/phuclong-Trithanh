import fs from 'node:fs';
import path from 'node:path';
import type { AgentImpl } from './types.js';
import { assets } from '../db/index.js';
import { FatalError, type Platform } from '../core/types.js';
import { absPath, FORMATS, hasFfmpeg, makeSlideshow, renderPoster, storeAsset, type FormatKey } from '../media/index.js';
import { truncate } from '../core/util.js';

/** Which poster formats each platform needs. */
export const PLATFORM_FORMATS: Record<Platform, FormatKey[]> = {
  facebook: ['square'],
  zalo: ['landscape'],
  threads: ['portrait'],
  tiktok: ['vertical'],
};

export interface EditOutput {
  posters: { assetId: string; format: FormatKey; sourceId: string }[];
  video: string | null;
  videoNote: string | null;
}

export const editor: AgentImpl = {
  async run(ctx) {
    const plan = ctx.campaign.plan!;
    const sel: string[] = ctx.inputs.collect?.selected ?? [];
    const sources = sel.map((id) => assets.get(id)).filter((a): a is NonNullable<typeof a> => !!a).slice(0, 3);
    if (!sources.length) throw new FatalError('Không có ảnh đầu vào từ Asset Collector');

    const formats = [...new Set(ctx.campaign.platforms.flatMap((p) => PLATFORM_FORMATS[p]))];
    if (!formats.length) formats.push('square');
    const logo = assets.list({ campaignId: ctx.campaign.id, role: 'logo' })[0] ?? assets.list({ library: true }).find((a) => a.role === 'logo');
    const logoBuf = logo ? fs.readFileSync(absPath(logo.path)) : null;
    if (!logo) ctx.log('Chưa có logo (tải ảnh với vai trò "logo" để tự chèn).');

    // Remove previous edits when the step is retried.
    for (const old of assets.list({ campaignId: ctx.campaign.id, role: 'edited' })) {
      try { fs.unlinkSync(absPath(old.path)); } catch { /* ignore */ }
      assets.remove(old.id);
    }

    const posters: EditOutput['posters'] = [];
    const total = sources.length * formats.length;
    let i = 0;
    for (const src of sources) {
      const buf = fs.readFileSync(absPath(src.path));
      for (const f of formats) {
        i++;
        ctx.progress(0.05 + (0.65 * i) / total, `Đang thiết kế poster ${FORMATS[f].label} (${i}/${total})...`);
        const out = await renderPoster(buf, {
          format: f,
          title: truncate(plan.headline || plan.product, 70),
          subtitle: plan.keyMessages[0],
          logo: logoBuf,
        });
        const a = await storeAsset({
          buffer: out, filename: `${f}-${src.label}.jpg`, campaignId: ctx.campaign.id, role: 'edited',
          source: `Biên tập từ: ${src.label}`, license: src.license, label: `${FORMATS[f].label} · ${src.label}`, derivedFrom: src.id, meta: { format: f },
        });
        posters.push({ assetId: a.id, format: f, sourceId: src.id });
        await ctx.pace();
      }
    }

    let video: string | null = null;
    let videoNote: string | null = null;
    if (ctx.campaign.platforms.includes('tiktok')) {
      if (await hasFfmpeg()) {
        ctx.progress(0.8, 'Đang dựng video 9:16...');
        const verticals = posters.filter((p) => p.format === 'vertical').map((p) => absPath(assets.get(p.assetId)!.path));
        const audio = assets.list({ campaignId: ctx.campaign.id }).find((a) => a.kind === 'audio');
        const rel = path.join(ctx.campaign.id, `video-${Date.now()}.mp4`);
        await makeSlideshow(verticals, absPath(rel), { secondsPerImage: 3, audio: audio ? absPath(audio.path) : null, signal: ctx.signal });
        const v = await storeAsset({
          buffer: fs.readFileSync(absPath(rel)), filename: 'slideshow.mp4', campaignId: ctx.campaign.id, role: 'edited',
          source: 'Dựng tự động từ poster', license: 'Theo giấy phép ảnh gốc', label: 'Video 9:16', meta: { format: 'vertical', seconds: verticals.length * 3 },
        });
        fs.unlinkSync(absPath(rel));
        video = v.id;
      } else {
        videoNote = 'Không tìm thấy ffmpeg nên chưa dựng được video — cài ffmpeg rồi chạy lại bước này.';
        ctx.log(videoNote, 'warn');
      }
    }
    return {
      output: { posters, video, videoNote } satisfies EditOutput,
      resultKind: 'real',
      summary: `Tạo ${posters.length} poster${video ? ' + 1 video' : ''}`,
    };
  },
};
