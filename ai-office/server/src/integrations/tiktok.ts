import fs from 'node:fs';
import { http } from './http.js';
import { cred } from './registry.js';
import { tiktokToken } from './tokens.js';
import { FatalError, type Asset } from '../core/types.js';
import { absPath } from '../media/index.js';
import { sleep } from '../core/util.js';

const API = 'https://open.tiktokapis.com/v2';
const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8' });

export async function testTikTok() {
  const t = await tiktokToken();
  const r = await http(`${API}/user/info/?fields=open_id,display_name`, { headers: auth(t), label: 'TikTok' });
  return `Tài khoản: ${r.data?.user?.display_name ?? r.data?.user?.open_id}`;
}

export async function publishTikTok(o: { caption: string; video: Asset; signal?: AbortSignal; log: (m: string) => void }) {
  const t = await tiktokToken();
  const mode = (cred('tiktok', 'postMode') ?? 'inbox').toLowerCase() === 'direct' ? 'direct' : 'inbox';
  const file = fs.readFileSync(absPath(o.video.path));
  const size = file.length;
  const MB = 1024 * 1024;
  const chunkSize = size <= 64 * MB ? size : 10 * MB;
  const totalChunks = size <= 64 * MB ? 1 : Math.floor(size / chunkSize);
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks };

  let init: any;
  if (mode === 'direct') {
    const info = await http(`${API}/post/publish/creator_info/query/`, { method: 'POST', headers: auth(t), body: '{}', label: 'TikTok creator_info' });
    const options: string[] = info.data?.privacy_level_options ?? [];
    const wanted = (cred('tiktok', 'privacyLevel') ?? 'SELF_ONLY').toUpperCase();
    const privacy = options.includes(wanted) ? wanted : options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
    if (!privacy) throw new FatalError('TikTok không trả về privacy_level hợp lệ cho tài khoản này');
    o.log(`TikTok Direct Post, privacy = ${privacy}`);
    init = await http(`${API}/post/publish/video/init/`, {
      method: 'POST', headers: auth(t), label: 'TikTok init',
      body: JSON.stringify({ post_info: { title: o.caption.slice(0, 2200), privacy_level: privacy, video_cover_timestamp_ms: 1000 }, source_info }),
    });
  } else {
    o.log('TikTok Inbox upload: video vào hộp nháp, cần mở app TikTok để hoàn tất đăng.');
    init = await http(`${API}/post/publish/inbox/video/init/`, { method: 'POST', headers: auth(t), label: 'TikTok init', body: JSON.stringify({ source_info }) });
  }
  const { publish_id, upload_url } = init.data;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
    const res = await fetch(upload_url, {
      method: 'PUT', signal: o.signal,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
      body: file.subarray(start, end + 1),
    });
    if (!res.ok) throw new FatalError(`TikTok upload chunk ${i + 1} lỗi ${res.status}`);
  }
  let status = 'PROCESSING_UPLOAD';
  let last: any = null;
  for (let i = 0; i < 20 && status.startsWith('PROCESSING'); i++) {
    await sleep(3000, o.signal);
    last = await http(`${API}/post/publish/status/fetch/`, { method: 'POST', headers: auth(t), body: JSON.stringify({ publish_id }), label: 'TikTok status' });
    status = last.data?.status ?? status;
  }
  if (status === 'FAILED') throw new FatalError(`TikTok từ chối video: ${last?.data?.fail_reason ?? 'không rõ'}`);
  const postId = last?.data?.publicaly_available_post_id?.[0] ?? null;
  return {
    mode,
    status,
    externalId: String(postId ?? publish_id),
    url: postId ? `https://www.tiktok.com/video/${postId}` : null,
    response: { init: init.data, status: last?.data },
  };
}
