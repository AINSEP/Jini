/**
 * @file One Electron session partition (one cookie jar) per key. Cookies ignore port, so two
 * loopback servers on different ports share a jar by default — one's session cookie would be sent
 * to the other, and the second redeem would overwrite the first. A partition per site is a
 * correctness requirement of serving several sites, not a hardening nicety.
 */
import crypto from 'node:crypto';

/**
 * A stable, filesystem-safe `persist:` partition name for `required.key`.
 *
 * Hashed rather than derived from the key so the name cannot collide with Electron's partition
 * syntax (`persist:` prefix, `/` separators) and does not leak e.g. the operator's directory
 * layout into a partition directory name under `userData`. The host normalises the key first
 * (e.g. `path.resolve` of a site dir) so equivalent spellings share one jar.
 *
 * @param required.prefix the host's partition namespace, placed between `persist:` and the digest.
 * @returns `persist:<prefix><32 hex chars>`.
 * @complexity O(n) in the key length.
 */
export function persistentPartitionName(required: { prefix: string; key: string }, _optional: Record<string, never> = {}): string {
  const digest = crypto.createHash('sha256').update(required.key).digest('hex').slice(0, 32);
  return `persist:${required.prefix}${digest}`;
}
