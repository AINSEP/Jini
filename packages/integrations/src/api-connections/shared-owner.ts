import type { Clock } from '@jini-ai/core/primitives';
import { ApiConnectionError } from './errors.js';
import type { ApiConnectionClientKind } from './deps.js';
import type { ApiConnectionDescriptor } from './types.js';
import type { SharedOAuthConnection } from './shared.js';
import type { OAuthClient } from "@jini-ai/core/contracts/oauth";
import type { KeyringPort, SecretSealerPort, VaultRepoPort, VaultMeta, VaultContext } from '@jini-ai/core/contracts/vault';
import type { SecretsVaultService } from '@jini-ai/core/contracts/site/secrets-credential-sets';
import type { ApiConnectionRecordStore, ApiConnectionTokenStore } from './ports.js';

/** Issuing configuration is sealed in the owner store; a consuming site's client cannot replace it. */
export interface SharedOAuthIssuingContext {
  readonly credentialId: string;
  readonly identity: SharedOAuthConnection['identity'];
  readonly client: OAuthClient;
  readonly clientKind: ApiConnectionClientKind;
  readonly descriptor: ApiConnectionDescriptor;
}

export interface SharedOAuthOwnerScope { readonly workspaceId: string; readonly repo: VaultRepoPort; readonly keyring: KeyringPort; readonly sealer: SecretSealerPort }

/** Refuse an issuing context whose declared identity and sealed client disagree. */
function assertIssuingContext(context: SharedOAuthIssuingContext, unavailable: () => ApiConnectionError): void {
  if (!context.identity || !context.client || !context.descriptor) throw unavailable();
  if (context.client.clientId !== context.identity.clientId || context.descriptor.tokenEndpoint !== context.identity.tokenEndpoint) throw unavailable();
  if (context.identity.authorizationEndpoint !== undefined && context.identity.authorizationEndpoint !== context.descriptor.authorizationEndpoint) throw unavailable();
  if (context.descriptor.pluginId !== context.identity.pluginId || context.descriptor.connectionId !== context.identity.connectionId) throw unavailable();
}

/** Opens one sealed issuing context, refusing a copied context or mismatched issuing client.
 * @complexity One selected owner-vault read; no inventory or polling.
 */
export async function readSharedOAuthContext(required: { vault: SecretsVaultService; credentialId: string; ownerWorkspaceId: string;
  apiConnectionVaultScope(input: { workspaceId: string }): VaultContext; contextId(input: { credentialId: string }): string; unavailable(): ApiConnectionError }, _optional = {}): Promise<SharedOAuthIssuingContext | null> {
  const { apiConnectionVaultScope, contextId, unavailable, ownerWorkspaceId } = required;
  const found = await required.vault.get({ ...apiConnectionVaultScope({ workspaceId: ownerWorkspaceId }), id: contextId({ credentialId: required.credentialId }) });
  if (!found) return null;
  const context = found.payload?.value as unknown as SharedOAuthIssuingContext | undefined;
  if (!context || context.credentialId !== required.credentialId) throw unavailable();
  assertIssuingContext(context, unavailable);
  return context;
}

/** Reuses owner records, vault sealing and durable token leases. Sites receive only access tokens.
 * @complexity O(1) construction; every operation reads/writes selected rows only.
 */
export function createSharedOAuthOwnerStorage(required: {
  scope: SharedOAuthOwnerScope; clock: Clock; ownerWorkspaceId: string;
  createApiConnectionVault(input: SharedOAuthOwnerScope & { clock: Clock }): SecretsVaultService;
  createApiConnectionVaultRecordStore(input: { vault: SecretsVaultService; workspaceId: string; clock: Clock }): ApiConnectionRecordStore;
  createApiConnectionVaultTokenStore(input: { vault: SecretsVaultService; records: ApiConnectionRecordStore; clock: Clock;
    owner: { workspaceId: string; pluginId: string; connectionId: string; clientId: string } }): ApiConnectionTokenStore;
  apiConnectionVaultScope(input: { workspaceId: string }): VaultContext;
  contextId(input: { credentialId: string }): string; contextMeta: VaultMeta; contextLabel(input: { id: string }): string;
  unavailable(): ApiConnectionError; accountChanged(): ApiConnectionError;
}, _optional = {}) {
  const { scope, clock, ownerWorkspaceId, createApiConnectionVault, createApiConnectionVaultRecordStore, createApiConnectionVaultTokenStore,
    apiConnectionVaultScope, contextId, contextMeta, contextLabel, unavailable, accountChanged } = required;
  if (scope.workspaceId !== ownerWorkspaceId) throw unavailable();
  const vault = createApiConnectionVault({ ...scope, clock });
  const records = createApiConnectionVaultRecordStore({ vault, workspaceId: ownerWorkspaceId, clock });
  const readContext = ({ credentialId }: { credentialId: string }) => readSharedOAuthContext({ vault, credentialId, ownerWorkspaceId, apiConnectionVaultScope, contextId, unavailable });
  return {
    vault, records, readContext,
    async saveContext({ credentialId, context }: { credentialId: string; context: SharedOAuthIssuingContext }) {
      if (context.credentialId !== credentialId || context.client.clientId !== context.identity.clientId) throw unavailable();
      const existing = await readContext({ credentialId });
      // An existing account keeps its issuing identity even if a later site's BYO client differs.
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(context)) throw accountChanged();
        return;
      }
      const id = contextId({ credentialId });
      await vault.put({ ...apiConnectionVaultScope({ workspaceId: ownerWorkspaceId }), id, expectedRevision: null, provider: null, label: contextLabel({ id }),
        meta: contextMeta, payload: { value: context as unknown as VaultMeta } });
    },
    tokensFor({ context }: { context: SharedOAuthIssuingContext }) {
      return createApiConnectionVaultTokenStore({ vault, records, clock, owner: { workspaceId: ownerWorkspaceId, pluginId: context.identity.pluginId,
        connectionId: context.identity.connectionId, clientId: context.client.clientId } });
    },
    async readConnection({ credentialId }: { credentialId: string }): Promise<SharedOAuthConnection | null> {
      const [context, record] = await Promise.all([readContext({ credentialId }), records.read({ key: credentialId })]);
      if (!context || !record) return null;
      if (record.key !== credentialId || record.workspaceId !== ownerWorkspaceId || record.pluginId !== context.identity.pluginId || record.connectionId !== context.identity.connectionId) throw unavailable();
      return { credentialId, identity: context.identity, generation: record.generation, status: record.status, account: record.account, grantedScopes: record.grantedScopes };
    },
  };
}
export type SharedOAuthOwnerStorage = ReturnType<typeof createSharedOAuthOwnerStorage>;

/** Label projection opens only the listed lifecycle/context rows, never token payloads.
 * @complexity At most three selected reads per OAuth item in the existing bounded 50-row inventory.
 */
export function createSharedOAuthLabels(required: Parameters<typeof createSharedOAuthOwnerStorage>[0] & {
  unavailableLabel: string; accountLabel(input: { context: SharedOAuthIssuingContext; connection: SharedOAuthConnection }): string;
}, _optional = {}) {
  const storage = createSharedOAuthOwnerStorage(required);
  return async ({ keyId }: { keyId: string }) => {
    const [context, connection] = await Promise.all([storage.readContext({ credentialId: keyId }), storage.readConnection({ credentialId: keyId })]);
    if (!context || !connection) return required.unavailableLabel;
    return required.accountLabel({ context, connection });
  };
}
