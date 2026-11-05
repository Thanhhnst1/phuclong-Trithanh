import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { z } from 'zod';
import { config, paths } from './config.js';
import {
  assets, campaigns, contents, logs, publications, settings, tasks, users, workflows,
} from './db/index.js';
import {
  createSession, currentUser, destroySession, hashPassword, publicUser, requireRole, userOf, verifyPassword,
} from './auth/index.js';
import { bus } from './core/bus.js';
import { FatalError, PLATFORMS, type Platform, type RunMode } from './core/types.js';
import { engine } from './orchestrator/engine.js';
import { detectPlatforms } from './orchestrator/planner.js';
import { validateWorkflow } from './orchestrator/workflows.js';
import { AGENT_PROFILES } from './agents/types.js';
import { ALLOWED_UPLOAD, absPath, hasFfmpeg, storeAsset } from './media/index.js';
import { verifyMedia } from './media/public.js';
import { INTEGRATIONS, integrationDef, integrationStatus, isConfigured, setCred, testIntegration } from './integrations/index.js';
import { vault, vaultKeySource } from './core/vault.js';
import { OAUTH_PROVIDERS, callbackUrl, facebookPages, finishOAuth, selectFacebookPage, startOAuth, type OAuthProvider } from './integrations/oauth.js';
import { listMcpServers, probeMcpServer, saveMcpServers } from './integrations/mcp.js';
import { buildReport, overview, reportToPdf, reportToXlsx } from './reports/index.js';
import { writeLog } from './core/log.js';
import { anthropicKey, currentModel, resolveLLM } from './llm/index.js';

const viewer = requireRole('viewer');
const editor = requireRole('editor');
const admin = requireRole('admin');

export const getMode = (): RunMode => (settings.get('mode') === 'production' ? 'production' : 'demo');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.isTest ? false : { level: 'warn' }, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 20 } });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof FatalError || err instanceof z.ZodError || err.validation) {
      const msg = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message;
      return reply.code(400).send({ error: msg });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Lỗi máy chủ: ' + (err.message ?? 'không rõ') });
  });

  // ------------------------------------------------------------ auth
  app.get('/api/auth/status', async (req) => {
    const u = currentUser(req);
    return { needsBootstrap: users.count() === 0, user: u ? publicUser(u) : null };
  });

  const Creds = z.object({ email: z.string().email(), password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'), name: z.string().min(1).optional() });

  app.post('/api/auth/bootstrap', async (req, reply) => {
    if (users.count() > 0) throw new FatalError('Hệ thống đã có quản trị viên');
    const b = Creds.parse(req.body);
    const u = users.create({ email: b.email, name: b.name ?? 'Quản trị viên', role: 'admin', passwordHash: hashPassword(b.password) });
    createSession(reply, u.id);
    return { user: publicUser(u) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = Creds.pick({ email: true }).extend({ password: z.string() }).parse(req.body);
    const u = users.byEmail(b.email);
    if (!u || !verifyPassword(b.password, u.passwordHash)) return reply.code(401).send({ error: 'Email hoặc mật khẩu không đúng' });
    createSession(reply, u.id);
    return { user: publicUser(u) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });

  // ------------------------------------------------------------ users (admin)
  app.get('/api/users', { preHandler: admin }, async () => users.list().map(publicUser));
  app.post('/api/users', { preHandler: admin }, async (req) => {
    const b = Creds.extend({ role: z.enum(['admin', 'editor', 'viewer']), name: z.string().min(1) }).parse(req.body);
    if (users.byEmail(b.email)) throw new FatalError('Email đã tồn tại');
    return publicUser(users.create({ email: b.email, name: b.name, role: b.role, passwordHash: hashPassword(b.password) }));
  });
  app.patch('/api/users/:id', { preHandler: admin }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ role: z.enum(['admin', 'editor', 'viewer']).optional(), name: z.string().optional(), password: z.string().min(8).optional() }).parse(req.body);
    if (b.role && b.role !== 'admin' && id === userOf(req).id) throw new FatalError('Không thể tự hạ quyền của chính mình');
    users.update(id, { role: b.role, name: b.name, ...(b.password ? { passwordHash: hashPassword(b.password) } : {}) });
    return { ok: true };
  });
  app.delete('/api/users/:id', { preHandler: admin }, async (req) => {
    const { id } = req.params as { id: string };
    if (id === userOf(req).id) throw new FatalError('Không thể xóa chính mình');
    users.remove(id);
    return { ok: true };
  });

  // ------------------------------------------------------------ system / settings
  app.get('/api/system', { preHandler: viewer }, async () => ({
    mode: getMode(),
    llm: { configured: !!anthropicKey(), active: !!resolveLLM(), model: currentModel() },
    ffmpeg: await hasFfmpeg(),
    publicBaseUrl: config.publicBaseUrl || null,
    vaultKeySource,
    integrations: Object.fromEntries(INTEGRATIONS.map((i) => [i.key, isConfigured(i.key)])),
  }));

  app.put('/api/settings', { preHandler: admin }, async (req) => {
    const b = z.object({ mode: z.enum(['demo', 'production']).optional(), model: z.string().min(3).optional() }).parse(req.body);
    if (b.mode) {
      if (b.mode === 'production' && vaultKeySource === 'file' && process.env.NODE_ENV === 'production') {
        throw new FatalError('Production yêu cầu đặt biến môi trường APP_SECRET để mã hóa thông tin xác thực');
      }
      settings.set('mode', b.mode);
      writeLog({ campaignId: null, taskId: null, agent: 'orchestrator', level: 'warn', message: `Chuyển chế độ hệ thống sang ${b.mode.toUpperCase()} (bởi ${userOf(req).email})`, data: null });
    }
    if (b.model) settings.set('llm.model', b.model);
    return { ok: true };
  });

  // ------------------------------------------------------------ agents + realtime
  app.get('/api/agents', { preHandler: viewer }, async () =>
    AGENT_PROFILES.map((a) => ({ ...a, state: engine.agentStates.get(a.id) })),
  );

  app.get('/api/events', { preHandler: viewer }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\n\n`);
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    for (const a of AGENT_PROFILES) send({ type: 'agent', agent: a.id, state: engine.agentStates.get(a.id) });
    bus.on('event', send);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', send);
    });
  });

  // ------------------------------------------------------------ campaigns
  app.get('/api/campaigns', { preHandler: viewer }, async (req) => {
    const q = req.query as { status?: string; agent?: string; q?: string };
    let list = campaigns.list({ status: q.status || undefined });
    if (q.agent) {
      const ids = new Set(list.filter((c) => tasks.forCampaign(c.id).some((t) => t.agent === q.agent)).map((c) => c.id));
      list = list.filter((c) => ids.has(c.id));
    }
    if (q.q) list = list.filter((c) => (c.title + ' ' + c.goal).toLowerCase().includes(q.q!.toLowerCase()));
    return list.map((c) => {
      const ts = tasks.forCampaign(c.id);
      const done = ts.filter((t) => ['succeeded', 'skipped'].includes(t.status)).length;
      return { ...c, progress: ts.length ? done / ts.length : 0, taskCount: ts.length };
    });
  });

  app.post('/api/campaigns/preview', { preHandler: viewer }, async (req) => {
    const b = z.object({ goal: z.string().min(3) }).parse(req.body);
    return { platforms: detectPlatforms(b.goal) };
  });

  app.post('/api/campaigns', { preHandler: editor }, async (req) => {
    const b = z.object({
      goal: z.string().min(5, 'Mục tiêu quá ngắn').max(2000),
      workflowId: z.string().default('wf_full'),
      platforms: z.array(z.enum(PLATFORMS as [Platform, ...Platform[]])).optional(),
      scheduledAt: z.string().datetime().nullable().optional(),
      publishAt: z.string().datetime().nullable().optional(),
      autoStart: z.boolean().optional(),
    }).parse(req.body);
    let platforms = b.platforms?.length ? b.platforms : detectPlatforms(b.goal);
    if (!platforms.length) platforms = [...PLATFORMS];
    return engine.createCampaign({ ...b, platforms, mode: getMode(), createdBy: userOf(req).id });
  });

  app.get('/api/campaigns/:id', { preHandler: viewer }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = campaigns.get(id);
    if (!c) return reply.code(404).send({ error: 'Không tìm thấy' });
    return {
      campaign: c,
      tasks: tasks.forCampaign(id),
      contents: contents.forCampaign(id),
      assets: assets.list({ campaignId: id }),
      publications: publications.forCampaign(id),
    };
  });

  app.post('/api/campaigns/:id/:action', { preHandler: editor }, async (req) => {
    const { id, action } = req.params as { id: string; action: string };
    switch (action) {
      case 'start': engine.startCampaign(id); break;
      case 'pause': engine.pause(id); break;
      case 'resume': engine.resume(id); break;
      case 'cancel': engine.cancel(id); break;
      case 'approve': {
        const b = z.object({ selections: z.record(z.string(), z.object({ contentId: z.string(), mediaIds: z.array(z.string()).optional() })) }).parse(req.body);
        engine.approve(id, b.selections as any, userOf(req).id);
        break;
      }
      case 'reject': {
        const b = z.object({ feedback: z.string().min(3, 'Hãy ghi góp ý cụ thể') }).parse(req.body);
        engine.reject(id, b.feedback);
        break;
      }
      default: throw new FatalError('Hành động không hợp lệ');
    }
    return { ok: true, campaign: campaigns.get(id) };
  });

  app.post('/api/campaigns/:id/tasks/:taskId/retry', { preHandler: editor }, async (req) => {
    const { id, taskId } = req.params as { id: string; taskId: string };
    engine.retryTask(id, taskId);
    return { ok: true };
  });

  app.delete('/api/campaigns/:id', { preHandler: admin }, async (req) => {
    const { id } = req.params as { id: string };
    const c = campaigns.get(id);
    if (!c) throw new FatalError('Không tìm thấy');
    if (['running', 'awaiting_approval'].includes(c.status)) throw new FatalError('Hãy hủy chiến dịch trước khi xóa');
    for (const a of assets.list({ campaignId: id })) {
      try { fs.unlinkSync(absPath(a.path)); } catch { /* ignore */ }
      assets.remove(a.id);
    }
    campaigns.remove(id);
    return { ok: true };
  });

  // ------------------------------------------------------------ content editing
  app.patch('/api/contents/:id', { preHandler: editor }, async (req) => {
    const { id } = req.params as { id: string };
    const c = contents.get(id);
    if (!c) throw new FatalError('Không tìm thấy nội dung');
    if (c.status === 'approved') throw new FatalError('Nội dung đã duyệt không sửa được');
    const b = z.object({ title: z.string().max(300).optional(), body: z.string().max(5000).optional(), hashtags: z.array(z.string()).optional(), cta: z.string().optional() }).parse(req.body);
    contents.update(id, b);
    bus.publish({ type: 'content', campaignId: c.campaignId });
    return contents.get(id);
  });

  // ------------------------------------------------------------ publications
  app.post('/api/publications/:id/manual-done', { preHandler: editor }, async (req) => {
    const { id } = req.params as { id: string };
    const p = publications.get(id);
    if (!p) throw new FatalError('Không tìm thấy');
    if (!['manual_pending', 'failed'].includes(p.status)) throw new FatalError('Bài này không ở trạng thái chờ đăng tay');
    const b = z.object({ url: z.string().url('Link bài đăng không hợp lệ') }).parse(req.body);
    publications.update(id, { status: 'manual_done', url: b.url, error: null });
    writeLog({ campaignId: p.campaignId, taskId: null, agent: p.platform, level: 'success', message: `Đã ghi nhận đăng thủ công ${p.platform}: ${b.url} (xác nhận bởi ${userOf(req).email})`, data: null });
    bus.publish({ type: 'publication', campaignId: p.campaignId });
    return publications.get(id);
  });

  // ------------------------------------------------------------ assets
  app.get('/api/assets', { preHandler: viewer }, async (req) => {
    const q = req.query as { campaignId?: string; library?: string };
    return q.library ? assets.list({ library: true }) : assets.list({ campaignId: q.campaignId });
  });

  app.post('/api/assets/upload', { preHandler: editor }, async (req) => {
    const u = userOf(req);
    const created = [];
    let campaignId: string | null = null;
    let role: 'source' | 'logo' = 'source';
    let license = '';
    let source = 'Người dùng tải lên';
    let rightsConfirmed = false;
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        const v = String(part.value);
        if (part.fieldname === 'campaignId' && v) campaignId = v;
        if (part.fieldname === 'role' && (v === 'logo' || v === 'source')) role = v;
        if (part.fieldname === 'license') license = v.slice(0, 200);
        if (part.fieldname === 'source' && v) source = v.slice(0, 200);
        if (part.fieldname === 'rightsConfirmed') rightsConfirmed = v === 'true';
        continue;
      }
      const ext = path.extname(part.filename).toLowerCase();
      if (!ALLOWED_UPLOAD.has(ext)) throw new FatalError(`Định dạng ${ext} không được hỗ trợ`);
      if (!rightsConfirmed) throw new FatalError('Hãy xác nhận anh có quyền sử dụng tư liệu này');
      if (campaignId && !campaigns.get(campaignId)) throw new FatalError('Chiến dịch không tồn tại');
      const buffer = await part.toBuffer();
      created.push(await storeAsset({
        buffer, filename: part.filename, campaignId, role, source: `${source} (${u.email})`,
        license: license || 'Người dùng xác nhận có quyền sử dụng',
      }));
    }
    if (!created.length) throw new FatalError('Chưa chọn tệp');
    return created;
  });

  app.delete('/api/assets/:id', { preHandler: editor }, async (req) => {
    const { id } = req.params as { id: string };
    const a = assets.get(id);
    if (!a) throw new FatalError('Không tìm thấy');
    try { fs.unlinkSync(absPath(a.path)); } catch { /* ignore */ }
    assets.remove(id);
    return { ok: true };
  });

  // Authenticated media (cookie session)
  app.get('/media/:id', { preHandler: viewer }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = assets.get(id);
    if (!a || !fs.existsSync(absPath(a.path))) return reply.code(404).send({ error: 'Không tìm thấy' });
    const q = req.query as { download?: string };
    reply.header('Content-Type', a.mime).header('Cache-Control', 'private, max-age=3600');
    if (q.download) reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(a.label)}${path.extname(a.path)}"`);
    return reply.send(fs.createReadStream(absPath(a.path)));
  });

  // Signed public media (for platforms that fetch images by URL)
  app.get('/public-media/:id/:exp/:sig', async (req, reply) => {
    const { id, exp, sig } = req.params as { id: string; exp: string; sig: string };
    const cleanSig = sig.replace(/\.[a-z0-9]+$/i, '');
    if (!verifyMedia(id, Number(exp), cleanSig)) return reply.code(403).send({ error: 'Liên kết hết hạn hoặc không hợp lệ' });
    const a = assets.get(id);
    if (!a || a.kind !== 'image' && a.kind !== 'video') return reply.code(404).send();
    reply.header('Content-Type', a.mime);
    return reply.send(fs.createReadStream(absPath(a.path)));
  });

  // ------------------------------------------------------------ workflows
  app.get('/api/workflows', { preHandler: viewer }, async () => workflows.list());
  const StepSchema = z.object({
    key: z.string().regex(/^[a-z0-9_]+$/), agent: z.enum(AGENT_PROFILES.map((a) => a.id) as [string, ...string[]]), title: z.string().min(1),
    deps: z.array(z.string()), depMode: z.enum(['success', 'settled']).optional(), type: z.enum(['agent', 'approval']).optional(),
    platform: z.enum(PLATFORMS as [string, ...string[]]).optional(), enabled: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(), timeoutMs: z.number().int().min(5000).max(3600000).optional(),
    fallbackAgent: z.enum(AGENT_PROFILES.map((a) => a.id) as [string, ...string[]]).optional(),
  });
  app.post('/api/workflows', { preHandler: editor }, async (req) => {
    const b = z.object({ id: z.string().optional(), name: z.string().min(2), description: z.string().default(''), steps: z.array(StepSchema).min(1) }).parse(req.body);
    const err = validateWorkflow(b as any);
    if (err) throw new FatalError(err);
    if (b.id) {
      const existing = workflows.get(b.id);
      if (existing?.builtin) throw new FatalError('Không sửa workflow mặc định — hãy lưu thành bản mới');
    }
    const id = b.id ?? `wf_${Date.now().toString(36)}`;
    workflows.upsert({ id, name: b.name, description: b.description, steps: b.steps as any, builtin: false });
    return workflows.get(id);
  });
  app.delete('/api/workflows/:id', { preHandler: editor }, async (req) => {
    workflows.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  // ------------------------------------------------------------ integrations
  app.get('/api/integrations', { preHandler: viewer }, async () => ({
    integrations: INTEGRATIONS.map((i) => integrationStatus(i.key)),
    mcpServers: listMcpServers().map((s) => ({ name: s.name, url: s.url, hasToken: !!s.token })),
    facebookPages: facebookPages(),
    oauthCallbackBase: config.publicBaseUrl ? callbackUrl('{provider}') : null,
  }));

  app.put('/api/integrations/:key', { preHandler: admin }, async (req) => {
    const { key } = req.params as { key: string };
    const def = integrationDef(key);
    if (!def) throw new FatalError('Tích hợp không tồn tại');
    const b = z.record(z.string(), z.string()).parse(req.body);
    for (const [k, v] of Object.entries(b)) {
      if (!def.fields.some((f) => f.key === k)) continue;
      if (v === '') continue; // empty = keep current
      setCred(key, k, v.trim(), userOf(req).id);
    }
    writeLog({ campaignId: null, taskId: null, agent: null, level: 'info', message: `Cập nhật cấu hình ${def.name} (bởi ${userOf(req).email})`, data: { fields: Object.keys(b) } });
    return integrationStatus(key);
  });

  app.delete('/api/integrations/:key', { preHandler: admin }, async (req) => {
    const { key } = req.params as { key: string };
    const def = integrationDef(key);
    if (!def) throw new FatalError('Tích hợp không tồn tại');
    for (const f of [...def.fields.map((x) => x.key), 'expiresAt', 'accessToken', 'pages']) vault.remove(`${key}.${f}`);
    return integrationStatus(key);
  });

  app.post('/api/integrations/:key/test', { preHandler: admin }, async (req) => {
    const { key } = req.params as { key: string };
    try {
      return { ok: true, message: await testIntegration(key) };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });

  app.post('/api/integrations/facebook/page', { preHandler: admin }, async (req) => {
    const b = z.object({ pageId: z.string() }).parse(req.body);
    selectFacebookPage(b.pageId, userOf(req).id);
    return { ok: true };
  });

  app.put('/api/mcp-servers', { preHandler: admin }, async (req) => {
    const b = z.array(z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/), url: z.string().url().startsWith('https://', 'MCP server phải dùng HTTPS'), token: z.string().optional() })).parse(req.body);
    const existing = new Map(listMcpServers().map((s) => [s.name, s]));
    saveMcpServers(b.map((s) => ({ ...s, token: s.token || existing.get(s.name)?.token })), userOf(req).id);
    return { ok: true };
  });
  app.post('/api/mcp-servers/:name/test', { preHandler: admin }, async (req) => {
    const s = listMcpServers().find((x) => x.name === (req.params as any).name);
    if (!s) throw new FatalError('Không tìm thấy MCP server');
    try {
      const tools = await probeMcpServer(s);
      return { ok: true, message: `${tools.length} công cụ: ${tools.map((t) => t.name).slice(0, 10).join(', ')}` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });

  app.get('/api/oauth/:provider/start', { preHandler: admin }, async (req) => {
    const { provider } = req.params as { provider: string };
    if (!OAUTH_PROVIDERS.includes(provider as OAuthProvider)) throw new FatalError('Nhà cung cấp không hỗ trợ OAuth');
    return { url: startOAuth(provider as OAuthProvider, userOf(req).id) };
  });

  app.get('/api/oauth/:provider/callback', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    let msg: string;
    let ok = false;
    try {
      if (q.error || !q.code || !q.state) throw new Error(q.error_description || q.error || 'Thiếu mã xác thực');
      msg = await finishOAuth(provider as OAuthProvider, q.code, q.state);
      ok = true;
    } catch (e: any) {
      msg = e.message;
    }
    writeLog({ campaignId: null, taskId: null, agent: null, level: ok ? 'success' : 'error', message: `OAuth ${provider}: ${msg}`, data: null });
    return reply.redirect(`/?tab=integrations&oauth=${ok ? 'ok' : 'error'}&msg=${encodeURIComponent(msg)}`);
  });

  // ------------------------------------------------------------ logs & reports
  app.get('/api/logs', { preHandler: viewer }, async (req) => {
    const q = req.query as { campaignId?: string; agent?: string; level?: string; limit?: string };
    return logs.query({ ...q, limit: q.limit ? Number(q.limit) : 200 });
  });

  app.get('/api/reports/overview', { preHandler: viewer }, async () => overview());

  app.get('/api/reports/:id.:fmt', { preHandler: viewer }, async (req, reply) => {
    const { id, fmt } = req.params as { id: string; fmt: string };
    const r = buildReport(id);
    const name = `bao-cao-${id}`;
    if (fmt === 'json') return r;
    if (fmt === 'xlsx') {
      return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${name}.xlsx"`).send(await reportToXlsx(r));
    }
    if (fmt === 'pdf') {
      return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${name}.pdf"`).send(await reportToPdf(r));
    }
    throw new FatalError('Định dạng không hỗ trợ');
  });

  // ------------------------------------------------------------ static web app (production build)
  if (fs.existsSync(paths.webDist)) {
    await app.register(fstatic, { root: paths.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) return reply.code(404).send({ error: 'Không tìm thấy' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
