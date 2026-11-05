import type { AgentImpl } from './types.js';
import { tavilySearch } from '../integrations/research.js';
import { listMcpServers } from '../integrations/mcp.js';

export interface ResearchOutput {
  summary: string;
  insights: string[];
  trends: string[];
  competitors: string[];
  ideas: string[];
  keywords: string[];
  sources: { title: string; url: string }[];
  method: 'claude_web_search' | 'claude_no_web' | 'tavily' | 'demo';
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'insights', 'trends', 'competitors', 'ideas', 'keywords'],
  properties: {
    summary: { type: 'string' },
    insights: { type: 'array', items: { type: 'string' } },
    trends: { type: 'array', items: { type: 'string' } },
    competitors: { type: 'array', items: { type: 'string' } },
    ideas: { type: 'array', items: { type: 'string' }, description: '4-6 ý tưởng nội dung cụ thể' },
    keywords: { type: 'array', items: { type: 'string' } },
  },
};

export const researcher: AgentImpl = {
  async run(ctx) {
    const plan = ctx.campaign.plan!;
    const topic = `${plan.product} — ${plan.goalSummary}`;
    ctx.progress(0.1, `Đang nghiên cứu "${plan.product}"...`);

    if (ctx.llm) {
      const mcp = listMcpServers();
      if (mcp.length) ctx.log(`Dùng ${mcp.length} MCP server: ${mcp.map((s) => s.name).join(', ')}`);
      ctx.progress(0.25, 'Đang tìm xu hướng & đối thủ trên web...');
      let notes = '';
      let sources: ResearchOutput['sources'] = [];
      let method: ResearchOutput['method'] = 'claude_web_search';
      try {
        const r = await ctx.llm.research({
          system: 'Bạn là chuyên viên nghiên cứu thị trường Việt Nam. Dùng web search để tìm thông tin thật, ghi rõ nguồn. Không bịa số liệu; nếu không tìm thấy thì nói rõ.',
          prompt: `Nghiên cứu cho chiến dịch: ${topic}\nĐối tượng: ${plan.audience}\nCần: xu hướng thị trường hiện tại, đối thủ/sản phẩm tương tự, insight khách hàng, góc nội dung đang hiệu quả trên ${plan.platforms.join(', ')}.`,
          webSearch: true,
          mcpServers: mcp,
          signal: ctx.signal,
        });
        notes = r.notes;
        sources = r.sources;
      } catch (e: any) {
        ctx.log(`Web search không khả dụng (${e?.message ?? e}) → nghiên cứu bằng kiến thức của mô hình, không có nguồn web.`, 'warn');
        method = 'claude_no_web';
      }
      ctx.progress(0.7, `Đang tổng hợp ${sources.length} nguồn...`);
      const s = await ctx.llm.json<Omit<ResearchOutput, 'sources' | 'method'>>({
        system: 'Tổng hợp nghiên cứu thành dữ liệu có cấu trúc, tiếng Việt. Chỉ dùng thông tin trong ghi chú; nếu thiếu ghi chú thì nêu rõ đây là nhận định chung.',
        prompt: `Chiến dịch: ${topic}\n\nGhi chú nghiên cứu:\n${notes || '(không có — hãy đưa ra nhận định chung và ghi rõ là chưa kiểm chứng)'}`,
        schema: SCHEMA,
        effort: 'low',
        signal: ctx.signal,
      });
      return {
        output: { ...s, sources, method } satisfies ResearchOutput,
        resultKind: 'ai',
        summary: `Đã tổng hợp ${s.insights.length} insight, ${s.ideas.length} ý tưởng, ${sources.length} nguồn`,
      };
    }

    const results = await tavilySearch(`${plan.product} xu hướng ${new Date().getFullYear()}`, ctx.signal).catch((e) => {
      ctx.log(`Tavily lỗi: ${e.message}`, 'warn');
      return null;
    });
    if (results?.length) {
      ctx.progress(0.6, `Tìm được ${results.length} nguồn, đang tổng hợp...`);
      await ctx.pace();
      return {
        output: {
          summary: `Kết quả tìm kiếm web cho "${plan.product}" (chưa qua AI tổng hợp).`,
          insights: results.slice(0, 4).map((r: any) => r.snippet.split('. ')[0]),
          trends: [], competitors: [],
          ideas: plan.keyMessages.map((m) => `Bài đăng nhấn mạnh: ${m}`),
          keywords: plan.searchKeywords,
          sources: results.map((r: any) => ({ title: r.title, url: r.url })),
          method: 'tavily',
        } satisfies ResearchOutput,
        resultKind: 'real',
        summary: `Đã thu ${results.length} nguồn web (Tavily)`,
      };
    }

    // Demo mode: clearly labelled sample research, no fake sources.
    ctx.progress(0.4, `Đang nghiên cứu xu hướng ${plan.product}... (demo)`);
    await ctx.pace();
    ctx.progress(0.8, 'Đang đề xuất ý tưởng nội dung... (demo)');
    await ctx.pace();
    return {
      output: {
        summary: `[MẪU DEMO] Chưa kết nối Claude hoặc công cụ tìm kiếm nên đây là nội dung mẫu, không phải nghiên cứu thật.`,
        insights: [
          `Khách hàng quan tâm chất lượng và độ tin cậy của ${plan.product}`,
          'Video ngắn dọc 9:16 có tỉ lệ xem hết cao trên TikTok/Reels',
          'Bài có giá/ưu đãi rõ ràng nhận nhiều tin nhắn hỏi mua hơn',
        ],
        trends: ['Nội dung hậu trường (behind-the-scenes)', 'Video unboxing / review thật'],
        competitors: ['(Cần kết nối công cụ nghiên cứu để phân tích đối thủ thật)'],
        ideas: [
          `Giới thiệu ${plan.product} trong 15 giây: vấn đề → giải pháp`,
          'Bộ ảnh chi tiết sản phẩm + thông số',
          'Câu chuyện khách hàng sử dụng thực tế',
          'Ưu đãi giới hạn thời gian kèm CTA nhắn tin',
        ],
        keywords: plan.searchKeywords,
        sources: [],
        method: 'demo',
      } satisfies ResearchOutput,
      resultKind: 'simulated',
      summary: 'Nghiên cứu MẪU (demo, không có nguồn thật)',
    };
  },
};
