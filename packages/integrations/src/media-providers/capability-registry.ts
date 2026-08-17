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
  get(id: string): ModelCapability | undefined;
  /** Adds/overrides capabilities (later calls win on a duplicate id). */
  register(caps: readonly ModelCapability[]): void;
  /** All registered capabilities. */
  all(): ModelCapability[];
}

/**
 * Normalizes a catalogue id by stripping a leading `aihubmix-` aggregator
 * prefix and trimming whitespace. The prefix convention comes from this
 * package's one ported reference seed (`seed.ts`) — a different aggregator's
 * prefix is the caller's own normalization to apply before `register`/`get`.
 */
export function normalizeModelId(id: string): string {
  return (id || '').trim().replace(/^aihubmix-/, '');
}

/** Creates a `CapabilityRegistry`, optionally pre-seeded with `seed`. */
export function createCapabilityRegistry(seed: readonly ModelCapability[] = []): CapabilityRegistry {
  const map = new Map<string, ModelCapability>();
  const register = (caps: readonly ModelCapability[]): void => {
    for (const cap of caps) {
      if (cap && typeof cap.id === 'string' && cap.id) {
        map.set(normalizeModelId(cap.id), cap);
      }
    }
  };
  register(seed);
  return {
    get: (id) => map.get(normalizeModelId(id)),
    register,
    all: () => [...map.values()],
  };
}
