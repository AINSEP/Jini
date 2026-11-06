import type { AuthServiceDeps } from '../auth-service.js';

export type MfaScope = { workspaceId: string; principalId: string };
export type MfaFactor = MfaScope & { sealedSecret: string; lastStep: number };
export type MfaPending = MfaScope & {
  purpose: 'login' | 'enroll' | 'passkey-enroll' | 'passkey-login'; tokenHash: string; expiresAt: number; attempts: number;
  sealedSecret?: string;
};
/** All methods join auth.repos.transactions; at most one pending row per scope/purpose.
 * Mutations and guard reads must serialize with all other identity writers.
 */
export interface MfaStore {
  factor(scope: MfaScope): Promise<MfaFactor | null>;
  saveFactor(factor: MfaFactor): Promise<void>;
  pending(input: { workspaceId: string; tokenHash: string }): Promise<MfaPending | null>;
  savePending(pending: MfaPending): Promise<void>;
  clearPending(scope: MfaScope): Promise<void>;
  clear(scope: MfaScope): Promise<void>;
}
/** A library adapter implements protocol crypto; accepted step enables replay prevention. */
export interface TotpPort {
  generate(): string;
  uri(input: { secret: string; label: string; issuer: string }): string;
  verify(input: { secret: string; code: string; nowMs: number }): Promise<number | null>;
}
/** Sealing adapters MUST authenticate the supplied workspace/principal context as AAD. */
export interface MfaSecretPort {
  seal(input: MfaScope & { secret: string }): Promise<string>;
  open(input: MfaScope & { sealedSecret: string }): Promise<string>;
}
export interface OwnerMfaDeps {
  auth: AuthServiceDeps;
  store: MfaStore;
  totp: TotpPort;
  secrets: MfaSecretPort;
  seededOwnerPrincipalId: string;
}
