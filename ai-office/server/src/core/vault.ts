import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { secretsTable } from '../db/index.js';

/**
 * Credential vault: values are encrypted with AES-256-GCM before they touch the database
 * and are never sent back to the browser (only masked previews).
 */
let key: Buffer | null = null;
export let vaultKeySource: 'env' | 'file' = 'env';

function getKey(): Buffer {
  if (key) return key;
  let secret = config.appSecret;
  if (!secret) {
    // Local/dev convenience: generate a random master key once and keep it next to the DB.
    const file = path.join(config.dataDir, '.master-key');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    secret = fs.readFileSync(file, 'utf8').trim();
    vaultKeySource = 'file';
  }
  key = crypto.scryptSync(secret, 'ai-office-vault-v1', 32);
  return key;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export const vault = {
  get(k: string): string | null {
    const enc = secretsTable.get(k);
    if (!enc) return null;
    try {
      return decrypt(enc);
    } catch {
      return null; // key rotated / corrupted → treat as missing
    }
  },
  set(k: string, value: string, by: string | null) {
    secretsTable.set(k, encrypt(value), by);
  },
  remove: (k: string) => secretsTable.remove(k),
  mask(v: string | null) {
    if (!v) return null;
    if (v.length <= 8) return '••••';
    return `${v.slice(0, 4)}••••${v.slice(-4)}`;
  },
};
