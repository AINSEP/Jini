/** First Save's complete snapshot; creation owns one atomic row/revision write. */
export type AdminPostCreateInput = Pick<AdminPost, "title"> & Partial<Pick<AdminPost,
  "slug" | "bodyJson" | "status" | "templateChoice" | "overridesThemePage" | "publishAt" | "featuredMediaId" | "author" | "showAuthor"
>> & { hideCoverImageInBody?: boolean };

export interface AdminPost {
  /** Derived from the revision ledger for editor URL stability after unpublishing. */
  everPublished?: boolean;
  author?: string | null;
  showAuthor?: boolean;
  id: string;
  workspaceId: string;
  // Was missing from this client-side type even though `toHeadlessPost` (the host's headless post serializer)
  // has always sent it — added here because PostEditor's delete affordance needs to tell a post
  // apart from a page (for confirm-dialog wording and for which list to return to) and every field
  // it needs already ships on the wire.
  kind: "post" | "page";
  title: string;
  slug: string;
  bodyJson: Record<string, unknown>;
  /**
   * SPEC-047 — which body column this entry actually carries. `"doc"` is a Tiptap document in
   * `bodyJson`; `"html"` is a bespoke, AI-generated Page whose real content is `bodyHtml`.
   *
   * Optional here only as prototype debt. The server already returns a proper discriminated union
   * (the host's headless contracts and post serializer), and REQ-3 wants this type to mirror it
   * so that constructing Tiptap's props from an html-format entry is a COMPILE error rather than a
   * runtime branch. Widening this shared interface into a union touches every existing `AdminPost`
   * consumer, so for now `features/pages` narrows on `bodyFormat` explicitly and the compile-time
   * guarantee is owed, not delivered.
   */
  bodyFormat?: "doc" | "html";
  /** The bespoke HTML body — present only when `bodyFormat === "html"`. */
  bodyHtml?: string | null;
  status: "draft" | "published";
  updatedAt: string;
  version: number;
  /**
   * Post-template-picker feature (2026-08-10) — the active static theme's `pages/*.html` filename
   * (from `theme.json`'s `postTemplate` array) this post renders through, or `null` when unset.
   * Optional (matches `bodyFormat`/`bodyHtml`'s own precedent just above) so pre-feature test
   * fixtures across this app don't all need updating — the real API always sends a definite value.
   */
  templateChoice?: string | null;
  /**
   * Slug-collision override (2026-08-10, tri-state 2026-08-15) — `null` means this post never had an
   * explicit opinion set (the server resolver's current default policy applies, post-wins as of this
   * change); `true`/`false` is a permanent explicit author choice that always wins over the default.
   * Optional, same migration-safety precedent as `templateChoice` just above.
   */
  overridesThemePage?: boolean | null;
  /**
   * SPEC-005 REQ-11 plugin extension-field bag, keyed by plugin id then field name — already on the
   * wire (`toHeadlessPost` spreads it in only when a plugin wrote something), just never declared
   * here until the Content analysis card (AW-7 Tier 2) needed `ext["content-analyzer"].report`.
   * Absent, not `{}`, when no plugin contributed. Values are whatever the plugin's declared field
   * types allow, so readers must validate before use.
   */
  ext?: Record<string, Record<string, unknown>>;
  /** Scheduled publishing (2026-10-05) — ISO UTC go-live time. A published row whose `publishAt`
   *  is still in the future is hidden from the public site until then. Sent only when set. */
  publishAt?: string | null;
  /** Featured image (2026-10-05) — a media asset id; themes and og:image use it. Sent only when set. */
  featuredMediaId?: string | null;
}
