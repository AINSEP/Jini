import { trimChars, trimCharsEnd } from '@jini-ai/core/primitives';
/**
 * Shared label-sanitizing helpers deploy targets use to turn a caller-supplied `projectName` into a
 * provider-safe identifier (lowercase, hyphenated, length-capped). Lifted
 * verbatim from `apps/daemon/src/deploy.ts`'s `safeProjectLabel` — pure
 * string logic, no OD dependency to strip.
 *
 * @param requiredArgs - Arbitrary `raw` input and the required `maxLength` cap.
 * @returns A label containing only `[a-z0-9-]`, with no leading/trailing/
 *   duplicate hyphens, truncated to `maxLength`.
 * @complexity O(n) in the length of `raw`.
 * @overallScore 100/100
 */
export function safeProjectLabel({ raw, maxLength }: { raw: unknown; maxLength: number }): string {
  const collapsed = String(raw)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
  return trimCharsEnd({ text: trimChars({ text: collapsed, chars: '-' }).slice(0, maxLength), chars: '-' });
}

/** DNS-label-safe variant (63-char cap, the DNS label limit). */
export function safeDnsLabel({ raw }: { raw: unknown }): string {
  return safeProjectLabel({ raw, maxLength: 63 });
}
