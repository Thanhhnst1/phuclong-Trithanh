import type { AgentImpl } from './types.js';
import { contents, stories } from '../db/index.js';
import { FatalError, type Platform, type Story } from '../core/types.js';
import { ETHICS } from '../orchestrator/planner.js';
import { domainOf } from './storyUtil.js';

export const PLATFORM_STYLE: Record<Platform, { label: string; maxChars: number; guide: string }> = {
  facebook: {
    label: 'Facebook', maxChars: 5000,
    guide: 'Bài Facebook: câu hook thật mạnh 1–2 dòng đầu; kể chuyện tự nhiên có diễn biến và cao trào; giải thích chi tiết gây bất ngờ; ngôn ngữ gần gũi; xuống dòng dễ đọc; kết bằng câu hỏi mở; 3–5 hashtag; dòng cuối "Nguồn: …".',
  },
  threads: { label: 'Threads', maxChars: 500, guide: 'Bản Threads ≤ 450 ký tự: hook + ý chính + câu hỏi, 1–2 hashtag, ghi nguồn ngắn.' },
  zalo: { label: 'Zalo OA', maxChars: 3000, guide: 'Bài Zalo: tiêu đề ≤ 80 ký tự, văn phong rõ ràng, ít hashtag, ghi nguồn.' },
  tiktok: { label: 'TikTok', maxChars: 2200, guide: 'Caption TikTok 1–2 câu gây tò mò + 4 hashtag, ghi nguồn ngắn.' },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['variants'],
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['platform', 'title', 'body', 'hashtags', 'cta'],
        properties: {
          platform: { type: 'string', enum: ['zalo', 'facebook', 'tiktok', 'threads'] },
          title: { type: 'string', description: 'Tiêu đề gây tò mò, KHÔNG giật tít sai sự thật' },
          body: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          cta: { type: 'string', description: 'Câu hỏi mở cuối bài' },
        },
      },
    },
  },
};

type Draft = { platform: Platform; title: string; body: string; hashtags: string[]; cta: string };

function sourceLine(s: Story) {
  return s.sources.length ? `Nguồn: ${s.sources.slice(0, 3).map((x) => domainOf(x.url)).join(', ')}` : '';
}

function demoDrafts(s: Story, platforms: Platform[]): Draft[] {
  return platforms.flatMap((p) => [1, 2].map((v) => ({
    platform: p,
    title: `[BÀI MẪU DEMO] ${s.title.replace('[MẪU DEMO] ', '')}`,
    body: `[BÀI MẪU DEMO — không phải tin thật]\n\n${v === 1 ? '😮 Câu hook mở đầu sẽ nằm ở đây.' : '🤔 Một góc kể khác cho cùng chủ đề.'}\n\nKhi có Claude API, Biên tập viên sẽ kể lại câu chuyện đã kiểm chứng, tách rõ điều đã xác nhận và điều còn là giả thuyết, rồi ghi nguồn ở cuối bài.\n\nBạn nghĩ sao về chuyện này?`,
    hashtags: ['#chuyenla', '#demo'],
    cta: 'Bạn nghĩ sao về chuyện này?',
  })));
}

/** Editor: turns each selected, verified story into ready-to-post copy (2 variants per platform). */
export const writer: AgentImpl = {
  async run(ctx) {
    const plan = ctx.campaign.plan!;
    const selected = stories.forCampaign(ctx.campaign.id).filter((s) => s.status === 'selected');
    if (!selected.length) throw new FatalError('Chưa có chủ đề nào được chọn');
    const platforms = ctx.campaign.platforms.length ? ctx.campaign.platforms : (['facebook'] as Platform[]);
    const notes = plan.revisionNotes ?? [];
    contents.deleteForCampaign(ctx.campaign.id);

    let total = 0;
    let kind: 'ai' | 'simulated' = 'simulated';
    for (const [i, s] of selected.entries()) {
      ctx.progress(0.1 + (0.8 * i) / selected.length, `Đang viết bài ${i + 1}/${selected.length}: ${s.title.slice(0, 40)}…`);
      let drafts: Draft[];
      if (ctx.llm && s.verification !== 'demo') {
        const r = await ctx.llm.json<{ variants: Draft[] }>({
          system: `Bạn là biên tập viên một trang Facebook nội dung "Thật sự có chuyện này sao?" tại Việt Nam. Kể chuyện cuốn hút nhưng tuyệt đối trung thực. ${ETHICS.join(' ')} Chỉ dùng dữ kiện được cung cấp, không thêm chi tiết, số liệu, lời nói. Nếu là chuyện bí ẩn: nói rõ điều đã xác nhận, điều còn là giả thuyết, hiện chưa có kết luận chính thức.`,
          prompt: [
            `CÂU CHUYỆN: ${s.title}`,
            `Tóm tắt: ${s.summary}`,
            `Thời gian/địa điểm: ${s.when} — ${s.where}`,
            `Tình trạng kiểm chứng: ${s.verification}`,
            `Đã xác nhận: ${s.confirmedFacts.join(' | ') || '—'}`,
            `Chưa kiểm chứng / lời kể: ${s.unverifiedClaims.join(' | ') || '—'}`,
            `Giả thuyết: ${s.hypotheses.join(' | ') || '—'}`,
            `Góc khai thác: ${s.angle}. Lý do thu hút: ${s.appealReasons}`,
            `${sourceLine(s)}`,
            s.checkNote ? `Ghi chú kiểm chứng: ${s.checkNote}` : '',
            notes.length ? `GÓP Ý CỦA CHỦ KÊNH: ${notes.join(' | ')}` : '',
            '',
            'Viết đúng 2 phương án khác nhau cho MỖI nền tảng:',
            ...platforms.map((p) => `- ${p}: ${PLATFORM_STYLE[p].guide} (tối đa ${PLATFORM_STYLE[p].maxChars} ký tự)`),
          ].filter(Boolean).join('\n'),
          schema: SCHEMA,
          effort: 'medium',
          signal: ctx.signal,
        });
        drafts = r.variants.filter((v) => platforms.includes(v.platform));
        kind = 'ai';
      } else {
        drafts = demoDrafts(s, platforms);
        await ctx.pace();
      }
      const counter: Record<string, number> = {};
      const src = sourceLine(s);
      for (const d of drafts) {
        counter[d.platform] = (counter[d.platform] ?? 0) + 1;
        let body = d.body;
        if (src && !/nguồn/i.test(body)) body = `${body}\n\n${src}`; // every post names its sources
        contents.create({
          campaignId: ctx.campaign.id, storyId: s.id, platform: d.platform, variant: counter[d.platform], title: d.title,
          body: body.slice(0, PLATFORM_STYLE[d.platform].maxChars), hashtags: d.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)),
          cta: d.cta, mediaIds: [], status: 'draft', resultKind: kind === 'ai' ? 'ai' : 'simulated', approvedBy: null, approvedAt: null,
        });
        total++;
      }
    }
    return {
      output: { count: total, stories: selected.length },
      resultKind: kind,
      summary: `Đã viết ${total} phương án cho ${selected.length} chủ đề${kind === 'simulated' ? ' (mẫu demo)' : ''}`,
    };
  },
};
