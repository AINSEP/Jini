/** @file Region-resolver slot. Resolvers come only from plugins the host enabled for this site; a host's
 * header resolver should be registered only when that host is the site's configured ingress (a header
 * from anywhere else can be forged by the visitor). Nothing here relaxes on a browser hint. */
import { REGION_KIND, type HeaderRegion, type RegionHint, type RegionResolver, type RegionRequest, type SlotKind } from '../contract.js';

/** A trusted country header. Unknown (XX) and Tor (T1) defer to the next resolver. @complexity O(1). */
export function headerResolver({ id, header }: { id: string; header: string }, { usValues = ['US'] }: { usValues?: readonly string[] | undefined } = {}): RegionResolver {
  const us = new Set(usValues.map(v => v.toUpperCase()));
  return { id, kind: REGION_KIND, resolve: ({ request }) => {
    const value = request.header(header)?.trim().toUpperCase();
    if (!value || value === 'XX' || value === 'T1') return null;
    return us.has(value) ? 'us' : 'strict';
  } };
}

/** Accepts a live resolver (resolve()) or the data-only manifest form ({ header, usValues }). */
export const REGION_SLOT: SlotKind<RegionResolver> = {
  kind: REGION_KIND,
  accept({ contribution: c }) {
    if (typeof c.resolve === 'function') return c as unknown as RegionResolver;     // e.g. an optional geo plugin
    if (typeof c.header !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(c.header)) return 'a region resolver needs resolve() or a header name';
    const d = c as unknown as HeaderRegion;
    return headerResolver({ id: d.id, header: d.header }, { usValues: d.usValues });
  },
};

/** First definite answer wins, in priority order. A throw, a timeout or nobody knowing => 'strict'.
 * @complexity O(resolvers). */
export async function resolveRegion({ resolvers, request }: { resolvers: readonly RegionResolver[]; request: RegionRequest }, { timeoutMs = 50 }: { timeoutMs?: number } = {}): Promise<RegionHint> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<RegionHint>(r => { timer = setTimeout(() => { ctl.abort(); r('strict'); }, timeoutMs); });
  try {
    for (const resolver of resolvers) {
      const asked = Promise.resolve().then(() => resolver.resolve({ request }, { signal: ctl.signal })).catch(() => 'strict' as const);
      const hint = await Promise.race([asked, expired]);
      if (hint) return hint;
    }
    return 'strict';
  } finally { clearTimeout(timer); }
}
