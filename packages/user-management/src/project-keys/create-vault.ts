import type { ProjectKeyTransaction } from '@jini-ai/core/contracts/site/project-key-attachments';
import { ToolInputError } from '@jini-ai/core';
import { VaultError, type VaultRepoPort } from '@jini-ai/core/contracts/vault';

/** Human secret cards create new owner entries. A separate trusted owner-session port may replace
 * granted entries atomically with its grant check. All reads retain the site grant boundary.
 * @returns A create-only port sharing the consumer repository ABI.
 * @complexity O(1) selected CAS insertion per submitted secret card; no owner inventory reads.
 */
export function projectKeyCreateVault({ owner, view, conflictError, replacementRefusedMessage }: { owner: VaultRepoPort; view: VaultRepoPort; conflictError: (required: Record<string, never>, optional?: Record<string, never>) => Error; replacementRefusedMessage: string }, { allowReplacement = false, transaction = async ({ run }) => run() }: { allowReplacement?: boolean; transaction?: ProjectKeyTransaction } = {}): VaultRepoPort {
  return { ...view,
    put: async (input, options) => {
      if (input.expectedRevision !== null) {
        return transaction({ run: async () => {
          if (!allowReplacement || !await view.find(input.record)) throw new ToolInputError({ message: replacementRefusedMessage });
          return owner.put(input, options);
        } });
      }
      try { return await owner.put(input, options); }
      catch (error) {
        if (error instanceof VaultError && error.code === 'conflict') throw conflictError({});
        throw error;
      }
    },
  };
}
