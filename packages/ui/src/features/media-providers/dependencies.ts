import { fakeLatencyDelay } from '../../utils/fake-latency.js';
import type { MediaProviderRowsPort, MediaProvidersPort } from './ports.js';
import type { MediaProviderMap } from './types.js';

export interface FakeMediaProvidersPortOptions {
  /** Seed daemon-held providers. Defaults to an empty map — REACHED, manages
   *  nothing — not `null`. A caller who wants the "daemon unreachable"
   *  branch must ask for it explicitly via `unreachable: true`; the two are
   *  never interchangeable (see `MediaProvidersPort.fetchMediaProviders`). */
  providers?: MediaProviderMap;
  /** When true, `fetchMediaProviders` resolves `null` instead of `providers`
   *  — the daemon was never reached. Exercises the branch
   *  `mergeDaemonProviders` treats as "leave local state alone". */
  unreachable?: boolean;
  /** When set, `saveMediaProviders` REJECTS with this message instead of
   *  persisting — the "save could not run at all" path. */
  saveError?: string;
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

/**
 * An in-memory test/demo double. Per this package's established convention
 * (see `project-locations/dependencies.ts`, `skills/dependencies.ts`), ships
 * a fake rather than a real transport — a real host supplies its own
 * `MediaProvidersPort` pointed at its own daemon's media-provider config
 * endpoints.
 */
export function createFakeMediaProvidersPort(options: FakeMediaProvidersPortOptions = {}): MediaProvidersPort {
  let providers: MediaProviderMap = { ...(options.providers ?? {}) };
  const latencyMs = options.latencyMs ?? 0;
  const delay = fakeLatencyDelay({}, { latencyMs });
  const delayedRejection = (message: string): Promise<never> =>
    latencyMs > 0
      ? new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), latencyMs))
      : Promise.reject(new Error(message));

  return {
    fetchMediaProviders() {
      if (options.unreachable) return delay({ value: null });
      return delay({ value: { ...providers } });
    },
    saveMediaProviders(next: MediaProviderMap) {
      if (options.saveError) return delayedRejection(options.saveError);
      providers = { ...next };
      return delay({ value: { ...providers } });
    },
  };
}

/**
 * The per-provider twin of {@link createFakeMediaProvidersPort}, with the same options: a patch
 * merges into one entry and a removal drops one entry, so a test can prove another provider was
 * left alone. `saveError` rejects both writes without persisting.
 */
export function createFakeMediaProviderRowsPort(options: FakeMediaProvidersPortOptions = {}): MediaProviderRowsPort {
  let providers: MediaProviderMap = { ...(options.providers ?? {}) };
  const latencyMs = options.latencyMs ?? 0;
  const delay = fakeLatencyDelay({}, { latencyMs });
  const write = (apply: () => void): Promise<MediaProviderMap> => {
    if (options.saveError) return Promise.reject(new Error(options.saveError));
    apply();
    return delay({ value: { ...providers } });
  };

  return {
    fetchMediaProviders() {
      if (options.unreachable) return delay({ value: null });
      return delay({ value: { ...providers } });
    },
    applyProviderChanges({ removes, patches }, _optional = {}) {
      return write(() => {
        const next = { ...providers };
        for (const providerId of removes) delete next[providerId];
        for (const { providerId, fields } of patches) next[providerId] = { ...next[providerId], ...fields };
        providers = next;
      });
    },
    patchProvider({ providerId, fields }) {
      return write(() => {
        providers = { ...providers, [providerId]: { ...providers[providerId], ...fields } };
      });
    },
    removeProvider({ providerId }) {
      return write(() => {
        providers = Object.fromEntries(Object.entries(providers).filter(([id]) => id !== providerId));
      });
    },
  };
}
