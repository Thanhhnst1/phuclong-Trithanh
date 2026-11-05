import crypto from 'node:crypto';
import { config } from '../config.js';
import { vault } from '../core/vault.js';

/**
 * Signed, expiring public URLs for media. Threads and Zalo download images by URL,
 * so the file must be reachable without a login cookie.
 */
function signingKey() {
  let k = vault.get('system.mediaSigningKey');
  if (!k) {
    k = crypto.randomBytes(32).toString('hex');
    vault.set('system.mediaSigningKey', k, null);
  }
  return k;
}

export function signMedia(assetId: string, ttlSec = 7 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', signingKey()).update(`${assetId}.${exp}`).digest('base64url');
  return { exp, sig };
}

export function verifyMedia(assetId: string, exp: number, sig: string) {
  if (!exp || exp < Date.now() / 1000) return false;
  const expected = crypto.createHmac('sha256', signingKey()).update(`${assetId}.${exp}`).digest('base64url');
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function publicMediaUrl(assetId: string, ext = '') {
  if (!config.publicBaseUrl) return null;
  const { exp, sig } = signMedia(assetId);
  return `${config.publicBaseUrl}/public-media/${assetId}/${exp}/${sig}${ext}`;
}
