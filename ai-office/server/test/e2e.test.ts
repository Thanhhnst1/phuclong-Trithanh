import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, setup, waitFor } from './helpers.js';
import { assets, contents, publications, settings, stories, tasks } from '../src/db/index.js';
import { absPath } from '../src/media/index.js';
import { overrides } from '../src/agents/index.js';
import { RetryableError, FatalError } from '../src/core/types.js';
import { setLLMOverride, type LLM } from '../src/llm/index.js';
import { runAutoHunt, saveAutoHunt } from '../src/orchestrator/autohunt.js';

let app: Awaited<ReturnType<typeof setup>>;
let admin: string;

beforeAll(async () => {
  app = await setup();
  admin = await login(app, 'admin');
});
afterAll(() => { overrides.clear(); setLLMOverride(null); });

const create = async (goal: string, extra: Record<string, unknown> = {}) => {
  const r = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: admin }, payload: { goal, ...extra } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};
const act = (cid: string, action: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api/campaigns/${cid}/${action}`, headers: { cookie: admin }, payload: payload as any });

const selectAll = async (cid: string, n = 2) => {
  const ids = stories.forCampaign(cid).filter((s) => s.status === 'proposed').slice(0, n).map((s) => s.id);
  const r = await act(cid, 'select', { storyIds: ids });
  expect(r.statusCode, r.body).toBe(200);
  return ids;
};
const approveAll = async (cid: string) => {
  const pick = new Map<string, string>();
  for (const c of contents.forCampaign(cid)) if (!pick.has(`${c.storyId}:${c.platform}`)) pick.set(`${c.storyId}:${c.platform}`, c.id);
  const r = await act(cid, 'approve', { contentIds: [...pick.values()] });
  expect(r.statusCode, r.body).toBe(200);
  return pick.size;
};

describe('auth & permissions', () => {
  it('rejects anonymous and under-privileged requests', async () => {
    expect((await app.inject({ url: '/api/campaigns' })).statusCode).toBe(401);
    const viewer = await login(app, 'viewer');
    expect((await app.inject({ url: '/api/campaigns', headers: { cookie: viewer } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie: viewer }, payload: { goal: 'Săn chuyện lạ hôm nay' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/integrations/facebook', headers: { cookie: viewer }, payload: {} })).statusCode).toBe(403);
  });
  it('never returns stored secrets in clear text', async () => {
    await app.inject({ method: 'PUT', url: '/api/integrations/tavily', headers: { cookie: admin }, payload: { apiKey: 'tvly-SECRETVALUE123456' } });
    const r = await app.inject({ url: '/api/integrations', headers: { cookie: admin } });
    expect(r.body).not.toContain('SECRETVALUE');
    await app.inject({ method: 'DELETE', url: '/api/integrations/tavily', headers: { cookie: admin } });
  });
});

describe('demo newsroom end-to-end', () => {
  it('hunts, checks, waits for topic choice, designs + writes, waits for approval, simulates posting, reports', async () => {
    const cid = await create('Săn chuyện bí ẩn và khám phá khoa học cho trang Facebook', { options: { count: 5, categories: [], region: 'both' } });
    await waitFor(cid, ['awaiting_approval']);
    const ss = stories.forCampaign(cid);
    expect(ss.length).toBeGreaterThan(0);
    expect(ss.every((s) => s.verification === 'demo' && s.title.startsWith('[MẪU DEMO]') && s.sources.length === 0)).toBe(true);
    expect(tasks.forCampaign(cid).find((t) => t.stepKey === 'select')!.status).toBe('awaiting_approval');

    const picked = await selectAll(cid, 2);
    await waitFor(cid, ['awaiting_approval']);
    expect(tasks.forCampaign(cid).find((t) => t.stepKey === 'approve')!.status).toBe('awaiting_approval');
    const cs = contents.forCampaign(cid);
    expect(new Set(cs.map((c) => c.storyId))).toEqual(new Set(picked));
    expect(cs.every((c) => c.platform === 'facebook' && c.body.includes('BÀI MẪU DEMO'))).toBe(true);
    const cards = assets.list({ campaignId: cid, role: 'edited' });
    expect(cards).toHaveLength(2);
    expect(cards.every((a) => a.meta.illustration === true && fs.existsSync(absPath(a.path)))).toBe(true);

    // at most one variant per story+platform
    const twins = cs.filter((c) => c.storyId === picked[0]).map((c) => c.id);
    expect((await act(cid, 'approve', { contentIds: twins })).statusCode).toBe(400);

    const n = await approveAll(cid);
    const done = await waitFor(cid, ['completed', 'completed_with_errors', 'failed']);
    expect(done.status).toBe('completed');
    const pubs = publications.forCampaign(cid);
    expect(pubs).toHaveLength(n);
    expect(pubs.every((p) => p.status === 'simulated' && p.url === null)).toBe(true);
    const report = (await app.inject({ url: `/api/reports/${cid}.json`, headers: { cookie: admin } })).json();
    expect(report.totals).toMatchObject({ published: 0, simulated: n });
    expect(report.stories.length).toBe(ss.length);
    expect((await app.inject({ url: `/api/reports/${cid}.pdf`, headers: { cookie: admin } })).headers['content-type']).toContain('pdf');
  });

  it('send-back at topic stage hunts again; at post stage rewrites', async () => {
    const cid = await create('Săn chuyện lạ', { options: { count: 5, categories: [], region: 'vn' } });
    await waitFor(cid, ['awaiting_approval']);
    const first = stories.forCampaign(cid).map((s) => s.id);
    expect((await act(cid, 'reject', { feedback: 'Thêm chủ đề khảo cổ' })).statusCode).toBe(200);
    await waitFor(cid, ['awaiting_approval']);
    expect(stories.forCampaign(cid).some((s) => first.includes(s.id))).toBe(false);
    await selectAll(cid, 1);
    await waitFor(cid, ['awaiting_approval']);
    const before = contents.forCampaign(cid).map((c) => c.id);
    expect((await act(cid, 'reject', { feedback: 'Hook mạnh hơn' })).statusCode).toBe(200);
    await waitFor(cid, ['awaiting_approval']);
    expect(contents.forCampaign(cid).some((c) => before.includes(c.id))).toBe(false);
    await act(cid, 'cancel');
  });
});

describe('honesty guards with an AI engine', () => {
  // Fake engine: search returns two sources; the model then "hallucinates" an extra URL and over-claims.
  const fake: LLM = {
    provider: 'fake', model: 'fake',
    async research({ prompt }) {
      if (prompt.startsWith('Kiểm chứng')) return { notes: 'chỉ một báo đưa tin', sources: [{ title: 'A', url: 'https://a-news.vn/x' }] };
      return { notes: 'notes', sources: [{ title: 'A', url: 'https://a-news.vn/x' }, { title: 'B', url: 'https://b-science.org/y' }] };
    },
    async json<T>({ schema }: { schema: any }): Promise<T> {
      const req = schema.required as string[];
      if (req.includes('searchQueries')) return { title: 'Săn tin', goalSummary: 'g', focus: 'f', searchQueries: ['q'], avoid: [] } as T;
      if (req.includes('candidates')) {
        return { candidates: [
          { title: 'Hồ nước đổi màu bí ẩn ở Chile', summary: 's', when: '2026', where: 'Chile', category: 'Bí ẩn', sourceUrls: ['https://a-news.vn/x', 'https://invented.example/fake'], appealReasons: 'r', angle: 'bí ẩn', appealScore: 9 },
          { title: 'Chuyện không có nguồn', summary: 's', when: '?', where: '?', category: 'x', sourceUrls: ['https://made-up.example/z'], appealReasons: 'r', angle: 'bí ẩn', appealScore: 8 },
        ] } as T;
      }
      if (req.includes('verification')) {
        return { verification: 'confirmed', confirmedFacts: ['f'], unverifiedClaims: [], hypotheses: ['h'], sources: [{ url: 'https://a-news.vn/x', title: 'A', type: 'press' }, { url: 'https://invented.example/fake', title: 'F', type: 'press' }], originalDate: '2026-01-01', isOldNewsRepackaged: false, mediaNotes: '', risks: [], recommendation: 'publish', note: 'ok' } as T;
      }
      return { variants: [{ platform: 'facebook', title: 't', body: 'b', hashtags: ['x'], cta: '?' }] } as T;
    },
  };

  it('drops invented URLs, downgrades single-source "confirmed", and skips repeated topics', async () => {
    setLLMOverride(fake);
    try {
      const cid = await create('Săn chuyện lạ', { workflowId: 'wf_proposals' });
      await waitFor(cid, ['completed', 'completed_with_errors']);
      const ss = stories.forCampaign(cid);
      expect(ss.map((s) => s.title)).toEqual(['Hồ nước đổi màu bí ẩn ở Chile']); // no-source story removed
      expect(ss[0].sources.map((s) => s.url)).toEqual(['https://a-news.vn/x']); // invented URL removed
      expect(ss[0].verification).toBe('partial'); // only one independent domain
      expect(ss[0].status).toBe('proposed');

      const cid2 = await create('Săn chuyện lạ', { workflowId: 'wf_proposals' });
      await waitFor(cid2, ['completed', 'completed_with_errors']);
      expect(stories.forCampaign(cid2)).toHaveLength(0); // same story already proposed earlier
    } finally {
      setLLMOverride(null);
    }
  });
});

describe('production without credentials', () => {
  it('falls back to manual publishing, never a fake success', async () => {
    settings.set('mode', 'production');
    overrides.set('research', { async run(ctx) {
      stories.create({ campaignId: ctx.campaign.id, title: 'Chủ đề thật đã kiểm chứng', summary: 's', when: 'w', where: 'p', category: 'c', verification: 'confirmed', sources: [{ title: 'a', url: 'https://a.vn' }], appealReasons: '', angle: 'bất ngờ', appealScore: 7, confirmedFacts: [], unverifiedClaims: [], hypotheses: [], risks: [], mediaNotes: '', checkNote: '', status: 'proposed', fingerprint: 'x' });
      return { output: {}, resultKind: 'real', summary: 'ok' };
    } });
    overrides.set('verify', { async run() { return { output: {}, resultKind: 'real', summary: 'ok' }; } });
    try {
      const cid = await create('Săn chuyện lạ lên Facebook và Threads');
      await waitFor(cid, ['awaiting_approval']);
      await selectAll(cid, 1);
      await waitFor(cid, ['awaiting_approval']);
      await approveAll(cid);
      await waitFor(cid, ['completed', 'completed_with_errors']);
      const pubs = publications.forCampaign(cid);
      expect(pubs.map((p) => p.status).sort()).toEqual(['manual_pending', 'manual_pending']);
      const r = await app.inject({ method: 'POST', url: `/api/publications/${pubs[0].id}/manual-done`, headers: { cookie: admin }, payload: { url: 'https://facebook.com/123' } });
      expect(r.json().status).toBe('manual_done');
    } finally {
      settings.set('mode', 'demo');
      overrides.clear();
    }
  });
});

describe('engine error handling', () => {
  it('retries transient errors with backoff', async () => {
    let calls = 0;
    overrides.set('plan', { async run(ctx) { calls++; if (calls < 2) throw new RetryableError('mạng chập chờn'); ctx.campaign.plan = { ...(ctx.campaign.plan as any), count: 5, categories: ['x'], searchQueries: [], avoid: [] } as any; return { output: {}, resultKind: 'simulated', summary: 'ok' }; } });
    overrides.set('research', { async run() { return { output: {}, resultKind: 'simulated', summary: 'ok' }; } });
    overrides.set('verify', { async run() { return { output: {}, resultKind: 'simulated', summary: 'ok' }; } });
    const cid = await create('Săn chuyện lạ');
    await waitFor(cid, ['awaiting_approval']);
    const t = tasks.forCampaign(cid).find((x) => x.stepKey === 'plan')!;
    expect(t.attempts).toBe(2);
    overrides.clear();
    await act(cid, 'cancel');
  });

  it('fatal error fails the task, blocks dependents, can be retried', async () => {
    let fail = true;
    overrides.set('research', { async run() { if (fail) throw new FatalError('thiếu quyền'); return { output: {}, resultKind: 'simulated', summary: 'ok' }; } });
    const cid = await create('Săn chuyện lạ', { workflowId: 'wf_proposals' });
    await waitFor(cid, ['completed_with_errors']);
    const ts = tasks.forCampaign(cid);
    const research = ts.find((x) => x.stepKey === 'research')!;
    expect(research.status).toBe('failed');
    expect(research.attempts).toBe(1);
    expect(ts.find((x) => x.stepKey === 'verify')!.status).toBe('blocked');
    fail = false;
    expect((await app.inject({ method: 'POST', url: `/api/campaigns/${cid}/tasks/${research.id}/retry`, headers: { cookie: admin } })).statusCode).toBe(200);
    await waitFor(cid, ['completed']);
    overrides.clear();
  });

  it('cancels a hung task', async () => {
    overrides.set('research', { run: () => new Promise(() => {}) });
    const cid = await create('Săn chuyện lạ');
    await new Promise((r) => setTimeout(r, 300));
    expect(tasks.forCampaign(cid).find((x) => x.stepKey === 'research')!.status).toBe('running');
    expect((await act(cid, 'cancel')).statusCode).toBe(200);
    await waitFor(cid, ['cancelled']);
    overrides.clear();
  });
});

describe('daily auto hunt', () => {
  it('starts once per day after the configured time', async () => {
    const me = (await app.inject({ url: '/api/auth/status', headers: { cookie: admin } })).json().user;
    saveAutoHunt({ enabled: true, time: '07:00', goal: 'Săn chuyện lạ mỗi sáng', platforms: ['facebook'], workflowId: 'wf_proposals', options: { count: 5, categories: [], region: 'both' }, userId: me.id, lastRun: null });
    expect(runAutoHunt('demo', new Date(2026, 10, 6, 6, 59))).toBeNull();
    const c = runAutoHunt('demo', new Date(2026, 10, 6, 7, 1));
    expect(c?.goal).toBe('Săn chuyện lạ mỗi sáng');
    expect(runAutoHunt('demo', new Date(2026, 10, 6, 9, 0))).toBeNull();
    await waitFor(c!.id, ['completed', 'completed_with_errors']);
  });
});
