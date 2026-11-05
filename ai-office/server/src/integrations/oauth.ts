import crypto from 'node:crypto';
import { config } from '../config.js';
import { oauthStates } from '../db/index.js';
import { http, form } from './http.js';
import { cred, setCred } from './registry.js';
import { saveExp } from './tokens.js';
import { FatalError } from '../core/types.js';
import { vault } from '../core/vault.js';

/**
 * Authorization-code OAuth flows for the supported platforms.
 * Callback URL to register with each platform: {PUBLIC_BASE_URL}/api/oauth/{provider}/callback
 */
export const OAUTH_PROVIDERS = ['facebook', 'threads', 'tiktok', 'zalo', 'gdrive'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const callbackUrl = (p: string) => `${config.publicBaseUrl}/api/oauth/${p}/callback`;

const b64url = (b: Buffer) => b.toString('base64url');

export function startOAuth(provider: OAuthProvider, userId: string): string {
  if (!config.publicBaseUrl) throw new FatalError('Cần cấu hình PUBLIC_BASE_URL (URL công khai, ví dụ https://office.example.com) để dùng OAuth');
  const state = b64url(crypto.randomBytes(24));
  const redirect = encodeURIComponent(callbackUrl(provider));
  const need = (k: string) => {
    const v = cred(provider, k);
    if (!v) throw new FatalError(`Thiếu "${k}" — nhập thông tin ứng dụng trước khi kết nối OAuth`);
    return encodeURIComponent(v);
  };
  let verifier: string | null = null;
  let url: string;
  switch (provider) {
    case 'facebook':
      url = `https://www.facebook.com/${config.fbGraphVersion}/dialog/oauth?client_id=${need('appId')}&redirect_uri=${redirect}&state=${state}&scope=pages_show_list,pages_read_engagement,pages_manage_posts`;
      break;
    case 'threads':
      url = `https://threads.net/oauth/authorize?client_id=${need('appId')}&redirect_uri=${redirect}&scope=threads_basic,threads_content_publish,threads_manage_insights&response_type=code&state=${state}`;
      break;
    case 'tiktok':
      url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${need('clientKey')}&scope=user.info.basic,video.upload,video.publish&response_type=code&redirect_uri=${redirect}&state=${state}`;
      break;
    case 'zalo': {
      verifier = b64url(crypto.randomBytes(32)).slice(0, 43);
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      url = `https://oauth.zaloapp.com/v4/oa/permission?app_id=${need('appId')}&redirect_uri=${redirect}&code_challenge=${challenge}&state=${state}`;
      break;
    }
    case 'gdrive':
      url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${need('clientId')}&redirect_uri=${redirect}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.readonly')}&access_type=offline&prompt=consent&state=${state}`;
      break;
  }
  oauthStates.create(state, provider, verifier, userId);
  return url;
}

export async function finishOAuth(provider: OAuthProvider, code: string, state: string): Promise<string> {
  const st = oauthStates.take(state);
  if (!st || st.provider !== provider) throw new FatalError('OAuth state không hợp lệ hoặc đã hết hạn');
  if (Date.now() - new Date(st.created_at).getTime() > 15 * 60 * 1000) throw new FatalError('Phiên OAuth đã hết hạn, thử lại');
  const by = st.user_id as string;
  const redirect = callbackUrl(provider);
  switch (provider) {
    case 'facebook': {
      const v = config.fbGraphVersion;
      const appId = cred('facebook', 'appId')!, secret = cred('facebook', 'appSecret')!;
      const short = await http(`https://graph.facebook.com/${v}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirect)}&client_secret=${secret}&code=${encodeURIComponent(code)}`, { label: 'Meta token' });
      const long = await http(`https://graph.facebook.com/${v}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${short.access_token}`, { label: 'Meta long-lived' });
      const pages = await http(`https://graph.facebook.com/${v}/me/accounts?fields=id,name,access_token&access_token=${long.access_token}`, { label: 'Meta pages' });
      const list = (pages.data ?? []) as { id: string; name: string; access_token: string }[];
      if (!list.length) throw new FatalError('Tài khoản không quản lý Page nào hoặc chưa cấp quyền Page');
      // Page tokens obtained from a long-lived user token do not expire.
      vault.set('facebook.pages', JSON.stringify(list), by);
      if (list.length === 1 || !cred('facebook', 'pageId')) {
        setCred('facebook', 'pageId', list[0].id, by);
        setCred('facebook', 'pageAccessToken', list[0].access_token, by);
      }
      return `Đã kết nối ${list.length} Page. Đang dùng: ${list[0].name}`;
    }
    case 'threads': {
      const r = await http('https://graph.threads.net/oauth/access_token', {
        method: 'POST', label: 'Threads token',
        body: form({ client_id: cred('threads', 'appId')!, client_secret: cred('threads', 'appSecret')!, grant_type: 'authorization_code', redirect_uri: redirect, code }),
      });
      const long = await http(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${cred('threads', 'appSecret')}&access_token=${r.access_token}`, { label: 'Threads long-lived' });
      setCred('threads', 'accessToken', long.access_token ?? r.access_token, by);
      setCred('threads', 'userId', String(r.user_id), by);
      return 'Đã kết nối Threads (token dài hạn ~60 ngày)';
    }
    case 'tiktok': {
      const r = await http('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST', label: 'TikTok token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_key: cred('tiktok', 'clientKey')!, client_secret: cred('tiktok', 'clientSecret')!, code, grant_type: 'authorization_code', redirect_uri: redirect }),
      });
      setCred('tiktok', 'accessToken', r.access_token, by);
      setCred('tiktok', 'refreshToken', r.refresh_token, by);
      saveExp('tiktok', r.expires_in);
      return `Đã kết nối TikTok (scope: ${r.scope})`;
    }
    case 'zalo': {
      const r = await http('https://oauth.zaloapp.com/v4/oa/access_token', {
        method: 'POST', label: 'Zalo token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: cred('zalo', 'secretKey')! },
        body: form({ code, app_id: cred('zalo', 'appId')!, grant_type: 'authorization_code', code_verifier: st.verifier ?? '' }),
      });
      setCred('zalo', 'accessToken', r.access_token, by);
      setCred('zalo', 'refreshToken', r.refresh_token, by);
      saveExp('zalo', r.expires_in);
      return 'Đã kết nối Zalo OA';
    }
    case 'gdrive': {
      const r = await http('https://oauth2.googleapis.com/token', {
        method: 'POST', label: 'Google token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: cred('gdrive', 'clientId')!, client_secret: cred('gdrive', 'clientSecret')!, code, grant_type: 'authorization_code', redirect_uri: redirect }),
      });
      if (r.refresh_token) setCred('gdrive', 'refreshToken', r.refresh_token, by);
      setCred('gdrive', 'accessToken', r.access_token, by);
      saveExp('gdrive', r.expires_in);
      return 'Đã kết nối Google Drive';
    }
  }
}

export function facebookPages(): { id: string; name: string }[] {
  const raw = vault.get('facebook.pages');
  if (!raw) return [];
  return (JSON.parse(raw) as any[]).map((p) => ({ id: p.id, name: p.name }));
}

export function selectFacebookPage(pageId: string, by: string) {
  const raw = vault.get('facebook.pages');
  const page = raw ? (JSON.parse(raw) as any[]).find((p) => p.id === pageId) : null;
  if (!page) throw new FatalError('Không tìm thấy Page');
  setCred('facebook', 'pageId', page.id, by);
  setCred('facebook', 'pageAccessToken', page.access_token, by);
}
