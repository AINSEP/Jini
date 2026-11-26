import { ToolInputError } from '@jini-ai/core';
import type { KeyringPort, SecretSealerPort } from '@jini-ai/core/contracts/vault';

/** Credential services need an active handle for human saves, never owner key derivation.
 * @returns A handle-only keyring; every derivation fails without reaching the owner keyring.
 * @complexity O(1), no database I/O.
 */
export function ownerKeyHandleOnly({ keyring, derivationRefusedMessage }: { keyring: KeyringPort; derivationRefusedMessage: string }, _optional: Record<string, never> = {}): KeyringPort {
  const refuse = async (): Promise<never> => { throw new ToolInputError({ message: derivationRefusedMessage }); };
  return { activeKey: (options: Record<string, never>) => keyring.activeKey(options), derive: refuse, deriveSigningSecret: refuse };
}

/** Extract only the selected identity from Jini's frozen vault AAD; the full AAD is compared below. */
function selectedIdentity({ aad, ownerScope, accessRefusedMessage }: { aad: string | undefined } & Pick<Parameters<typeof siteGrantedSealer>[0], "ownerScope" | "accessRefusedMessage">): { workspaceId: string; id: string } {
  const prefix = 'secrets-vault:v1:';
  if (!aad?.startsWith(prefix)) throw refused(accessRefusedMessage);
  let value: unknown;
  try { value = JSON.parse(aad.slice(prefix.length)); } catch { throw refused(accessRefusedMessage); }
  if (!isOwnerKeyIdentity(value, ownerScope)) throw refused(accessRefusedMessage);
  return { workspaceId: value[0], id: value[1] };
}

/** Only API-key AAD under the fixed owner scope can reach the owner's crypto service. */
function isOwnerKeyIdentity(value: unknown, ownerScope: Parameters<typeof siteGrantedSealer>[0]["ownerScope"]): value is [string, string, string, string, null, null] {
  if (!Array.isArray(value) || value.length !== 6) return false;
  const [workspaceId, id]: unknown[] = value;
  if (workspaceId !== ownerScope.workspaceId || typeof id !== 'string') return false;
  return ownerKeyScope({ value, ownerScope });
}

function ownerKeyScope({ value, ownerScope }: { value: unknown[]; ownerScope: Parameters<typeof siteGrantedSealer>[0]["ownerScope"] }, _optional: Record<string, never> = {}): boolean {
  const [, , kind, ownerKey, principalId, binding]: unknown[] = value;
  return typeof kind === 'string' && ownerScope.kinds.includes(kind)
    && ownerKey === ownerScope.ownerKey && principalId === null && binding === null;
}

function refused(accessRefusedMessage: string): ToolInputError {
  return new ToolInputError({ message: accessRefusedMessage });
}

/** Keep crypto inside the owner boundary and recheck the site grant before and after each open.
 * A caller retaining an envelope cannot decrypt it after revoke. Jini authenticates the full AAD;
 * no envelope inventory or additional owner-row hydration is needed for this authorization check.
 * @returns A site-fenced sealer; human saves still seal through the trusted owner service.
 * @complexity O(1) indexed grant/reference reads plus O(ciphertext bytes) crypto.
 */
export function siteGrantedSealer({ allowed, sealer, ownerScope, accessRefusedMessage }: {
  allowed: (required: { credentialId: string }, optional?: Record<string, never>) => Promise<boolean>; sealer: SecretSealerPort;
  ownerScope: { workspaceId: string; ownerKey: string; kinds: readonly string[] }; accessRefusedMessage: string;
}, _optional: Record<string, never> = {}): SecretSealerPort {
  return {
    seal: ({ plaintext, key, aad }) => sealer.seal({ plaintext, key, aad }),
    open: async (input, options = {}) => {
      const identity = selectedIdentity({ aad: options.aad, ownerScope, accessRefusedMessage });
      const access = { credentialId: identity.id };
      if (!await allowed(access)) throw refused(accessRefusedMessage);
      const plaintext = await sealer.open(input, options);
      if (!await allowed(access)) throw refused(accessRefusedMessage);
      return plaintext;
    },
  };
}
