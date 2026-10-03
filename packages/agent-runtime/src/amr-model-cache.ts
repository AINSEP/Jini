/**
 * @module amr-model-cache
 *
 * A live-model-catalog cache that returns a cached remote list instantly
 * while refreshing in the background, falling back to a static preset
 * list on cold start. Ported verbatim from OD's
 * `apps/daemon/src/runtimes/amr/amr-model-cache.ts` with one change: the
 * `AmrModelsResponse` return type is now vendored locally (a small,
 * self-contained shape) instead of imported from OD's contracts workspace
 * package.
 *
 * Named for its origin use (the AMR/vela agent's live model list), but the
 * caching pattern itself is generic to any agent with a similarly-shaped
 * "cheap static preset + slower authoritative remote list" catalog.
 */
import type { RuntimeModelOption } from './types.js';
import { coalesceModelLoad } from './model-loading-state.js';

export type AmrModelsResponse = {
  source: 'remote' | 'preset';
  models: RuntimeModelOption[];
  refreshing: boolean;
  stale?: boolean;
  remoteError?: string;
};

type RemoteCacheEntry = {
  models: RuntimeModelOption[];
  fetchedAt: number;
};

type Fetchers = {
  fetchPreset: () => Promise<RuntimeModelOption[]>;
  fetchRemote: () => Promise<RuntimeModelOption[]>;
};

type CacheState = {
  remote: RemoteCacheEntry | null;
  inFlight: Promise<void> | null;
  lastRemoteError: string | null;
};

// The AMR model catalog changes rarely (new models land on the order of
// days), and a cached remote list is returned immediately while a refresh
// runs in the background — `get()` never blocks on the network when a
// cached entry exists. The per-run preflight also reads this cache, so a
// tight interval would spawn `vela model list` far more often than the
// catalog actually changes. Refresh at most once every 10 minutes per
// cache key; callers always get the last-known catalog instantly in
// between.
const DEFAULT_REMOTE_REFRESH_INTERVAL_MS = 10 * 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

export class AmrModelLoadingCache {
  private readonly states = new Map<string, CacheState>();

  private readonly refreshIntervalMs: number;

  constructor(_requiredArgs: Record<string, never> = {}, { refreshIntervalMs = DEFAULT_REMOTE_REFRESH_INTERVAL_MS }: { refreshIntervalMs?: number } = {}) {
    this.refreshIntervalMs = refreshIntervalMs;
  }

  async get({ cacheKey, fetchers }: { cacheKey: string; fetchers: Fetchers }): Promise<AmrModelsResponse> {
    const state = this.stateFor(cacheKey);
    const now = Date.now();
    if (state.remote) {
      const staleByAge = now - state.remote.fetchedAt >= this.refreshIntervalMs;
      if (staleByAge) this.startRefresh(state, fetchers.fetchRemote);
      return {
        source: 'remote',
        models: state.remote.models,
        refreshing: state.inFlight !== null,
        ...(state.inFlight || state.lastRemoteError ? { stale: true } : {}),
        ...(state.lastRemoteError ? { remoteError: state.lastRemoteError } : {}),
      };
    }

    const preset = await fetchers.fetchPreset();
    this.startRefresh(state, fetchers.fetchRemote);
    return {
      source: 'preset',
      models: preset,
      refreshing: state.inFlight !== null,
      ...(state.lastRemoteError ? { remoteError: state.lastRemoteError } : {}),
    };
  }

  warm({ cacheKey, fetchRemote }: { cacheKey: string; fetchRemote: () => Promise<RuntimeModelOption[]> }): void {
    this.startRefresh(this.stateFor(cacheKey), fetchRemote);
  }

  resetForTests(): void {
    this.states.clear();
  }

  private stateFor(cacheKey: string): CacheState {
    const existing = this.states.get(cacheKey);
    if (existing) return existing;
    const created: CacheState = { remote: null, inFlight: null, lastRemoteError: null };
    this.states.set(cacheKey, created);
    return created;
  }

  private startRefresh(state: CacheState, fetchRemote: () => Promise<RuntimeModelOption[]>): void {
    void coalesceModelLoad({ state, load: async () => {
      try {
        const models = await fetchRemote();
        if (models.length === 0) {
          throw new Error('AMR remote model list returned no chat models');
        }
        state.remote = { models, fetchedAt: Date.now() };
        state.lastRemoteError = null;
      } catch (error) {
        state.lastRemoteError = errorMessage(error);
      }
    } });
  }
}

export const amrModelLoadingCache = new AmrModelLoadingCache();
