import type { MfaScope, MfaSecretPort } from './ports.js';

type Key = { readonly keyId: string };
/** Reuse a host's authenticated sealer; never derive or store a separate MFA key.
 * @complexity O(1), one key lookup/seal or open per explicit action; bounded secret envelopes.
 */
export function createSealedMfaSecrets<Envelope>(required: {
  keyring: { activeKey(input: Record<string, never>): Promise<Key> };
  sealer: {
    seal(input: { plaintext: string; key: Key; aad: string }): Promise<Envelope>;
    open(input: { sealed: Envelope }, options: { aad: string }): Promise<string>;
  };
}, _options: Record<string, never> = {}): MfaSecretPort {
  const aad = (scope: MfaScope) => JSON.stringify(['owner-totp-v1', scope.workspaceId, scope.principalId]);
  return {
    seal: async input => JSON.stringify(await required.sealer.seal({ plaintext: input.secret,
      key: await required.keyring.activeKey({}), aad: aad(input) })),
    open: input => required.sealer.open({ sealed: JSON.parse(input.sealedSecret) as Envelope }, { aad: aad(input) }),
  };
}
