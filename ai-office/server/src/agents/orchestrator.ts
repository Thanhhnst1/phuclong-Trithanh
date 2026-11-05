import type { AgentImpl } from './types.js';
import { campaigns } from '../db/index.js';
import { makePlan } from '../orchestrator/planner.js';

export const planner: AgentImpl = {
  async run(ctx) {
    ctx.progress(0.2, 'Đang phân tích mục tiêu & lập kế hoạch...');
    await ctx.pace();
    const plan = await makePlan(ctx.campaign.goal, ctx.campaign.platforms, ctx.llm, ctx.signal);
    const prev = ctx.campaign.plan as any;
    const merged = { ...plan, revisionNotes: prev?.revisionNotes ?? [] };
    campaigns.update(ctx.campaign.id, { plan: merged, title: plan.title });
    ctx.campaign.plan = merged;
    ctx.progress(0.9, `Kế hoạch: ${plan.platforms.length} nền tảng, ${plan.keyMessages.length} thông điệp`);
    await ctx.pace();
    return {
      output: merged,
      resultKind: plan.generatedBy,
      summary: plan.generatedBy === 'ai' ? 'Đã lập kế hoạch bằng AI' : 'Kế hoạch theo mẫu (demo, chưa có AI)',
    };
  },
};
