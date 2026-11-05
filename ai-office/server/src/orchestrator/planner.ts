import { PLATFORMS, type CampaignPlan, type Platform } from '../core/types.js';
import { fold } from '../core/util.js';
import type { LLM } from '../llm/index.js';

const PLATFORM_PATTERNS: Record<Platform, RegExp> = {
  zalo: /\bzalo\b/,
  facebook: /\b(facebook|fb|face|fanpage)\b/,
  tiktok: /\btik ?tok\b/,
  threads: /\bthreads?\b/,
};

/** Detect target platforms mentioned in a Vietnamese/English goal. Empty when none are named. */
export function detectPlatforms(goal: string): Platform[] {
  const f = fold(goal);
  return PLATFORMS.filter((p) => PLATFORM_PATTERNS[p].test(f));
}

/** Rough product extraction for demo mode: text after an action verb, before "lên/trên/tới…". */
export function extractProduct(goal: string): string {
  const m = goal.match(/(?:quảng bá|quảng cáo|giới thiệu|bán|ra mắt|đăng bài về|đăng|promote|marketing)\s+(.+?)(?=\s+(?:lên|trên|tới|đến|qua|cho|vào|tại|on|to)\s|[,.;!?]|$)/i);
  let p = (m?.[1] ?? goal).trim();
  p = p.replace(/^(?:sản phẩm|bộ|chiếc|cái|mẫu)\s+này$/i, 'sản phẩm').replace(/\s+này$/i, '').trim();
  if (!p || p.length > 80) p = 'Sản phẩm mới';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'product', 'goalSummary', 'audience', 'tone', 'keyMessages', 'headline', 'searchKeywords'],
  properties: {
    title: { type: 'string', description: 'Tên chiến dịch ngắn gọn, tiếng Việt' },
    product: { type: 'string', description: 'Sản phẩm/dịch vụ được quảng bá' },
    goalSummary: { type: 'string' },
    audience: { type: 'string', description: 'Chân dung khách hàng mục tiêu' },
    tone: { type: 'string', description: 'Giọng điệu thương hiệu phù hợp' },
    keyMessages: { type: 'array', items: { type: 'string' }, description: '3-5 thông điệp chính' },
    headline: { type: 'string', description: 'Tiêu đề poster ≤ 60 ký tự' },
    searchKeywords: { type: 'array', items: { type: 'string' }, description: '3-6 từ khóa nghiên cứu / tìm ảnh' },
  },
};

export async function makePlan(goal: string, platforms: Platform[], llm: LLM | null, signal?: AbortSignal): Promise<CampaignPlan> {
  if (llm) {
    const p = await llm.json<Omit<CampaignPlan, 'platforms' | 'generatedBy'>>({
      system:
        'Bạn là Orchestrator của một đội AI marketing tại Việt Nam. Phân tích mục tiêu của người dùng và lập kế hoạch chiến dịch ngắn gọn, thực tế. Không bịa số liệu.',
      prompt: `Mục tiêu: "${goal}"\nNền tảng: ${platforms.join(', ')}\nTrả về kế hoạch theo schema.`,
      schema: PLAN_SCHEMA,
      effort: 'low',
      signal,
    });
    return { ...p, platforms, generatedBy: 'ai' };
  }
  const product = extractProduct(goal);
  const f = fold(goal);
  const tet = /\btet\b|xuan|nam moi/.test(f);
  return {
    title: `Chiến dịch: ${product}`,
    product,
    goalSummary: goal,
    platforms,
    audience: tet ? 'Gia đình, nhân viên văn phòng mua quà biếu Tết (25-45 tuổi)' : 'Khách hàng hiện tại và khách hàng tiềm năng quan tâm sản phẩm',
    tone: tet ? 'Ấm áp, sang trọng, đậm không khí Tết' : 'Thân thiện, chuyên nghiệp, đáng tin cậy',
    keyMessages: tet
      ? ['Quà Tết trọn vẹn, ý nghĩa', 'Đóng gói sang trọng, sẵn sàng biếu tặng', 'Giao nhanh trước Tết']
      : [`${product} chất lượng, giá tốt`, 'Tư vấn tận tình, giao hàng nhanh', 'Cam kết chính hãng'],
    headline: product.length < 40 ? `${product} — Chất lượng tạo niềm tin` : product,
    searchKeywords: [product, ...(tet ? ['quà tết', 'gift box'] : ['khuyến mãi'])],
    generatedBy: 'simulated',
  };
}
