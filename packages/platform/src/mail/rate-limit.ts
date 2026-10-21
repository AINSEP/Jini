/**
 * @file Per-provider token bucket with capacity reserved for transactional mail.
 *
 * Bulk and transactional share one provider quota, so a newsletter run could otherwise starve a
 * sign-in link for minutes. Bulk may only take tokens above `reservedForTransactional`; transactional
 * may drain the bucket to zero.
 */
import type { MailRateLimit } from "./provider.js";
import type { MailDeliveryLane } from "./ports.js";

export interface MailLaneLimiter {
  tryTake(required: { lane: MailDeliveryLane }): { ok: true } | { ok: false; retryAfterMs: number };
}

/**
 * @param required.limit - Sustained rate and burst size (the bucket starts full).
 * @param optional.reservedForTransactional - Tokens bulk may never consume; defaults to 20% of burst,
 *   at least 1 (never the whole burst).
 * @param optional.now - Injected clock in ms.
 * @complexity O(1) per take.
 */
export function createMailLaneLimiter(
  required: { limit: MailRateLimit },
  optional: { reservedForTransactional?: number; now?: () => number } = {},
): MailLaneLimiter {
  const { perSecond, burst } = required.limit;
  if (!(perSecond > 0) || !(burst >= 1)) throw new RangeError("mail rate limit needs perSecond > 0 and burst >= 1");
  const now = optional.now ?? Date.now;
  // At least one token whenever burst > 1: 20% of a small burst (Resend's 2) floors to 0, which let
  // bulk drain the bucket and starve an interactive sign-in link. Never all of it (bulk must move).
  const reserved = Math.min(optional.reservedForTransactional ?? Math.max(1, Math.floor(burst * 0.2)), burst - 1);
  let tokens = burst;
  let last = now();

  const refill = (): void => {
    const at = now();
    tokens = Math.min(burst, tokens + ((at - last) / 1000) * perSecond);
    last = at;
  };

  return {
    tryTake({ lane }) {
      refill();
      const floor = lane === "bulk" ? reserved : 0;
      if (tokens - 1 >= floor) {
        tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterMs: Math.ceil(((floor + 1 - tokens) / perSecond) * 1000) };
    },
  };
}
