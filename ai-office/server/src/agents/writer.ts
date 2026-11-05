import type { AgentImpl } from './types.js';
import { contents } from '../db/index.js';
import type { Platform } from '../core/types.js';
import { slug } from '../core/util.js';

export const PLATFORM_STYLE: Record<Platform, { label: string; maxChars: number; guide: string }> = {
  facebook: { label: 'Facebook Page', maxChars: 2000, guide: 'Bài 80-200 chữ, mở đầu gây chú ý, xuống dòng dễ đọc, emoji vừa phải, CTA nhắn tin/bình luận, 3-6 hashtag.' },
  zalo: { label: 'Zalo OA', maxChars: 2000, guide: 'Văn phong lịch sự, rõ ràng, thông tin cụ thể (giá, liên hệ), ít hashtag (0-2), tiêu đề ≤ 80 ký tự.' },
  tiktok: { label: 'TikTok', maxChars: 2200, guide: 'Caption rất ngắn 1-2 câu, hook mạnh trong 3 giây đầu, 4-6 hashtag xu hướng.' },
  threads: { label: 'Threads', maxChars: 500, guide: 'Giọng tự nhiên, đối thoại, ≤ 400 ký tự, 1-2 hashtag, đặt câu hỏi gợi tương tác.' },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['variants'],
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['platform', 'title', 'body', 'hashtags', 'cta'],
        properties: {
          platform: { type: 'string', enum: ['zalo', 'facebook', 'tiktok', 'threads'] },
          title: { type: 'string' },
          body: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          cta: { type: 'string' },
        },
      },
    },
  },
};

type Draft = { platform: Platform; title: string; body: string; hashtags: string[]; cta: string };

function demoDrafts(platform: Platform, plan: any, research: any): Draft[] {
  const p = plan.product as string;
  const tag = '#' + slug(p).replace(/-/g, '');
  const m = plan.keyMessages as string[];
  const idea = research?.ideas?.[0] ?? '';
  const base: Draft[] = [
    { platform, title: `${p} — lựa chọn đáng tin cậy`, body: `✨ ${p}\n\n${m.map((x) => `✅ ${x}`).join('\n')}\n\n📩 Nhắn tin ngay để được tư vấn!`, hashtags: [tag, '#chatluong', '#uudai'], cta: 'Nhắn tin để được tư vấn' },
    { platform, title: `Bạn đã biết về ${p}?`, body: `Đang tìm ${p.toLowerCase()} chuẩn chất lượng? 🤔\n${m[0] ?? ''}. ${m[1] ?? ''}.\n${idea ? `\n💡 ${idea}\n` : ''}\n👉 Bình luận "QUAN TÂM" để nhận báo giá.`, hashtags: [tag, '#tuvan'], cta: 'Bình luận để nhận báo giá' },
    { platform, title: `Ưu đãi ${p}`, body: `🔥 Ưu đãi có hạn cho ${p}!\n${m.slice(0, 2).join(' • ')}\n\n📞 Liên hệ ngay hôm nay.`, hashtags: [tag, '#khuyenmai', '#hotdeal'], cta: 'Liên hệ ngay' },
  ];
  return base.map((d) => {
    if (platform === 'tiktok') return { ...d, body: d.body.split('\n')[0] + ' 👇', hashtags: [...d.hashtags, '#fyp', '#xuhuong'] };
    if (platform === 'threads') return { ...d, body: d.body.slice(0, 380) };
    if (platform === 'zalo') return { ...d, hashtags: d.hashtags.slice(0, 1) };
    return d;
  });
}

export const writer: AgentImpl = {
  async run(ctx) {
    const plan = ctx.campaign.plan!;
    const research = ctx.inputs.research ?? null;
    const platforms = ctx.campaign.platforms.length ? ctx.campaign.platforms : (['facebook'] as Platform[]);
    const notes: string[] = (plan as any).revisionNotes ?? [];
    contents.deleteForCampaign(ctx.campaign.id);

    let drafts: Draft[] = [];
    let kind: 'ai' | 'simulated' = 'simulated';
    if (ctx.llm) {
      ctx.progress(0.2, `Đang viết ${platforms.length * 3} phương án nội dung...`);
      const r = await ctx.llm.json<{ variants: Draft[] }>({
        system: 'Bạn là copywriter mạng xã hội tại Việt Nam. Viết tiếng Việt tự nhiên, đời thường, đúng văn phong từng nền tảng. Không bịa giá, khuyến mãi hay số liệu không có trong brief.',
        prompt: [
          `Sản phẩm: ${plan.product}`,
          `Mục tiêu: ${plan.goalSummary}`,
          `Đối tượng: ${plan.audience}`,
          `Giọng điệu: ${plan.tone}`,
          `Thông điệp chính: ${plan.keyMessages.join('; ')}`,
          research ? `Nghiên cứu: ${research.summary}\nÝ tưởng: ${(research.ideas ?? []).join('; ')}` : '',
          notes.length ? `YÊU CẦU CHỈNH SỬA TỪ NGƯỜI DUYỆT: ${notes.join(' | ')}` : '',
          '',
          'Viết đúng 3 phương án khác nhau cho MỖI nền tảng sau:',
          ...platforms.map((p) => `- ${p}: ${PLATFORM_STYLE[p].guide} (tối đa ${PLATFORM_STYLE[p].maxChars} ký tự)`),
        ].filter(Boolean).join('\n'),
        schema: SCHEMA,
        effort: 'medium',
        signal: ctx.signal,
      });
      drafts = r.variants.filter((v) => platforms.includes(v.platform));
      kind = 'ai';
    } else {
      for (const p of platforms) {
        ctx.progress(0.2 + 0.6 * (platforms.indexOf(p) / platforms.length), `Đang viết caption ${PLATFORM_STYLE[p].label}... (mẫu demo)`);
        drafts.push(...demoDrafts(p, plan, research));
        await ctx.pace();
      }
    }

    const counter: Record<string, number> = {};
    for (const d of drafts) {
      counter[d.platform] = (counter[d.platform] ?? 0) + 1;
      const max = PLATFORM_STYLE[d.platform].maxChars;
      contents.create({
        campaignId: ctx.campaign.id, platform: d.platform, variant: counter[d.platform], title: d.title,
        body: d.body.slice(0, max), hashtags: d.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)), cta: d.cta,
        mediaIds: [], status: 'draft', resultKind: kind, approvedBy: null, approvedAt: null,
      });
    }
    const missing = platforms.filter((p) => !counter[p]);
    if (missing.length) ctx.log(`Thiếu nội dung cho: ${missing.join(', ')}`, 'warn');
    return {
      output: { count: drafts.length, byPlatform: counter },
      resultKind: kind,
      summary: `Đã hoàn thành ${drafts.length} caption${kind === 'simulated' ? ' (mẫu demo)' : ''}`,
    };
  },
};
