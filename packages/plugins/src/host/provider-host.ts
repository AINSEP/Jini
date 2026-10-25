/** Resource lifecycle for the existing contribution snapshots. Domain validation stays injected. */
import { createProviderRegistry, type ProviderDefinition } from '@jini-ai/core/provider-registry';
import type { PluginContributionRegistry, PluginContributionsSnapshot } from './contributions.js';
import type { PluginProviderContribution, PluginProviderResource } from './provider-contributions.js';

export interface PluginProviderContract {
  readonly contract: string;
  /** Supplied by the domain owner; plugins never select or replace this validator. */
  readonly validate: (required: { provider: unknown }, optional?: Record<string, never>) => string | undefined;
  readonly seed?: readonly ProviderDefinition<unknown>[];
}
export interface PluginProviderFailure {
  readonly pluginId: string;
  readonly contract: string;
  readonly id: string;
  readonly phase: 'dispose' | 'dispose_timeout';
  readonly error: unknown;
}
export interface PluginProviderLease extends PluginProviderResource {
  /** Retired leases must not admit new application work. In-flight work is host-owned. */
  isCurrent(required: Record<string, never>, optional?: Record<string, never>): boolean;
  dispose(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}
export interface PluginProviderHost {
  /** Await during boot. Undefined means unavailable or retired while initialization was pending. */
  initialize(required: {
    contract: string; id: string; input: Readonly<Record<string, unknown>>;
  }, optional?: { factoryOptions?: Readonly<Record<string, unknown>> }): Promise<PluginProviderLease | undefined>;
  /** Disable/quarantine callers detach the contribution first; shutdown and failed boot call this. */
  dispose(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}
export class PluginProviderError extends Error {
  constructor(required: { message: string }, _optional: Record<string, never> = {}) {
    super(required.message); this.name = 'PluginProviderError';
  }
}
interface Acquired {
  readonly snapshot: PluginContributionsSnapshot;
  readonly lease: PluginProviderLease;
}

/** A timeout bounds waiting, not a promise's effects. Late results are still observed and released. */
function createResourceDisposer(required: {
  resource: PluginProviderResource; timeoutMs: number;
  report: (required: { phase: PluginProviderFailure['phase']; error: unknown }) => void;
}, _optional: Record<string, never> = {}): () => Promise<void> {
  let disposal: Promise<void> | undefined;
  return () => {
    disposal ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = Promise.resolve().then(() => required.resource.dispose({}, {})).catch(error => {
        required.report({ phase: 'dispose', error });
      });
      try {
        await Promise.race([work, new Promise<void>(resolve => {
          timer = setTimeout(() => {
            required.report({ phase: 'dispose_timeout', error: new PluginProviderError({ message: 'provider disposal timed out' }) });
            resolve();
          }, required.timeoutMs);
        })]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
    })();
    return disposal;
  };
}

function timeoutOption(value: number | undefined, fallback: number, name: string): number {
  const timeoutMs = value ?? fallback;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError(`invalid provider ${name} timeout`);
  return timeoutMs;
}

/**
 * Track resources against snapshot identity, so replacement retires even the same plugin version.
 * @param required.contributions Existing executable contribution owner; detach retires immediately.
 * @param required.contracts Domain validators and optional built-in providers.
 * @param optional.disposeTimeoutMs Positive finite bound for each resource's teardown (default 2000).
 * @param optional.initializeTimeoutMs Positive finite bound for awaiting a factory (default 10000).
 * @returns A host whose shutdown is idempotent and whose late factory results are disposed.
 * @throws RangeError for invalid timeouts; PluginProviderError for unknown/invalid contracts or ports.
 */
export function createPluginProviderHost(required: {
  contributions: PluginContributionRegistry; contracts: readonly PluginProviderContract[];
}, optional: {
  disposeTimeoutMs?: number;
  initializeTimeoutMs?: number;
  onError?: (required: PluginProviderFailure, optional?: Record<string, never>) => void | Promise<void>;
} = {}): PluginProviderHost {
  const timeoutMs = timeoutOption(optional.disposeTimeoutMs, 2000, 'disposal');
  const initializeTimeoutMs = timeoutOption(optional.initializeTimeoutMs, 10_000, 'initialization');
  const contracts = new Map<string, PluginProviderContract>();
  for (const contract of required.contracts) {
    if (contracts.has(contract.contract)) throw new PluginProviderError({ message: 'duplicate provider contract' });
    // Validate built-in definitions eagerly, using core's throwing composition policy.
    createProviderRegistry<unknown>({ contract: contract.contract }, { validate: contract.validate, seed: contract.seed ?? [] });
    contracts.set(contract.contract, contract);
  }
  const acquired = new Set<Acquired>();
  const cleanups = new Set<Promise<void>>();
  const disposers = new WeakMap<PluginProviderResource, () => Promise<void>>();
  // Pending initializations re-check their generation on each change, so retirement settles them.
  const wakers = new Set<() => void>();
  let closed = false;
  let shutdown: Promise<void> | undefined;
  const current = (snapshot: PluginContributionsSnapshot): boolean => !closed && required.contributions.list({}).includes(snapshot);
  // Every started teardown, direct or host-triggered, is awaited by shutdown.
  const track = (pending: Promise<void>): Promise<void> => {
    cleanups.add(pending);
    void pending.then(() => { cleanups.delete(pending); });
    return pending;
  };
  const cleanup = (item: Acquired): Promise<void> => item.lease.dispose({});
  const unsubscribe = required.contributions.subscribe({ onChanged: () => {
    // Contribution listeners can reject publication and roll it back synchronously. Release
    // only the committed generation; lease.isCurrent already blocks work during replacement.
    queueMicrotask(() => {
      for (const item of acquired) if (!current(item.snapshot)) void cleanup(item);
      for (const wake of wakers) wake();
    });
  } });
  const report = (failure: PluginProviderFailure): void => {
    // Diagnostics must never prevent another provider from releasing its resources.
    try { void Promise.resolve(optional.onError?.(failure, {})).catch(() => {}); } catch { /* Failure reporting is a borrowed host effect. */ }
  };
  function releaserFor(input: {
    resource: PluginProviderResource; snapshot: PluginContributionsSnapshot; provider: PluginProviderContribution;
  }): () => Promise<void> {
    let release = disposers.get(input.resource);
    if (!release) {
      release = createResourceDisposer({ resource: input.resource, timeoutMs, report: failure => report({
        ...failure, pluginId: input.snapshot.pluginId, contract: input.provider.contract, id: input.provider.id,
      }) });
      disposers.set(input.resource, release);
    }
    return release;
  }
  function leaseResource(input: { port: unknown; release: () => Promise<void>; snapshot: PluginContributionsSnapshot }): Acquired {
    let retired = false;
    const item: Acquired = { snapshot: input.snapshot, lease: {
      port: input.port,
      isCurrent: () => !retired && current(input.snapshot),
      dispose: () => { retired = true; acquired.delete(item); return track(input.release()); },
    } };
    return item;
  }
  function validatePort(input: { port: unknown; contract: PluginProviderContract; snapshot: PluginContributionsSnapshot; provider: PluginProviderContribution }): void {
    const registry = createProviderRegistry<unknown>({ contract: input.contract.contract }, {
      validate: input.contract.validate, seed: input.contract.seed ?? [],
    });
    if (!registry.contribute({ definition: { id: input.provider.id, provider: input.port }, pluginId: input.snapshot.pluginId, contract: input.provider.contract })) {
      throw new PluginProviderError({ message: registry.refusals()[0]!.message });
    }
  }
  function findProvider(input: { contract: string; id: string }): { snapshot: PluginContributionsSnapshot; provider: PluginProviderContribution } | undefined {
    for (const snapshot of required.contributions.list({})) {
      const provider = snapshot.providers?.find(value => value.contract === input.contract && value.id === input.id);
      if (provider) return { snapshot, provider };
    }
    return undefined;
  }
  /** Admit one factory result; anything not handed out as a lease is released before settling. */
  async function admit(input: {
    resource: PluginProviderResource; contract: PluginProviderContract; snapshot: PluginContributionsSnapshot;
    provider: PluginProviderContribution; abandoned: () => boolean;
  }): Promise<PluginProviderLease | undefined> {
    const { resource, snapshot } = input;
    if (!resource || typeof resource.dispose !== 'function') throw new PluginProviderError({ message: 'provider factory must return { port, dispose }' });
    // Cleanup exists before the first port read; the single read is the value validated and leased.
    const release = releaserFor(input);
    let item: Acquired;
    try {
      const port = resource.port;
      validatePort({ ...input, port });
      item = leaseResource({ port, release, snapshot });
    } catch (error) { await track(release()); throw error; }
    if (input.abandoned() || !current(snapshot)) { await cleanup(item); return undefined; }
    acquired.add(item);
    return item.lease;
  }
  /** Settle on the factory, retirement (undefined) or the deadline; admit() still releases late results. */
  function untilRetiredOrDeadline(input: {
    produced: Promise<PluginProviderLease | undefined>; snapshot: PluginContributionsSnapshot; abandon: () => void;
  }): Promise<PluginProviderLease | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake!: () => void;
    const stopped = new Promise<undefined>((resolve, reject) => {
      wake = () => { if (!current(input.snapshot)) { input.abandon(); resolve(undefined); } };
      timer = setTimeout(() => {
        input.abandon();
        reject(new PluginProviderError({ message: 'provider initialization timed out' }));
      }, initializeTimeoutMs);
    });
    wakers.add(wake);
    return Promise.race([input.produced, stopped]).finally(() => { wakers.delete(wake); clearTimeout(timer); });
  }
  async function initialize(
    input: Parameters<PluginProviderHost['initialize']>[0], options: NonNullable<Parameters<PluginProviderHost['initialize']>[1]> = {},
  ): Promise<PluginProviderLease | undefined> {
    if (closed) throw new PluginProviderError({ message: 'provider host is closed' });
    const contract = contracts.get(input.contract);
    if (!contract) throw new PluginProviderError({ message: `unknown provider contract '${input.contract}'` });
    const selected = findProvider(input);
    if (!selected) return undefined;
    const { snapshot, provider } = selected;
    let abandoned = false;
    const produced = Promise.resolve(provider.factory(input.input, options.factoryOptions ?? {}))
      .then(resource => admit({ resource, contract, snapshot, provider, abandoned: () => abandoned }));
    return untilRetiredOrDeadline({ produced, snapshot, abandon: () => { abandoned = true; } });
  }
  return {
    initialize,
    dispose() {
      shutdown ??= (async () => {
        closed = true;
        unsubscribe();
        // Begin every teardown before awaiting any: a hung or rejected sink cannot block peers.
        for (const item of acquired) void cleanup(item);
        for (const wake of wakers) wake();
        await Promise.all([...cleanups]);
      })();
      return shutdown;
    },
  };
}
