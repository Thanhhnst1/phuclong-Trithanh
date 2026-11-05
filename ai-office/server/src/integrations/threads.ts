import { http } from './http.js';
import { cred } from './registry.js';
import { FatalError, RetryableError, type Asset } from '../core/types.js';
import { publicMediaUrl } from '../media/public.js';
import { sleep } from '../core/util.js';

const T = 'https://graph.threads.net/v1.0';

function creds() {
  const userId = cred('threads', 'userId');
  const token = cred('threads', 'accessToken');
  if (!userId || !token) throw new FatalError('Threads chưa được kết nối');
  return { userId, token };
}

export async function testThreads() {
  const { token } = creds();
  const r = await http(`${T}/me?fields=id,username&access_token=${encodeURIComponent(token)}`, { label: 'Threads' });
  return `Tài khoản @${r.username} (${r.id})`;
}

export async function publishThreads(o: { text: string; image?: Asset | null; signal?: AbortSignal; log: (m: string) => void }) {
  const { userId, token } = creds();
  const imageUrl = o.image ? publicMediaUrl(o.image.id, '.jpg') : null;
  if (o.image && !imageUrl) o.log('Thiếu PUBLIC_BASE_URL nên Threads không tải được ảnh → đăng bài chữ.');
  const params: Record<string, string> = { text: o.text.slice(0, 500), access_token: token, media_type: imageUrl ? 'IMAGE' : 'TEXT' };
  if (imageUrl) params.image_url = imageUrl;
  const c = await http(`${T}/${userId}/threads`, { method: 'POST', body: new URLSearchParams(params), label: 'Threads container', signal: o.signal });
  // Meta recommends waiting for the container to finish processing before publishing.
  for (let i = 0; i < 10; i++) {
    const s = await http(`${T}/${c.id}?fields=status,error_message&access_token=${encodeURIComponent(token)}`, { label: 'Threads status', signal: o.signal });
    if (s.status === 'FINISHED' || !s.status) break;
    if (s.status === 'ERROR') throw new FatalError(`Threads xử lý media lỗi: ${s.error_message}`);
    await sleep(3000, o.signal);
    if (i === 9) throw new RetryableError('Threads container chưa sẵn sàng');
  }
  const p = await http(`${T}/${userId}/threads_publish`, {
    method: 'POST', body: new URLSearchParams({ creation_id: c.id, access_token: token }), label: 'Threads publish', signal: o.signal,
  });
  let url: string | null = null;
  try {
    const m = await http(`${T}/${p.id}?fields=permalink&access_token=${encodeURIComponent(token)}`, { label: 'Threads permalink' });
    url = m.permalink ?? null;
  } catch { /* permalink is optional */ }
  return { externalId: p.id as string, url, response: { container: c, publish: p } };
}

export async function threadsMetrics(mediaId: string) {
  const { token } = creds();
  const r = await http(`${T}/${mediaId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(token)}`, { label: 'Threads insights' });
  const out: Record<string, number> = {};
  for (const m of r.data ?? []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
  return out;
}
