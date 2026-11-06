import type { AgentImpl } from './types.js';
import { stories } from '../db/index.js';
import { tavilySearch } from '../integrations/research.js';
import { listMcpServers } from '../integrations/mcp.js';
import { ETHICS } from '../orchestrator/planner.js';
import { fingerprint, findDuplicate, keepKnownSources } from './storyUtil.js';
import type { StorySource } from '../core/types.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'when', 'where', 'category', 'sourceUrls', 'appealReasons', 'angle', 'appealScore'],
        properties: {
          title: { type: 'string', description: 'Tiêu đề ngắn gọn, gây tò mò nhưng đúng sự thật' },
          summary: { type: 'string', description: 'Tóm tắt sự việc 2-4 câu, chỉ dựa trên nguồn' },
          when: { type: 'string', description: 'Thời gian xảy ra / công bố (ghi rõ nếu không rõ)' },
          where: { type: 'string' },
          category: { type: 'string' },
          sourceUrls: { type: 'array', items: { type: 'string' }, description: 'CHỈ các URL đã xuất hiện trong kết quả tìm kiếm' },
          appealReasons: { type: 'string', description: 'Vì sao người đọc dừng lại và tương tác' },
          angle: { type: 'string', enum: ['bất ngờ', 'khoa học', 'bí ẩn', 'cảm xúc', 'phân tích'] },
          appealScore: { type: 'integer', minimum: 1, maximum: 10, description: 'Tiềm năng thu hút (KHÔNG phải độ tin cậy)' },
        },
      },
    },
  },
};

type Cand = { title: string; summary: string; when: string; where: string; category: string; sourceUrls: string[]; appealReasons: string; angle: string; appealScore: number };

const blankStory = {
  confirmedFacts: [] as string[], unverifiedClaims: [] as string[], hypotheses: [] as string[], risks: [] as string[], mediaNotes: '', checkNote: '',
};

/** Trend Hunter: finds candidate stories (more than needed, the fact-checker filters). */
export const researcher: AgentImpl = {
  async run(ctx) {
    const plan = ctx.campaign.plan!;
    const cid = ctx.campaign.id;
    stories.deleteForCampaign(cid); // re-hunt replaces this campaign's candidates
    const want = plan.count + 4;
    const recent = stories.history(60).filter((s) => s.campaignId !== cid).map((s) => `- ${s.title}`).join('\n');
    const notes = plan.revisionNotes?.length ? `\nYêu cầu bổ sung của chủ kênh: ${plan.revisionNotes.join(' | ')}` : '';

    let cands: Cand[] = [];
    let known = new Set<string>();
    let titles = new Map<string, string>();
    let kind: 'ai' | 'real' | 'simulated' = 'simulated';

    if (ctx.llm) {
      const mcp = listMcpServers();
      ctx.progress(0.1, 'Đang lướt báo chí, mạng xã hội, trang khoa học…');
      const r = await ctx.llm.research({
        system: `Bạn là phóng viên điều tra săn tin cho một trang Facebook lớn ở Việt Nam. Dùng web search để tìm câu chuyện CÓ THẬT, mới, độc đáo. Ưu tiên báo chí chính thống, tổ chức khoa học, cơ quan chức năng. Quy tắc: ${ETHICS.join(' ')}`,
        prompt: [
          `Nhiệm vụ: ${plan.focus}`,
          `Nhóm chủ đề: ${plan.categories.join(', ')}`,
          `Gợi ý truy vấn: ${plan.searchQueries.join(' | ')}`,
          `Hôm nay: ${new Date().toISOString().slice(0, 10)}. Ưu tiên sự việc mới hoặc diễn biến mới; ghi rõ thời điểm gốc.`,
          `Tìm khoảng ${want} câu chuyện khác nhau. Với mỗi câu chuyện ghi: tóm tắt, thời gian, địa điểm, đường link nguồn.`,
          recent ? `KHÔNG lặp lại các chủ đề đã đề xuất trước đây:\n${recent}` : '',
          notes,
        ].filter(Boolean).join('\n'),
        webSearch: true,
        mcpServers: mcp,
        signal: ctx.signal,
      });
      known = new Set(r.sources.map((s) => s.url));
      titles = new Map(r.sources.map((s) => [s.url, s.title]));
      ctx.progress(0.6, `Tìm thấy ${r.sources.length} nguồn, đang chọn lọc chủ đề…`);
      if (!r.sources.length) ctx.log('Web search không trả về nguồn nào — không thể đề xuất chủ đề có kiểm chứng.', 'warn');
      const s = await ctx.llm.json<{ candidates: Cand[] }>({
        system: 'Chuyển ghi chú săn tin thành danh sách chủ đề có cấu trúc. Chỉ dùng thông tin và URL có trong ghi chú/danh sách nguồn. Không thêm chi tiết.',
        prompt: `Ghi chú:\n${r.notes}\n\nDanh sách nguồn hợp lệ:\n${r.sources.map((x) => `- ${x.title}: ${x.url}`).join('\n')}\n\nTrả về tối đa ${want} chủ đề.`,
        schema: SCHEMA,
        effort: 'low',
        signal: ctx.signal,
      });
      cands = s.candidates;
      kind = 'ai';
    } else {
      const queries = plan.searchQueries.slice(0, 3);
      for (const q of queries) {
        const res = await tavilySearch(q, ctx.signal).catch((e) => {
          ctx.log(`Tavily lỗi: ${e.message}`, 'warn');
          return null;
        });
        if (!res) continue;
        for (const x of res) {
          known.add(x.url);
          titles.set(x.url, x.title);
          cands.push({ title: x.title, summary: x.snippet, when: 'Chưa xác định', where: 'Chưa xác định', category: plan.categories[0] ?? '', sourceUrls: [x.url], appealReasons: 'Kết quả tìm kiếm — cần biên tập đánh giá', angle: 'phân tích', appealScore: 5 });
        }
      }
      if (cands.length) kind = 'real';
    }

    if (!cands.length) {
      // Demo: obviously-labelled placeholders so the workflow can be tested. Never realistic fake news.
      ctx.progress(0.5, 'Chưa có công cụ tìm kiếm → tạo chủ đề MẪU để thử quy trình…');
      await ctx.pace();
      cands = Array.from({ length: plan.count }, (_, i) => plan.categories[i % plan.categories.length] ?? 'Chuyện lạ').map((c, i) => ({
        title: `[MẪU DEMO] Chủ đề ví dụ ${i + 1} — ${c}`,
        summary: 'Đây là chủ đề mẫu để thử quy trình, KHÔNG phải tin thật. Kết nối Claude API (tab Kết nối) để săn tin thật có nguồn.',
        when: '—', where: '—', category: c, sourceUrls: [], appealReasons: 'Mẫu demo', angle: 'bất ngờ', appealScore: 9 - i,
      }));
    }

    let dup = 0;
    let dropped = 0;
    const seen = new Set<string>();
    for (const c of cands) {
      const fp = fingerprint(c.title);
      if (kind !== 'simulated') {
        if (seen.has(fp)) continue;
        seen.add(fp);
      }
      const prev = kind !== 'simulated' ? findDuplicate(c.title, cid) : null;
      if (prev) {
        dup++;
        ctx.log(`Bỏ chủ đề trùng với chủ đề cũ: "${c.title}" ≈ "${prev.title}"`);
        continue;
      }
      const sources: StorySource[] = keepKnownSources(c.sourceUrls.map((url) => ({ url, title: titles.get(url) ?? url })), known);
      if (kind !== 'simulated' && !sources.length) {
        dropped++;
        continue;
      }
      stories.create({
        campaignId: cid, title: c.title, summary: c.summary, when: c.when, where: c.where, category: c.category,
        verification: kind === 'simulated' ? 'demo' : 'insufficient', sources, appealReasons: c.appealReasons, angle: c.angle,
        appealScore: Math.max(1, Math.min(10, Math.round(c.appealScore))), ...blankStory, status: 'candidate', fingerprint: fp,
      });
    }
    if (dropped) ctx.log(`Loại ${dropped} chủ đề không có nguồn hợp lệ (URL không đến từ kết quả tìm kiếm).`, 'warn');
    const n = stories.forCampaign(cid).length;
    await ctx.pace();
    return {
      output: { candidates: n, duplicates: dup, droppedNoSource: dropped, method: kind },
      resultKind: kind,
      summary: kind === 'simulated' ? `Tạo ${n} chủ đề MẪU (demo)` : `Săn được ${n} chủ đề, bỏ ${dup} trùng lặp`,
    };
  },
};
