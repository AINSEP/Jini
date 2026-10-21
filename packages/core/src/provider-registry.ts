/**
 * @file The one keyed provider registry every provider seam shares (FROZEN CONTRACT, 2026-10-21).
 *
 * Four registries with four shapes grew independently (media `VendorAdapterRegistry`, visitor-auth,
 * `OAuthProviderRegistry`, commerce `createPaymentProviderRegistry`). This is the shape new seams use
 * and the four migrate to; `docs/provider-registry.md` in this package records the contract and the
 * migration path for each. Other builds depend on the exported names and semantics below: change
 * them only additively.
 *
 * Error policy is split by origin. A core/built-in registration that is malformed or duplicated is a
 * composition-root programming error, so it THROWS at boot (same class as commerce's registry). A
 * plugin contribution is third-party input, so a broken or duplicate one is recorded in
 * `refusals()` and never crashes boot (same policy as `createPluginContributionLoader`).
 */

/** Provider ids share the plugin-tool name grammar (agent-plugins lifecycle/tools/manifest.ts). */
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export type ProviderOrigin = 'core' | 'plugin';

/** One registered provider. Stored frozen; the `provider` value keeps its identity. */
export interface ProviderDefinition<T> {
  readonly id: string;
  readonly provider: T;
  readonly label?: string;
}

export interface RegisteredProvider<T> extends ProviderDefinition<T> {
  readonly origin: ProviderOrigin;
  /** Set only for `origin: 'plugin'`. */
  readonly pluginId?: string;
}

export type ProviderRefusalCode = 'invalid_id' | 'invalid_provider' | 'duplicate' | 'contract_mismatch' | 'displaced_by_core';

export interface ProviderRefusal {
  readonly code: ProviderRefusalCode;
  readonly pluginId: string;
  readonly providerId: string;
  readonly message: string;
}

export interface ProviderRegistry<T> {
  readonly contract: string;
  /** Core/built-in registration. @throws {ProviderRegistryError} on a bad id, invalid provider or duplicate. */
  register(required: { readonly definition: ProviderDefinition<T> }, _optional?: Record<string, never>): void;
  /** Plugin registration. Never throws (a throwing validator or provider getter is an `invalid_provider`
   * refusal); returns false and records a refusal instead. */
  contribute(required: { readonly definition: ProviderDefinition<T>; readonly pluginId: string; readonly contract?: string }, _optional?: Record<string, never>): boolean;
  get(required: { readonly id: string }, _optional?: Record<string, never>): RegisteredProvider<T> | undefined;
  has(required: { readonly id: string }, _optional?: Record<string, never>): boolean;
  /** Frozen snapshot in registration order. */
  list(_required?: Record<string, never>, _optional?: Record<string, never>): readonly RegisteredProvider<T>[];
  /** The configured default provider, if one was named and is registered. */
  getDefault(_required?: Record<string, never>, _optional?: Record<string, never>): RegisteredProvider<T> | undefined;
  /** Frozen snapshot of every refused plugin contribution, in refusal order. */
  refusals(_required?: Record<string, never>, _optional?: Record<string, never>): readonly ProviderRefusal[];
}

export class ProviderRegistryError extends Error {
  readonly code: ProviderRefusalCode;
  constructor(required: { readonly code: ProviderRefusalCode; readonly message: string }) {
    super(required.message);
    this.name = 'ProviderRegistryError';
    this.code = required.code;
  }
}

interface Fault { readonly code: ProviderRefusalCode; readonly message: string }

/** @returns The first validation fault of a definition, or undefined when it may be registered. */
function definitionFault<T>(
  required: { readonly contract: string; readonly definition: ProviderDefinition<T> },
  optional: { readonly validate?: (required: { readonly provider: T }) => string | undefined } = {},
): Fault | undefined {
  const { contract, definition } = required;
  if (typeof definition.id !== 'string' || !PROVIDER_ID_PATTERN.test(definition.id)) {
    return { code: 'invalid_id', message: `${contract} provider id '${String(definition.id)}' must match ${PROVIDER_ID_PATTERN.source}` };
  }
  const reason = optional.validate?.({ provider: definition.provider });
  if (reason !== undefined) return { code: 'invalid_provider', message: `${contract} provider '${definition.id}' is invalid: ${reason}` };
  return undefined;
}

/** The id for a refusal line; a hostile definition whose id cannot even be read is recorded as ''. */
function safeId<T>(required: { readonly definition: ProviderDefinition<T> }, _optional: Record<string, never> = {}): string {
  try { return String(required.definition.id); } catch { return ''; }
}

function frozenEntry<T>(required: { readonly definition: ProviderDefinition<T>; readonly origin: ProviderOrigin }, optional: { readonly pluginId?: string } = {}): RegisteredProvider<T> {
  const { id, provider, label } = required.definition;
  return Object.freeze({
    id, provider, origin: required.origin,
    ...(label === undefined ? {} : { label }),
    ...(optional.pluginId === undefined ? {} : { pluginId: optional.pluginId }),
  });
}

/**
 * Build an independent registry for one provider contract (e.g. `mail`, `dns`, `payments`).
 * Core always wins an id: a core registration displaces an earlier plugin entry (recording a
 * `displaced_by_core` refusal) so a plugin loaded first can never turn a later core registration
 * into a boot crash.
 * @param required.contract - Contract name used in messages and checked against contributions.
 * @param optional.defaultProviderId - Validated eagerly; need not be registered yet.
 * @param optional.validate - Contract-specific shape check; a string is the reason it is invalid.
 * @param optional.seed - Core definitions registered in order (throwing policy).
 * @throws {ProviderRegistryError} When the default id or a seed definition is invalid.
 * @complexity register/contribute/get/has O(1); list/refusals O(n) snapshot.
 */
export function createProviderRegistry<T>(
  required: { readonly contract: string },
  optional: {
    readonly defaultProviderId?: string;
    readonly validate?: (required: { readonly provider: T }) => string | undefined;
    readonly seed?: readonly ProviderDefinition<T>[];
  } = {},
): ProviderRegistry<T> {
  const { contract } = required;
  const { defaultProviderId, validate } = optional;
  if (defaultProviderId !== undefined && !PROVIDER_ID_PATTERN.test(defaultProviderId)) {
    throw new ProviderRegistryError({ code: 'invalid_id', message: `${contract} default provider id '${defaultProviderId}' must match ${PROVIDER_ID_PATTERN.source}` });
  }
  const providers = new Map<string, RegisteredProvider<T>>();
  const refused: ProviderRefusal[] = [];
  const refuse = (input: { readonly fault: Fault; readonly pluginId: string; readonly providerId: string }): false => {
    refused.push(Object.freeze({ ...input.fault, pluginId: input.pluginId, providerId: input.providerId }));
    return false;
  };

  const registry: ProviderRegistry<T> = {
    contract,
    register({ definition }) {
      const fault = definitionFault({ contract, definition }, { ...(validate ? { validate } : {}) });
      if (fault) throw new ProviderRegistryError(fault);
      const existing = providers.get(definition.id);
      if (existing?.origin === 'core') {
        throw new ProviderRegistryError({ code: 'duplicate', message: `${contract} provider '${definition.id}' is already registered` });
      }
      if (existing?.pluginId !== undefined) {
        refuse({ fault: { code: 'displaced_by_core', message: `${contract} provider '${definition.id}' from plugin '${existing.pluginId}' was replaced by the built-in provider` }, pluginId: existing.pluginId, providerId: definition.id });
        providers.delete(definition.id);
      }
      providers.set(definition.id, frozenEntry({ definition, origin: 'core' }));
    },
    contribute(input) {
      // Third-party input: a throwing validator, id or provider getter is refused, never propagated
      // (core registrations keep the throwing policy above).
      try { return contributeChecked(input); }
      catch { return refuse({ fault: { code: 'invalid_provider', message: `${contract} provider from plugin '${input.pluginId}' was not loaded: its definition could not be validated` }, pluginId: input.pluginId, providerId: safeId({ definition: input.definition }) }); }
    },
    get({ id }) { return providers.get(id); },
    has({ id }) { return providers.has(id); },
    list() { return Object.freeze([...providers.values()]); },
    getDefault() { return defaultProviderId === undefined ? undefined : providers.get(defaultProviderId); },
    refusals() { return Object.freeze([...refused]); },
  };
  function contributeChecked({ definition, pluginId, contract: declared }: Parameters<ProviderRegistry<T>['contribute']>[0]): boolean {
    const providerId = String(definition.id);
    if (declared !== undefined && declared !== contract) {
      return refuse({ fault: { code: 'contract_mismatch', message: `plugin '${pluginId}' contributed provider '${providerId}' for contract '${declared}', not '${contract}'` }, pluginId, providerId });
    }
    const fault = definitionFault({ contract, definition }, { ...(validate ? { validate } : {}) });
    if (fault) return refuse({ fault, pluginId, providerId });
    const existing = providers.get(providerId);
    if (existing) {
      const owner = existing.pluginId === undefined ? 'the built-in provider' : `plugin '${existing.pluginId}'`;
      return refuse({ fault: { code: 'duplicate', message: `${contract} provider '${providerId}' from plugin '${pluginId}' was not loaded: already registered by ${owner}` }, pluginId, providerId });
    }
    providers.set(providerId, frozenEntry({ definition, origin: 'plugin' }, { pluginId }));
    return true;
  }
  for (const definition of optional.seed ?? []) registry.register({ definition });
  return registry;
}

// ---------------------------------------------------------------------------------------------
// Shared provider-call types. Every provider method returns a ProviderResult instead of throwing.
// ---------------------------------------------------------------------------------------------

export type ProviderMode = 'test' | 'live';

/** Who a provider call acts for. Credentials are pre-resolved by the host, never carried here. */
export interface ProviderContext {
  readonly workspaceId: string;
  readonly siteId?: string;
  /** The connected account at the provider (e.g. a Stripe account or a mail domain id). */
  readonly providerAccountId?: string;
  readonly mode: ProviderMode;
}

/** The provider definitively refused: nothing happened, the caller may correct and retry. */
export type ProviderRejectedCode =
  | 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict'
  | 'rate_limited' | 'quota_exceeded' | 'unsupported' | 'not_configured' | 'provider_error';

/** The outcome is indeterminate (it may have happened): the caller must reconcile, not blindly retry. */
export type ProviderUnknownCode = 'timeout' | 'network' | 'provider_unavailable' | 'unexpected_response';

export interface ProviderError<C extends string> {
  readonly code: C;
  /** Caller-safe: no credentials, tokens, or raw provider payloads. */
  readonly message: string;
  readonly retryAfterMs?: number;
}

export type ProviderResult<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: ProviderError<ProviderRejectedCode> }
  | { readonly status: 'unknown'; readonly error: ProviderError<ProviderUnknownCode> };

export function providerOk<T>(required: { readonly value: T }, _optional: Record<string, never> = {}): ProviderResult<T> {
  return { status: 'ok', value: required.value };
}

export function providerRejected<T = never>(required: ProviderError<ProviderRejectedCode>, _optional: Record<string, never> = {}): ProviderResult<T> {
  return { status: 'rejected', error: { ...required } };
}

export function providerUnknown<T = never>(required: ProviderError<ProviderUnknownCode>, _optional: Record<string, never> = {}): ProviderResult<T> {
  return { status: 'unknown', error: { ...required } };
}

// ---------------------------------------------------------------------------------------------
// Domain requirements. Lives here, not in devops/dns, because mail, site hosting and TLS providers
// all declare records they need while a DNS provider (or the operator, manually) satisfies them.
// ---------------------------------------------------------------------------------------------

export type DomainPurpose = 'mail' | 'site' | 'tls';

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'CAA' | 'NS' | 'SRV';

export interface DomainRecordRequirement {
  readonly type: DnsRecordType;
  /** Fully-qualified record name, e.g. `send.example.com`. */
  readonly name: string;
  readonly value: string;
  readonly ttl?: number;
  /** MX / SRV priority. */
  readonly priority?: number;
  /** Operator-facing explanation, e.g. "DKIM signing key". */
  readonly note?: string;
}

/** What one provider needs from a domain before it can serve `purpose` for it. */
export interface DomainRequirement {
  readonly purpose: DomainPurpose;
  readonly domain: string;
  readonly providerId: string;
  readonly records: readonly DomainRecordRequirement[];
}
