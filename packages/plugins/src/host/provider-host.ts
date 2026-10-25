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

/**
 * Track resources against snapshot identity, so replacement retires even the same plugin version.
 * @param required.contributions Existing executable contribution owner; detach retires immediately.
 * @param required.contracts Domain validators and optional built-in providers.
 * @param optional.disposeTimeoutMs Positive finite bound for each resource's teardown (default 2000).
 * @returns A host whose shutdown is idempotent and whose late factory results are disposed.
 * @throws RangeError for invalid timeout; PluginProviderError for unknown/invalid contracts or ports.
 */
export function createPluginProviderHost(required: {
  contributions: PluginContributionRegistry; contracts: readonly PluginProviderContract[];
}, optional: {
  disposeTimeoutMs?: number;
  onError?: (required: PluginProviderFailure, optional?: Record<string, never>) => void | Promise<void>;
} = {}): PluginProviderHost {
  const timeoutMs = optional.disposeTimeoutMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('invalid provider disposal timeout');
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
  let closed = false;
  let shutdown: Promise<void> | undefined;
  const current = (snapshot: PluginContributionsSnapshot): boolean => !closed && required.contributions.list({}).includes(snapshot);
  const cleanup = (item: Acquired): Promise<void> => {
    acquired.delete(item);
    const pending = item.lease.dispose({});
    cleanups.add(pending);
    void pending.then(() => { cleanups.delete(pending); });
    return pending;
  };
  const unsubscribe = required.contributions.subscribe({ onChanged: () => {
    // Contribution listeners can reject publication and roll it back synchronously. Release
    // only the committed generation; lease.isCurrent already blocks work during replacement.
    queueMicrotask(() => {
      for (const item of acquired) if (!current(item.snapshot)) void cleanup(item);
    });
  } });
  const report = (failure: PluginProviderFailure): void => {
    // Diagnostics must never prevent another provider from releasing its resources.
    try { void Promise.resolve(optional.onError?.(failure, {})).catch(() => {}); } catch { /* Failure reporting is a borrowed host effect. */ }
  };
  function leaseResource(input: {
    resource: PluginProviderResource; snapshot: PluginContributionsSnapshot; provider: PluginProviderContribution;
  }): Acquired {
    let release = disposers.get(input.resource);
    if (!release) {
      release = createResourceDisposer({ resource: input.resource, timeoutMs, report: failure => report({
        ...failure, pluginId: input.snapshot.pluginId, contract: input.provider.contract, id: input.provider.id,
      }) });
      disposers.set(input.resource, release);
    }
    let retired = false;
    const dispose = release;
    const item: Acquired = { snapshot: input.snapshot, lease: {
      port: input.resource.port,
      isCurrent: () => !retired && current(input.snapshot),
      dispose: () => { retired = true; acquired.delete(item); return dispose(); },
    } };
    return item;
  }
  function validatePort(input: { resource: PluginProviderResource; contract: PluginProviderContract; snapshot: PluginContributionsSnapshot; provider: PluginProviderContribution }): void {
    const registry = createProviderRegistry<unknown>({ contract: input.contract.contract }, {
      validate: input.contract.validate, seed: input.contract.seed ?? [],
    });
    if (!registry.contribute({ definition: { id: input.provider.id, provider: input.resource.port }, pluginId: input.snapshot.pluginId, contract: input.provider.contract })) {
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
  async function initialize(
    input: Parameters<PluginProviderHost['initialize']>[0], options: NonNullable<Parameters<PluginProviderHost['initialize']>[1]> = {},
  ): Promise<PluginProviderLease | undefined> {
    if (closed) throw new PluginProviderError({ message: 'provider host is closed' });
    const contract = contracts.get(input.contract);
    if (!contract) throw new PluginProviderError({ message: `unknown provider contract '${input.contract}'` });
    const selected = findProvider(input);
    if (!selected) return undefined;
    const { snapshot, provider } = selected;
    const resource = await provider.factory(input.input, options.factoryOptions ?? {});
    if (!resource || typeof resource.dispose !== 'function') throw new PluginProviderError({ message: 'provider factory must return { port, dispose }' });
    const item = leaseResource({ resource, snapshot, provider });
    try { validatePort({ resource, contract, snapshot, provider }); }
    catch (error) { await cleanup(item); throw error; }
    if (!current(snapshot)) { await cleanup(item); return undefined; }
    acquired.add(item);
    return item.lease;
  }
  return {
    initialize,
    dispose() {
      shutdown ??= (async () => {
        closed = true;
        unsubscribe();
        // Begin every teardown before awaiting any: a hung or rejected sink cannot block peers.
        for (const item of acquired) void cleanup(item);
        await Promise.all([...cleanups]);
      })();
      return shutdown;
    },
  };
}
