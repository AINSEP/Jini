import type { AdminPublishCredentialVerification, AdminPublishExecutionMode } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { CredentialTokenHint } from '@jini-ai/core/contracts/site/secrets-credential-token';
export type CredentialKind = 'publish' | 'source-control' | 'custom';
export type CredentialCategory = 'source-control' | 'hosting' | 'media' | 'ai' | 'ops' | 'general';
export interface RequestOptions { readonly signal?: AbortSignal }
export interface CredentialField { readonly name: string; readonly label: string; readonly required?: boolean; readonly secret?: boolean; readonly type?: string; readonly help?: string }
export interface CredentialProvider {
  readonly kind: Exclude<CredentialKind, 'custom'>; readonly id: string; readonly label: string;
  readonly vendorLabel: string; readonly category: CredentialCategory; readonly tokenField: string;
  readonly fields: readonly CredentialField[]; readonly tokenPageUrl?: string; readonly help?: string;
  /** A bare entry for a saved row whose provider is no longer listed (its plugin switched off). */
  readonly unlisted?: boolean;
}
/** A saved token is never read back. `tokenHint` is the server's own masked hint (`{ length, last4 }`, OD-3 c),
 * shown exactly as sent; a store that sends none shows none. */
export interface CredentialSummary {
  readonly kind: CredentialKind; readonly id: string; readonly providerId: string; readonly label: string;
  readonly configured: boolean; readonly isDefault: boolean; readonly createdAt: string; readonly updatedAt: string;
  readonly accountLabel?: string | null; readonly category?: CredentialCategory; readonly baseUrl?: string;
  readonly additionalHosts?: readonly string[]; readonly username?: string;
  /** Publish and custom rows: a vendor or a custom provider stores them, and the plugin ids they serve. */
  readonly credentialType?: 'vendor' | 'custom'; readonly worksFor?: readonly string[];
  /** The verify result a create, update or verify call returned. The server keeps it in memory only. */
  readonly lastVerification?: AdminPublishCredentialVerification;
  /** The server-approved masked hint; never any part of the token beyond what the server chose to send. */
  readonly tokenHint?: CredentialTokenHint | null;
  /** Custom rows: a `project` key lives in Shared Keys and is attached per site; a `site` key is this site's only. */
  readonly scope?: 'project' | 'site'; readonly usedBy?: readonly string[]; readonly usedByThisSite?: boolean;
}
/** One store read: its rows plus store-level facts (the publish store's server-owned `executionMode`). */
export interface CredentialStoreSnapshot {
  readonly rows: readonly CredentialSummary[]; readonly executionMode?: AdminPublishExecutionMode;
  /** Custom store: whether a new key can be saved to the project (Shared Keys) rather than this site only. */
  readonly projectKeysAvailable?: boolean;
}
export interface CredentialInput {
  readonly label: string; readonly connection: Readonly<Record<string, string>>; readonly isDefault?: boolean;
  readonly category?: CredentialCategory; readonly baseUrl?: string; readonly additionalHosts?: readonly string[];
  /** Custom create only: where the new key is stored. Sent only when the store reported `projectKeysAvailable`. */
  readonly scope?: 'project' | 'site';
  /** Publish and custom: the plugin ids this credential serves. Sent only when chosen. */
  readonly worksFor?: readonly string[];
}
export interface CredentialPatch {
  readonly label?: string; readonly connection?: Readonly<Record<string, string>>; readonly isDefault?: boolean;
  readonly category?: CredentialCategory; readonly baseUrl?: string; readonly additionalHosts?: readonly string[];
  /** Omit preserves, null clears, string replaces independently of secret replacement. */
  readonly username?: string | null;
  /** Publish and custom: omitted preserves compatibility; `[]` clears it without a connection. */
  readonly worksFor?: readonly string[];
}
export interface CredentialDraft {
  readonly kind: CredentialKind; readonly id?: string; readonly providerId: string; readonly label: string;
  readonly token: string; readonly values: Readonly<Record<string, string>>; readonly category: CredentialCategory;
  readonly baseUrl: string; readonly additionalHosts: string; readonly username: string;
  /** The "Works for" chips (publish and custom). Absent means untouched: nothing is sent. */
  readonly worksFor?: readonly string[];
}
export type OtherStoreId = 'site-assistant' | 'admin-byok' | 'media-provider' | 'external-mcp';
export interface OtherCredentialSummary {
  readonly store: OtherStoreId; readonly id: string; readonly label: string; readonly category: CredentialCategory;
  readonly configured: boolean; readonly supportsReplace: boolean; readonly envNames?: readonly string[];
  readonly updatedAt?: string | null;
  /** A server-approved masked hint (opt-in on the HTTP adapter): at most the last four characters, never the value.
   * Core's `CredentialTokenHint`, narrowed: a hint without a tail is not projected, and a bare legacy tail
   * (`apiKeyTail`/`masked`) carries no `length`, so `length` is present only when the server sent one. */
  readonly tokenHint?: Readonly<Partial<Pick<CredentialTokenHint, 'length'>> & { last4: NonNullable<CredentialTokenHint['last4']> }>;
}
/** A host deep link to the screen that owns one other store (Create and the full field set live there). */
export interface OtherStoreLink { readonly href: string; readonly label: string }
export type RootKeyState = 'active' | 'missing' | 'missing-with-data' | 'mismatch' | 'invalid';
export interface RootKeyStatus {
  readonly active: boolean; readonly source: 'env' | 'file' | 'none'; readonly state: RootKeyState;
  readonly fingerprint?: string; readonly invalid?: boolean; readonly keyFilePath: string;
  readonly runtimeMode: 'production' | 'local';
  /** The env var the server reads the key from; a name, never a value. Hosts show it in the badge. */
  readonly envVarName?: string;
  /** Why an `invalid` key was refused, so the page can say what to fix without echoing the key. */
  readonly reason?: 'empty' | 'not-hex' | 'odd-length' | 'too-short';
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
/** A reveal reply: whether the key is active and, only then, its value. A reply without `hex` reveals nothing. */
export interface RootKeyReveal { readonly active: boolean; readonly hex?: string }
