import { ToolInputError } from "@jini-ai/core";
import type { SecretsVaultService } from "@jini-ai/core/contracts/site/secrets-credential-sets";
import type { VaultRepoPort, VaultIdentity } from "@jini-ai/core/contracts/vault";
import type { SiteKeyReferences, SiteOAuthBindings } from "@jini-ai/core/contracts/site/project-key-attachments";

/** Persist an inert, token-free binding for one API connection or MCP server.
 * @complexity O(1) selected site-vault I/O; identifiers are bounded to 512 characters.
 */
export function createSiteOAuthBindings({ vault, repo, identity: resolveIdentity, credentialFormat, invalidIdMessage }: {
  vault: Pick<SecretsVaultService, "get" | "put" | "delete">; repo: Pick<VaultRepoPort, "find">;
  identity: (required: { consumerId: string }, optional?: Record<string, never>) => VaultIdentity;
  credentialFormat: string; invalidIdMessage: string;
}, _optional: Record<string, never> = {}): SiteOAuthBindings {
  const checkedId = ({ value }: { value: string }, _optional: Record<string, never> = {}) => {
    if (!value || value.length > 512 || value.includes('\0')) throw new ToolInputError({ message: invalidIdMessage });
    return value;
  };
  return {
    read: async input => {
      const found = await vault.get(resolveIdentity({ consumerId: checkedId({ value: input.consumerId }) }));
      const value = found?.payload?.value;
      return value !== null && typeof value === "object" && "credentialId" in value && typeof value.credentialId === 'string' ? { credentialId: checkedId({ value: value.credentialId }) } : null;
    },
    set: async input => {
      const credentialId = checkedId({ value: input.credentialId });
      const key = resolveIdentity({ consumerId: checkedId({ value: input.consumerId }) });
      const current = await repo.find(key);
      await vault.put({ ...key, expectedRevision: current?.revision ?? null, provider: null, label: key.id,
        meta: { credentialFormat: credentialFormat }, payload: { value: { credentialId } } });
    },
    remove: async input => {
      const key = resolveIdentity({ consumerId: checkedId({ value: input.consumerId }) });
      const current = await repo.find(key);
      if (current) await vault.delete({ ...key, expectedRevision: current.revision });
    },
  };
}

/** Reuse the non-exported plugin-state row format without a new table or migration.
 * One reference is one selected row; no inventories, timers or owner key material enter this store.
 * @returns Reference persistence for this server-bound workspace.
 * @complexity O(1) selected row I/O per operation; payload is only {credentialId}, with an id of at most 512 characters.
 */
export function createSiteKeyReferences({ vault, repo, identity: resolveIdentity, credentialFormat, invalidIdMessage }: {
  vault: Pick<SecretsVaultService, "get" | "put" | "delete">; repo: Pick<VaultRepoPort, "find">;
  identity: (required: { credentialId: string }, optional?: Record<string, never>) => VaultIdentity;
  credentialFormat: string; invalidIdMessage: string;
}, _optional: Record<string, never> = {}): SiteKeyReferences {
  const identity = ({ credentialId }: { credentialId: string }) => {
    if (!credentialId || credentialId.length > 512) throw new ToolInputError({ message: invalidIdMessage });
    return resolveIdentity({ credentialId });
  };
  return {
    set: async input => {
      const key = identity(input);
      const current = await repo.find(key);
      await vault.put({ ...key, expectedRevision: current?.revision ?? null, provider: null, label: key.id,
        meta: { credentialFormat: credentialFormat }, payload: { value: { credentialId: input.credentialId } } });
    },
    has: async input => {
      const found = await vault.get(identity(input));
      const value = found?.payload?.value;
      return value !== null && typeof value === "object" && "credentialId" in value && typeof value.credentialId === "string" && value.credentialId === input.credentialId;
    },
    remove: async input => {
      const key = identity(input);
      const current = await repo.find(key);
      if (current) await vault.delete({ ...key, expectedRevision: current.revision });
    },
  };
}
