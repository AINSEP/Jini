import type { VaultRecord, VaultRepoPort } from "../vault.js";

/** Host-owned project transaction; callers share the vault and reference commit boundary. */
export type ProjectKeyTransaction = <T>(required: { run: () => Promise<T> }, optional?: Record<string, never>) => Promise<T>;

/** Project-local references. Only the meta UUID identifies a site; workspace ids are never safe. */
export interface KeyAttachments {
  keyForLabel?(required: { siteId: string; label: string }, optional?: Record<string, never>): Promise<string | null>;
  keysFor(required: { siteId: string }, optional?: Record<string, never>): Promise<readonly string[]>;
  attach(required: { siteId: string; keyId: string; siteName: string }, optional?: Record<string, never>): Promise<void>;
  detach(required: { siteId: string; keyId: string }, optional?: Record<string, never>): Promise<void>;
  isAttached(required: { siteId: string; keyId: string }, optional?: Record<string, never>): Promise<boolean>;
  usersOf(required: { keyId: string }, optional?: Record<string, never>): Promise<readonly { siteId: string; siteName: string }[]>;
  removeKey(required: { keyId: string }, optional?: Record<string, never>): Promise<void>;
  renameSite(required: { siteId: string; siteName: string }, optional?: Record<string, never>): Promise<void>;
}

/** A vault reader that may also offer an indexed `findByLabel` over the same (possibly site-granted) rows.
 * Structural only: the Project Keys grant wrapper produces it and the custom-credential repo consumes it.
 */
export type SiteGrantedVault = VaultRepoPort & { findByLabel?: (input: { workspaceId: string; label: string }, options?: Record<string, never>) => Promise<VaultRecord | null> };

/** Site storage contains references only. Grants and secrets remain in the owner database. */
export interface SiteKeyReferences {
  set(input: { credentialId: string }, options?: Record<string, never>): Promise<void>;
  has(input: { credentialId: string }, options?: Record<string, never>): Promise<boolean>;
  remove(input: { credentialId: string }, options?: Record<string, never>): Promise<void>;
}

/** A consumer binding names one owner credential; a live owner grant still authorizes every use. */
export interface SiteOAuthBindings {
  read(input: { consumerId: string }, options?: Record<string, never>): Promise<{ credentialId: string } | null>;
  set(input: { consumerId: string; credentialId: string }, options?: Record<string, never>): Promise<void>;
  remove(input: { consumerId: string }, options?: Record<string, never>): Promise<void>;
}
