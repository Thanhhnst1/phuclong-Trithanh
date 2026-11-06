import type { AgentImpl } from './types.js';
import { campaigns } from '../db/index.js';
import { makePlan } from '../orchestrator/planner.js';
import type { HuntOptions } from '../core/types.js';

export const planner: AgentImpl = {
  async run(ctx) {
    ctx.progress(0.2, 'Tổng biên tập đang phân tích yêu cầu & lập kế hoạch săn tin…');
    await ctx.pace();
    const prev = (ctx.campaign.plan ?? {}) as any;
    const opts: HuntOptions = { count: prev.options?.count ?? 8, categories: prev.options?.categories ?? [], region: prev.options?.region ?? 'both' };
    const plan = await makePlan(ctx.campaign.goal, ctx.campaign.platforms, opts, ctx.llm, ctx.signal);
    const merged = { ...plan, options: opts, revisionNotes: prev.revisionNotes ?? [] };
    campaigns.update(ctx.campaign.id, { plan: merged, title: plan.title });
    ctx.campaign.plan = merged;
    ctx.progress(0.9, `Kế hoạch: tìm ${plan.count} chủ đề · ${plan.categories.length} nhóm`);
    await ctx.pace();
    return {
      output: merged,
      resultKind: plan.generatedBy,
      summary: plan.generatedBy === 'ai' ? 'Đã lập kế hoạch săn tin bằng AI' : 'Kế hoạch theo mẫu (demo, chưa có AI)',
    };
  },
};
