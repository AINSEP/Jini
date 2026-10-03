/** Fixed-window counting over a host-owned clock and counter store. */

import type { Clock } from '@jini-ai/core/primitives';
export type { Clock } from '@jini-ai/core/primitives';

/** Host-selected window and request budget; no product profiles live here. */
export interface RateLimitProfile {
  readonly windowSeconds: number;
  readonly max: number;
  readonly burst: number;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export interface CounterWindow {
  readonly windowStartMs: number;
  readonly count: number;
}

/**
 * Async storage port. Dedicate one store to one limiter; checks are serialized
 * within that limiter. Sharing a store across processes requires a different,
 * atomic distributed algorithm. Stored values are replaced, never mutated.
 */
export interface CounterStore {
  get(required: { key: string }): Promise<CounterWindow | undefined>;
  set(required: { key: string; state: CounterWindow }): Promise<void>;
  delete(required: { key: string }): Promise<void>;
  entries(required: Record<string, never>): Promise<Iterable<readonly [string, CounterWindow]>>;
  size(required: Record<string, never>): Promise<number>;
}

// Each allowed check consumes its budget immediately; there is no separate commit step.
// size is an eviction diagnostic, not a capability a request consumer needs.
export interface RateLimiter {
  /** Resolves the budget decision; rejects missing, non-string or empty keys with TypeError. */
  check(required: { key: string }): Promise<RateLimitResult>;
  size(required: Record<string, never>): Promise<number>;
}

/**
 * Creates an isolated in-memory CounterStore adapter.
 * @param _required - No required configuration for this adapter.
 * @returns A new store; construct one for each limiter.
 */
export function createMemoryCounterStore(
  _required: Record<string, never>,
  _optional: Record<string, never> = {},
): CounterStore {
  const windows = new Map<string, CounterWindow>();
  return {
    get: async ({ key }) => windows.get(key),
    set: async ({ key, state }) => { windows.set(key, { ...state }); },
    delete: async ({ key }) => { windows.delete(key); },
    entries: async () => windows.entries(),
    size: async () => windows.size,
  };
}

// An injected clock makes window boundaries deterministic without real-time sleeps; a fresh
// dedicated store keeps limiter instances isolated instead of sharing module-global counters.
/**
 * Builds a fixed-window limiter, preserving max+burst and ceil-to-second retry
 * delays. Counter updates and periodic eviction run in arrival order across
 * storage awaits. Rejected checks do not consume more of the budget.
 * @param required - Host profile, clock and dedicated counter store.
 * @returns An async limiter. Storage failures reject the caller's check.
 * Invalid keys reject with TypeError before storage or queue state is touched.
 * @example const result = await limiter.check({ key: clientIp });
 */
export function createRateLimiter(
  { profile, clock, store }: { profile: RateLimitProfile; clock: Clock; store: CounterStore },
  _optional: Record<string, never> = {},
): RateLimiter {
  const windowMs = profile.windowSeconds * 1000;
  const effectiveMax = profile.max + profile.burst;
  let lastSweepMs: number | null = null;
  let pending: Promise<void> = Promise.resolve();

  // Expiry sweeps prevent attacker-controlled keys (for example rotating anonymous source IPs)
  // from accumulating forever. Work is O(tracked keys) only once per window; per-request full
  // scans would replace a memory-exhaustion risk with linear request latency. Active key volume
  // still determines memory use, and separate in-memory processes each retain their own budget.
  async function consume(key: string): Promise<RateLimitResult> {
    const nowMs = clock.nowMs();
    if (lastSweepMs === null) {
      lastSweepMs = nowMs;
    } else if (nowMs - lastSweepMs >= windowMs) {
      // One scan per window, rather than one per request. Sweep cost is linear
      // in tracked keys; expired entries behave exactly like missing entries.
      for (const [expiredKey, state] of await store.entries({})) {
        if (nowMs - state.windowStartMs >= windowMs) await store.delete({ key: expiredKey });
      }
      lastSweepMs = nowMs;
    }

    const existing = await store.get({ key });
    if (!existing || nowMs - existing.windowStartMs >= windowMs) {
      await store.set({ key, state: { windowStartMs: nowMs, count: 1 } });
      return { allowed: true };
    }
    if (existing.count < effectiveMax) {
      await store.set({ key, state: { ...existing, count: existing.count + 1 } });
      return { allowed: true };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartMs + windowMs - nowMs) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  return {
    check: async (required) => {
      const key = required?.key;
      // Positional or missing keys must never merge unrelated clients into an undefined bucket.
      if (typeof key !== "string" || key === "") throw new TypeError("rate limit key must be a non-empty string");
      const result = pending.then(() => consume(key));
      // Only the queue's tail contains the failure. The caller still receives
      // the rejection, and later checks can try the adapter again.
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
    size: () => pending.then(() => store.size({})),
  };
}

// A minimal structural request avoids importing a framework's full socket/request type and
// lets policy be evaluated with plain objects, without coupling domains to a transport host.
/** Structural request shape; transport/framework trust configuration stays outside. */
export interface ClientIpSource {
  readonly socket: { readonly remoteAddress?: string };
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}

/**
 * Host trust policy. A fallback may use framework-resolved `source.ip` only
 * when the host has configured that framework's proxy trust appropriately.
 */
export interface ClientIpPolicy {
  readonly unknownAddress: string;
  isTrustedProxy(required: { address: string }): boolean;
  fallbackAddress(required: { source: ClientIpSource; socketPeer: string }): string;
}

/**
 * Reads the first forwarded hop only when the immediate peer is trusted.
 * @param required - Request source and explicit host trust/fallback policy.
 * @returns The forwarded IP for a trusted peer, or the policy's fallback.
 */
export function resolveClientIp(
  { source, policy }: { source: ClientIpSource; policy: ClientIpPolicy },
  _optional: Record<string, never> = {},
): string {
  const socketPeer = source.socket?.remoteAddress ?? policy.unknownAddress;
  if (policy.isTrustedProxy({ address: socketPeer })) {
    const header = source.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header[0] : header;
    const firstHop = value?.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  }
  return policy.fallbackAddress({ source, socketPeer });
}
