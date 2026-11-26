import { VaultError } from '../vault.js';

export async function authorizeScopedVaultContext(
  { context, scope }: { readonly context: { readonly workspaceId?: string; readonly kind: string; readonly ownerKey: string; readonly principalId: string | null; readonly binding?: string | null }; readonly scope: { readonly workspaceId?: string; readonly kind: string; readonly ownerKey: string } },
  _optional = {},
): Promise<void> {
  if (("workspaceId" in scope && context.workspaceId !== scope.workspaceId) || context.kind !== scope.kind || context.ownerKey !== scope.ownerKey || context.principalId !== null || ("binding" in context && context.binding !== null)) throw new VaultError({ code: 'context' });
}
