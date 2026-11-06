import { fold } from '../core/util.js';
import { stories } from '../db/index.js';
import type { Story } from '../core/types.js';

const STOP = new Set('cua va la co mot nhung cac duoc trong cho voi khi da den tu nay nguoi the the-gioi o ve bi ra vi sau truoc the a an the of in on at to for with from by is are was were be has have had this that new'.split(' '));

/** Order-independent token signature of a title (diacritics removed, stop-words dropped). */
export function fingerprint(title: string) {
  return [...new Set(fold(title).split(' ').filter((w) => w.length > 2 && !STOP.has(w)))].sort().join(' ');
}

export function similarity(a: string, b: string) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Find an earlier topic (any campaign) that is essentially the same story. */
export function findDuplicate(title: string, exceptCampaign: string): Story | null {
  const fp = fingerprint(title);
  for (const s of stories.history()) {
    if (s.campaignId === exceptCampaign) continue;
    if (similarity(fp, s.fingerprint) >= 0.5) return s;
  }
  return null;
}

/** Keep only URLs actually returned by the search tools — the model may not invent sources. */
export function keepKnownSources<T extends { url: string }>(list: T[], known: Set<string>): T[] {
  const norm = (u: string) => u.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
  const knownNorm = new Set([...known].map(norm));
  return list.filter((s) => knownNorm.has(norm(s.url)));
}

export const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};
