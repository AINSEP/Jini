import type { VaultKind, VAULT_KINDS } from '@jini-ai/core/contracts/vault';
type Assert<T extends true> = T;
type RuntimeKind = typeof VAULT_KINDS[number] | 'custom';
export type VaultKindChecks = [Assert<VaultKind extends RuntimeKind ? true : false>, Assert<RuntimeKind extends VaultKind ? true : false>];
