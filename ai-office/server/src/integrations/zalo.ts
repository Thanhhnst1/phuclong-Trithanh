import { http } from './http.js';
import { cred } from './registry.js';
import { zaloToken } from './tokens.js';
import { FatalError, type Asset } from '../core/types.js';
import { publicMediaUrl } from '../media/public.js';

const OA = 'https://openapi.zalo.me/v2.0';

export async function testZalo() {
  const t = await zaloToken();
  const r = await http(`${OA}/oa/getoa`, { headers: { access_token: t }, label: 'Zalo OA' });
  return `OA: ${r.data?.name} (${r.data?.oa_id})`;
}

/** Create and publish an OA article. Requires a public cover image URL. */
export async function publishZaloArticle(o: { title: string; body: string; description: string; cover: Asset | null; signal?: AbortSignal }) {
  const t = await zaloToken();
  const coverUrl = o.cover ? publicMediaUrl(o.cover.id, '.jpg') : null;
  if (!coverUrl) throw new FatalError('Zalo OA yêu cầu ảnh bìa có URL công khai — cấu hình PUBLIC_BASE_URL hoặc dùng quy trình đăng thủ công');
  const paragraphs = o.body.split(/\n{2,}/).map((p) => ({ type: 'text', content: p.replace(/\n/g, '<br>') }));
  const created = await http(`${OA}/article/create`, {
    method: 'POST', label: 'Zalo article', signal: o.signal,
    headers: { access_token: t, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'normal', title: o.title.slice(0, 150), author: cred('zalo', 'author') ?? 'Admin',
      cover: { cover_type: 'photo', photo_url: coverUrl, status: 'show' },
      description: o.description.slice(0, 300), body: paragraphs, status: 'show', comment: 'show',
    }),
  });
  const token = created.data?.token;
  let id: string | null = null;
  try {
    const v = await http(`${OA}/article/verify`, { method: 'POST', label: 'Zalo verify', headers: { access_token: t, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    id = v.data?.id ?? null;
  } catch { /* verification is best-effort; article creation already succeeded */ }
  return { externalId: id ?? token, url: null as string | null, response: created };
}
