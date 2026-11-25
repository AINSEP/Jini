import type { PagesHtmlDocumentStoreDeps } from "./html-document-store.js";
import type { PageHtmlInverse, PagesHtmlDocumentStoreScope, PluginEmbedDiagnostic } from "@jini-ai/core/contracts/site/page-html-store";
import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { type Clock as ClockPort } from "@jini-ai/core/primitives";
import { assertEntityLive } from "../core/index.js";
import { type OutboxPort } from "@jini-ai/core/contracts/events";

import { type PostRecord, type PostRepoPort } from "../posts/post.js";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
// Not from the barrel above — see `html-document-store.sqlite.ts`'s identical import for why.
import { announcePendingGoLive } from "../entries/index.js";
import { SYSTEM_ACTOR_ID } from "../posts/post.js";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import { normalizeEmbedMarkerQuoting } from "../widgets/markers/index.js";
import { normalizeWidgetSlugMarkers, type WidgetSlugLookupPort } from "../widgets/index.js";
import type { UUID } from "@jini-ai/core/primitives";
import { extractHtmlEntryRefs } from "../widgets/index.js";
import type { EntryRefsRepoPort } from "../widgets/index.js";
import {
  PageConcurrentEditError,
  PageKindMismatchError,
  PageNotFoundError,
} from "./html-document-store.js";

/**
 * @file The `PostRepoPort`-backed twin of `html-document-store.sqlite.ts`, for `app.ts`'s hermetic
 * in-memory composition root.
 *
 * ## Why a second implementation rather than the real one over `:memory:`
 *
 * `RouteDeps.chatHistory` deliberately takes the *real* adapter over a throwaway `:memory:`
 * database rather than a hand-written double, and that is the right call there. It is the wrong
 * call here, and the difference is worth stating because the two roots look alike: the hermetic
 * root's posts live in an `InMemoryPostRepo`, not in any SQLite database at all. Handing this store
 * its own `:memory:` `ContentDb` would give it a second, disconnected set of rows — writes would
 * succeed, reads through `postRepo` would never see them, and every test would pass against a store
 * that shares no state with the pages it is supposedly editing. Silently wrong beats loudly broken
 * only in the wrong direction.
 *
 * So this mirrors `postRepo`, exactly the justification `search-index.memory.ts` records for its own
 * existence in the same root.
 *
 * ## What it must keep in sync
 *
 * The compare-and-set discipline (CIC-1), not just the method names. A double that accepted writes
 * unconditionally would make the hermetic root a place where the concurrency bug this store exists
 * to prevent is untestable and invisible — so `write()` here checks the version the same way, and
 * raises the same `PageConcurrentEditError`.
 */
export class InMemoryPagesHtmlDocumentStore {
  private lastReadVersion: number | null = null;
  private pluginWarnings: readonly PluginEmbedDiagnostic[] = [];

  embedWarnings(): readonly PluginEmbedDiagnostic[] { return this.pluginWarnings; }

  private async validatePluginEmbeds(input: { html: string }, _options = {}): Promise<void> {
    this.pluginWarnings = await this.deps.validatePluginEmbeds?.({ workspaceId: this.scope.workspaceId, html: input.html }) ?? [];
  }
  private readonly allowedKinds: ReadonlySet<PostKind>;

  private readonly scope: PagesHtmlDocumentStoreScope;
  private readonly deps: { repo: PostRepoPort; clock: ClockPort; entryRefsRepo?: EntryRefsRepoPort; outbox?: OutboxPort; allowedKinds?: ReadonlySet<PostKind>; validatePluginEmbeds?: PagesHtmlDocumentStoreDeps["validatePluginEmbeds"]; widgetSlugLookup?: WidgetSlugLookupPort; reportUnindexedRef: PagesHtmlDocumentStoreDeps["reportUnindexedRef"]; restoredEntryRefs: PagesHtmlDocumentStoreDeps["restoredEntryRefs"] };
  constructor(
    { scope, deps }: { scope: PagesHtmlDocumentStoreScope; deps: { repo: PostRepoPort; clock: ClockPort; entryRefsRepo?: EntryRefsRepoPort; outbox?: OutboxPort; allowedKinds?: ReadonlySet<PostKind>; validatePluginEmbeds?: PagesHtmlDocumentStoreDeps["validatePluginEmbeds"]; widgetSlugLookup?: WidgetSlugLookupPort; reportUnindexedRef: PagesHtmlDocumentStoreDeps["reportUnindexedRef"]; restoredEntryRefs: PagesHtmlDocumentStoreDeps["restoredEntryRefs"] } },
    _optional = {},
  ) {
    this.scope = scope;
    this.deps = deps;
    this.allowedKinds = deps.allowedKinds ?? new Set(["page"]);
  }

  /** B224: gives a slug-only widget marker its widget id before the HTML is stored (a no-op without `widgetSlugLookup`). */
  private async withWidgetIds(html: string, _options = {}): Promise<string> {
    const entryRepo = this.deps.widgetSlugLookup;
    if (!entryRepo) return html;
    return normalizeWidgetSlugMarkers({ deps: { entryRepo }, input: { workspaceId: this.scope.workspaceId as UUID, html } });
  }

  private async load(): Promise<PostRecord | null> {
    return this.deps.repo.findById({ workspaceId: this.scope.workspaceId, id: this.scope.postId });
  }

  /** @see PagesHtmlDocumentStore's own `reindexEntryRefs` private method for the full rationale. */
  private async reindexEntryRefs({ html }: { html: string }, _optional = {}): Promise<void> {
    if (!this.deps.entryRefsRepo) return;
    const refs = extractHtmlEntryRefs({ workspaceId: this.scope.workspaceId, sourceEntryId: this.scope.postId, html }, { report: this.deps.reportUnindexedRef });
    await this.deps.entryRefsRepo.replaceForSource({ workspaceId: this.scope.workspaceId, sourceEntryId: this.scope.postId, refs });
  }

  /** @see PagesHtmlDocumentStorePort.capturedVersion */
  capturedVersion(): number | null {
    return this.lastReadVersion;
  }

  /**
   * S1 (fix plan 2026-09-24 row 14) — mirrors the real store's `appendRevision` helper. Unlike that
   * store's optional `deps.revisions`, `deps.repo` here IS a full `PostRepoPort` unconditionally (it
   * is what this whole double is built over — see this file's header), so there is no "supplied or
   * not" branch: every call appends.
   */
  private async appendRevision({ seq, recordedAt }: { seq: number; recordedAt: string }, _optional = {}): Promise<void> {
    const row = await this.load();
    if (!row) return;
    await this.deps.repo.appendRevision({
      postId: this.scope.postId,
      workspaceId: this.scope.workspaceId,
      seq,
      op: "update",
      stateJson: row,
      actorId: this.scope.actorId ?? SYSTEM_ACTOR_ID,
      recordedAt,
    });
  }

  /** @see SqlPagesHtmlDocumentStore's `catchUpGoLive`; `row` is the row before this write. */
  private async catchUpGoLive({ row, nowIso }: { row: PostRecord; nowIso: string }, _optional = {}): Promise<void> {
    if (this.deps.outbox) await announcePendingGoLive({ outbox: this.deps.outbox, post: row, nowIso });
  }

  /** @see PagesHtmlDocumentStore.ensureHtmlFormat */
  async ensureHtmlFormat({ seedHtml: authoredSeedHtml, expectedVersion }: { seedHtml: string; expectedVersion?: number }, _optional = {}): Promise<void> {
    // Canvas-serialized `data-embed-config="{&quot;…}"` is stored in the readable single-quoted form.
    const seedHtml = await this.withWidgetIds(normalizeEmbedMarkerQuoting({ html: authoredSeedHtml }));
    const row = await this.load();
    if (!row) throw new PageNotFoundError(`page '${this.scope.postId}' was not found`);
    assertEntityLive({ entityType: "page", entityId: this.scope.postId, state: isTrashed(row) ? "trashed" : "live" });
    // The factory scopes this shared writer to the calling surface's own document kinds.
    if (!this.allowedKinds.has(row.kind)) {
      throw new PageKindMismatchError(`'${this.scope.postId}' is not an allowed HTML document kind`);
    }

    if (expectedVersion !== undefined && row.version !== expectedVersion) throw new PageConcurrentEditError(`page '${this.scope.postId}' is at version ${row.version}, not the expected version ${expectedVersion} — re-read and retry`);
    if (row.bodyFormat === "html") {
      this.lastReadVersion = row.version;
      return;
    }

    await this.validatePluginEmbeds({ html: seedHtml });
    const nextVersion = row.version + 1;
    const updatedAt = clockNowIso({ clock: this.deps.clock });

    await this.deps.repo.transaction({ fn: async () => {
      // Pre-conversion snapshot — see the real store's `ensureHtmlFormat` for why this is skipped
      // when a revision at this exact `seq` already exists.
      const existing = await this.deps.repo.listRevisions({ workspaceId: this.scope.workspaceId, postId: this.scope.postId });
      if (!existing.some((revision) => revision.seq === row.version)) {
        await this.appendRevision({ seq: row.version, recordedAt: updatedAt });
      }
      const { applied } = await this.deps.repo.saveIfVersion({ record: { ...row,
        bodyFormat: "html",
        bodyHtml: seedHtml,
        version: nextVersion,
        updatedAt,
      }, ifVersion: row.version });
      if (!applied) throw new PageConcurrentEditError(`page '${this.scope.postId}' was edited elsewhere while it was being converted to HTML — retry`);
      await this.appendRevision({ seq: nextVersion, recordedAt: updatedAt });
      await this.catchUpGoLive({ row, nowIso: updatedAt });
    } });
    this.lastReadVersion = nextVersion;
    await this.reindexEntryRefs({ html: seedHtml });
  }

  /** @see PagesHtmlDocumentStore.read */
  async read(): Promise<string> {
    const row = await this.load();
    if (!row) throw new PageNotFoundError(`page '${this.scope.postId}' was not found`);
    assertEntityLive({ entityType: "page", entityId: this.scope.postId, state: isTrashed(row) ? "trashed" : "live" });
    if (!this.allowedKinds.has(row.kind) || row.bodyFormat !== "html" || row.bodyHtml === null) {
      throw new PageNotFoundError(`page '${this.scope.postId}' was not found`);
    }
    this.lastReadVersion = row.version;
    return row.bodyHtml;
  }

  /**
   * @see PagesHtmlDocumentStore.write
   *
   * Commits through {@link PostRepoPort.saveIfVersion} rather than a separate `row.version !==
   * expectedVersion` check followed by an unconditional `save()`. The two-step form has an `await`
   * gap between the check and the act: two `write()` calls truly in flight at once (as two parallel
   * `pages_write_region` tool-call dispatches produce — see `tool-registrations.write-region.test.ts`'s
   * own header, defect #2) can both pass the check before either has saved, so the later `save()`
   * silently clobbers the earlier one with no error to either caller. `saveIfVersion` does its
   * version compare and its write in one synchronous span with no `await` inside, so whichever
   * caller's `saveIfVersion` actually runs second — even with both `write()`s in flight — sees the
   * version the first one already bumped and reports `applied: false`. This is this store's own
   * analogue of the real store's atomic `UPDATE ... WHERE version = ?` (see this file's header).
   * Pinned by `__tests__/html-document-store.memory.test.ts`'s "BUG: two write() calls truly IN
   * FLIGHT AT ONCE" case.
   */
  async write({ html: authoredHtml }: { html: string }, _optional?: Record<string, never>): Promise<void> {
    // Canvas-serialized `data-embed-config="{&quot;…}"` is stored in the readable single-quoted form.
    const quoted = normalizeEmbedMarkerQuoting({ html: authoredHtml });
    if (this.lastReadVersion === null) {
      throw new Error("PagesHtmlDocumentStore.write() called before read() — there is no version to condition the write on");
    }
    const expectedVersion = this.lastReadVersion;
    const html = await this.withWidgetIds(quoted);
    // Preserve this call's read basis across asynchronous plugin validation (CIC-1).
    await this.validatePluginEmbeds({ html });
    const row = await this.load();

    // Disambiguate on the mismatch path: a trashed row is not "someone else edited it" — see
    // `PagesHtmlDocumentStore.write`'s own doc for why the two are distinct rejections.
    if (row && isTrashed(row)) {
      assertEntityLive({ entityType: "page", entityId: this.scope.postId, state: "trashed" });
    }
    if (!row || !this.allowedKinds.has(row.kind) || row.bodyFormat !== "html" || row.version !== expectedVersion) {
      throw new PageConcurrentEditError(
        `page '${this.scope.postId}' was edited elsewhere since this turn started — re-read and retry`
      );
    }
    // Match the real store: freshness is checked before comparing normalized HTML, so even an
    // identical body cannot make a stale save succeed. No ledger/index writes on this path.
    if (row.bodyHtml === html) return;

    const nextVersion = expectedVersion + 1;
    const updatedAt = clockNowIso({ clock: this.deps.clock });
    const { applied } = await this.deps.repo.saveIfVersion({
      record: { ...row, bodyHtml: html, version: nextVersion, updatedAt },
      ifVersion: expectedVersion,
    });
    if (!applied) {
      throw new PageConcurrentEditError(
        `page '${this.scope.postId}' was edited elsewhere since this turn started — re-read and retry`
      );
    }
    // S1 (fix plan 2026-09-24 row 14) — after, not inside, `saveIfVersion`: that call is this
    // store's own atomic compare-and-set (see this method's own header), so there is nothing left to
    // wrap in a `transaction()` by the time `applied` is known true.
    await this.appendRevision({ seq: nextVersion, recordedAt: updatedAt });
    await this.catchUpGoLive({ row, nowIso: updatedAt });
    this.lastReadVersion = nextVersion;
    await this.reindexEntryRefs({ html });
  }
  /** @see SqlPagesHtmlDocumentStore.restore — verbatim, version-conditioned, no authoring hooks. */
  async restore({ inverse, expectedVersion }: { inverse: PageHtmlInverse; expectedVersion: number }, _optional = {}): Promise<void> {
    const conflict = () => new PageConcurrentEditError(`page '${this.scope.postId}' changed after this edit was made — the newer version was kept`);
    const row = await this.load();
    if (!row || isTrashed(row) || !this.allowedKinds.has(row.kind) || row.version !== expectedVersion) throw conflict();
    if (inverse.format === "html" && row.bodyFormat === "html" && row.bodyHtml === inverse.html) return;
    const nextVersion = expectedVersion + 1;
    const updatedAt = clockNowIso({ clock: this.deps.clock });
    const body = inverse.format === "html"
      ? { bodyFormat: "html" as const, bodyHtml: inverse.html }
      : { bodyFormat: "doc" as const, bodyJson: inverse.bodyJson, bodyHtml: null };
    await this.deps.repo.transaction({ fn: async () => {
      const { applied } = await this.deps.repo.saveIfVersion({ record: { ...row, ...body, version: nextVersion, updatedAt } as PostRecord, ifVersion: expectedVersion });
      if (!applied) throw conflict();
      await this.appendRevision({ seq: nextVersion, recordedAt: updatedAt });
    } });
    this.lastReadVersion = nextVersion;
    if (this.deps.entryRefsRepo) {
      const refs = this.deps.restoredEntryRefs({ inverse, workspaceId: this.scope.workspaceId, postId: this.scope.postId });
      await this.deps.entryRefsRepo.replaceForSource({ workspaceId: this.scope.workspaceId, sourceEntryId: this.scope.postId, refs });
    }
  }
}
