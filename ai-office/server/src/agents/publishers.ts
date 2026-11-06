import type { AgentContext, AgentImpl } from './types.js';
import { assets, contents, publications, stories } from '../db/index.js';
import { FatalError, type Asset, type ContentVariant, type Platform } from '../core/types.js';
import { isConfigured } from '../integrations/registry.js';
import { publishFacebook } from '../integrations/facebook.js';
import { publishThreads } from '../integrations/threads.js';
import { publishTikTok } from '../integrations/tiktok.js';
import { publishZaloArticle } from '../integrations/zalo.js';
import { bus } from '../core/bus.js';
import { sleep } from '../core/util.js';
import { PLATFORM_FORMATS } from './editor.js';

export const composeText = (c: ContentVariant) =>
  [c.body, c.hashtags.length ? c.hashtags.join(' ') : ''].filter(Boolean).join('\n\n');

/** Media for a post: the approver's choice, else the card designed for that story + platform format. */
export function mediaFor(campaignId: string, platform: Platform, c: ContentVariant): { image: Asset | null; video: Asset | null } {
  const chosen = c.mediaIds.map((id) => assets.get(id)).filter((a): a is Asset => !!a);
  const edited = assets.list({ campaignId, role: 'edited' }).filter((a) => !c.storyId || a.meta?.storyId === c.storyId);
  const fmt = PLATFORM_FORMATS[platform][0];
  const image = chosen.find((a) => a.kind === 'image') ?? edited.find((a) => a.kind === 'image' && a.meta?.format === fmt) ?? edited.find((a) => a.kind === 'image') ?? null;
  const video = chosen.find((a) => a.kind === 'video') ?? edited.find((a) => a.kind === 'video') ?? null;
  return { image, video };
}

type RealResult = { externalId: string; url: string | null; response: any; status?: 'published' | 'draft_uploaded' };

const REAL: Record<Platform, (ctx: AgentContext, c: ContentVariant, m: ReturnType<typeof mediaFor>) => Promise<RealResult>> = {
  facebook: (ctx, c, m) => publishFacebook({ message: composeText(c), image: m.image, video: null, signal: ctx.signal }),
  threads: (ctx, c, m) => publishThreads({ text: composeText(c), image: m.image, signal: ctx.signal, log: (s) => ctx.log(s, 'warn') }),
  zalo: (ctx, c, m) => publishZaloArticle({ title: c.title, body: c.body, description: c.cta || c.title, cover: m.image, signal: ctx.signal }),
  tiktok: async (ctx, c, m) => {
    if (!m.video) throw new FatalError('TikTok cần video nhưng chưa có (thiếu ffmpeg?)');
    const r = await publishTikTok({ caption: composeText(c), video: m.video, signal: ctx.signal, log: (s) => ctx.log(s) });
    return { ...r, status: r.status === 'PUBLISH_COMPLETE' ? 'published' : 'draft_uploaded' };
  },
};

const LABEL: Record<Platform, string> = { facebook: 'Facebook', zalo: 'Zalo', tiktok: 'TikTok', threads: 'Threads' };

export function publisher(platform: Platform): AgentImpl {
  return {
    async run(ctx) {
      const posts = contents.approvedFor(ctx.campaign.id, platform);
      if (!posts.length) {
        return { output: { posts: 0 }, resultKind: 'none', summary: `Không có bài ${LABEL[platform]} nào được duyệt` };
      }
      // Retries must not duplicate records or re-post what already went out.
      const prev = publications.forCampaign(ctx.campaign.id).filter((p) => p.platform === platform);
      for (const p of prev) if (['failed', 'simulated', 'manual_pending'].includes(p.status)) publications.remove(p.id);
      const done = new Set(prev.filter((p) => ['published', 'draft_uploaded', 'manual_done'].includes(p.status)).map((p) => p.contentId));

      const mode = ctx.campaign.mode === 'demo' ? 'simulated' : isConfigured(platform) ? 'real' : 'manual';
      let ok = 0, failed = 0;
      let lastErr: unknown = null;
      for (const [i, c] of posts.entries()) {
        if (done.has(c.id)) continue;
        const media = mediaFor(ctx.campaign.id, platform, c);
        ctx.progress(0.1 + (0.85 * i) / posts.length, `${mode === 'simulated' ? 'Mô phỏng đăng' : mode === 'manual' ? 'Chuẩn bị gói đăng tay' : 'Đang đăng'} ${LABEL[platform]} ${i + 1}/${posts.length}…`);
        await ctx.pace();
        const base = { campaignId: ctx.campaign.id, platform, contentId: c.id, externalId: null, url: null, error: null, metrics: null };
        if (mode === 'simulated') {
          publications.create({ ...base, mode: 'simulated', status: 'simulated', response: { note: 'Demo mode — không gọi API nền tảng', media: { image: media.image?.id, video: media.video?.id } } });
          ok++;
        } else if (mode === 'manual') {
          publications.create({ ...base, mode: 'manual', status: 'manual_pending', response: { reason: `${LABEL[platform]} chưa kết nối API — cần đăng thủ công`, media: { image: media.image?.id, video: media.video?.id } } });
          ok++;
        } else {
          try {
            const r = await REAL[platform](ctx, c, media);
            publications.create({ ...base, mode: 'real', status: r.status ?? 'published', externalId: r.externalId, url: r.url, response: r.response });
            if (c.storyId) stories.update(c.storyId, { status: 'published' });
            ctx.log(`Đăng ${LABEL[platform]} thành công${r.url ? `: ${r.url}` : ''}`, 'success');
            ok++;
            if (i < posts.length - 1) await sleep(5000, ctx.signal); // avoid burst posting
          } catch (e: any) {
            if (ctx.signal.aborted) throw e;
            publications.create({ ...base, mode: 'real', status: 'failed', error: String(e?.message ?? e), response: null });
            ctx.log(`Đăng ${LABEL[platform]} lỗi: ${e?.message ?? e}`, 'error');
            failed++;
            lastErr = e;
          }
        }
        bus.publish({ type: 'publication', campaignId: ctx.campaign.id });
      }
      if (failed && !ok) throw lastErr; // every post failed → let the engine retry / mark failed
      const kind = mode === 'real' ? 'real' : mode === 'simulated' ? 'simulated' : 'manual';
      const summary = mode === 'simulated' ? `MÔ PHỎNG ${ok} bài — chưa đăng thật lên ${LABEL[platform]}`
        : mode === 'manual' ? `${ok} bài ${LABEL[platform]} chờ đăng thủ công`
          : `Đã đăng ${ok} bài ${LABEL[platform]}${failed ? `, ${failed} lỗi` : ''}`;
      return { output: { mode, ok, failed }, resultKind: kind, summary };
    },
  };
}
