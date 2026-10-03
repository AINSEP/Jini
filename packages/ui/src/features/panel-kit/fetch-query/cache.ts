import type { Clock } from '@jini-ai/core/primitives';
import type { QueryKey } from './types.js';

/**
 * Ten seconds covers reading, closing and reopening a record or bouncing between screens
 * without paying for another identical request. Five seconds was too short for that read
 * cycle; thirty seconds exposed more other-operator staleness than the conservative initial
 * shared default should allow. There is no default polling/focus refresh, so this bounds
 * the extra exposure on a quick revisit. Write invalidation bypasses freshness; reads that
 * must be fresh on every mount can choose staleTime: 0 without lowering every query default.
 */
export const DEFAULT_STALE_TIME = 10_000;
const IDLE_RETENTION = 5 * 60_000;


export interface QueryCacheSchedulerPort {
  schedule(required: { callback: () => void; delayMs: number }): unknown;
  cancel(required: { handle: unknown }): void;
}
/** Host connectivity and focus signals; the cache itself has no DOM dependency. */
export interface FetchQueryEnvironmentPort {
  isOnline(): boolean;
  subscribeOnline(required: { listener: (online: boolean) => void }): () => void;
  subscribeFocus(required: { listener: () => void }): () => void;
}
export interface FetchQueryCacheOptions {
  clock?: Clock;
  scheduler?: QueryCacheSchedulerPort;
  environment?: FetchQueryEnvironmentPort;
}
const browserScheduler: QueryCacheSchedulerPort = {
  schedule: ({ callback, delayMs }) => setTimeout(callback, delayMs),
  cancel: ({ handle }) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface QueryState {
  data: unknown;
  error: Error | null;
  status: 'pending' | 'success' | 'error';
  isFetching: boolean;
}

export interface QueryObserver {
  fetch: () => Promise<unknown>;
  staleTime: number;
  focus: boolean;
}

export interface CacheEntry {
  key: QueryKey;
  state: QueryState;
  updatedAt: number;
  invalidated: boolean;
  replacement: number;
  pending: Promise<unknown> | undefined;
  refreshAfterPending: boolean;
  listeners: Set<() => void>;
  observers: Set<QueryObserver>;
  retention: number;
  eviction: unknown;
}

// Normalize unknown promise rejections once so consumers receive Error without repeating
// the same narrowing boilerplate at every read and write call site.
export function toQueryError(value: unknown): Error {
  return value instanceof Error ? value : new Error(typeof value === 'string' && value.trim() ? value : 'request failed');
}

/** One provider-owned cache. Requests are shared by structural primitive keys.
 * Failed reads retain earlier data; replacement writes supersede older requests.
 * Idle entries live for at least five minutes or their declared freshness period. */
export class FetchQueryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private disposed = false;
  private readonly clock: Clock;
  private readonly scheduler: QueryCacheSchedulerPort;
  private readonly environment: FetchQueryEnvironmentPort | undefined;
  private online: boolean;
  private readonly onlineWaiters = new Set<() => void>();
  private releaseEnvironment: (() => void) | undefined;

  constructor(_required: Record<string, never> = {}, { clock = { nowMs: () => Date.now() }, scheduler = browserScheduler, environment }: FetchQueryCacheOptions = {}) {
    this.clock = clock;
    this.scheduler = scheduler;
    this.environment = environment;
    this.online = environment?.isOnline() ?? true;
  }

  entry({ key }: { key: QueryKey }, { staleTime = DEFAULT_STALE_TIME }: { staleTime?: number } = {}): CacheEntry {
    const hash = JSON.stringify(key);
    let entry = this.entries.get(hash);
    if (!entry) {
      entry = {
        key: [...key], state: { data: undefined, error: null, status: 'pending', isFetching: false },
        updatedAt: 0, invalidated: false, replacement: 0, pending: undefined,
        refreshAfterPending: false, listeners: new Set(), observers: new Set(),
        retention: IDLE_RETENTION, eviction: undefined,
      };
      this.entries.set(hash, entry);
    }
    // An imperative load has no standing observer: idle eviction must not drop a value
    // earlier than its declared freshness and unexpectedly force another network request.
    entry.retention = Math.max(entry.retention, staleTime);
    return entry;
  }

  fresh({ entry, staleTime }: { entry: CacheEntry; staleTime: number }): boolean {
    return entry.state.data !== undefined && !entry.invalidated && this.clock.nowMs() - entry.updatedAt < staleTime;
  }

  subscribe({ entry, listener }: { entry: CacheEntry; listener: () => void }): () => void {
    this.cancelEviction(entry);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); this.scheduleEviction(entry); };
  }

  observe({ entry, observer }: { entry: CacheEntry; observer: QueryObserver }): () => void {
    entry.observers.add(observer);
    return () => { entry.observers.delete(observer); this.scheduleEviction(entry); };
  }

  /** Cache hits respect freshness; explicit refreshes restart background reads.
   * Initial reads still deduplicate because no earlier successful data exists to refresh. */
  load<T>({ entry, fetch, staleTime }: { entry: CacheEntry; fetch: () => Promise<T>; staleTime: number }, { force = false }: { force?: boolean } = {}): Promise<T> {
    this.cancelEviction(entry);
    if (entry.pending && (!force || entry.state.data === undefined)) return entry.pending as Promise<T>;
    if (!force && this.fresh({ entry: entry, staleTime: staleTime })) {
      this.scheduleEviction(entry);
      return Promise.resolve(entry.state.data as T);
    }
    // Shared per key across loader instances: a replacement while this request is out
    // must win over its older answer, not just protect the instance that issued the write.
    const replacement = entry.replacement;
    const run = (): Promise<T> => {
      // A queued offline refresh may have been superseded before reconnection.
      if (entry.pending !== pending) return (entry.pending ?? Promise.resolve(entry.state.data)) as Promise<T>;
      this.publish(entry, { ...entry.state, isFetching: true });
      return fetch();
    };
    const pending: Promise<T> = Promise.resolve().then(() => {
      if (this.online) return run();
      this.publish(entry, { ...entry.state, isFetching: false });
      return this.runOnline({ run });
    }).then(value => {
      const data = replacement === entry.replacement ? value : entry.state.data as T;
      // Undefined is never successful query data, including an initial or background read.
      if (data === undefined) throw new Error(`${JSON.stringify(entry.key)} data is undefined`);
      return data;
    }).then(data => {
      // Only the current request may publish or clear invalidation. An older transport
      // need not support abort: its callers follow the replacement request instead.
      if (entry.pending !== pending) return (entry.pending ?? entry.state.data) as Promise<T> | T;
      entry.updatedAt = this.clock.nowMs();
      entry.invalidated = false;
      this.publish(entry, { data, error: null, status: 'success', isFetching: false });
      return data;
    }, error => {
      if (entry.pending !== pending) return (entry.pending ?? entry.state.data) as Promise<T> | T;
      // A replacement write is newer than this read's failure as well as its data.
      // Keep the write's timestamp and freshness; only settle the obsolete fetch flag.
      if (replacement !== entry.replacement) {
        this.publish(entry, { ...entry.state, isFetching: false });
        return entry.state.data as T;
      }
      entry.invalidated = true;
      this.publish(entry, { ...entry.state, error: toQueryError(error), status: 'error', isFetching: false });
      throw error;
    }).finally(() => {
      if (entry.pending !== pending) return;
      entry.pending = undefined;
      if (entry.refreshAfterPending) {
        entry.refreshAfterPending = false;
        this.refresh(entry);
      }
      this.scheduleEviction(entry);
    });
    entry.pending = pending;
    // Mark handled even when a UI caller deliberately discards the promise.
    void pending.catch(() => {});
    const state = entry.state.data === undefined ? { ...entry.state, status: 'pending' as const, error: null } : entry.state;
    this.publish(entry, { ...state, isFetching: this.online });
    return pending;
  }

  replace({ entry, data }: { entry: CacheEntry; data: unknown }): void {
    entry.replacement += 1;
    entry.updatedAt = this.clock.nowMs();
    entry.invalidated = false;
    this.publish(entry, { data, error: null, status: 'success', isFetching: entry.state.isFetching });
    this.scheduleEviction(entry);
  }

  invalidate({ prefix }: { prefix: QueryKey }): void {
    for (const entry of this.entries.values()) {
      if (!prefix.every((part, index) => entry.key[index] === part)) continue;
      entry.invalidated = true;
      this.refresh(entry);
    }
  }

  onFocus(): void {
    for (const entry of this.entries.values()) {
      const observer = [...entry.observers].find(value => value.focus && !this.fresh({ entry: entry, staleTime: value.staleTime }));
      // Environmental refreshes share a request already underway, unlike an explicit gesture.
      if (observer && !entry.pending) void this.load({ entry: entry, fetch: observer.fetch, staleTime: observer.staleTime });
    }
  }

  /** Execute a read/write once connectivity returns; failures are not retried.
   * @param required.run Operation to invoke online.
   * @returns The operation's original result or rejection. */
  runOnline<T>({ run }: { run: () => Promise<T> }): Promise<T> {
    if (this.online) return Promise.resolve().then(() => {
      // Connectivity may change between queuing the operation and its invocation.
      if (!this.online) return this.runOnline({ run });
      return run();
    });
    return new Promise<void>(resolve => { this.onlineWaiters.add(resolve); }).then(() => this.runOnline({ run }));
  }

  /** Stop timers on provider disposal; reactivate for React's effect replay. */
  activate(): void {
    this.disposed = false;
    if (!this.environment || this.releaseEnvironment) return;
    const releaseOnline = this.environment.subscribeOnline({ listener: online => this.onOnline({ online }) });
    const releaseFocus = this.environment.subscribeFocus({ listener: () => this.onFocus() });
    this.releaseEnvironment = () => { releaseOnline(); releaseFocus(); };
    this.onOnline({ online: this.environment.isOnline() });
  }
  dispose(): void {
    this.disposed = true;
    this.releaseEnvironment?.();
    this.releaseEnvironment = undefined;
    for (const entry of this.entries.values()) this.cancelEviction(entry);
  }

  private onOnline({ online }: { online: boolean }): void {
    const reconnect = online && !this.online;
    this.online = online;
    if (!online) return;
    for (const resume of this.onlineWaiters) resume();
    this.onlineWaiters.clear();
    if (!reconnect) return;
    for (const entry of this.entries.values()) {
      const observer = [...entry.observers].find(value => !this.fresh({ entry, staleTime: value.staleTime }));
      // A paused request already owns its resumption; restarting it here would double-fetch.
      if (observer && !entry.pending) void this.load({ entry, fetch: observer.fetch, staleTime: observer.staleTime });
    }
  }

  private refresh(entry: CacheEntry): void {
    const observer = entry.observers.values().next().value as QueryObserver | undefined;
    if (observer) void this.load({ entry: entry, fetch: observer.fetch, staleTime: observer.staleTime }, { force: true });
  }

  private publish(entry: CacheEntry, state: QueryState): void {
    entry.state = state;
    for (const listener of entry.listeners) listener();
  }

  private cancelEviction(entry: CacheEntry): void {
    if (entry.eviction !== undefined) this.scheduler.cancel({ handle: entry.eviction });
    entry.eviction = undefined;
  }

  private scheduleEviction(entry: CacheEntry): void {
    this.cancelEviction(entry);
    if (this.disposed || entry.listeners.size || entry.observers.size || entry.pending || !Number.isFinite(entry.retention)) return;
    entry.eviction = this.scheduler.schedule({ callback: () => this.entries.delete(JSON.stringify(entry.key)), delayMs: entry.retention });
  }
}
