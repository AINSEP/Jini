import { type PostRepoPort, PostConflictError, type PostRecord, PostVersionConflictError } from "./post.js";
import { type UUID, type Clock as ClockPort, nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { type BeforeSaveHookPort, runBeforeSaveHook, mergeExt } from "./post-before-save.js";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { persistUpdatedPost, appendPostRevision, enqueueContentWrite, emitPublicTransitionEvent } from "./post-write-effects.js";

/** The STRICT slug-uniqueness rule `importPostEntity` (publish) keeps: a slug claimed by any
 * DIFFERENT record, trashed or not, is a conflict. Publish plans its own address clashes —
 * `planRetire`/{@link retirePostForReplacement} offer to move the holder, and its precheck refuses a
 * trashed holder up front — so this is only its write-time backstop, not the authoring rule above. */
async function assertSlugAvailableForUpdate(
  { repo, workspaceId, slug, id }: { repo: PostRepoPort; workspaceId: UUID; slug: string; id: UUID },
  _optional: Record<string, never> = {}
): Promise<void> {
  const duplicate = await repo.findBySlug({ workspaceId, slug });
  if (duplicate && duplicate.id !== id) {
    throw new PostConflictError(`slug '${slug}' already exists`);
  }
}

// ---------------------------------------------------------------------------
// Replication (publish-content) — importPostEntity
// ---------------------------------------------------------------------------

export interface ImportPostEntityDeps {
  clock: ClockPort;
  repo: PostRepoPort;
  outbox: OutboxPort;
  /** Same optional "absent ⇒ zero-plugin path unchanged" contract as {@link UpdatePostDeps.beforeSaveHook}. */
  beforeSaveHook?: BeforeSaveHookPort;
}

export interface ImportPostEntityInput {
  workspaceId: UUID;
  /**
   * The SOURCE instance's own `PostRecord`, carried VERBATIM — this is the whole point of this
   * function (see its own doc). `id` is preserved; `version`/`updatedAt` are ignored (destination-
   * local write bookkeeping, recomputed here), and `createdAt`/`createdByPrincipalId` are honored
   * only for a row that does not exist at this destination yet (write-once).
   */
  record: PostRecord;
  /**
   * Optimistic-concurrency basis, same contract as {@link UpdatePostInput.expectedVersion}:
   * `undefined` means the caller believes no row exists here (a create), a number means it read
   * that version and expects to still be writing over it.
   */
  expectedVersion?: number;
  /** Attribution for the revision this write appends — the IMPORTING OPERATOR, never the source's
   *  own author (which travels in `record.createdByPrincipalId` and is a different fact). */
  actorId?: UUID;
  delegatedByWorkspaceId?: UUID | null;
  delegatedById?: UUID | null;
}

/**
 * The fail-closed target checks {@link importPostEntity} runs before any write: a create must find
 * no row, and an update must find a live row of the same kind.
 * @throws {PostVersionConflictError} When a create finds an existing row.
 * @throws {PostConflictError} When the existing row is trashed or of another kind.
 * @complexity O(1).
 */
function assertImportTarget(required: { input: ImportPostEntityInput; existing: PostRecord | null }): void {
  const { input, existing } = required;
  // The caller's basis and the destination's reality must agree BEFORE anything is written. A
  // create whose row already exists would otherwise upsert straight over it (`persistUpdatedPost`
  // falls through to an unconditional `save()` when no basis is supplied), silently winning a race
  // the whole `expectedVersion` mechanism exists to lose. Mirrors `import-media-entity.ts`'s own
  // "expected no existing row, found version N" guard.
  if (input.expectedVersion === undefined && existing) {
    throw new PostVersionConflictError({
      message: `post '${input.record.id}' already exists at this destination (version ${existing.version}) but was published as new`,
      expectedVersion: 0,
      currentVersion: existing.version,
    });
  }

  if (existing) {
    // A trashed destination row is NOT an update target. Overwriting it with a live source record
    // would silently resurrect content an operator here deliberately binned; restoring it is a
    // separate, deliberate act (revert the delete change set).
    if (isTrashed(existing)) {
      throw new PostConflictError(
        `post '${input.record.id}' is in the trash at this destination — restore it before publishing over it`
      );
    }
    if (existing.kind !== input.record.kind) {
      throw new PostConflictError(
        `post '${input.record.id}' is a '${existing.kind}' at this destination but a '${input.record.kind}' at the source — kind is fixed at creation`
      );
    }
    // D2 (2026-09-24 owner decision, publish-types-plan §6): a body-format difference (doc -> html
    // loses the Tiptap document, html -> doc loses `body_html` — see `resolveUpdateBodyFields`'s doc
    // for the real incident that concern originally documented) used to refuse here outright. The
    // owner has since decided publishing should REPLACE the destination's body wholesale instead,
    // the same as it already replaces every other content field this function carries verbatim —
    // `importPostEntity` spreads `record` over `existing` in full, so no partial merge of the two formats is
    // possible either way. `contributePostPublish`'s `precheck` no longer blocks this either (its own
    // doc has the matching removal); this is the second half of that same change.
  }
}

/**
 * Replicates ONE post/page row from another instance, preserving every content field verbatim.
 *
 * ## Why this is a third function rather than a wider `createPost`/`updatePost`
 *
 * `createPost`/`updatePost` are the AUTHORING chokepoint. They deliberately refuse to accept
 * `bodyFormat`/`bodyHtml` (SPEC-047/ADR-056 CIC-3), `seoExtJson` (SPEC-008 INV-01, owned by
 * `Jini/packages/cms/src/seo/write-service.ts`), `memberAccessJson` (ADR-030 §4) and `deletedAt` (owned by
 * `PostRepoPort.softDelete`), because an editor must not be able to reach those columns by sending
 * an extra field on a save. Publishing is not authoring: it REPLICATES a row another instance
 * already authored, through those same chokepoints, and must therefore reproduce every column or it
 * is not a publish at all.
 *
 * Widening the authoring inputs to serve this one caller would have handed every existing editor
 * call site a way through those guards. This function keeps them intact and takes a whole
 * `PostRecord` instead — the identical shape and reasoning `@jini-ai/cms/media/site/import-media-entity`
 * already uses for media (`mediaRepo.save({...record, ...})`), which is why media has never had the
 * fidelity defect this function exists to fix on the post side.
 *
 * DISCLOSED DEVIATION: this is a second writer for `posts.seo_ext_json` alongside SPEC-008 INV-01's
 * `setEntrySeoOverrides`, and the first writer for `posts.member_access_json`. It writes both as
 * OPAQUE strings, copied without interpretation from a value the source instance's own chokepoint
 * already validated — it never constructs, parses or merges either one. The alternative (refusing to
 * publish any post carrying SEO overrides or member gating) would have made the feature unusable for
 * ordinary content while still leaving member-gating loss as the failure mode for anyone who forced
 * it through.
 *
 * ## What it refuses
 *
 * Fail-closed on every remaining condition where a verbatim copy would destroy destination state in
 * a way the owner has not opted into — a resurrection of a trashed destination row, a kind change
 * (`PostKind` is fixed at creation), or a slug already held by a different row. A body-format
 * conversion (doc <-> html) is deliberately NOT in this list as of D2 (2026-09-24 owner decision,
 * publish-types-plan §6) — see the removed guard's own comment below for why publishing is now
 * allowed to replace a row across a format change, which it does wholesale, never partially.
 *
 * @complexity O(1) — a fixed, small number of repo calls; no iteration over caller-controlled
 * collections.
 */
export async function importPostEntity(required: {
  deps: ImportPostEntityDeps;
  input: ImportPostEntityInput;
}, _optional: Record<string, never> = {}): Promise<{ post: PostRecord; revisionId: string; previousRevisionId: string | null }> {
  const { deps, input } = required;
  const { workspaceId, record } = input;

  const existing = await deps.repo.findById({ workspaceId, id: record.id });

  assertImportTarget({ input, existing });

  await assertSlugAvailableForUpdate({ repo: deps.repo, workspaceId, slug: record.slug, id: record.id });

  // CIC U-004: the hook resolves (or throws) BEFORE the record is built and BEFORE the single
  // repo write below, exactly as on the authoring paths. The draft carries the INCOMING body and
  // ext, so a destination plugin filters the entry it is about to see saved, not the one it had.
  const extPatch = await runBeforeSaveHook({ hook: deps.beforeSaveHook, draft: {
    id: record.id,
    workspaceId,
    title: record.title,
    slug: record.slug,
    status: record.status,
    bodyJson: record.bodyJson,
    ext: (record.ext ?? {}) as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  } });
  const ext = mergeExt({ existingExt: record.ext, patch: extPatch });

  const { ext: _incomingExt, ...carriedOver } = record;
  const now = clockNowIso({ clock: deps.clock });
  const post: PostRecord = {
    ...carriedOver,
    workspaceId,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
    // Write-once authorship, same convention `importMediaEntity` applies to `media.createdAt`: an
    // existing row keeps its own, a brand-new row takes the source's. `repo.sqlite.ts`'s
    // `updatableColumns()` omits both columns, so the existing-row branch is also enforced
    // structurally and not only by this expression.
    createdByPrincipalId: existing ? existing.createdByPrincipalId : record.createdByPrincipalId,
    createdAt: existing ? existing.createdAt : record.createdAt,
    ...(ext !== undefined ? { ext } : {}),
  };

  const { id: revisionId, previousId: previousRevisionId } = await deps.repo.transaction({ fn: async () => {
    await persistUpdatedPost({ repo: deps.repo, post, expectedVersion: input.expectedVersion });
    const revision = await appendPostRevision({ repo: deps.repo, post, op: existing ? "update" : "create", attribution: input });
    // Same SEO/sitemap signal every other write path emits — a post that arrives already-published
    // must invalidate the destination's sitemap cache exactly like one published locally. Inside
    // the transaction (2026-10-21), so the row never commits without its event.
    await enqueueContentWrite({ outbox: deps.outbox, post, actorId: input.actorId, source: "service", operation: existing ? "saved" : "created" });
    await emitPublicTransitionEvent({ outbox: deps.outbox, previous: existing ?? null, next: post, nowIso: now, actorId: input.actorId, source: "service" });
    return revision;
  } });

  return { post, revisionId, previousRevisionId };
}
