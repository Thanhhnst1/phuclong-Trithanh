import { PLATFORMS, type CampaignPlan, type HuntOptions, type Platform } from '../core/types.js';
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

export const CATEGORIES = [
  'Bí ẩn chưa có lời giải',
  'Khám phá khoa học',
  'Khảo cổ & lịch sử',
  'Hiện tượng tự nhiên',
  'Chuyện con người cảm động',
  'Sự việc hy hữu',
  'AI & công nghệ',
  'Sự thật ít người biết',
] as const;

const CATEGORY_HINTS: [RegExp, string][] = [
  [/bi an|ky la|ky bi|chua co loi giai|huyen bi/, 'Bí ẩn chưa có lời giải'],
  [/khoa hoc|nghien cuu|vu tru|thien van/, 'Khám phá khoa học'],
  [/khao co|lich su|co dai/, 'Khảo cổ & lịch sử'],
  [/tu nhien|thien nhien|dong vat|thoi tiet/, 'Hiện tượng tự nhiên'],
  [/cam dong|long tot|ky tich|con nguoi/, 'Chuyện con người cảm động'],
  [/hy huu|kho tin|bat thuong/, 'Sự việc hy hữu'],
  [/\bai\b|cong nghe|tri tue nhan tao|robot/, 'AI & công nghệ'],
];

export function detectCategories(goal: string): string[] {
  const f = fold(goal);
  return CATEGORY_HINTS.filter(([r]) => r.test(f)).map(([, c]) => c);
}

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'goalSummary', 'focus', 'searchQueries', 'avoid'],
  properties: {
    title: { type: 'string', description: 'Tên phiên săn tin ngắn gọn, tiếng Việt' },
    goalSummary: { type: 'string' },
    focus: { type: 'string', description: 'Hướng săn tin cụ thể cho phóng viên' },
    searchQueries: { type: 'array', items: { type: 'string' }, description: '6-10 truy vấn tìm kiếm (cả tiếng Việt và tiếng Anh)' },
    avoid: { type: 'array', items: { type: 'string' }, description: 'Những loại nội dung phải tránh' },
  },
};

export const ETHICS = [
  'Không bịa sự kiện, nhân vật, lời nói, số liệu.',
  'Không giật tít gây hiểu lầm, không biến tin đồn thành sự thật.',
  'Không gán tội khi chưa có kết luận của cơ quan có thẩm quyền.',
  'Không xâm phạm đời tư, không tiết lộ dữ liệu cá nhân.',
  'Không kích động thù hận, phân biệt đối xử; không khai thác bi kịch theo hướng phản cảm.',
  'Không dùng tin cũ trình bày như tin mới.',
];

export async function makePlan(goal: string, platforms: Platform[], opts: HuntOptions, llm: LLM | null, signal?: AbortSignal): Promise<CampaignPlan> {
  const categories = opts.categories.length ? opts.categories : detectCategories(goal).length ? detectCategories(goal) : [...CATEGORIES];
  const regionText = opts.region === 'vn' ? 'trong nước' : opts.region === 'world' ? 'thế giới' : 'trong nước và thế giới';
  const base = { platforms, categories, region: opts.region, count: Math.min(10, Math.max(5, opts.count)) };
  if (llm) {
    const p = await llm.json<Pick<CampaignPlan, 'title' | 'goalSummary' | 'focus' | 'searchQueries' | 'avoid'>>({
      system: 'Bạn là Tổng biên tập một tòa soạn nội dung Facebook tại Việt Nam: săn nhanh, kiểm chứng kỹ, uy tín đứng trên lượt xem.',
      prompt: `Yêu cầu của chủ kênh: "${goal}"\nNhóm chủ đề: ${categories.join(', ')}\nPhạm vi: ${regionText}\nSố chủ đề cần đề xuất: ${base.count}\nHôm nay: ${new Date().toISOString().slice(0, 10)}\nLập kế hoạch săn tin theo schema.`,
      schema: PLAN_SCHEMA,
      effort: 'low',
      signal,
    });
    return { ...p, ...base, avoid: [...new Set([...p.avoid, ...ETHICS])], generatedBy: 'ai' };
  }
  return {
    title: `Săn tin: ${categories.slice(0, 2).join(', ')}${categories.length > 2 ? '…' : ''}`,
    goalSummary: goal,
    focus: `Tìm ${base.count} câu chuyện ${regionText} thuộc nhóm: ${categories.join(', ')}; ưu tiên có thật, bất ngờ, có nguồn uy tín.`,
    searchQueries: categories.map((c) => `${c} mới nhất`),
    avoid: ETHICS,
    ...base,
    generatedBy: 'simulated',
  };
}
