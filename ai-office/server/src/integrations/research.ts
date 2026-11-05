import { http } from './http.js';
import { cred } from './registry.js';

export async function tavilySearch(query: string, signal?: AbortSignal) {
  const key = cred('tavily', 'apiKey');
  if (!key) return null;
  const r = await http('https://api.tavily.com/search', {
    method: 'POST', label: 'Tavily', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: 6, search_depth: 'basic' }),
  });
  return (r.results ?? []).map((x: any) => ({ title: x.title as string, url: x.url as string, snippet: (x.content as string)?.slice(0, 400) ?? '' }));
}

export async function testTavily() {
  const r = await tavilySearch('test');
  return `OK — ${r?.length ?? 0} kết quả`;
}

export async function pexelsSearch(query: string, perPage = 4, signal?: AbortSignal) {
  const key = cred('pexels', 'apiKey');
  if (!key) return null;
  const r = await http(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`, {
    headers: { Authorization: key }, label: 'Pexels', signal,
  });
  return (r.photos ?? []).map((p: any) => ({
    id: String(p.id), url: p.src?.large as string, author: p.photographer as string, page: p.url as string, alt: (p.alt as string) ?? '',
  }));
}

export async function testPexels() {
  const r = await pexelsSearch('gift', 1);
  return `OK — ${r?.length ?? 0} ảnh`;
}
