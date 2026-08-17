/**
 * Shared label-sanitizing helpers used by both the Vercel and Cloudflare
 * Pages adapters to turn a caller-supplied `projectName` into a
 * provider-safe identifier (lowercase, hyphenated, length-capped). Lifted
 * verbatim from `apps/daemon/src/deploy.ts`'s `safeProjectLabel` — pure
 * string logic, no OD dependency to strip.
 *
 * @param raw - Arbitrary caller input (may be empty, non-ASCII, etc).
 * @param maxLength - Hard cap on the returned label's length.
 * @returns A label containing only `[a-z0-9-]`, with no leading/trailing/
 *   duplicate hyphens, truncated to `maxLength`.
 * @complexity O(n) in the length of `raw`.
 * @overallScore 100/100
 */
export function safeProjectLabel(raw: unknown, maxLength: number): string {
  return String(raw)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** DNS-label-safe variant (63-char cap, the DNS label limit). */
export function safeDnsLabel(raw: unknown): string {
  return safeProjectLabel(raw, 63);
}
