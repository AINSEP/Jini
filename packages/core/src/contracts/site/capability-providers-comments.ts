/**
 * @file Comments provider contracts. Types only; this module owns the declarations that
 * `@jini-ai/capability-providers/comments` (`definitions.ts`, `ports.ts`, `registry.ts`) used to
 * declare. That package imports them from here and keeps its runtime values.
 */

export interface CommentsSettingField { readonly key: string; readonly label: string; readonly kind: 'public' | 'secret'; readonly required: boolean }
export interface CommentsProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: 'stored' | 'embedded';
  readonly consentCategory: 'functional' | 'marketing';
  readonly csp: { readonly scriptSrc: readonly string[]; readonly frameSrc: readonly string[]; readonly connectSrc: readonly string[]; readonly styleSrc: readonly string[] };
  readonly settingsSchema: readonly CommentsSettingField[];
  readonly implementation: 'metadata-only' | 'adapter';
}

/** Provider-neutral comments boundaries. Private moderation data never enters thread rendering. */
export type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash';
/** Optional executable assets are declared separately; ordinary thread HTML remains visible. */
export interface CommentThreadScript { readonly src: string }
export interface CommentThreadRendererPort {
  renderThread(required: { siteId: string; entry: { id: string; slug: string; title: string; canonicalUrl: string }; locale: string },
    optional?: { nonce?: string; cursor?: string }): Promise<{ html: string; scripts?: readonly CommentThreadScript[] }>;
}
export interface CommentModerationPort {
  listQueue(required: { siteId: string; status: CommentStatus; limit: number; cursor?: string | null }, optional?: Record<string, never>): Promise<{
    items: readonly { id: string; entryId: string; status: CommentStatus; authorName: string; bodyText: string; version: number }[];
    nextCursor: string | null;
  }>;
  get(required: { siteId: string; id: string }, optional?: Record<string, never>): Promise<{ id: string; entryId: string; status: CommentStatus; authorName: string; bodyText: string; version: number } | null>;
  apply(required: { siteId: string; id: string; expectedVersion: number; action: 'approve' | 'mark_spam' | 'trash' | 'restore'; actorPrincipalId: string; actorPluginId?: string | null; note: string | null }, optional?: Record<string, never>): Promise<
    { ok: true } | { ok: false; reason: 'not-found' | 'conflict'; currentVersion?: number }>;
  purge(required: { siteId: string; id: string; actorPrincipalId: string; note: string | null }, optional?: Record<string, never>): Promise<
    { ok: true } | { ok: false; reason: 'not-found' | 'conflict' }>;
}
export interface CommentSubmissionPort {
  submit(required: { siteId: string; entryId: string; parentId: string | null; authorName: string; authorEmail: string | null;
    authorUrl: string | null; bodyRaw: string; authorIpHash: string; honeypotValue: string }, optional?: Record<string, never>): Promise<
      { ok: true; id: string; status: CommentStatus } | { ok: false; reason: string }>;
}
/** Separate bindings preserve the difference between stored and embedded providers. */
export type CommentsProviderAdapter =
  | { kind: 'stored'; renderer: CommentThreadRendererPort; moderation: CommentModerationPort; submission: CommentSubmissionPort }
  | { kind: 'embedded'; renderer: CommentThreadRendererPort; dashboardUrl: string };
export interface CommentsSelection { providerId: string | null; revision: number }
/** compareAndSet must compare and persist inside ONE storage transaction, including the revision. */
export interface CommentsSelectionStorePort {
  read(required: { siteId: string }, optional?: Record<string, never>): Promise<CommentsSelection>;
  compareAndSet(required: { siteId: string; expectedRevision: number; providerId: string | null; actorPrincipalId: string }, optional?: Record<string, never>): Promise<boolean>;
}

export interface CommentsProviderBinding {
  definition: CommentsProviderDefinition;
  /** Resolves only this site's adapter; undefined explicitly means not ready. No executable metadata loading. */
  resolve(required: { siteId: string }, optional?: Record<string, never>): Promise<CommentsProviderAdapter | undefined>;
}
export interface CommentsProviderRegistry {
  register(required: CommentsProviderBinding, optional?: Record<string, never>): void;
  get(required: { providerId: string }, optional?: Record<string, never>): CommentsProviderDefinition | undefined;
  has(required: { providerId: string }, optional?: Record<string, never>): boolean;
  list(required: Record<string, never>, optional?: Record<string, never>): readonly CommentsProviderDefinition[];
  resolve(required: { siteId: string; providerId: string }, optional?: Record<string, never>): Promise<CommentsProviderAdapter | undefined>;
  active(required: { siteId: string }, optional?: Record<string, never>): Promise<{ providerId: string | null; revision: number; adapter: CommentsProviderAdapter | undefined }>;
  select(required: { siteId: string; providerId: string | null; expectedRevision: number; actorPrincipalId: string }, optional?: Record<string, never>): Promise<void>;
}
