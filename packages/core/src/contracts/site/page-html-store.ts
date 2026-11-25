import type { JsonObject } from "../../primitives/index.js";
import type { PostKind } from "./post-kind.js";

export interface PluginEmbedDiagnostic { readonly code: string; readonly message: string }

/** Scopes one store instance to one Page row — mirrors every other adapter in this feature area
 * being workspace-scoped, so a store built for workspace A can never touch workspace B's row even
 * if handed a colliding `postId` (defense in depth; ids are UUIDs and collision is not the expected
 * threat model, but the scoping costs nothing and matches house convention). */
export interface PagesHtmlDocumentStoreScope {
  workspaceId: string;
  postId: string;
  /**
   * Fix plan 2026-09-24 row 14 (S1) — the `post_revisions.actor_id` a {@link
   * PagesHtmlDocumentStoreDeps.revisions} append attributes this Page's edit to. Defaults to
   * {@link SYSTEM_ACTOR_ID}, the same ledger fallback `post.ts` itself uses for an omitted caller,
   * rather than being required — most construction sites predate this field and a route that never
   * passes one should not have to.
   */
  actorId?: string;
}

/**
 * The capability a Page's bespoke-HTML body is read and written through, as an interface rather
 * than the concrete class.
 *
 * Two implementations satisfy it: {@link SqlPagesHtmlDocumentStore} over the real `content.db`, and
 * `html-document-store.memory.ts`'s `PostRepoPort`-backed twin for `app.ts`'s hermetic root. A
 * class type would not work here even if there were only one — TypeScript compares classes with
 * private fields nominally, so a structurally identical second implementation is not assignable to
 * the first.
 *
 * `read()` deliberately returns only the string; the version an implementation conditions its
 * write on is captured on the instance rather than handed back with the body. Handlers use Jini's
 * pure edits over that body without another store read.
 */
export interface PagesHtmlDocumentStorePort {
  /** Safe warnings from the last validated write, for authenticated authoring surfaces. */
  embedWarnings?(): readonly PluginEmbedDiagnostic[];
  /** Checks a supplied client basis before capturing it or converting a doc Page to HTML. */
  ensureHtmlFormat(required: { seedHtml: string; expectedVersion?: number }, optional?: Record<string, never>): Promise<void>;
  read(): Promise<string>;
  write(required: { html: string }, optional?: Record<string, never>): Promise<void>;
  /**
   * The row `version` captured by the most recent {@link read}/{@link ensureHtmlFormat} — the exact
   * value the next {@link write}'s compare-and-set will condition on — or `null` before either has
   * run.
   *
   * Added 2026-09-09 so a caller-stated `expectedVersion` (the agent tools' optimistic-concurrency
   * basis, mirroring `content_post_update`'s) can be compared against the version the write is
   * ACTUALLY conditioned on, with nothing able to move in between. Comparing against a version read
   * separately — through `postRepo`, say — would leave a window where a concurrent writer lands
   * between the check and this store's own `read()`, and the write would then be conditioned on the
   * intruder's version and silently clobber it. That is precisely the failure a version guard exists
   * to prevent, so the basis and the predicate must be the same number.
   *
   * This is the host's concurrency contract, independent of the engine's `HtmlDocumentStore`; pure region
   * edits never read the store or advance this basis.
   */
  capturedVersion(): number | null;
  /**
   * Restores a recorded pre-write body verbatim, conditioned on the row still being live at exactly
   * `expectedVersion` (the reverter's compare-and-set, kept even after the revert gateway's own
   * version preflight). Matching live HTML at that version is a successful no-op. Optional only so
   * narrow test fakes keep compiling; the `page-html` reverter refuses a store without it.
   * @throws {PageConcurrentEditError} When the row moved, was trashed, or is gone.
   */
  restore?(required: { inverse: PageHtmlInverse; expectedVersion: number }, optional?: Record<string, never>): Promise<void>;
}

/**
 * Builds a store for one Page, with the `content.db` handle and clock already closed over.
 *
 * A factory rather than a store, for the same reason `RouteDeps.chatHistory` is one: composition
 * owns the db handle so no route ever holds it, which is what makes an unscoped `WHERE id = ?`
 * unwritable from a route rather than merely against convention. Every instance is bound to exactly
 * one `(workspaceId, postId)` pair at construction.
 */
export type PagesHtmlDocumentStoreFactory = (
  scope: PagesHtmlDocumentStoreScope,
  options?: { allowedKinds?: ReadonlySet<PostKind> },
) => PagesHtmlDocumentStorePort;

/**
 * @file The exact pre-write body a recorded assistant HTML change restores (P1-T2.T).
 *
 * Kept as the stored row's own bytes, never a normalized or rendered copy: an Undo that restores
 * something nobody ever saved is not an Undo. A doc Page's first full HTML write records the doc
 * body and format captured BEFORE `ensureHtmlFormat` nulls `body_json`, because after that the
 * doc exists nowhere else the reverter is allowed to read (the `pages_read_html` doc fallback is
 * rendered HTML, not the body).
 */
export type PageHtmlInverse = { format: "html"; html: string } | { format: "doc"; bodyJson: JsonObject };

/** The assistant tools whose real HTML changes earn a recorded Undo. */
export type PageHtmlOperation = "pages_write_html" | "pages_write_region" | "pages_move_region";
/** What one store operation did: `changed: false` covers refusals and unchanged normalized writes. */
export interface PageHtmlWriteOutcome<T> { changed: boolean; version: number | null; value: T }
/**
 * Whether this composition can run a recorded HTML write at all (FIX 11). `enabled` only where one
 * transaction spans the page write, its revisions, events and the change-set record (sqlite,
 * postgres). The in-memory composition binds `disabled`: its post snapshot does not cover the
 * change-set repo or the outbox, so a late failure would orphan the Undo record.
 */
export type RecordedHtmlWrites = "enabled" | "disabled";
export interface RecordPageHtmlWritePort {
  <T>(required: { target: { workspaceId: string; pageId: string; actorId: string; executionId: string }; expectedVersion: number;
    operation: PageHtmlOperation; write: () => Promise<PageHtmlWriteOutcome<T>>; signal: AbortSignal }, optional?: Record<string, never>): Promise<{ value: T; version: number | null; changeSetId?: string }>;
}
