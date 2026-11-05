import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { bootstrap } from '../src/bootstrap.js';
import { buildApp } from '../src/app.js';
import { engine } from '../src/orchestrator/engine.js';
import { campaigns } from '../src/db/index.js';
import { setLLMOverride } from '../src/llm/index.js';

let booted = false;
export async function setup() {
  if (!booted) {
    fs.rmSync(config.dataDir, { recursive: true, force: true });
    await bootstrap(path.join(config.dataDir, 'test.db'));
    setLLMOverride(null); // never call real APIs from tests
    engine.backoffBaseMs = 5;
    engine.start(25);
    booted = true;
  }
  const app = await buildApp();
  return app;
}

export async function login(app: Awaited<ReturnType<typeof setup>>, role: 'admin' | 'editor' | 'viewer' = 'admin') {
  const email = `${role}@test.local`;
  const pw = 'matkhau-123';
  const st = await app.inject({ url: '/api/auth/status' });
  if (st.json().needsBootstrap) {
    await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { email: 'admin@test.local', password: pw, name: 'Admin' } });
  }
  if (role !== 'admin') {
    const adminCookie = await cookieFor(app, 'admin@test.local', pw);
    await app.inject({ method: 'POST', url: '/api/users', headers: { cookie: adminCookie }, payload: { email, password: pw, name: role, role } });
  }
  return cookieFor(app, email, pw);
}

async function cookieFor(app: Awaited<ReturnType<typeof setup>>, email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const c = r.cookies.find((x) => x.name === 'aio_session');
  if (!c) throw new Error('login failed: ' + r.body);
  return `aio_session=${c.value}`;
}

export async function waitFor(cid: string, statuses: string[], timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const c = campaigns.get(cid)!;
    if (statuses.includes(c.status)) return c;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`timeout waiting for ${statuses.join('/')}, now ${campaigns.get(cid)?.status}`);
}
