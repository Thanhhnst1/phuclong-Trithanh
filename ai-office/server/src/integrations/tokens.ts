import { cred, setCred } from './registry.js';
import { http, form } from './http.js';
import { FatalError } from '../core/types.js';

/** Refresh short-lived OAuth tokens (TikTok 24h, Zalo OA ~25h, Google 1h) shortly before expiry. */
const SKEW = 5 * 60 * 1000;
const expired = (integration: string) => {
  const exp = Number(cred(integration, 'expiresAt') ?? 0);
  return !exp || Date.now() > exp - SKEW;
};
const saveExp = (integration: string, seconds: number | string | undefined) =>
  setCred(integration, 'expiresAt', String(Date.now() + Number(seconds ?? 3600) * 1000), null);

export async function tiktokToken(): Promise<string> {
  const token = cred('tiktok', 'accessToken');
  if (!token) throw new FatalError('TikTok chưa kết nối');
  const refresh = cred('tiktok', 'refreshToken');
  if (!expired('tiktok') || !refresh) return token;
  const r = await http('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', label: 'TikTok refresh',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: cred('tiktok', 'clientKey') ?? '', client_secret: cred('tiktok', 'clientSecret') ?? '', grant_type: 'refresh_token', refresh_token: refresh }),
  });
  setCred('tiktok', 'accessToken', r.access_token, null);
  if (r.refresh_token) setCred('tiktok', 'refreshToken', r.refresh_token, null);
  saveExp('tiktok', r.expires_in);
  return r.access_token;
}

export async function zaloToken(): Promise<string> {
  const token = cred('zalo', 'accessToken');
  if (!token) throw new FatalError('Zalo OA chưa kết nối');
  const refresh = cred('zalo', 'refreshToken');
  if (!expired('zalo') || !refresh) return token;
  const r = await http('https://oauth.zaloapp.com/v4/oa/access_token', {
    method: 'POST', label: 'Zalo refresh',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: cred('zalo', 'secretKey') ?? '' },
    body: form({ refresh_token: refresh, app_id: cred('zalo', 'appId') ?? '', grant_type: 'refresh_token' }),
  });
  setCred('zalo', 'accessToken', r.access_token, null);
  if (r.refresh_token) setCred('zalo', 'refreshToken', r.refresh_token, null);
  saveExp('zalo', r.expires_in);
  return r.access_token;
}

export async function googleToken(): Promise<string> {
  const cached = cred('gdrive', 'accessToken');
  if (cached && !expired('gdrive')) return cached;
  const refresh = cred('gdrive', 'refreshToken');
  if (!refresh) throw new FatalError('Google Drive chưa kết nối (thiếu refresh token)');
  const r = await http('https://oauth2.googleapis.com/token', {
    method: 'POST', label: 'Google token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: cred('gdrive', 'clientId') ?? '', client_secret: cred('gdrive', 'clientSecret') ?? '', refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  setCred('gdrive', 'accessToken', r.access_token, null);
  saveExp('gdrive', r.expires_in);
  return r.access_token;
}

export { saveExp };
