import { FatalError, RetryableError } from '../core/types.js';

/** fetch wrapper: timeout, JSON parsing, and retryable vs fatal error classification. */
export async function http<T = any>(
  url: string,
  init: RequestInit & { timeoutMs?: number; signal?: AbortSignal; label?: string } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), init.timeoutMs ?? 30000);
  init.signal?.addEventListener('abort', () => ctrl.abort(init.signal!.reason), { once: true });
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    throw new RetryableError(`${init.label ?? 'HTTP'}: lỗi kết nối (${e?.message ?? e})`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  // Several Meta/Zalo endpoints return 200 with an error object.
  const apiErr = body && typeof body === 'object' && (body.error?.message || (typeof body.error === 'number' && body.error !== 0 && body.message) || (body.error?.code && body.error.code !== 'ok' && body.error.message));
  if (!res.ok || apiErr) {
    const msg = `${init.label ?? 'HTTP'} ${res.status}: ${typeof apiErr === 'string' ? apiErr : typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`;
    if (res.status === 429 || res.status >= 500) throw new RetryableError(msg);
    throw new FatalError(msg);
  }
  return body as T;
}

export const form = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v));
  return p;
};
