import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, setup, waitFor } from './helpers.js';
import { assets, contents, publications, settings, tasks } from '../src/db/index.js';
import { absPath } from '../src/media/index.js';
import { overrides } from '../src/agents/index.js';
import { RetryableError, FatalError } from '../src/core/types.js';

let app: Awaited<ReturnType<typeof setup>>;
let admin: string;

beforeAll(async () => {
  app = await setup();
  admin = await login(app, 'admin');
});
afterAll(() => overrides.clear());

const create = async (goal: string, extra: Record<string, unknown> = {}) => {
  const r = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: admin }, payload: { goal, ...extra } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};

const approveAll = async (cid: string) => {
  const sel: Record<string, { contentId: string }> = {};
  for (const c of contents.forCampaign(cid)) if (!sel[c.platform]) sel[c.platform] = { contentId: c.id };
  const r = await app.inject({ method: 'POST', url: `/api/campaigns/${cid}/approve`, headers: { cookie: admin }, payload: { selections: sel } });
  expect(r.statusCode, r.body).toBe(200);
};

describe('auth & permissions', () => {
  it('rejects anonymous and under-privileged requests', async () => {
    expect((await app.inject({ url: '/api/campaigns' })).statusCode).toBe(401);
    const viewer = await login(app, 'viewer');
    expect((await app.inject({ url: '/api/campaigns', headers: { cookie: viewer } })).statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: viewer }, payload: { goal: 'Quảng bá sản phẩm lên Facebook' } });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/integrations/facebook', headers: { cookie: viewer }, payload: {} })).statusCode).toBe(403);
  });

  it('never returns stored secrets in clear text', async () => {
    await app.inject({ method: 'PUT', url: '/api/integrations/tavily', headers: { cookie: admin }, payload: { apiKey: 'tvly-SECRETVALUE123456' } });
    const r = await app.inject({ url: '/api/integrations', headers: { cookie: admin } });
    expect(r.body).not.toContain('SECRETVALUE');
    await app.inject({ method: 'DELETE', url: '/api/integrations/tavily', headers: { cookie: admin } });
  });
});

describe('demo mode: full workflow end-to-end', () => {
  it('plans, researches, collects, edits, writes, waits for approval, simulates publishing and reports', async () => {
    const cid = await create('Quảng bá bộ quà Tết này lên Zalo, Facebook, TikTok và Threads.');
    await waitFor(cid, ['awaiting_approval']);

    const ts = tasks.forCampaign(cid);
    expect(ts.find((t) => t.stepKey === 'approve')!.status).toBe('awaiting_approval');
    expect(ts.filter((t) => t.platform).every((t) => t.status === 'pending')).toBe(true);
    // research & writer outputs are honestly labelled as demo
    expect(ts.find((t) => t.stepKey === 'research')!.resultKind).toBe('simulated');
    expect(ts.find((t) => t.stepKey === 'write')!.resultKind).toBe('simulated');

    const cs = contents.forCampaign(cid);
    expect(new Set(cs.map((c) => c.platform))).toEqual(new Set(['zalo', 'facebook', 'tiktok', 'threads']));
    expect(cs.filter((c) => c.platform === 'facebook')).toHaveLength(3);

    const edited = assets.list({ campaignId: cid, role: 'edited' });
    expect(edited.some((a) => a.kind === 'video')).toBe(true);
    for (const a of edited) expect(fs.existsSync(absPath(a.path))).toBe(true);

    await approveAll(cid);
    const done = await waitFor(cid, ['completed', 'completed_with_errors', 'failed']);
    expect(done.status).toBe('completed');

    const pubs = publications.forCampaign(cid);
    expect(pubs).toHaveLength(4);
    expect(pubs.every((p) => p.mode === 'simulated' && p.status === 'simulated' && p.url === null)).toBe(true);

    const report = (await app.inject({ url: `/api/reports/${cid}.json`, headers: { cookie: admin } })).json();
    expect(report.totals).toMatchObject({ published: 0, simulated: 4 });
    const pdf = await app.inject({ url: `/api/reports/${cid}.pdf`, headers: { cookie: admin } });
    expect(pdf.headers['content-type']).toContain('pdf');
    const xlsx = await app.inject({ url: `/api/reports/${cid}.xlsx`, headers: { cookie: admin } });
    expect(xlsx.statusCode).toBe(200);
    expect(assets.list({ campaignId: cid, role: 'report' })).toHaveLength(2);
  });

  it('reject sends content back to the writer with feedback', async () => {
    const cid = await create('Giới thiệu răng gầu K100 lên Facebook', { workflowId: 'wf_quick' });
    await waitFor(cid, ['awaiting_approval']);
    const before = contents.forCampaign(cid).map((c) => c.id);
    const r = await app.inject({ method: 'POST', url: `/api/campaigns/${cid}/reject`, headers: { cookie: admin }, payload: { feedback: 'Thêm số hotline' } });
    expect(r.statusCode, r.body).toBe(200);
    await waitFor(cid, ['awaiting_approval']);
    const after = contents.forCampaign(cid).map((c) => c.id);
    expect(after.some((id) => before.includes(id))).toBe(false);
    expect((tasks.forCampaign(cid).find((t) => t.stepKey === 'write')!).attempts).toBe(1);
  });
});

describe('production mode without credentials', () => {
  it('falls back to manual publishing, never reports a fake success', async () => {
    settings.set('mode', 'production');
    try {
      const cid = await create('Quảng bá răng gầu lên Facebook và Threads', { workflowId: 'wf_quick' });
      await waitFor(cid, ['awaiting_approval']);
      await approveAll(cid);
      await waitFor(cid, ['completed', 'completed_with_errors']);
      const pubs = publications.forCampaign(cid);
      expect(pubs.map((p) => p.status).sort()).toEqual(['manual_pending', 'manual_pending']);
      const r = await app.inject({ method: 'POST', url: `/api/publications/${pubs[0].id}/manual-done`, headers: { cookie: admin }, payload: { url: 'https://facebook.com/123' } });
      expect(r.json().status).toBe('manual_done');
    } finally {
      settings.set('mode', 'demo');
    }
  });
});

describe('error handling', () => {
  it('retries transient errors with backoff', async () => {
    let calls = 0;
    overrides.set('research', { async run() { calls++; if (calls < 3) throw new RetryableError('mạng chập chờn'); return { output: { ideas: [] }, resultKind: 'simulated', summary: 'ok' }; } });
    const cid = await create('Quảng bá sản phẩm lên Facebook');
    await waitFor(cid, ['awaiting_approval']);
    const t = tasks.forCampaign(cid).find((x) => x.stepKey === 'research')!;
    expect(t.status).toBe('succeeded');
    expect(t.attempts).toBe(3);
    overrides.delete('research');
    await app.inject({ method: 'POST', url: `/api/campaigns/${cid}/cancel`, headers: { cookie: admin } });
  });

  it('fatal error fails the task, blocks dependents, and can be retried', async () => {
    let fail = true;
    overrides.set('research', { async run() { if (fail) throw new FatalError('thiếu quyền'); return { output: {}, resultKind: 'simulated', summary: 'ok' }; } });
    const cid = await create('Quảng bá sản phẩm lên Facebook');
    await waitFor(cid, ['completed_with_errors']);
    const ts = tasks.forCampaign(cid);
    const research = ts.find((x) => x.stepKey === 'research')!;
    expect(research.status).toBe('failed');
    expect(research.attempts).toBe(1);
    expect(ts.find((x) => x.stepKey === 'write')!.status).toBe('blocked');
    expect(ts.find((x) => x.stepKey === 'report')!.status).toBe('succeeded'); // settled deps → report still produced

    fail = false;
    const r = await app.inject({ method: 'POST', url: `/api/campaigns/${cid}/tasks/${research.id}/retry`, headers: { cookie: admin } });
    expect(r.statusCode, r.body).toBe(200);
    await waitFor(cid, ['awaiting_approval']);
    overrides.delete('research');
    await app.inject({ method: 'POST', url: `/api/campaigns/${cid}/cancel`, headers: { cookie: admin } });
  });

  it('times out hung tasks and supports cancel', async () => {
    overrides.set('research', { run: () => new Promise(() => {}) });
    const cid = await create('Quảng bá sản phẩm lên Facebook');
    await new Promise((r) => setTimeout(r, 300));
    const t = tasks.forCampaign(cid).find((x) => x.stepKey === 'research')!;
    expect(t.status).toBe('running');
    const r = await app.inject({ method: 'POST', url: `/api/campaigns/${cid}/cancel`, headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    await waitFor(cid, ['cancelled']);
    await new Promise((r) => setTimeout(r, 100));
    expect(tasks.forCampaign(cid).every((x) => ['cancelled', 'succeeded'].includes(x.status))).toBe(true);
    overrides.delete('research');
  });
});
