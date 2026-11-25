import type { PluginEmbedDiagnostic, PagesHtmlDocumentStoreScope, PagesHtmlDocumentStorePort, PageHtmlInverse } from "@jini-ai/core/contracts/site/page-html-store";
import { nowIso as clockNowIso, type Clock as ClockPort, type UUID } from "@jini-ai/core/primitives";
import { assertEntityLive, type PostStatus } from "../core/index.js";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { normalizeEmbedMarkerQuoting } from "../widgets/markers/index.js";
import { extractHtmlEntryRefs, normalizeWidgetSlugMarkers, type WidgetSlugLookupPort, type EntryRefsRepoPort, type EntryRefRow } from "../widgets/index.js";
import type { EntryRefsReport } from "../widgets/entry-refs-extractor.js";
import { announcePendingGoLive } from "../entries/index.js";
import { SYSTEM_ACTOR_ID, type PostRepoPort } from "../posts/post.js";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";

export class PageNotFoundError extends Error {}

/**
 * Refuses {@link SqlPagesHtmlDocumentStore.ensureHtmlFormat} on a row that is not `kind: "page"`.
 *
 * Distinct from {@link PageNotFoundError} on purpose, and it is the one place in this file that
 * does NOT follow the "kind-mismatch is indistinguishable from not-found" convention: the other
 * methods hide a Post's existence because they are read/write paths an agent can aim at any id,
 * whereas this one is only ever reached from a route that has already resolved the row through the
 * pages surface. Conflating "this Post cannot become an html Page" with "no such page" here would
 * hide a genuine caller bug (a Post id routed into the Pages editor) behind a 404 that reads as
 * ordinary missing data.
 */
export class PageKindMismatchError extends Error {}

/**
 * CIC-1's rejection — surfaced when `write()`'s `UPDATE ... WHERE version = <captured>` affects zero
 * rows, meaning the row's version moved since the matching `read()`. Never a silent no-op or a
 * fallback overwrite (ADR-056 Decision 2's own wording).
 */
export class PageConcurrentEditError extends Error {}

export interface PageHtmlStatementRow {
  id: string; workspace_id: string; kind: string; status: string; publish_at: string | null;
  updated_at: string; deleted_at: string | null; body_html: string | null; body_format: string; version: number;
}
export interface PageHtmlStatements {
  readBody(required: { scope: Pick<PagesHtmlDocumentStoreScope, "workspaceId" | "postId"> }, optional?: Record<string, never>): Promise<Pick<PageHtmlStatementRow, "kind" | "body_html" | "body_format" | "version" | "deleted_at"> | undefined>;
  readForConversion(required: { scope: Pick<PagesHtmlDocumentStoreScope, "workspaceId" | "postId"> }, optional?: Record<string, never>): Promise<Omit<PageHtmlStatementRow, "body_html"> | undefined>;
  readForWrite(required: { scope: Pick<PagesHtmlDocumentStoreScope, "workspaceId" | "postId"> }, optional?: Record<string, never>): Promise<PageHtmlStatementRow | undefined>;
  readDeletedAt(required: { scope: Pick<PagesHtmlDocumentStoreScope, "workspaceId" | "postId"> }, optional?: Record<string, never>): Promise<{ deleted_at: string | null } | undefined>;
  update(required: { scope: Pick<PagesHtmlDocumentStoreScope, "workspaceId" | "postId">; allowedKinds: ReadonlySet<PostKind>;
    set: { body_html?: string | null; body_json?: string | null; body_format?: "html" | "doc"; version: number; updated_at: string };
    guard: { version: number; liveHtmlOnly?: boolean } }, optional?: Record<string, never>): Promise<number>;
  transaction<T>(required: { fn: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
}
export interface PagesHtmlDocumentStoreDeps {
  validatePluginEmbeds?: (input: { workspaceId: string; html: string }) => Promise<readonly PluginEmbedDiagnostic[]>;
  widgetSlugLookup?: WidgetSlugLookupPort;
  statements: PageHtmlStatements;
  allowedKinds?: ReadonlySet<PostKind>;
  clock: ClockPort;
  entryRefsRepo?: EntryRefsRepoPort;
  revisions?: Pick<PostRepoPort, "findById" | "appendRevision" | "transaction" | "listRevisions">;
  outbox?: Pick<OutboxPort, "enqueue">;
  reportUnindexedRef: EntryRefsReport;
  restoredEntryRefs(required: { inverse: PageHtmlInverse; workspaceId: string; postId: string }): readonly EntryRefRow[];
}
type GoLiveColumns = Pick<PageHtmlStatementRow, "id" | "workspace_id" | "kind" | "status" | "publish_at" | "updated_at" | "deleted_at">;

/**
 * the host's page HTML store over one `"html"`-format Page row (SPEC-047/ADR-056 REQ-4).
 *
 * Stateful by necessity, not by convenience: this port's `read()` returns only a string (no version),
 * so the row's `version` at the time of the most recent `read()`
 * is captured on the instance and is what the next `write()` conditions its compare-and-set on
 * (CIC-1). Pages handlers read once, compute through Jini's pure functions, then write, with no
 * other store read landing in between — so "condition on the most recently read version" is
 * exactly "condition on the version the content
 * being written was computed from," which is the property CIC-1 requires.
 */
export class SqlPagesHtmlDocumentStore implements PagesHtmlDocumentStorePort {
  private lastReadVersion: number | null = null;
  private pluginWarnings: readonly PluginEmbedDiagnostic[] = [];

  embedWarnings(): readonly PluginEmbedDiagnostic[] { return this.pluginWarnings; }

  /** B224: gives a slug-only widget marker its widget id before the HTML is stored (a no-op without `widgetSlugLookup`). */
  private async withWidgetIds(html: string, _options = {}): Promise<string> {
    const entryRepo = this.deps.widgetSlugLookup;
    if (!entryRepo) return html;
    return normalizeWidgetSlugMarkers({ deps: { entryRepo }, input: { workspaceId: this.scope.workspaceId as UUID, html } });
  }

  private async validatePluginEmbeds(input: { html: string }, _options = {}): Promise<void> {
    this.pluginWarnings = await this.deps.validatePluginEmbeds?.({ workspaceId: this.scope.workspaceId, html: input.html }) ?? [];
  }
  private readonly allowedKinds: ReadonlySet<PostKind>;

  private readonly scope: PagesHtmlDocumentStoreScope;
  private readonly deps: PagesHtmlDocumentStoreDeps;
  constructor(
    { scope, deps }: { scope: PagesHtmlDocumentStoreScope; deps: PagesHtmlDocumentStoreDeps },
    _optional = {},
  ) {
    this.scope = scope;
    this.deps = deps;
    this.allowedKinds = deps.allowedKinds ?? new Set(["page"]);
  }

  /**
   * @see PagesHtmlDocumentStorePort.capturedVersion
   * @complexity O(1).
   */
  capturedVersion(): number | null {
    return this.lastReadVersion;
  }

  /**
   * The compare-and-set UPDATE both write paths share: this row, at exactly `guard.version`, and
   * (for {@link write}) still an `"html"` row outside the Trash.
   *
   * @returns The number of rows changed — 0 or 1.
   * @complexity O(1) — one indexed, version-conditioned row update.
   */
  /**
   * Runs one write path's statements as one transaction: through `revisions.transaction` when the
   * ledger is wired (the transaction its appends already join), else the kernel's own — so the
   * go-live catch-up commits or rolls back with the row even without a ledger (2026-10-21).
   *
   * @complexity O(1) besides `fn`.
   */
  private inTransaction<T>({ fn }: { fn: () => Promise<T> }, _optional = {}): Promise<T> {
    return this.deps.revisions ? this.deps.revisions.transaction({ fn }) : this.deps.statements.transaction({ fn });
  }

  /**
   * The go-live catch-up of {@link PagesHtmlDocumentStoreDeps.outbox}: `row` as it stood BEFORE this
   * write, `nowIso` the write's instant. Call it inside the write's transaction, after the UPDATE
   * matched. A no-op without an outbox.
   *
   * @complexity O(1) — at most one enqueue.
   */
  private async catchUpGoLive({ row, nowIso }: { row: GoLiveColumns; nowIso: string }, _optional = {}): Promise<void> {
    if (!this.deps.outbox) return;
    const post = {
      id: row.id,
      workspaceId: row.workspace_id,
      kind: row.kind as PostKind,
      status: row.status as PostStatus,
      publishAt: row.publish_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
    await announcePendingGoLive({ outbox: this.deps.outbox, post, nowIso });
  }

  private async updateThisRow(set: Parameters<PageHtmlStatements["update"]>[0]["set"], guard: { version: number; liveHtmlOnly?: boolean }): Promise<number> {
    return this.deps.statements.update({ scope: this.scope, allowedKinds: this.allowedKinds, set, guard });
  }

  /**
   * Reads the current `body_html`, capturing this row's `version` on the instance for the next
   * {@link write} to condition its compare-and-set on.
   *
   * A row that does not exist, or that exists but is not `bodyFormat: "html"`, 404s identically —
   * the same "kind-mismatch is indistinguishable from not-found" convention
   * `pages/get-by-id.ts` already applies, so this store never leaks whether a `doc`-format row with
   * this id exists.
   *
   * @throws {PageNotFoundError} If no `"html"`-format row with this id exists in this workspace.
   * @throws {EntityNotLiveError} If the row is in the Trash (`@jini-ai/cms/core`, S5 web-high fix
   * plan 2026-09-24). Checked BEFORE the `bodyFormat` mismatch below, so a trashed row reports Trash
   * even when its body is `"doc"`-format — the caller needs to know the row is trashed either way.
   * @complexity O(1) — one indexed row lookup.
   * @overallScore 100
   */
  async read(): Promise<string> {
    const row = await this.deps.statements.readBody({ scope: this.scope });

    if (!row) throw new PageNotFoundError(`page '${this.scope.postId}' was not found`);
    assertEntityLive({ entityType: "page", entityId: this.scope.postId, state: row.deleted_at ? "trashed" : "live" });
    if (!this.allowedKinds.has(row.kind as PostKind) || row.body_format !== "html" || row.body_html === null) {
      throw new PageNotFoundError(`page '${this.scope.postId}' was not found`);
    }

    this.lastReadVersion = row.version;
    return row.body_html;
  }

  /**
   * Births an `"html"`-format Page: flips a `"doc"`-format row to `"html"` and seeds `body_html`
   * with `seedHtml`. Idempotent — a row already in `"html"` format is left untouched (content
   * included) and only has its `version` captured, so the caller can follow with
   * {@link read}/{@link write} unconditionally.
   *
   * **This is the only path by which an `"html"`-format row ever comes into existence.** It exists
   * because the two halves of the design lock each other out otherwise: `post.ts`'s
   * `resolveBodyFields()` is hardcoded to `"doc"` and can never construct an html row (ADR-056
   * CIC-3, deliberate), while {@link read} refuses a row whose `bodyHtml` is null — so without this
   * method there is no first write. Keeping it here rather than loosening `createPost` is what
   * preserves CIC-3 literally: `createPost`/`updatePost` still cannot produce this shape, and this
   * class remains the sole writer of it.
   *
   * **The conversion is one-way and drops `body_json`** (D-2's explicitly warned, one-way format
   * conversion). The CHECK constraint on `posts` permits exactly one populated body column per
   * format, so flipping to `"html"` requires nulling `body_json` in the same statement — any TipTap
   * content on that row is gone and is not recoverable from this table. Callers must not offer this
   * on a Page with authored `doc` content without warning the operator first; today the only caller
   * is the Pages editor acting on a freshly created, empty Page.
   *
   * @throws {PageNotFoundError} If no row with this id exists in this workspace.
   * @throws {EntityNotLiveError} If the row is in the Trash (`@jini-ai/cms/core`, S5 web-high fix
   * plan 2026-09-24). Checked BEFORE the `kind` mismatch below, matching {@link read}'s ordering.
   * @throws {PageKindMismatchError} If the row exists but is `kind: "post"` — Posts are Tiptap, full
   * stop (D-1), and no Post may be converted to bespoke HTML through this or any other path.
   * @complexity O(1) — one indexed row lookup plus, on a `doc` row, one indexed row update.
   */
  async ensureHtmlFormat({ seedHtml: authoredSeedHtml, expectedVersion }: { seedHtml: string; expectedVersion?: number }, _optional = {}): Promise<void> {
    // Canvas-serialized `data-embed-config="{&quot;…}"` is stored in the readable single-quoted form.
    const seedHtml = await this.withWidgetIds(normalizeEmbedMarkerQuoting({ html: authoredSeedHtml }));
    const row = await this.deps.statements.readForConversion({ scope: this.scope });

    if (!row) throw new PageNotFoundError(`page '${this.scope.postId}' was not found`);
    assertEntityLive({ entityType: "page", entityId: this.scope.postId, state: row.deleted_at ? "trashed" : "live" });
    // The factory scopes this shared writer to the calling surface's own document kinds.
    if (!this.allowedKinds.has(row.kind as PostKind)) {
      throw new PageKindMismatchError(`'${this.scope.postId}' is not an allowed HTML document kind`);
    }
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw new PageConcurrentEditError(`page '${this.scope.postId}' is at version ${row.version}, not the expected version ${expectedVersion} — re-read and retry`);
    if (row.body_format === "html") {
      // Already born. Capture the version so a following `write()` has something to condition on,
      // and leave the content alone — re-seeding here would silently discard the page's real body
      // every time the editor opened it.
      this.lastReadVersion = row.version;
      return;
    }

    await this.validatePluginEmbeds({ html: seedHtml });
    const nextVersion = row.version + 1;
    const updatedAt = clockNowIso({ clock: this.deps.clock });

    await this.inTransaction({ fn: () => this.runConversion({ row, seedHtml, nextVersion, updatedAt }) });

    this.lastReadVersion = nextVersion;
    await this.reindexEntryRefs({ html: seedHtml });
  }

  private async runConversion({ row, seedHtml, nextVersion, updatedAt }: {
    row: Omit<PageHtmlStatementRow, "body_html">; seedHtml: string; nextVersion: number; updatedAt: string;
  }, _optional = {}): Promise<void> {
      // S1 (fix plan 2026-09-24 row 14) — the PRE-conversion snapshot. `bodyJson` is about to be
      // nulled by the UPDATE below (D-2's one-way conversion), so this is the ledger's only chance
      // ever to record what a legacy doc Page's body was. Skipped when a row at this exact `seq`
      // already exists — `updatePost` ledgers every real edit itself, so a Page with prior edit
      // history already has this snapshot and a second row at the same `seq` would be a redundant
      // duplicate, not a recovery of anything new.
      if (this.deps.revisions) {
        const existing = await this.deps.revisions.listRevisions({
          workspaceId: this.scope.workspaceId,
          postId: this.scope.postId,
        });
        if (!existing.some((revision) => revision.seq === row.version)) {
          await this.appendRevision({ seq: row.version, recordedAt: updatedAt });
        }
      }

      const changes = await this.updateThisRow(
        {
          body_format: "html",
          body_html: seedHtml,
          // Required by the table's CHECK constraint, not incidental — see this method's doc.
          body_json: null,
          version: nextVersion,
          updated_at: updatedAt,
        },
        // Same compare-and-set discipline as `write()` (CIC-1): if another writer moved this row
        // between the SELECT above and here, this update matches nothing rather than clobbering.
        { version: row.version }
      );

      // Reject inside the transaction so the pre-conversion snapshot rolls back with a stale CAS.
      if (changes === 0) {
        throw new PageConcurrentEditError(
          `page '${this.scope.postId}' was edited elsewhere while it was being converted to HTML — retry`
        );
      }

      // The POST-conversion snapshot — the row's first ever html-format state.
      await this.appendRevision({ seq: nextVersion, recordedAt: updatedAt });
      await this.emitUpdated({ status: row.status, version: nextVersion, occurredAt: updatedAt });
      await this.catchUpGoLive({ row, nowIso: updatedAt });
  }

  /**
   * Enqueues `entry.updated` for a content change of a published page (see
   * {@link PagesHtmlDocumentStoreDeps.outbox}); the same envelope and idempotent id shape as
   * `post.ts`'s status-transition emitter. A draft or scheduled page emits nothing, exactly as a
   * `post.ts` edit of a non-published row does: no public-facing content changed.
   * @complexity O(1) — one outbox insert.
   */
  private async emitUpdated(required: { status: string; version: number; occurredAt: string }): Promise<void> {
    if (!this.deps.outbox) return;
    await this.deps.outbox.enqueue({
      id: `${this.scope.postId}-content.saved-${required.version}`, name: "content.saved",
      occurredAt: required.occurredAt, aggregateId: this.scope.postId, workspaceId: this.scope.workspaceId,
      payload: { entryId: this.scope.postId, contentType: "page", actorId: this.scope.actorId, source: "service" },
    });
    if (required.status !== "published") return;
    await this.deps.outbox.enqueue({
      id: `${this.scope.postId}-entry.updated-${required.version}`,
      name: "entry.updated",
      occurredAt: required.occurredAt,
      aggregateId: this.scope.postId,
      workspaceId: this.scope.workspaceId,
      payload: { entryId: this.scope.postId, contentType: "page" },
    });
  }

  /**
   * S1 (fix plan 2026-09-24 row 14) — appends one `post_revisions` row capturing this row's state AS
   * OF RIGHT NOW under `seq`, when {@link PagesHtmlDocumentStoreDeps.revisions} was supplied. A no-op
   * (not an error) when it wasn't, matching {@link reindexEntryRefs}'s own optional-dependency shape.
   *
   * Always re-reads the row through `revisions.findById` rather than accepting a caller-built
   * snapshot — the two write paths that call this ({@link write}'s post-write state and {@link
   * ensureHtmlFormat}'s pre- AND post-conversion states) each need a DIFFERENT moment's row, and
   * "read whatever is there right now" is the one implementation that is correct for all three
   * without the caller having to hand-assemble a `PostRecord`.
   *
   * @complexity O(1) — one indexed lookup plus one ledger insert.
   */
  private async appendRevision({ seq, recordedAt }: { seq: number; recordedAt: string }, _optional = {}): Promise<void> {
    if (!this.deps.revisions) return;
    const row = await this.deps.revisions.findById({ workspaceId: this.scope.workspaceId, id: this.scope.postId });
    // Cannot happen on either call site's success path (each call follows a write that just matched
    // this exact row) — a defensive no-op, not a silent swallow of a real failure.
    if (!row) return;
    await this.deps.revisions.appendRevision({
      postId: this.scope.postId,
      workspaceId: this.scope.workspaceId,
      seq,
      op: "update",
      stateJson: row,
      actorId: this.scope.actorId ?? SYSTEM_ACTOR_ID,
      recordedAt,
    });
  }

  /**
   * SPEC-047 Slice 3 — re-extracts and replaces this Page's `entry_refs` rows for `html`, when
   * {@link PagesHtmlDocumentStoreDeps.entryRefsRepo} was supplied. A no-op (not an error) when it
   * wasn't — see that field's own doc for why this dependency stays optional.
   *
   * @complexity O(n) over `html`'s length (delegates to `extractHtmlEntryRefs`'s own O(n) scan) plus
   * one `replaceForSource` write.
   * @overallScore 100
   */
  private async reindexEntryRefs({ html }: { html: string }, _optional = {}): Promise<void> {
    if (!this.deps.entryRefsRepo) return;
    const refs = extractHtmlEntryRefs({
      workspaceId: this.scope.workspaceId,
      sourceEntryId: this.scope.postId,
      html,
    }, { report: this.deps.reportUnindexedRef });
    await this.deps.entryRefsRepo.replaceForSource({
      workspaceId: this.scope.workspaceId,
      sourceEntryId: this.scope.postId,
      refs,
    });
  }

  /**
   * Writes a new `body_html`, conditioned on the `version` captured by the most recent {@link read}
   * (CIC-1's compare-and-set). On success, `version` is incremented and the instance's captured
   * version advances to match — so a second `write()` on this same instance (no intervening `read()`
   * call) is conditioned on the version this store itself just produced, not a stale one.
   * Identical normalized HTML leaves the row, ledger and reference index untouched, after checking
   * the current row still matches the captured version and is live HTML.
   *
   * @throws {Error} If called before any {@link read} — there is no captured version to condition on.
   * @throws {EntityNotLiveError} If the row was trashed since the matching `read()`
   * (`@jini-ai/cms/core`, S5 web-high fix plan 2026-09-24) — disambiguated on the rejection path.
   * @throws {PageConcurrentEditError} If zero rows matched the compare-and-set for any other reason —
   * the row's version moved since the matching `read()` (another writer committed first). The caller
   * must re-`read()` and retry; this method never falls back to an unconditional overwrite.
   * @complexity O(n) time for n HTML characters; one indexed lookup, at most one CAS update and
   * revision append, plus the optional reference scan. No persistence writes for unchanged HTML.
   * @overallScore 100
   */
  async write({ html: authoredHtml }: { html: string }, _optional = {}): Promise<void> {
    // Canvas-serialized `data-embed-config="{&quot;…}"` is stored in the readable single-quoted form.
    const quoted = normalizeEmbedMarkerQuoting({ html: authoredHtml });
    if (this.lastReadVersion === null) {
      throw new Error("PagesHtmlDocumentStore.write() called before read() — there is no version to condition the write on");
    }
    const expectedVersion = this.lastReadVersion;
    const html = await this.withWidgetIds(quoted);
    // Preserve this call's read basis across asynchronous plugin validation (CIC-1).
    await this.validatePluginEmbeds({ html });
    const nextVersion = expectedVersion + 1;
    const updatedAt = clockNowIso({ clock: this.deps.clock });

    const runWrite = async () => {
      const current = await this.deps.statements.readForWrite({ scope: this.scope });
      // Check freshness before equality: matching HTML must never hide a stale captured version.
      if (!current || !this.allowedKinds.has(current.kind as PostKind)) return 0;
      if (current.version !== expectedVersion || current.body_format !== "html" || current.deleted_at) return 0;
      if (current.body_html === html) return null;
      const changes = await this.updateThisRow(
        { body_html: html, version: nextVersion, updated_at: updatedAt },
        { version: expectedVersion, liveHtmlOnly: true }
      );
      // S1 (fix plan 2026-09-24 row 14) — only on the row this UPDATE actually matched. A 0-row
      // result below throws before any append lands (and, inside `revisions.transaction()`, rolls
      // this back too — though there is nothing to roll back on this path, unlike `ensureHtmlFormat`'s
      // two-append converting branch).
      if (changes > 0) {
        await this.appendRevision({ seq: nextVersion, recordedAt: updatedAt });
        await this.emitUpdated({ status: current.status, version: nextVersion, occurredAt: updatedAt });
        await this.catchUpGoLive({ row: current, nowIso: updatedAt });
      }
      return changes;
    };

    const changes = await this.inTransaction({ fn: runWrite });
    if (changes === null) return;

    if (changes === 0) {
      // Disambiguate: the row can have moved off this exact predicate either because it was trashed
      // (a state the model must be told about explicitly) or for the ordinary concurrent-edit reason
      // this class has always guarded against. A trashed row does not get to masquerade as "someone
      // else edited it" — the recovery action is different (restore from Trash vs. re-read and retry).
      const stillHere = await this.deps.statements.readDeletedAt({ scope: this.scope });
      const deletedAt = stillHere?.deleted_at;
      if (deletedAt) {
        assertEntityLive({ entityType: "page", entityId: this.scope.postId, state: "trashed" });
      }
      throw new PageConcurrentEditError(
        `page '${this.scope.postId}' was edited elsewhere since this turn started — re-read and retry`
      );
    }

    this.lastReadVersion = nextVersion;
    await this.reindexEntryRefs({ html });
  }
  /**
   * @see PagesHtmlDocumentStorePort.restore
   *
   * Restore skips authoring transformations on purpose: no marker re-quoting, widget-id stamping or
   * plugin validation, because the inverse is the exact body that was stored, and running today's
   * normalization over it would restore something nobody ever saved. Doc restore sets both body
   * columns and the format in one compare-and-set, keeping the table's one-populated-body-column
   * invariant. Unrelated metadata and `autosave_json` are left as they are.
   * @complexity O(n) in the body's size; one indexed lookup, at most one CAS update and revision append.
   */
  async restore({ inverse, expectedVersion }: { inverse: PageHtmlInverse; expectedVersion: number }, _optional = {}): Promise<void> {
    const nextVersion = expectedVersion + 1;
    const updatedAt = clockNowIso({ clock: this.deps.clock });
    const body: Omit<Parameters<PageHtmlStatements["update"]>[0]["set"], "version" | "updated_at"> = inverse.format === "html"
      ? { body_format: "html", body_html: inverse.html, body_json: null }
      : { body_format: "doc", body_json: JSON.stringify(inverse.bodyJson), body_html: null };
    const runRestore = async (): Promise<"conflict" | "unchanged" | "restored"> => {
      const current = await this.deps.statements.readForWrite({ scope: this.scope });
      if (!current || !this.allowedKinds.has(current.kind as PostKind) || current.deleted_at || current.version !== expectedVersion) return "conflict";
      if (inverse.format === "html" && current.body_format === "html" && current.body_html === inverse.html) return "unchanged";
      const changes = await this.updateThisRow({ ...body, version: nextVersion, updated_at: updatedAt }, { version: expectedVersion, liveHtmlOnly: true });
      if (changes === 0) return "conflict";
      await this.appendRevision({ seq: nextVersion, recordedAt: updatedAt });
      await this.emitUpdated({ status: current.status, version: nextVersion, occurredAt: updatedAt });
      return "restored";
    };
    const outcome = await this.inTransaction({ fn: runRestore });
    if (outcome === "conflict") throw new PageConcurrentEditError(`page '${this.scope.postId}' changed after this edit was made — the newer version was kept`);
    if (outcome === "unchanged") return;
    this.lastReadVersion = nextVersion;
    if (this.deps.entryRefsRepo) {
      const refs = this.deps.restoredEntryRefs({ inverse, workspaceId: this.scope.workspaceId, postId: this.scope.postId });
      await this.deps.entryRefsRepo.replaceForSource({ workspaceId: this.scope.workspaceId, sourceEntryId: this.scope.postId, refs });
    }
  }
}
