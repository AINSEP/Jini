/**
 * @file NS delegation check. The registrar (who publishes the NS set in the parent zone) and the
 * DNS host (who serves the records) are often different companies; planning against a host the
 * zone is not delegated to edits records nobody resolves. This only READS the delegation —
 * registrar writes are out of scope.
 */
import { providerUnknown, type ProviderResult } from '@jini-ai/core/provider-registry';
import type { AuthoritativeDnsPort } from './contract.js';
import { normalizeDnsName } from './records.js';

export type DelegationState = 'delegated' | 'not_delegated' | 'unknown';

export interface DelegationCheck {
  readonly zone: string;
  readonly state: DelegationState;
  /** The NS set the parent publishes (normalized, sorted). */
  readonly nameservers: readonly string[];
  /** Expected nameservers absent from the delegation. */
  readonly missing: readonly string[];
  /** Delegated nameservers the caller did not expect (e.g. the previous DNS host's). */
  readonly unexpected: readonly string[];
  readonly reason: string;
}

/** Call a port method, turning a thrown error into the `unknown` outcome it really is. */
export async function settlePort<T>(required: { readonly call: () => Promise<ProviderResult<T>> }, _optional = {}): Promise<ProviderResult<T>> {
  try {
    return await required.call();
  } catch {
    return providerUnknown({ code: 'network', message: 'The DNS query failed before an answer arrived.' });
  }
}

function compare(actual: readonly string[], expected: readonly string[]): { missing: string[]; unexpected: string[] } {
  return { missing: expected.filter(ns => !actual.includes(ns)), unexpected: actual.filter(ns => !expected.includes(ns)) };
}

/**
 * Read the NS delegation of `zone`. With `expectedNameservers` the delegation must match that set
 * exactly: a leftover nameserver of the previous host would answer some queries with old data.
 * A transport failure is `unknown`, never `not_delegated`.
 */
export async function checkDelegation(
  required: { readonly zone: string; readonly expectedNameservers?: readonly string[] },
  ports: { readonly resolver: AuthoritativeDnsPort },
): Promise<DelegationCheck> {
  const zone = normalizeDnsName({ name: required.zone });
  const result = await settlePort({ call: () => ports.resolver.queryNs({ zone }) });
  const empty = { zone, nameservers: [], missing: [], unexpected: [] };
  if (result.status === 'unknown') return { ...empty, state: 'unknown', reason: `The delegation of ${zone} could not be read: ${result.error.message}` };
  if (result.status === 'rejected' && result.error.code !== 'not_found') return { ...empty, state: 'unknown', reason: `The delegation of ${zone} could not be read: ${result.error.message}` };
  const nameservers = result.status === 'ok' ? [...new Set(result.value.map(name => normalizeDnsName({ name })))].sort() : [];
  if (nameservers.length === 0) return { ...empty, state: 'not_delegated', reason: `${zone} has no NS delegation in its parent zone.` };
  const expected = (required.expectedNameservers ?? []).map(name => normalizeDnsName({ name }));
  const { missing, unexpected } = compare(nameservers, expected);
  if (expected.length > 0 && missing.length + unexpected.length > 0) {
    return { zone, nameservers, missing, unexpected, state: 'not_delegated', reason: `${zone} is delegated to ${nameservers.join(', ')}, not to ${expected.join(', ')}; change the nameservers at the registrar.` };
  }
  return { zone, nameservers, missing: [], unexpected: [], state: 'delegated', reason: `${zone} is delegated to ${nameservers.join(', ')}.` };
}
