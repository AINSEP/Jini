import type { VaultKind } from '@jini-ai/core/contracts/vault';
import type { VAULT_KINDS } from '../credential-sets/vault.types.js';
type Assert<T extends true> = T;
type RuntimeKind = typeof VAULT_KINDS[number] | 'custom';
export type VaultKindChecks = [Assert<VaultKind extends RuntimeKind ? true : false>, Assert<RuntimeKind extends VaultKind ? true : false>];
