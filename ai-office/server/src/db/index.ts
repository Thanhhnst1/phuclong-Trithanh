import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type {
  Asset,
  Campaign,
  ContentVariant,
  Publication,
  Task,
  Workflow,
} from '../core/types.js';

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY, enc TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT, user_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  steps_json TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT NOT NULL, workflow_id TEXT NOT NULL,
  platforms_json TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, plan_json TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  scheduled_at TEXT, publish_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, step_key TEXT NOT NULL, agent TEXT NOT NULL,
  title TEXT NOT NULL, type TEXT NOT NULL, platform TEXT, status TEXT NOT NULL,
  deps_json TEXT NOT NULL, dep_mode TEXT NOT NULL, output_json TEXT, result_kind TEXT,
  progress REAL NOT NULL DEFAULT 0, message TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3, timeout_ms INTEGER NOT NULL DEFAULT 120000,
  fallback_agent TEXT, error TEXT, run_after TEXT, started_at TEXT, finished_at TEXT, seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_campaign ON tasks(campaign_id);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT, task_id TEXT, agent TEXT,
  level TEXT NOT NULL, message TEXT NOT NULL, data_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_campaign ON logs(campaign_id);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, campaign_id TEXT, kind TEXT NOT NULL, role TEXT NOT NULL, path TEXT NOT NULL,
  mime TEXT NOT NULL, width INTEGER, height INTEGER, hash TEXT, source TEXT NOT NULL,
  license TEXT NOT NULL, label TEXT NOT NULL, derived_from TEXT, meta_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contents (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, platform TEXT NOT NULL, variant INTEGER NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, hashtags_json TEXT NOT NULL, cta TEXT NOT NULL,
  media_json TEXT NOT NULL, status TEXT NOT NULL, result_kind TEXT NOT NULL,
  approved_by TEXT, approved_at TEXT
);
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, platform TEXT NOT NULL, content_id TEXT,
  mode TEXT NOT NULL, status TEXT NOT NULL, external_id TEXT, url TEXT, error TEXT,
  response_json TEXT, metrics_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

export function openDb(file: string) {
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not opened');
  return db;
}

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const pj = (v: unknown, fallback: any = null) => {
  if (v === null || v === undefined) return fallback;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
};

type Row = Record<string, any>;
const all = (sql: string, ...p: any[]) => getDb().prepare(sql).all(...p) as Row[];
const get = (sql: string, ...p: any[]) => getDb().prepare(sql).get(...p) as Row | undefined;
const run = (sql: string, ...p: any[]) => getDb().prepare(sql).run(...p);

/** Build "a = ?, b = ?" update from a camelCase patch using a column map. */
function updateRow(table: string, id: string, patch: Row, cols: Record<string, [string, (v: any) => any]>) {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const c = cols[k];
    if (!c) continue;
    sets.push(`${c[0]} = ?`);
    vals.push(c[1](v));
  }
  if (!sets.length) return;
  run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
}
const id = (v: any) => (v === undefined ? null : v);

// ---------------- settings ----------------
export const settings = {
  get(key: string): string | null {
    return (get('SELECT value FROM settings WHERE key = ?', key)?.value as string) ?? null;
  },
  set(key: string, value: string) {
    run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  },
};

// ---------------- users / sessions ----------------
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  passwordHash: string;
  createdAt: string;
}
const mapUser = (r: Row): UserRow => ({
  id: r.id, email: r.email, name: r.name, role: r.role, passwordHash: r.password_hash, createdAt: r.created_at,
});
export const users = {
  count: () => Number(get('SELECT COUNT(*) AS n FROM users')!.n),
  list: () => all('SELECT * FROM users ORDER BY created_at').map(mapUser),
  byEmail: (email: string) => {
    const r = get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
    return r ? mapUser(r) : null;
  },
  byId: (uid: string) => {
    const r = get('SELECT * FROM users WHERE id = ?', uid);
    return r ? mapUser(r) : null;
  },
  create(u: Omit<UserRow, 'id' | 'createdAt'>) {
    const row = { ...u, id: newId('usr'), createdAt: now() };
    run('INSERT INTO users VALUES (?,?,?,?,?,?)', row.id, row.email.toLowerCase(), row.name, row.passwordHash, row.role, row.createdAt);
    return row;
  },
  update(uid: string, patch: Partial<Pick<UserRow, 'name' | 'role' | 'passwordHash'>>) {
    updateRow('users', uid, patch, { name: ['name', id], role: ['role', id], passwordHash: ['password_hash', id] });
  },
  remove(uid: string) {
    run('DELETE FROM sessions WHERE user_id = ?', uid);
    run('DELETE FROM users WHERE id = ?', uid);
  },
};
export const sessions = {
  create: (tokenHash: string, userId: string, expiresAt: string) =>
    run('INSERT INTO sessions VALUES (?,?,?)', tokenHash, userId, expiresAt),
  get: (tokenHash: string) => get('SELECT * FROM sessions WHERE token_hash = ?', tokenHash),
  remove: (tokenHash: string) => run('DELETE FROM sessions WHERE token_hash = ?', tokenHash),
  purgeExpired: () => run('DELETE FROM sessions WHERE expires_at < ?', now()),
};

// ---------------- secrets (encrypted values; see core/vault.ts) ----------------
export const secretsTable = {
  get: (key: string) => (get('SELECT enc FROM secrets WHERE key = ?', key)?.enc as string) ?? null,
  set: (key: string, enc: string, by: string | null) =>
    run(
      'INSERT INTO secrets VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      key, enc, now(), by,
    ),
  remove: (key: string) => run('DELETE FROM secrets WHERE key = ?', key),
  keys: (prefix: string) =>
    all('SELECT key, updated_at FROM secrets WHERE key LIKE ?', `${prefix}%`).map((r) => ({ key: r.key as string, updatedAt: r.updated_at as string })),
};

export const oauthStates = {
  create: (state: string, provider: string, verifier: string | null, userId: string) =>
    run('INSERT INTO oauth_states VALUES (?,?,?,?,?)', state, provider, verifier, userId, now()),
  take(state: string) {
    const r = get('SELECT * FROM oauth_states WHERE state = ?', state);
    run('DELETE FROM oauth_states WHERE state = ?', state);
    return r ?? null;
  },
};

// ---------------- workflows ----------------
const mapWorkflow = (r: Row): Workflow => ({
  id: r.id, name: r.name, description: r.description, steps: pj(r.steps_json, []), builtin: !!r.builtin,
});
export const workflows = {
  list: () => all('SELECT * FROM workflows ORDER BY builtin DESC, created_at').map(mapWorkflow),
  get: (wid: string) => {
    const r = get('SELECT * FROM workflows WHERE id = ?', wid);
    return r ? mapWorkflow(r) : null;
  },
  upsert(w: Workflow) {
    run(
      `INSERT INTO workflows VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
       description=excluded.description, steps_json=excluded.steps_json`,
      w.id, w.name, w.description, JSON.stringify(w.steps), w.builtin ? 1 : 0, now(),
    );
  },
  remove: (wid: string) => run('DELETE FROM workflows WHERE id = ? AND builtin = 0', wid),
};

// ---------------- campaigns ----------------
const mapCampaign = (r: Row): Campaign => ({
  id: r.id, title: r.title, goal: r.goal, workflowId: r.workflow_id, platforms: pj(r.platforms_json, []),
  status: r.status, mode: r.mode, plan: pj(r.plan_json), createdBy: r.created_by, createdAt: r.created_at,
  updatedAt: r.updated_at, scheduledAt: r.scheduled_at, publishAt: r.publish_at,
});
export const campaigns = {
  list(filter: { status?: string } = {}) {
    if (filter.status) return all('SELECT * FROM campaigns WHERE status = ? ORDER BY created_at DESC', filter.status).map(mapCampaign);
    return all('SELECT * FROM campaigns ORDER BY created_at DESC').map(mapCampaign);
  },
  byStatus: (statuses: string[]) =>
    all(`SELECT * FROM campaigns WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at`, ...statuses).map(mapCampaign),
  get(cid: string) {
    const r = get('SELECT * FROM campaigns WHERE id = ?', cid);
    return r ? mapCampaign(r) : null;
  },
  create(c: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>) {
    const row: Campaign = { ...c, id: newId('cmp'), createdAt: now(), updatedAt: now() };
    run(
      'INSERT INTO campaigns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      row.id, row.title, row.goal, row.workflowId, JSON.stringify(row.platforms), row.status, row.mode,
      j(row.plan), row.createdBy, row.createdAt, row.updatedAt, row.scheduledAt, row.publishAt,
    );
    return row;
  },
  update(cid: string, patch: Partial<Campaign>) {
    updateRow('campaigns', cid, { ...patch, updatedAt: now() }, {
      title: ['title', id], status: ['status', id], plan: ['plan_json', j], platforms: ['platforms_json', j],
      updatedAt: ['updated_at', id], scheduledAt: ['scheduled_at', id], publishAt: ['publish_at', id], mode: ['mode', id],
    });
  },
  remove(cid: string) {
    for (const t of ['tasks', 'logs', 'contents', 'publications']) run(`DELETE FROM ${t} WHERE campaign_id = ?`, cid);
    run('DELETE FROM campaigns WHERE id = ?', cid);
  },
};

// ---------------- tasks ----------------
const mapTask = (r: Row): Task => ({
  id: r.id, campaignId: r.campaign_id, stepKey: r.step_key, agent: r.agent, title: r.title, type: r.type,
  platform: r.platform, status: r.status, deps: pj(r.deps_json, []), depMode: r.dep_mode, output: pj(r.output_json),
  resultKind: r.result_kind, progress: r.progress, message: r.message, attempts: r.attempts, maxAttempts: r.max_attempts,
  timeoutMs: r.timeout_ms, fallbackAgent: r.fallback_agent, error: r.error, runAfter: r.run_after,
  startedAt: r.started_at, finishedAt: r.finished_at, seq: r.seq,
});
const taskCols: Record<string, [string, (v: any) => any]> = {
  status: ['status', id], output: ['output_json', j], resultKind: ['result_kind', id], progress: ['progress', id],
  message: ['message', id], attempts: ['attempts', id], error: ['error', id], runAfter: ['run_after', id],
  startedAt: ['started_at', id], finishedAt: ['finished_at', id], agent: ['agent', id],
};
export const tasks = {
  forCampaign: (cid: string) => all('SELECT * FROM tasks WHERE campaign_id = ? ORDER BY seq', cid).map(mapTask),
  get(tid: string) {
    const r = get('SELECT * FROM tasks WHERE id = ?', tid);
    return r ? mapTask(r) : null;
  },
  byStatus: (status: string) => all('SELECT * FROM tasks WHERE status = ?', status).map(mapTask),
  create(t: Omit<Task, 'id'>) {
    const row: Task = { ...t, id: newId('tsk') };
    run(
      'INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      row.id, row.campaignId, row.stepKey, row.agent, row.title, row.type, row.platform, row.status,
      JSON.stringify(row.deps), row.depMode, j(row.output), row.resultKind, row.progress, row.message, row.attempts,
      row.maxAttempts, row.timeoutMs, row.fallbackAgent, row.error, row.runAfter, row.startedAt, row.finishedAt, row.seq,
    );
    return row;
  },
  update: (tid: string, patch: Partial<Task>) => updateRow('tasks', tid, patch, taskCols),
};

// ---------------- logs ----------------
export interface LogRow {
  id: number;
  campaignId: string | null;
  taskId: string | null;
  agent: string | null;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data: any;
  createdAt: string;
}
export const logs = {
  add(l: Omit<LogRow, 'id' | 'createdAt'>): LogRow {
    const createdAt = now();
    const res = run('INSERT INTO logs(campaign_id, task_id, agent, level, message, data_json, created_at) VALUES (?,?,?,?,?,?,?)',
      l.campaignId, l.taskId, l.agent, l.level, l.message, j(l.data), createdAt);
    return { ...l, id: Number(res.lastInsertRowid), createdAt };
  },
  query(f: { campaignId?: string; agent?: string; level?: string; limit?: number }) {
    const where: string[] = [];
    const p: any[] = [];
    if (f.campaignId) { where.push('campaign_id = ?'); p.push(f.campaignId); }
    if (f.agent) { where.push('agent = ?'); p.push(f.agent); }
    if (f.level) { where.push('level = ?'); p.push(f.level); }
    const sql = `SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    return all(sql, ...p, Math.min(f.limit ?? 200, 1000)).map((r) => ({
      id: r.id, campaignId: r.campaign_id, taskId: r.task_id, agent: r.agent, level: r.level, message: r.message,
      data: pj(r.data_json), createdAt: r.created_at,
    })) as LogRow[];
  },
};

// ---------------- assets ----------------
const mapAsset = (r: Row): Asset => ({
  id: r.id, campaignId: r.campaign_id, kind: r.kind, role: r.role, path: r.path, mime: r.mime, width: r.width,
  height: r.height, hash: r.hash, source: r.source, license: r.license, label: r.label, derivedFrom: r.derived_from,
  meta: pj(r.meta_json, {}), createdAt: r.created_at,
});
export const assets = {
  get(aid: string) {
    const r = get('SELECT * FROM assets WHERE id = ?', aid);
    return r ? mapAsset(r) : null;
  },
  list(f: { campaignId?: string | null; role?: string; library?: boolean } = {}) {
    if (f.library) return all('SELECT * FROM assets WHERE campaign_id IS NULL ORDER BY created_at').map(mapAsset);
    if (f.campaignId && f.role) return all('SELECT * FROM assets WHERE campaign_id = ? AND role = ? ORDER BY created_at', f.campaignId, f.role).map(mapAsset);
    if (f.campaignId) return all('SELECT * FROM assets WHERE campaign_id = ? ORDER BY created_at', f.campaignId).map(mapAsset);
    return all('SELECT * FROM assets ORDER BY created_at DESC LIMIT 500').map(mapAsset);
  },
  byPath: (p: string) => {
    const r = get('SELECT * FROM assets WHERE path = ?', p);
    return r ? mapAsset(r) : null;
  },
  create(a: Omit<Asset, 'id' | 'createdAt'>) {
    const row: Asset = { ...a, id: newId('ast'), createdAt: now() };
    run('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', row.id, row.campaignId, row.kind, row.role, row.path,
      row.mime, row.width, row.height, row.hash, row.source, row.license, row.label, row.derivedFrom, j(row.meta), row.createdAt);
    return row;
  },
  update: (aid: string, patch: Partial<Asset>) =>
    updateRow('assets', aid, patch, { label: ['label', id], license: ['license', id], source: ['source', id], role: ['role', id], meta: ['meta_json', j] }),
  remove: (aid: string) => run('DELETE FROM assets WHERE id = ?', aid),
};

// ---------------- contents ----------------
const mapContent = (r: Row): ContentVariant => ({
  id: r.id, campaignId: r.campaign_id, platform: r.platform, variant: r.variant, title: r.title, body: r.body,
  hashtags: pj(r.hashtags_json, []), cta: r.cta, mediaIds: pj(r.media_json, []), status: r.status,
  resultKind: r.result_kind, approvedBy: r.approved_by, approvedAt: r.approved_at,
});
export const contents = {
  forCampaign: (cid: string) => all('SELECT * FROM contents WHERE campaign_id = ? ORDER BY platform, variant', cid).map(mapContent),
  get(cid: string) {
    const r = get('SELECT * FROM contents WHERE id = ?', cid);
    return r ? mapContent(r) : null;
  },
  approvedFor(campaignId: string, platform: string) {
    const r = get("SELECT * FROM contents WHERE campaign_id = ? AND platform = ? AND status = 'approved' LIMIT 1", campaignId, platform);
    return r ? mapContent(r) : null;
  },
  deleteForCampaign: (cid: string) => run('DELETE FROM contents WHERE campaign_id = ?', cid),
  create(c: Omit<ContentVariant, 'id'>) {
    const row: ContentVariant = { ...c, id: newId('cnt') };
    run('INSERT INTO contents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', row.id, row.campaignId, row.platform, row.variant, row.title,
      row.body, JSON.stringify(row.hashtags), row.cta, JSON.stringify(row.mediaIds), row.status, row.resultKind, row.approvedBy, row.approvedAt);
    return row;
  },
  update: (cid: string, patch: Partial<ContentVariant>) =>
    updateRow('contents', cid, patch, {
      title: ['title', id], body: ['body', id], hashtags: ['hashtags_json', j], cta: ['cta', id], mediaIds: ['media_json', j],
      status: ['status', id], approvedBy: ['approved_by', id], approvedAt: ['approved_at', id],
    }),
};

// ---------------- publications ----------------
const mapPub = (r: Row): Publication => ({
  id: r.id, campaignId: r.campaign_id, platform: r.platform, contentId: r.content_id, mode: r.mode, status: r.status,
  externalId: r.external_id, url: r.url, error: r.error, response: pj(r.response_json), metrics: pj(r.metrics_json),
  createdAt: r.created_at, updatedAt: r.updated_at,
});
export const publications = {
  forCampaign: (cid: string) => all('SELECT * FROM publications WHERE campaign_id = ? ORDER BY created_at', cid).map(mapPub),
  all: () => all('SELECT * FROM publications ORDER BY created_at DESC').map(mapPub),
  get(pid: string) {
    const r = get('SELECT * FROM publications WHERE id = ?', pid);
    return r ? mapPub(r) : null;
  },
  create(p: Omit<Publication, 'id' | 'createdAt' | 'updatedAt'>) {
    const row: Publication = { ...p, id: newId('pub'), createdAt: now(), updatedAt: now() };
    run('INSERT INTO publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', row.id, row.campaignId, row.platform, row.contentId,
      row.mode, row.status, row.externalId, row.url, row.error, j(row.response), j(row.metrics), row.createdAt, row.updatedAt);
    return row;
  },
  remove: (pid: string) => run('DELETE FROM publications WHERE id = ?', pid),
  update: (pid: string, patch: Partial<Publication>) =>
    updateRow('publications', pid, { ...patch, updatedAt: now() }, {
      status: ['status', id], url: ['url', id], externalId: ['external_id', id], error: ['error', id],
      response: ['response_json', j], metrics: ['metrics_json', j], updatedAt: ['updated_at', id],
    }),
};
