import { ToolInputError } from '@jini-ai/core';
import {
  isInVaultQueryScope,
  type VaultRecord,
  type VaultRepoPort,
} from '@jini-ai/core/contracts/vault';
import type { KeyAttachments, SiteGrantedVault } from '@jini-ai/core/contracts/site/project-key-attachments';
export type AttachedVaultFailure = { kind: "list" } | { kind: "find" | "label"; error: unknown };

function createGrantedVaultFind({ vault, siteId, attachments, policy }: Parameters<typeof attachedOnlyVault>[0]): VaultRepoPort['find'] {
  return async (input, options) => {
    try {
      if (!await attachments.isAttached({ siteId, keyId: input.id })) return null;
      return await vault.find(input, options);
    } catch (error) {
      policy.report({ kind: "find", error });
      return null;
    }
  };
}


/** Site consumption adapter over CMS site grants. Never reads ungranted envelopes or forwards writes.
 * Each lookup rechecks the grant; inventory reads at most 100 selected rows, never the owner vault.
 * @returns A read-only vault with the existing repository ABI.
 * @complexity O(g) indexed reads/time/space for g granted keys (at most 100).
 */
export function attachedOnlyVault({ vault, siteId, attachments, policy }: {
  vault: VaultRepoPort; siteId: string; attachments: KeyAttachments;
  policy: { readonlyMessage: string; report(required: AttachedVaultFailure, optional?: Record<string, never>): void };
}, _optional: Record<string, never> = {}): SiteGrantedVault {
  const find: VaultRepoPort['find'] = createGrantedVaultFind({ vault, siteId, attachments, policy });
  async function granted({ workspaceId }: { workspaceId: string }): Promise<VaultRecord[]> {
    const rows: VaultRecord[] = [];
    for (const id of await attachments.keysFor({ siteId }).catch(() => {
      policy.report({ kind: "list" });
      return [];
    })) {
      const row = await find({ workspaceId, id });
      if (row) rows.push(row);
    }
    return rows;
  }
  const list: VaultRepoPort['list'] = async input =>
    (await granted(input)).filter(record => isInVaultQueryScope({ record, query: input }));
  const refuse = async (): Promise<never> => {
    throw new ToolInputError({ message: policy.readonlyMessage });
  };
  const keyForLabel = attachments.keyForLabel?.bind(attachments);
  return {
    find, list,
    ...(keyForLabel ? { findByLabel: async (input: { workspaceId: string; label: string }) => {
      try {
        const id = await keyForLabel({ siteId, label: input.label });
        return id ? await find({ workspaceId: input.workspaceId, id }) : null;
      } catch (error) {
        policy.report({ kind: "label", error });
        return null;
      }
    } } : {}),
    findOne: async input => (await granted(input)).find(row => row.kind === input.kind
      && (input.ownerKey === undefined || row.ownerKey === input.ownerKey)
      && (input.principalId === undefined || row.principalId === input.principalId)) ?? null,
    findDefault: async input => {
      const rows = await list(input);
      const selected = rows.find(row => row.isDefault);
      if (selected || rows.length !== 1) return selected ?? null;
      const only = rows[0];
      if (only === undefined) throw new Error("Shared key inventory has no sole row");
      return only;
    },
    put: refuse, patchMeta: refuse, delete: refuse, applyBatch: refuse,
  };
}
