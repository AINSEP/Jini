/**
 * Injection-style capability registry. Ported verbatim (pattern-for-pattern)
 * from OD's `apps/daemon/src/media-adapters/capabilities.ts` — the
 * task brief's own research flagged this as "a clean, already-generic port."
 * The registry holds NO data of its own: callers seed it, and every consumer
 * depends only on `get()`/`register()`/`all()`, never on the raw seed, so
 * swapping the data source (a hardcoded const today, a live vendor-API fetch
 * tomorrow) touches nothing downstream.
 */
import type { ModelCapability } from './types.js';

export interface CapabilityRegistry {
  /** Looks up a model by catalogue id (an aggregator prefix, if any, is stripped first — see `normalizeModelId`). */
  get(required: { id: string }): ModelCapability | undefined;
  /** Adds/overrides capabilities (later calls win on a duplicate id). */
  register(required: { caps: readonly ModelCapability[] }): void;
  /** All registered capabilities. */
  all(): ModelCapability[];
}

/**
 * Normalizes a catalogue id by stripping a leading `aihubmix-` aggregator
 * prefix and trimming whitespace. The prefix convention comes from this
 * package's one ported reference seed (`seed.ts`) — a different aggregator's
 * prefix is the caller's own normalization to apply before `register`/`get`.
 */
export function normalizeModelId({ id }: { id: string }): string {
  return (id || '').trim().replace(/^aihubmix-/, '');
}

/** Creates a `CapabilityRegistry`, optionally pre-seeded with `seed`. */
export function createCapabilityRegistry({  }: Record<string, never>, { seed = [] }: { seed?: readonly ModelCapability[] | undefined } = {}): CapabilityRegistry {
  const map = new Map<string, ModelCapability>();
  const register = ({ caps }: { caps: readonly ModelCapability[] }): void => {
    for (const cap of caps) {
      if (cap && typeof cap.id === 'string' && cap.id) {
        map.set(normalizeModelId({ id: cap.id }), cap);
      }
    }
  };
  register({ caps: seed });
  return {
    get: ({ id }: { id: string }) => map.get(normalizeModelId({ id })),
    register,
    all: () => [...map.values()],
  };
}
