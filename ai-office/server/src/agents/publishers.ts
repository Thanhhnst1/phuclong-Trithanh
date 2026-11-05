import type { AgentContext, AgentImpl } from './types.js';
import { assets, contents, publications } from '../db/index.js';
import { FatalError, type Asset, type ContentVariant, type Platform } from '../core/types.js';
import { isConfigured } from '../integrations/registry.js';
import { publishFacebook } from '../integrations/facebook.js';
import { publishThreads } from '../integrations/threads.js';
import { publishTikTok } from '../integrations/tiktok.js';
import { publishZaloArticle } from '../integrations/zalo.js';
import { bus } from '../core/bus.js';
import { PLATFORM_FORMATS } from './editor.js';

export const composeText = (c: ContentVariant) =>
  [c.body, c.hashtags.length ? c.hashtags.join(' ') : ''].filter(Boolean).join('\n\n');

/** Pick the media for a platform: the approver's choice, else edited assets in the platform's format. */
export function mediaFor(campaignId: string, platform: Platform, c: ContentVariant): { image: Asset | null; video: Asset | null } {
  const chosen = c.mediaIds.map((id) => assets.get(id)).filter((a): a is Asset => !!a);
  const edited = assets.list({ campaignId, role: 'edited' });
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
    if (!m.video) throw new FatalError('TikTok cần video nhưng chưa có (bước Media Editor không dựng được video)');
    const r = await publishTikTok({ caption: composeText(c), video: m.video, signal: ctx.signal, log: (s) => ctx.log(s) });
    return { ...r, status: r.status === 'PUBLISH_COMPLETE' ? 'published' : 'draft_uploaded' };
  },
};

const LABEL: Record<Platform, string> = { facebook: 'Facebook', zalo: 'Zalo', tiktok: 'TikTok', threads: 'Threads' };

export function publisher(platform: Platform): AgentImpl {
  return {
    async run(ctx) {
      const content = contents.approvedFor(ctx.campaign.id, platform);
      if (!content) throw new FatalError(`Chưa có nội dung ${LABEL[platform]} được duyệt`);
      const media = mediaFor(ctx.campaign.id, platform, content);
      ctx.progress(0.2, `Đang chuẩn bị xuất bản ${LABEL[platform]}...`);
      await ctx.pace();

      // Remove earlier attempts for this platform so retries don't duplicate records.
      for (const p of publications.forCampaign(ctx.campaign.id)) {
        if (p.platform === platform && (p.status === 'failed' || p.status === 'simulated' || p.status === 'manual_pending')) publications.remove(p.id);
      }

      if (ctx.campaign.mode === 'demo') {
        ctx.progress(0.7, `Mô phỏng đăng ${LABEL[platform]}...`);
        await ctx.pace();
        publications.create({
          campaignId: ctx.campaign.id, platform, contentId: content.id, mode: 'simulated', status: 'simulated', externalId: null,
          url: null, error: null, response: { note: 'Demo mode — không gọi API nền tảng', media: { image: media.image?.id, video: media.video?.id } }, metrics: null,
        });
        bus.publish({ type: 'publication', campaignId: ctx.campaign.id });
        return { output: { mode: 'simulated' }, resultKind: 'simulated', summary: `MÔ PHỎNG — chưa đăng thật lên ${LABEL[platform]}` };
      }

      if (!isConfigured(platform)) {
        publications.create({
          campaignId: ctx.campaign.id, platform, contentId: content.id, mode: 'manual', status: 'manual_pending', externalId: null, url: null,
          error: null, response: { reason: `${LABEL[platform]} chưa kết nối API — cần đăng thủ công`, media: { image: media.image?.id, video: media.video?.id } }, metrics: null,
        });
        bus.publish({ type: 'publication', campaignId: ctx.campaign.id });
        ctx.log(`${LABEL[platform]} chưa kết nối: đã tạo gói đăng thủ công. Đăng xong hãy dán link vào mục Báo cáo.`, 'warn');
        return { output: { mode: 'manual' }, resultKind: 'manual', summary: `Chờ đăng thủ công ${LABEL[platform]}` };
      }

      ctx.progress(0.6, `Đang đăng lên ${LABEL[platform]}...`);
      try {
        const r = await REAL[platform](ctx, content, media);
        const pub = publications.create({
          campaignId: ctx.campaign.id, platform, contentId: content.id, mode: 'real', status: r.status ?? 'published',
          externalId: r.externalId, url: r.url, error: null, response: r.response, metrics: null,
        });
        bus.publish({ type: 'publication', campaignId: ctx.campaign.id });
        ctx.log(`Đăng ${LABEL[platform]} thành công${r.url ? `: ${r.url}` : ''}`, 'success');
        return {
          output: { mode: 'real', publicationId: pub.id, url: r.url, status: pub.status },
          resultKind: 'real',
          summary: pub.status === 'draft_uploaded' ? `Đã gửi bản nháp ${LABEL[platform]}` : `Đã đăng ${LABEL[platform]}`,
        };
      } catch (e: any) {
        publications.create({
          campaignId: ctx.campaign.id, platform, contentId: content.id, mode: 'real', status: 'failed', externalId: null, url: null,
          error: String(e?.message ?? e), response: null, metrics: null,
        });
        bus.publish({ type: 'publication', campaignId: ctx.campaign.id });
        throw e;
      }
    },
  };
}
