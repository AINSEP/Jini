import type { Clock } from '@jini-ai/core/primitives';
import { coalesceModelLoad, type ModelLoadingState } from './model-loading-state.js';

/** Components are encoded as a JSON tuple; delimiter characters cannot alias another tenant's key. Hosts include all credential/provider scopes affecting discovery. */
export type ModelCatalogCacheKey = readonly string[];
export type ModelDiscovery<Model> = (input: { cacheKey: ModelCatalogCacheKey }) => Promise<readonly Model[] | null>;
export type ModelMerger<Model> = (input: { fallback: readonly Model[]; live: readonly Model[] }) => readonly Model[];

export interface ModelCatalogCacheDependencies<Model> {
  readonly discover: ModelDiscovery<Model>;
  readonly clock: Clock;
  readonly merge: ModelMerger<Model>;
}
export interface ModelCatalogCacheOptions {
  readonly ttlMs?: number;
  /** Called once per failed discovery, after fallback state is recorded. */
  readonly onDiscoveryError?: (input: { error: unknown; cacheKey: ModelCatalogCacheKey }) => void;
}
/** Per-call discovery can close over a credential the host has already resolved. */
export interface ModelCatalogReadOptions<Model> {
  readonly discover?: ModelDiscovery<Model>;
}

interface CatalogState<Model> extends ModelLoadingState {
  expiresAt: number;
  live: readonly Model[] | null;
}

/** Blocking live-discovery enrichment backed by the same single-flight loader as the legacy model cache. Successes and failures share the TTL; the host resolves credentials before calling get. */
export class ModelCatalogCache<Model> {
  private readonly states = new Map<string, CatalogState<Model>>();
  private readonly ttlMs: number;

  constructor(private readonly required: ModelCatalogCacheDependencies<Model>, private readonly optional: ModelCatalogCacheOptions = {}) {
    this.ttlMs = optional.ttlMs ?? 5 * 60_000;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0) throw new RangeError('ttlMs must be finite and non-negative');
  }

  /** Returns the current fallback merged with cached live data, awaiting at most one discovery per key.
   * Local key work is proportional to the key's encoded length; discovery and merge cost belongs to the host ports. State retains one entry per distinct key until this instance is discarded.
   */
  async get({ cacheKey, fallback }: { cacheKey: ModelCatalogCacheKey; fallback: readonly Model[] }, options: ModelCatalogReadOptions<Model> = {}): Promise<readonly Model[]> {
    const key = JSON.stringify(cacheKey);
    let state = this.states.get(key);
    if (!state) {
      state = { inFlight: null, expiresAt: -Infinity, live: null };
      this.states.set(key, state);
    }
    if (state.inFlight) {
      await state.inFlight;
    } else if (state.expiresAt <= this.required.clock.nowMs()) {
      state.expiresAt = this.required.clock.nowMs() + this.ttlMs;
      const current = state;
      const discover = options.discover ?? this.required.discover;
      // Snapshot the key before crossing the asynchronous discovery boundary.
      const scopedKey = [...cacheKey];
      await coalesceModelLoad({
        state: current, load: async () => {
          try {
            current.live = await discover({ cacheKey: scopedKey });
          } catch (error) {
            current.live = null;
            this.optional.onDiscoveryError?.({ error, cacheKey: scopedKey });
          }
        }
      });
    }
    return this.required.merge({ fallback, live: state.live ?? [] });
  }
}

/** Keeps every fallback entry and its metadata in order, then appends each unseen live ID once. Neither input list is mutated. Time and space are O(fallback.length + live.length). */
export function unionModels<Model extends { readonly id: string }>({ fallback, live }: { fallback: readonly Model[]; live: readonly Model[] }): Model[] {
  const seen = new Set(fallback.map(model => model.id));
  const merged = [...fallback];
  for (const model of live) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }
  return merged;
}
