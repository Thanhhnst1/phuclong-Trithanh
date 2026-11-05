import fs from 'node:fs';
import { config } from '../config.js';
import { http } from './http.js';
import { cred } from './registry.js';
import { FatalError, type Asset } from '../core/types.js';
import { absPath } from '../media/index.js';

const G = () => `https://graph.facebook.com/${config.fbGraphVersion}`;

function creds() {
  const pageId = cred('facebook', 'pageId');
  const token = cred('facebook', 'pageAccessToken');
  if (!pageId || !token) throw new FatalError('Facebook chưa được kết nối (thiếu Page ID / token)');
  return { pageId, token };
}

export async function testFacebook() {
  const { pageId, token } = creds();
  const r = await http(`${G()}/${pageId}?fields=id,name,link&access_token=${encodeURIComponent(token)}`, { label: 'Facebook' });
  return `Page: ${r.name} (${r.id})`;
}

export async function publishFacebook(o: { message: string; image?: Asset | null; video?: Asset | null; signal?: AbortSignal }) {
  const { pageId, token } = creds();
  if (o.video) {
    const fd = new FormData();
    fd.set('access_token', token);
    fd.set('description', o.message);
    fd.set('source', new Blob([fs.readFileSync(absPath(o.video.path))], { type: o.video.mime }), 'video.mp4');
    const r = await http(`${G()}/${pageId}/videos`, { method: 'POST', body: fd, label: 'Facebook video', timeoutMs: 300000, signal: o.signal });
    return { externalId: r.id as string, url: `https://www.facebook.com/${pageId}/videos/${r.id}`, response: r };
  }
  if (o.image) {
    const fd = new FormData();
    fd.set('access_token', token);
    fd.set('message', o.message);
    fd.set('source', new Blob([fs.readFileSync(absPath(o.image.path))], { type: o.image.mime }), 'image.jpg');
    const r = await http(`${G()}/${pageId}/photos`, { method: 'POST', body: fd, label: 'Facebook photo', timeoutMs: 120000, signal: o.signal });
    const postId = (r.post_id as string) ?? `${pageId}_${r.id}`;
    return { externalId: postId, url: `https://www.facebook.com/${postId}`, response: r };
  }
  const r = await http(`${G()}/${pageId}/feed`, {
    method: 'POST', body: new URLSearchParams({ message: o.message, access_token: token }), label: 'Facebook feed', signal: o.signal,
  });
  return { externalId: r.id as string, url: `https://www.facebook.com/${r.id}`, response: r };
}

export async function facebookMetrics(postId: string) {
  const { token } = creds();
  const r = await http(
    `${G()}/${postId}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${encodeURIComponent(token)}`,
    { label: 'Facebook metrics' },
  );
  return {
    reactions: r.reactions?.summary?.total_count ?? 0,
    comments: r.comments?.summary?.total_count ?? 0,
    shares: r.shares?.count ?? 0,
  };
}
