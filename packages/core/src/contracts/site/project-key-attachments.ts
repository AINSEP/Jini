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
