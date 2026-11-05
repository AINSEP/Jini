import type { RateLimiterPort } from './ports.js';
/** Pre-body admission counts every request, including malformed ones. The shared site budget
 * bounds multipart parsing; ordinary URL-encoded requests retain source admission only.
 * @returns The site's or source's refusal, otherwise admission to body parsing.
 * @complexity Two O(1) limiter checks, no body reads, persistence or external calls. */
export async function admitFormRequest(
  { workspaceId, sourceIp, site, source }: { workspaceId: string; sourceIp: string; site: RateLimiterPort; source: RateLimiterPort },
  { multipart = true }: { multipart?: boolean } = {},
): Promise<Awaited<ReturnType<RateLimiterPort['check']>>> {
  if (multipart) {
    const budget = await site.check({ key: workspaceId });
    if (!budget.allowed) return budget;
  }
  return source.check({ key: `${workspaceId}:${sourceIp}` });
}
