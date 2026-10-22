/**
 * @file The DNS provider registry: the shared core registry (`contract: 'dns'`) seeded with the
 * built-in `manual` provider as default, plus a shape check so a malformed plugin contribution is
 * refused instead of failing at first use.
 */
import { token } from '@jini-ai/core';
import { createProviderRegistry, type ProviderDefinition, type ProviderRegistry } from '@jini-ai/core/provider-registry';
import type { AuthoritativeDnsPort, DnsProvider } from './contract.js';
import { createManualDnsProvider, MANUAL_DNS_PROVIDER_ID } from './manual.js';

export const DNS_PROVIDER_CONTRACT = 'dns';

export type DnsProviderRegistry = ProviderRegistry<DnsProvider>;

/** Composition token for the instance's DNS provider registry. */
export const DnsProviderRegistryToken = token<DnsProviderRegistry>({ id: 'jini.dnsProviderRegistry' });

/** Composition token for the authoritative resolver the manual provider and the verifier share. */
export const AuthoritativeDnsToken = token<AuthoritativeDnsPort>({ id: 'jini.authoritativeDns' });

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function capabilitiesValid(value: unknown): boolean {
  return isObject(value) && typeof value.automatic === 'boolean' && isStringList(value.recordTypes)
    && typeof value.apexFlattening === 'boolean' && typeof value.proxy === 'boolean';
}

function optionalFunction(value: unknown): boolean {
  return value === undefined || typeof value === 'function';
}

/** Ordered checks; each runs only after every earlier one passed. */
const SHAPE_CHECKS: ReadonlyArray<readonly [(provider: Record<string, unknown>) => boolean, string]> = [
  [provider => typeof provider.label === 'string' && provider.label.trim() !== '', 'label must be a non-empty string'],
  [provider => isStringList(provider.credentialKeys), 'credentialKeys must be a list of strings'],
  [provider => capabilitiesValid(provider.capabilities), 'capabilities must declare automatic, recordTypes, apexFlattening and proxy'],
  [provider => typeof provider.findZone === 'function' && typeof provider.listRecords === 'function', 'findZone and listRecords must be functions'],
  [provider => optionalFunction(provider.apply) && optionalFunction(provider.instructions), 'apply and instructions must be functions when present'],
  [provider => (provider.capabilities as { automatic: boolean }).automatic === (provider.apply !== undefined), 'automatic providers must implement apply and manual ones must omit it'],
];

/** @returns Why `provider` is not a DnsProvider, or undefined when it is one. */
export function dnsProviderShapeError(required: { readonly provider: unknown }, _optional = {}): string | undefined {
  const { provider } = required;
  if (!isObject(provider)) return 'provider must be an object';
  return SHAPE_CHECKS.find(([passes]) => !passes(provider))?.[1];
}

/** A registry definition whose id and label come from the provider itself. */
export function dnsProviderDefinition(required: { readonly provider: DnsProvider }, _optional = {}): ProviderDefinition<DnsProvider> {
  return { id: required.provider.id, label: required.provider.label, provider: required.provider };
}

/**
 * Build the DNS provider registry with `manual` registered and set as the default.
 * @param optional.seed - Further built-in providers, registered after `manual` (throwing policy).
 */
export function createDnsProviderRegistry(
  required: { readonly resolver: AuthoritativeDnsPort },
  optional: { readonly seed?: readonly DnsProvider[] } = {},
): DnsProviderRegistry {
  const manual = createManualDnsProvider({ resolver: required.resolver });
  return createProviderRegistry<DnsProvider>({ contract: DNS_PROVIDER_CONTRACT }, {
    defaultProviderId: MANUAL_DNS_PROVIDER_ID,
    validate: ({ provider }) => dnsProviderShapeError({ provider }),
    seed: [manual, ...(optional.seed ?? [])].map(provider => dnsProviderDefinition({ provider })),
  });
}
