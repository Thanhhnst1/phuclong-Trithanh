import path from 'node:path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { campaigns, publications, tasks, contents, stories } from '../db/index.js';
import { paths } from '../config.js';
import type { Campaign, Publication, Task } from '../core/types.js';
import { profileOf } from '../agents/types.js';

export interface CampaignReport {
  campaign: Pick<Campaign, 'id' | 'title' | 'goal' | 'status' | 'mode' | 'createdAt' | 'platforms'>;
  generatedAt: string;
  tasks: { total: number; byStatus: Record<string, number>; list: Pick<Task, 'title' | 'agent' | 'status' | 'resultKind' | 'attempts' | 'error' | 'startedAt' | 'finishedAt'>[] };
  publications: (Pick<Publication, 'platform' | 'mode' | 'status' | 'url' | 'error' | 'metrics'> & { title: string | null })[];
  totals: { published: number; simulated: number; manualPending: number; manualDone: number; failed: number };
  engagement: Record<string, number>;
  stories: { title: string; verification: string; status: string; appealScore: number; when: string; where: string; angle: string; sources: string[]; note: string }[];
}

const VERIF: Record<string, string> = { confirmed: 'Đã xác nhận', partial: 'Xác nhận một phần', insufficient: 'Chưa đủ bằng chứng', demo: 'MẪU DEMO' };
const STORY_ST: Record<string, string> = { proposed: 'Đề xuất', held: 'Chờ kiểm chứng', rejected: 'Loại', selected: 'Đã chọn', published: 'Đã đăng', candidate: 'Ứng viên' };

const STATUS_VI: Record<string, string> = {
  published: 'Đã đăng (thật)', draft_uploaded: 'Đã gửi nháp', simulated: 'MÔ PHỎNG', manual_pending: 'Chờ đăng tay', manual_done: 'Đã đăng tay', failed: 'Lỗi',
  succeeded: 'Thành công', running: 'Đang chạy', pending: 'Chờ', awaiting_approval: 'Chờ duyệt', cancelled: 'Đã hủy', skipped: 'Bỏ qua', blocked: 'Bị chặn',
};
export const vi = (s: string) => STATUS_VI[s] ?? s;

export function buildReport(campaignId: string): CampaignReport {
  const c = campaigns.get(campaignId);
  if (!c) throw new Error('Không tìm thấy chiến dịch');
  const ts = tasks.forCampaign(campaignId);
  const pubs = publications.forCampaign(campaignId);
  const byStatus: Record<string, number> = {};
  for (const t of ts) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const engagement: Record<string, number> = {};
  for (const p of pubs) for (const [k, v] of Object.entries(p.metrics ?? {})) if (typeof v === 'number') engagement[k] = (engagement[k] ?? 0) + v;
  const count = (s: string) => pubs.filter((p) => p.status === s).length;
  return {
    campaign: { id: c.id, title: c.title, goal: c.goal, status: c.status, mode: c.mode, createdAt: c.createdAt, platforms: c.platforms },
    generatedAt: new Date().toISOString(),
    tasks: {
      total: ts.length, byStatus,
      list: ts.map((t) => ({ title: t.title, agent: t.agent, status: t.status, resultKind: t.resultKind, attempts: t.attempts, error: t.error, startedAt: t.startedAt, finishedAt: t.finishedAt })),
    },
    publications: pubs.map((p) => ({
      platform: p.platform, mode: p.mode, status: p.status, url: p.url, error: p.error, metrics: p.metrics,
      title: p.contentId ? contents.get(p.contentId)?.title ?? null : null,
    })),
    totals: {
      published: count('published') + count('draft_uploaded'), simulated: count('simulated'), manualPending: count('manual_pending'),
      manualDone: count('manual_done'), failed: count('failed'),
    },
    engagement,
    stories: stories.forCampaign(campaignId).map((x) => ({
      title: x.title, verification: VERIF[x.verification] ?? x.verification, status: STORY_ST[x.status] ?? x.status, appealScore: x.appealScore,
      when: x.when, where: x.where, angle: x.angle, sources: x.sources.map((y) => y.url), note: x.checkNote,
    })),
  };
}

export async function reportToXlsx(r: CampaignReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI Office';
  const s = wb.addWorksheet('Tổng quan');
  s.columns = [{ width: 28 }, { width: 70 }];
  const rows: [string, any][] = [
    ['Chiến dịch', r.campaign.title], ['Mục tiêu', r.campaign.goal], ['Chế độ', r.campaign.mode === 'demo' ? 'DEMO (mô phỏng)' : 'Production'],
    ['Trạng thái', r.campaign.status], ['Nền tảng', r.campaign.platforms.join(', ')], ['Tạo lúc', r.campaign.createdAt], ['Xuất báo cáo', r.generatedAt],
    ['Đăng thật', r.totals.published], ['Mô phỏng', r.totals.simulated], ['Chờ đăng tay', r.totals.manualPending], ['Đã đăng tay', r.totals.manualDone], ['Lỗi', r.totals.failed],
    ...Object.entries(r.engagement).map(([k, v]) => [`Tương tác: ${k}`, v] as [string, any]),
  ];
  rows.forEach((row) => s.addRow(row));
  s.getColumn(1).font = { bold: true };

  const st = wb.addWorksheet('Chủ đề');
  st.columns = [
    { header: 'Chủ đề', key: 'title', width: 50 }, { header: 'Xác minh', key: 'verification', width: 20 }, { header: 'Trạng thái', key: 'status', width: 16 },
    { header: 'Điểm hấp dẫn', key: 'appealScore', width: 12 }, { header: 'Thời gian', key: 'when', width: 18 }, { header: 'Địa điểm', key: 'where', width: 18 },
    { header: 'Góc khai thác', key: 'angle', width: 14 }, { header: 'Nguồn', key: 'sources', width: 60 }, { header: 'Ghi chú kiểm chứng', key: 'note', width: 50 },
  ];
  for (const x of r.stories) st.addRow({ ...x, sources: x.sources.join('\n') });
  st.getRow(1).font = { bold: true };

  const p = wb.addWorksheet('Bài đăng');
  p.columns = [
    { header: 'Nền tảng', key: 'platform', width: 12 }, { header: 'Chế độ', key: 'mode', width: 12 }, { header: 'Trạng thái', key: 'status', width: 18 },
    { header: 'Tiêu đề', key: 'title', width: 40 }, { header: 'Link', key: 'url', width: 50 }, { header: 'Số liệu', key: 'metrics', width: 40 }, { header: 'Lỗi', key: 'error', width: 40 },
  ];
  for (const x of r.publications) p.addRow({ ...x, status: vi(x.status), metrics: x.metrics ? JSON.stringify(x.metrics) : '', url: x.url ?? '' });
  p.getRow(1).font = { bold: true };

  const t = wb.addWorksheet('Tác vụ');
  t.columns = [
    { header: 'Bước', key: 'title', width: 30 }, { header: 'Agent', key: 'agent', width: 20 }, { header: 'Trạng thái', key: 'status', width: 16 },
    { header: 'Loại kết quả', key: 'resultKind', width: 14 }, { header: 'Số lần chạy', key: 'attempts', width: 12 }, { header: 'Bắt đầu', key: 'startedAt', width: 24 },
    { header: 'Kết thúc', key: 'finishedAt', width: 24 }, { header: 'Lỗi', key: 'error', width: 50 },
  ];
  for (const x of r.tasks.list) t.addRow({ ...x, agent: profileOf(x.agent as any)?.name ?? x.agent, status: vi(x.status) });
  t.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reportToPdf(r: CampaignReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', path.join(paths.fonts, 'DejaVuSans.ttf'));
    doc.registerFont('B', path.join(paths.fonts, 'DejaVuSans-Bold.ttf'));

    doc.font('B').fontSize(18).fillColor('#2B2D42').text('Báo cáo chiến dịch');
    doc.font('R').fontSize(11).fillColor('#555').text(r.campaign.title).moveDown(0.5);
    if (r.campaign.mode === 'demo') {
      doc.font('B').fillColor('#C0392B').text('CHẾ ĐỘ DEMO — các bài "Mô phỏng" KHÔNG được đăng thật.').moveDown(0.5);
    }
    doc.font('R').fillColor('#222').fontSize(10);
    doc.text(`Mục tiêu: ${r.campaign.goal}`);
    doc.text(`Nền tảng: ${r.campaign.platforms.join(', ')}   ·   Trạng thái: ${r.campaign.status}`);
    doc.text(`Xuất lúc: ${new Date(r.generatedAt).toLocaleString('vi-VN')}`).moveDown();

    if (r.stories.length) {
      doc.font('B').fontSize(13).text('Chủ đề đã săn & kiểm chứng').moveDown(0.3);
      for (const x of r.stories) {
        doc.font('B').fontSize(10).text(`• [${x.appealScore}/10] ${x.title}`);
        doc.font('R').text(`  ${x.verification} · ${x.status} · ${x.when} · ${x.where}`);
        for (const u of x.sources.slice(0, 3)) doc.fillColor('#1a5fb4').text(`  ${u}`, { link: u }).fillColor('#222');
        if (x.note) doc.fillColor('#555').text(`  ${x.note}`).fillColor('#222');
      }
      doc.moveDown();
    }
    doc.font('B').fontSize(13).text('Kết quả xuất bản').moveDown(0.3);
    doc.font('R').fontSize(10).text(
      `Đăng thật: ${r.totals.published}   Mô phỏng: ${r.totals.simulated}   Chờ đăng tay: ${r.totals.manualPending}   Đã đăng tay: ${r.totals.manualDone}   Lỗi: ${r.totals.failed}`,
    ).moveDown(0.5);
    for (const p of r.publications) {
      doc.font('B').text(`• ${p.platform.toUpperCase()} — ${vi(p.status)}`, { continued: false });
      if (p.title) doc.font('R').text(`  ${p.title}`);
      if (p.url) doc.fillColor('#1a5fb4').text(`  ${p.url}`, { link: p.url }).fillColor('#222');
      if (p.metrics) doc.text(`  Số liệu: ${Object.entries(p.metrics).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      if (p.error) doc.fillColor('#C0392B').text(`  Lỗi: ${p.error}`).fillColor('#222');
    }
    if (!r.publications.length) doc.text('Chưa có bài đăng.');
    doc.moveDown();

    doc.font('B').fontSize(13).text('Tiến trình các Agent').moveDown(0.3);
    doc.font('R').fontSize(10);
    for (const t of r.tasks.list) {
      const name = profileOf(t.agent as any)?.name ?? t.agent;
      doc.text(`• ${t.title} (${name}) — ${vi(t.status)}${t.resultKind === 'simulated' ? ' [mô phỏng]' : ''}${t.attempts > 1 ? ` · ${t.attempts} lần chạy` : ''}`);
      if (t.error) doc.fillColor('#C0392B').text(`  ${t.error}`).fillColor('#222');
    }
    doc.end();
  });
}

/** Cross-campaign dashboard numbers. */
export function overview() {
  const cs = campaigns.list();
  const pubs = publications.all();
  const byStatus: Record<string, number> = {};
  for (const c of cs) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const byPlatform: Record<string, Record<string, number>> = {};
  for (const p of pubs) {
    byPlatform[p.platform] ??= {};
    byPlatform[p.platform][p.status] = (byPlatform[p.platform][p.status] ?? 0) + 1;
  }
  return { campaigns: cs.length, byStatus, byPlatform, publications: pubs.length };
}
