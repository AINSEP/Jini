import { createHash } from 'node:crypto';
import { canonicalJson } from '@jini-ai/core/records';
import type { Empty } from './ports.js';

/**
 * The `requestDigest` for an `EnqueueIntent`: sha-256 hex of the canonical JSON request, so a
 * replay with reordered keys still matches and any changed value conflicts. Pass the JSON-like
 * request the idempotency key was issued for, not the derived event.
 * @complexity O(n log n) time over n request keys, O(n) space.
 * @example const requestDigest = outboxRequestDigest({ request: body });
 */
export function outboxRequestDigest(required: { request: unknown }, _optional: Empty = {}): string {
  return createHash('sha256').update(canonicalJson({ value: required.request })).digest('hex');
}
