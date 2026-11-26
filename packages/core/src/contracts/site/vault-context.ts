import { VaultError } from '../vault.js';

export async function authorizeScopedVaultContext(
  { context, scope }: { readonly context: { readonly kind: string; readonly ownerKey: string; readonly principalId: string | null; readonly binding: string | null }; readonly scope: { readonly kind: string; readonly ownerKey: string } },
  _optional = {},
): Promise<void> {
  if (context.kind !== scope.kind || context.ownerKey !== scope.ownerKey || context.principalId !== null || context.binding !== null) throw new VaultError({ code: 'context' });
}
