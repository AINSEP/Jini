/** Provider-neutral comments boundaries. Private moderation data never enters thread rendering. */
export type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash';
export interface CommentThreadRendererPort {
  renderThread(required: { siteId: string; entry: { id: string; slug: string; title: string; canonicalUrl: string }; locale: string },
    optional?: { nonce?: string; cursor?: string }): Promise<{ html: string }>;
}
export interface CommentModerationPort {
  listQueue(required: { siteId: string; status: CommentStatus; limit: number; cursor?: string | null }): Promise<{
    items: readonly { id: string; entryId: string; status: CommentStatus; authorName: string; bodyText: string; version: number }[];
    nextCursor: string | null;
  }>;
  get(required: { siteId: string; id: string }): Promise<{ id: string; entryId: string; status: CommentStatus; authorName: string; bodyText: string; version: number } | null>;
  apply(required: { siteId: string; id: string; expectedVersion: number; action: 'approve' | 'mark_spam' | 'trash' | 'restore'; actorPrincipalId: string; actorPluginId?: string | null; note: string | null }): Promise<
    { ok: true } | { ok: false; reason: 'not-found' | 'conflict'; currentVersion?: number }>;
  purge(required: { siteId: string; id: string; actorPrincipalId: string; note: string | null }): Promise<
    { ok: true } | { ok: false; reason: 'not-found' | 'conflict' }>;
}
export interface CommentSubmissionPort {
  submit(required: { siteId: string; entryId: string; parentId: string | null; authorName: string; authorEmail: string | null;
    authorUrl: string | null; bodyRaw: string; authorIpHash: string; honeypotValue: string }): Promise<
      { ok: true; id: string; status: CommentStatus } | { ok: false; reason: string }>;
}
/** Separate bindings preserve the difference between stored and embedded providers. */
export type CommentsProviderAdapter =
  | { kind: 'stored'; renderer: CommentThreadRendererPort; moderation: CommentModerationPort; submission: CommentSubmissionPort }
  | { kind: 'embedded'; renderer: CommentThreadRendererPort; dashboardUrl: string };
export interface CommentsSelection { providerId: string | null; revision: number }
/** compareAndSet must compare and persist inside ONE storage transaction, including the revision. */
export interface CommentsSelectionStorePort {
  read(required: { siteId: string }): Promise<CommentsSelection>;
  compareAndSet(required: { siteId: string; expectedRevision: number; providerId: string | null; actorPrincipalId: string }): Promise<boolean>;
}
