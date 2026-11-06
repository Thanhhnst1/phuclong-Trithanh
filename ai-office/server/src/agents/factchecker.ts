import type { AgentImpl } from './types.js';
import { stories } from '../db/index.js';
import { ETHICS } from '../orchestrator/planner.js';
import { domainOf, keepKnownSources } from './storyUtil.js';
import type { Story, StorySource, Verification } from '../core/types.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verification', 'confirmedFacts', 'unverifiedClaims', 'hypotheses', 'sources', 'originalDate', 'isOldNewsRepackaged', 'mediaNotes', 'risks', 'recommendation', 'note'],
  properties: {
    verification: { type: 'string', enum: ['confirmed', 'partial', 'insufficient'], description: 'confirmed = ≥2 nguồn độc lập uy tín xác nhận phần cốt lõi' },
    confirmedFacts: { type: 'array', items: { type: 'string' } },
    unverifiedClaims: { type: 'array', items: { type: 'string' }, description: 'Lời kể nhân chứng / thông tin chưa kiểm chứng' },
    hypotheses: { type: 'array', items: { type: 'string' }, description: 'Giả thuyết, chưa có kết luận chính thức' },
    sources: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['url', 'title', 'type'],
        properties: { url: { type: 'string' }, title: { type: 'string' }, type: { type: 'string', enum: ['press', 'science', 'official', 'primary', 'social', 'other'] } },
      },
    },
    originalDate: { type: 'string', description: 'Ngày sự việc/công bố gốc' },
    isOldNewsRepackaged: { type: 'boolean', description: 'Tin cũ đang bị chia sẻ lại như tin mới?' },
    mediaNotes: { type: 'string', description: 'Rủi ro ảnh/video bị cắt ghép, dùng sai ngữ cảnh, ảnh AI' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Đời tư, danh dự, gán tội, phản cảm, pháp lý…' },
    recommendation: { type: 'string', enum: ['publish', 'hold', 'drop'] },
    note: { type: 'string', description: 'Kết luận kiểm chứng ngắn gọn' },
  },
};

type Check = {
  verification: Exclude<Verification, 'demo'>; confirmedFacts: string[]; unverifiedClaims: string[]; hypotheses: string[];
  sources: StorySource[]; originalDate: string; isOldNewsRepackaged: boolean; mediaNotes: string; risks: string[];
  recommendation: 'publish' | 'hold' | 'drop'; note: string;
};

/** Fact-checker: verifies the most promising candidates, then keeps the best `count` for the editor-in-chief. */
export const factchecker: AgentImpl = {
  async run(ctx) {
    const plan = ctx.campaign.plan!;
    const all = stories.forCampaign(ctx.campaign.id).filter((s) => s.status === 'candidate');

    if (all.every((s) => s.verification === 'demo')) {
      for (const s of all) {
        ctx.progress(0.2 + (0.7 * all.indexOf(s)) / Math.max(1, all.length), `Kiểm chứng mẫu: ${s.title.slice(0, 40)}…`);
        stories.update(s.id, { status: 'proposed', checkNote: 'MẪU DEMO — không có kiểm chứng thật.', confirmedFacts: [], hypotheses: [] });
      }
      await ctx.pace();
      return { output: { proposed: all.length, held: 0, rejected: 0 }, resultKind: 'simulated', summary: `Đánh dấu ${all.length} chủ đề MẪU (không kiểm chứng thật)` };
    }

    if (!ctx.llm) {
      for (const s of all) stories.update(s.id, { status: 'held', checkNote: 'Chưa kiểm chứng: cần Claude API (web search) để đối chiếu nguồn độc lập.' });
      ctx.log('Không có Claude API nên không kiểm chứng được — toàn bộ chủ đề vào nhóm CHỜ KIỂM CHỨNG.', 'warn');
      return { output: { proposed: 0, held: all.length, rejected: 0 }, resultKind: 'none', summary: `${all.length} chủ đề chờ kiểm chứng (thiếu Claude API)` };
    }

    // Verify the most appealing candidates first; stop once we have enough publishable topics.
    const queue = [...all].sort((a, b) => b.appealScore - a.appealScore);
    let proposed = 0, held = 0, rejected = 0;
    for (const [i, s] of queue.entries()) {
      if (proposed >= plan.count) {
        stories.update(s.id, { status: 'held', checkNote: 'Chưa kiểm chứng (đã đủ số chủ đề cần đề xuất).' });
        held++;
        continue;
      }
      ctx.progress(0.05 + (0.9 * i) / queue.length, `Kiểm chứng ${i + 1}/${queue.length}: ${s.title.slice(0, 48)}…`);
      try {
        const r = await ctx.llm.research({
          system: `Bạn là biên tập viên kiểm chứng (fact-checker). Dùng web search để truy nguồn gốc, đối chiếu ít nhất 2 nguồn ĐỘC LẬP đáng tin cậy, kiểm tra thời điểm gốc (tin cũ đăng lại?), bối cảnh hình ảnh. Phân biệt rõ: sự thật đã xác nhận / lời kể nhân chứng / giả thuyết. ${ETHICS.join(' ')}`,
          prompt: `Kiểm chứng câu chuyện:\nTiêu đề: ${s.title}\nTóm tắt: ${s.summary}\nThời gian/địa điểm: ${s.when} — ${s.where}\nNguồn ban đầu: ${s.sources.map((x) => x.url).join(', ')}`,
          webSearch: true,
          mcpServers: [],
          signal: ctx.signal,
        });
        const known = new Set([...r.sources.map((x) => x.url), ...s.sources.map((x) => x.url)]);
        const c = await ctx.llm.json<Check>({
          system: 'Tổng hợp kết quả kiểm chứng theo schema. Chỉ dùng URL có trong danh sách. Nghiêm khắc: nếu không có ít nhất 2 nguồn độc lập uy tín xác nhận phần cốt lõi thì không được ghi confirmed.',
          prompt: `Câu chuyện: ${s.title}\n${s.summary}\n\nGhi chú kiểm chứng:\n${r.notes}\n\nNguồn hợp lệ:\n${[...known].map((u) => `- ${u}`).join('\n')}`,
          schema: SCHEMA,
          effort: 'medium',
          signal: ctx.signal,
        });
        const sources = keepKnownSources(c.sources, known);
        const independent = new Set(sources.filter((x) => x.type !== 'social').map((x) => domainOf(x.url))).size;
        // Enforce the rule in code, not only in the prompt.
        let verification: Verification = c.verification;
        if (verification === 'confirmed' && independent < 2) verification = 'partial';
        if (!sources.length) verification = 'insufficient';
        let status: Story['status'] = 'proposed';
        let checkNote = c.note;
        if (c.recommendation === 'drop' || c.risks.some((x) => /đời tư|danh dự|gán tội|phản cảm|thù hận|vi phạm/i.test(x)) && c.recommendation !== 'publish') {
          status = 'rejected';
        } else if (verification === 'insufficient' || c.recommendation === 'hold') {
          status = 'held';
        }
        if (c.isOldNewsRepackaged) checkNote = `⚠ Tin cũ (gốc: ${c.originalDate}) đang được chia sẻ lại. ${checkNote}`;
        stories.update(s.id, {
          verification, status, sources: sources.length ? sources : s.sources, confirmedFacts: c.confirmedFacts, unverifiedClaims: c.unverifiedClaims,
          hypotheses: c.hypotheses, risks: c.risks, mediaNotes: c.mediaNotes, checkNote, when: c.originalDate || s.when,
        });
        if (status === 'proposed') proposed++;
        else if (status === 'held') held++;
        else rejected++;
        ctx.log(`${status === 'proposed' ? '✅' : status === 'held' ? '⏸' : '⛔'} ${s.title} — ${verification}, ${independent} nguồn độc lập`);
      } catch (e: any) {
        if (ctx.signal.aborted) throw e;
        stories.update(s.id, { status: 'held', checkNote: `Lỗi khi kiểm chứng: ${e.message}` });
        held++;
        ctx.log(`Kiểm chứng lỗi "${s.title}": ${e.message}`, 'warn');
      }
    }
    return {
      output: { proposed, held, rejected },
      resultKind: 'ai',
      summary: `Đề xuất ${proposed} chủ đề · ${held} chờ kiểm chứng · ${rejected} loại`,
    };
  },
};
