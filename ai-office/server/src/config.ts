import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

function loadDotEnv() {
  // Minimal .env loader (no extra dependency). Real env vars take precedence.
  for (const file of [path.join(SERVER_ROOT, '.env'), path.join(SERVER_ROOT, '..', '.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const val = m[2].replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadDotEnv();

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '127.0.0.1',
  dataDir: path.resolve(SERVER_ROOT, env.DATA_DIR ?? 'data'),
  /** Public URL where this server is reachable from the internet. Needed by Threads/Zalo (they fetch media by URL) and OAuth callbacks. */
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  /** Master key used to encrypt stored credentials. MUST be set in production. */
  appSecret: env.APP_SECRET ?? '',
  /** Directory scanned once to seed the local media library (defaults to the repository root product photos). */
  seedDir: path.resolve(SERVER_ROOT, env.SEED_DIR ?? '../..'),
  workerConcurrency: Number(env.WORKER_CONCURRENCY ?? 4),
  defaultModel: env.CLAUDE_MODEL ?? 'claude-opus-5-5',
  fbGraphVersion: env.FB_GRAPH_VERSION ?? 'v23.0',
  /** Demo pacing so the office animation is watchable. 0 in tests. */
  demoStepDelayMs: Number(env.DEMO_STEP_DELAY_MS ?? 900),
  cookieSecure: env.COOKIE_SECURE === 'true',
  isTest: env.NODE_ENV === 'test' || !!env.VITEST,
};

export const paths = {
  db: path.join(config.dataDir, 'app.db'),
  media: path.join(config.dataDir, 'media'),
  library: path.join(config.dataDir, 'library'),
  fonts: path.join(SERVER_ROOT, 'assets', 'fonts'),
  webDist: path.resolve(SERVER_ROOT, '..', 'web', 'dist'),
};

export function ensureDirs() {
  for (const p of [config.dataDir, paths.media, paths.library]) fs.mkdirSync(p, { recursive: true });
}
