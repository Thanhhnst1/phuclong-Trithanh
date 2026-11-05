import type { AgentImpl } from './types.js';
import { publications } from '../db/index.js';
import { facebookMetrics } from '../integrations/facebook.js';
import { threadsMetrics } from '../integrations/threads.js';
import { buildReport, reportToPdf, reportToXlsx } from '../reports/index.js';
import { storeAsset } from '../media/index.js';
import { bus } from '../core/bus.js';

/** Collects engagement numbers — only for real publications; nothing is invented for simulated ones. */
export const metricsCollector: AgentImpl = {
  async run(ctx) {
    const pubs = publications.forCampaign(ctx.campaign.id);
    const real = pubs.filter((p) => p.mode === 'real' && p.status === 'published' && p.externalId);
    ctx.progress(0.2, `Đang thu số liệu cho ${real.length} bài đăng thật...`);
    await ctx.pace();
    let fetched = 0;
    for (const p of real) {
      try {
        let m: Record<string, number> | null = null;
        if (p.platform === 'facebook') m = await facebookMetrics(p.externalId!);
        if (p.platform === 'threads') m = await threadsMetrics(p.externalId!);
        if (m) {
          publications.update(p.id, { metrics: m });
          fetched++;
        }
      } catch (e: any) {
        ctx.log(`Không lấy được số liệu ${p.platform}: ${e.message}`, 'warn');
      }
    }
    const skipped = pubs.length - real.length;
    if (skipped) ctx.log(`${skipped} bài không phải đăng thật (mô phỏng/thủ công/lỗi) → không có số liệu tự động.`);
    bus.publish({ type: 'publication', campaignId: ctx.campaign.id });
    return {
      output: { fetched, skipped },
      resultKind: fetched ? 'real' : 'none',
      summary: fetched ? `Đã thu số liệu ${fetched} bài` : 'Chưa có số liệu thật để thu',
    };
  },
};

export const reporter: AgentImpl = {
  async run(ctx) {
    ctx.progress(0.3, 'Đang tổng hợp báo cáo...');
    await ctx.pace();
    const r = buildReport(ctx.campaign.id);
    ctx.progress(0.6, 'Đang xuất Excel & PDF...');
    const xlsx = await storeAsset({ buffer: await reportToXlsx(r), filename: 'bao-cao.xlsx', campaignId: ctx.campaign.id, role: 'report', source: 'Reporter', license: 'Nội bộ', label: 'Báo cáo Excel' });
    const pdf = await storeAsset({ buffer: await reportToPdf(r), filename: 'bao-cao.pdf', campaignId: ctx.campaign.id, role: 'report', source: 'Reporter', license: 'Nội bộ', label: 'Báo cáo PDF' });
    await ctx.pace();
    const t = r.totals;
    return {
      output: { totals: t, files: { xlsx: xlsx.id, pdf: pdf.id } },
      resultKind: 'real',
      summary: `Báo cáo: ${t.published} đăng thật, ${t.simulated} mô phỏng, ${t.manualPending} chờ đăng tay, ${t.failed} lỗi`,
    };
  },
};
