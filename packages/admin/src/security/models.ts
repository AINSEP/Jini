export type CredentialKind = 'publish' | 'source-control' | 'custom';
export type CredentialCategory = 'source-control' | 'hosting' | 'media' | 'ai' | 'ops' | 'general';
export interface RequestOptions { readonly signal?: AbortSignal }
export interface CredentialField { readonly name: string; readonly label: string; readonly required?: boolean; readonly secret?: boolean; readonly type?: string; readonly help?: string }
export interface CredentialProvider {
  readonly kind: Exclude<CredentialKind, 'custom'>; readonly id: string; readonly label: string;
  readonly vendorLabel: string; readonly category: CredentialCategory; readonly tokenField: string;
  readonly fields: readonly CredentialField[]; readonly tokenPageUrl?: string; readonly help?: string;
}
/** A saved token is never read back: label and updatedAt identify a connection without a last-4 hint. */
export interface CredentialSummary {
  readonly kind: CredentialKind; readonly id: string; readonly providerId: string; readonly label: string;
  readonly configured: boolean; readonly isDefault: boolean; readonly createdAt: string; readonly updatedAt: string;
  readonly accountLabel?: string | null; readonly category?: CredentialCategory; readonly baseUrl?: string;
  readonly additionalHosts?: readonly string[]; readonly username?: string;
}
export interface CredentialInput {
  readonly label: string; readonly connection: Readonly<Record<string, string>>; readonly isDefault?: boolean;
  readonly category?: CredentialCategory; readonly baseUrl?: string; readonly additionalHosts?: readonly string[];
}
export interface CredentialPatch {
  readonly label?: string; readonly connection?: Readonly<Record<string, string>>; readonly isDefault?: boolean;
  readonly category?: CredentialCategory; readonly baseUrl?: string; readonly additionalHosts?: readonly string[];
  /** Omit preserves, null clears, string replaces independently of secret replacement. */
  readonly username?: string | null;
}
export interface CredentialDraft {
  readonly kind: CredentialKind; readonly id?: string; readonly providerId: string; readonly label: string;
  readonly token: string; readonly values: Readonly<Record<string, string>>; readonly category: CredentialCategory;
  readonly baseUrl: string; readonly additionalHosts: string; readonly username: string;
}
export type OtherStoreId = 'site-assistant' | 'admin-byok' | 'media-provider' | 'external-mcp';
export interface OtherCredentialSummary {
  readonly store: OtherStoreId; readonly id: string; readonly label: string; readonly category: CredentialCategory;
  readonly configured: boolean; readonly supportsReplace: boolean; readonly envNames?: readonly string[];
  readonly updatedAt?: string | null;
}
export type RootKeyState = 'active' | 'missing' | 'missing-with-data' | 'mismatch' | 'invalid';
export interface RootKeyStatus {
  readonly active: boolean; readonly source: 'env' | 'file' | 'none'; readonly state: RootKeyState;
  readonly fingerprint?: string; readonly invalid?: boolean; readonly keyFilePath: string;
  readonly runtimeMode: 'production' | 'local';
}
export interface RootKeyPreview {
  readonly removes: number; readonly affectedWebhooks: readonly { readonly label: string; readonly targetUrl: string }[];
  readonly detail: string; readonly runtimeMode: 'production' | 'local';
}
export interface RootKeyResult {
  readonly outcome: string; readonly fingerprint: string; readonly keyFilePath: string;
  readonly runtimeMode: 'production' | 'local'; readonly resealed?: number; readonly discarded?: number;
  readonly kept?: number; readonly affectedWebhooks?: RootKeyPreview['affectedWebhooks']; readonly restorePointId?: string;
}
