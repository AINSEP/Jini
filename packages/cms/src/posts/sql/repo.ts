import type { MediaAccessEvidence } from "@jini-ai/cms/media/site/access-evidence";

import { sql } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";

type ContentKernel = StorageKernel<Kysely<unknown>, unknown>;
import type { PostAutosaveSnapshot, PostRecord, PostRepoPort, PostRevisionAppendResult, PostRevisionInput, PostRevisionRecord } from "@jini-ai/cms/posts/post";
import type { GoLiveCandidatesPort } from "@jini-ai/cms/entries";
import { toRecord, toRevisionRecord, toRevisionRow, toRow, updatableColumns, type PostTables } from "./repo.rows.js";
import { toPostSearchDocument } from "@jini-ai/cms/posts/search";
import { postSearchFor } from "./search-index.js";
import type { PostSearchKernel, PostSearchProjection } from "./search-index.contract.js";

/**
 * @file THE post repository: one Kysely query body for every database the storage kernel drives
 * (SQLite, PGlite, Postgres). The reference conversion every later repo copies — storage-adapter
 * plan §4, ADR-066.
 *
 * Every statement goes through `kernel.run` and is awaited; a method that writes more than one
 * statement (or reads then writes) runs in `kernel.transaction`, which joins the caller's own
 * transaction when there is one. Row mapping lives in `repo.rows.ts`; the one genuinely
 * dialect-specific piece — the search projection — is a {@link PostSearchProjection} adapter.
 *
 * SEARCH INDEX: `save()` — and only `save()` — also refreshes this post's searchable projection.
 * That is the whole sync obligation, because `title`/`slug`/`bodyJson` are the only indexed values
 * and this is their only writer. `softDelete()` deliberately does NOT touch it; a trashed post is
 * excluded by the search query's own `deleted_at IS NULL` filter against the live row, which is also
 * what makes a later restore searchable again with no extra step. See `@jini-ai/cms/posts/sql`'s `search-index.ts`.
 */


/**
 * H4 (owner decision 11-23): the agent-pause hold keeps an AGENT-created post that is scheduled for a
 * moment after the pause began from going live, until the owner approves the resume card (which
 * deletes the `agent_pause_holds` row — `agent-pause-gate.ts`). Read from the hold row itself so
 * every public read sees the same truth without each caller awaiting the gate. Posts that were
 * live before the pause and unscheduled agent posts are untouched: the switch pauses future
 * publishes, it does not unpublish. `EXISTS` is never NULL, so a NULL `publish_at` cannot drop a row.
 */
const notHeldAgentSchedule = sql<boolean>`NOT (posts.created_by_kind = 'agent' AND EXISTS (SELECT 1 FROM agent_pause_holds h WHERE h.workspace_id = posts.workspace_id AND posts.publish_at > h.held_since))`;

/** Host-supplied clock, id, hashing and lock-key policy. Named (not `SqlPostRepo["runtime"]`) because a
 * private member's type is erased from the emitted declarations, which left host callbacks untyped. */
export interface SqlPostRepoRuntime {
  nowIso: () => string; newId: () => string; hashJsonText: (text: string) => string;
  postRevisionLockKey: (scope: { workspaceId: string; postId: string }) => string;
}

export class SqlPostRepo implements PostRepoPort, GoLiveCandidatesPort {
  protected readonly kernel: ContentKernel;
  private readonly search: PostSearchProjection;
  /** The process-wide evidence store the composition root also hands the media-rendition reader; every write below clears the entries linked to this repo. */
  private readonly mediaAccessEvidence: MediaAccessEvidence;
  /** The same kernel, schema erased, for the Jini search adapters. */
  private readonly searchKernel: ContentKernel;
  private readonly runtime: SqlPostRepoRuntime;
  constructor(required: { kernel: ContentKernel; search: PostSearchProjection; mediaAccessEvidence: MediaAccessEvidence } & SqlPostRepoRuntime, _optional: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.mediaAccessEvidence = required.mediaAccessEvidence;
    this.search = required.search;
    this.searchKernel = required.kernel;
    this.runtime = required;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<PostRecord | null> {
    const row = await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .selectFrom("posts")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toRecord({ row }) : null;
  }

  async findBySlug(required: { workspaceId: string; slug: string }): Promise<PostRecord | null> {
    const row = await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .selectFrom("posts")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("slug", "=", required.slug)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toRecord({ row }) : null;
  }

  async list(required: { workspaceId: string }): Promise<PostRecord[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<PostTables>().selectFrom("posts").selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map(row => toRecord({ row }));
  }

  /** See PostRepoPort.listHtmlByKind: filter before loading any body and bound the result. */
  async listHtmlByKind(required: { workspaceId: string; kind: import("@jini-ai/core/contracts/site/post-kind").PostKind; limit: number; before?: { updatedAt: string; id: string } }, _options = {}): Promise<PostRecord[]> {
    const before = required.before;
    const rows = await this.kernel.run(db => db.withTables<PostTables>().selectFrom("posts").selectAll()
      .where("workspace_id", "=", required.workspaceId).where("kind", "=", required.kind)
      .where("body_format", "=", "html").where("body_html", "is not", null).where("deleted_at", "is", null)
      .$if(before !== undefined, qb => {
        if (before === undefined) throw new Error("Post pagination has no cursor");
        return qb.where(eb => eb.or([
          eb("updated_at", "<", before.updatedAt),
          eb.and([eb("updated_at", "=", before.updatedAt), eb("id", ">", before.id)]),
        ]));
      })
      .orderBy("updated_at", "desc").orderBy("id", "asc").limit(required.limit).execute());
    return rows.map(row => toRecord({ row }));
  }

  /** See `PostRepoPort.listPublishedPreviews`'s own doc for the exact contract. Every filter
   *  (workspace, `status`, `kind`, non-trashed) and the `LIMIT` are pushed into the ONE query — no
   *  in-JS filter or slice after the fact, the discipline that method's doc requires. */
  async listPublishedPreviews(required: { workspaceId: string; limit: number; nowIso?: string; offset?: number }): Promise<PostRecord[]> {
    const nowIso = required.nowIso ?? this.runtime.nowIso();
    const rows = await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .selectFrom("posts")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("status", "=", "published")
        .where("kind", "=", "post")
        .where("deleted_at", "is", null)
        // Scheduled publishing: same rule as `isLiveAt` — ISO UTC strings compare in time order.
        .where((eb) => eb.or([eb("publish_at", "is", null), eb("publish_at", "<=", nowIso)]))
        .where(notHeldAgentSchedule)
        // Display-date order (`postDisplayDateIso`): go-live time when set, else `updated_at`; `id`
        // breaks ties so OFFSET batches never repeat or skip a row.
        .orderBy(sql`coalesce(publish_at, updated_at)`, "desc")
        .orderBy("id", "asc")
        .limit(required.limit)
        .offset(required.offset ?? 0)
        .execute()
    );
    return rows.map(row => toRecord({ row }));
  }

  /** See `GoLiveCandidatesPort.listGoLiveCandidates`. Every predicate is in the query: ISO UTC
   *  strings compare in time order (`scheduled-publish.ts`), so `publish_at > updated_at` is "saved
   *  while still scheduled". Ordered by go-live time, `id` breaking ties. */
  async listGoLiveCandidates(required: { workspaceId: string; nowIso: string; afterIso?: string }, _optional: Record<string, never> = {}): Promise<PostRecord[]> {
    const { workspaceId, nowIso, afterIso } = required;
    const rows = await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .selectFrom("posts")
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .where("status", "=", "published")
        .where("deleted_at", "is", null)
        .where("publish_at", "<=", nowIso)
        .where((eb) => eb("publish_at", ">", eb.ref("updated_at")))
        .where(notHeldAgentSchedule)
        .$if(afterIso !== undefined, (qb) => qb.where("publish_at", ">", afterIso as string))
        .orderBy("publish_at", "asc")
        .orderBy("id", "asc")
        .execute()
    );
    return rows.map(row => toRecord({ row }));
  }

  /** Upsert plus the search projection, in one transaction. The projection is refreshed here rather
   *  than by a trigger on `posts`, because the indexed body is plain text walked out of a nested
   *  TipTap document — an extraction SQL has no business attempting. */
  async save(record: PostRecord): Promise<void> {
    const row = toRow({ record });
    await this.kernel.transaction(async () => {
      await this.kernel.run((db) =>
        db.withTables<PostTables>()
          .insertInto("posts")
          .values(row)
          .onConflict((oc) => oc.column("id").doUpdateSet(updatableColumns({ row })))
          .execute()
      );
      await this.search.upsert({ kernel: this.searchKernel, document: toPostSearchDocument(record) });
    });
    this.mediaAccessEvidence.invalidate({ owner: this });
  }

  /**
   * See `PostRepoPort.saveIfVersion`'s own doc for the contract. An `UPDATE … WHERE id = ? AND
   * workspace_id = ? AND version = ?` — never the upsert `save()` above uses, because an absent row
   * must report `applied: false` rather than be inserted. The predicate and the write are ONE
   * statement (fable bugs audit C01); `RETURNING` reports whether it landed, the same on every
   * driver. The search projection is refreshed only on a write that actually landed.
   *
   * @complexity O(1) — one statement against the `posts` primary key.
   */
  async saveIfVersion(required: { record: PostRecord; ifVersion: number }): Promise<{ applied: boolean }> {
    const row = toRow({ record: required.record });
    const result = await this.kernel.transaction(async () => {
      const updated = await this.kernel.run((db) =>
        db.withTables<PostTables>()
          .updateTable("posts")
          .set(updatableColumns({ row }))
          .where("id", "=", row.id)
          .where("workspace_id", "=", row.workspace_id)
          .where("version", "=", required.ifVersion)
          .returning("id")
          .execute()
      );
      if (updated.length === 0) return { applied: false };
      await this.search.upsert({ kernel: this.searchKernel, document: toPostSearchDocument(required.record) });
      return { applied: true };
    });
    if (result.applied) this.mediaAccessEvidence.invalidate({ owner: this });
    return result;
  }

  /**
   * Stamps the trash marker (see `post.ts`'s `PostRecord.deletedAt`) — an UPDATE of three columns,
   * never a `DELETE FROM`. The row survives so `postDeleteReverter` has a pre-image to restore and
   * so `posts_workspace_slug_unique` keeps reserving the trashed row's slug.
   */
  async softDelete(required: {
    workspaceId: string;
    id: string;
    deletedAt: string;
    updatedAt: string;
    version: number;
  }): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .updateTable("posts")
        .set({ deleted_at: required.deletedAt, updated_at: required.updatedAt, version: required.version })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .execute()
    );
    this.mediaAccessEvidence.invalidate({ owner: this });
  }

  /**
   * See `PostRepoPort.hardDelete`'s own doc. A real `DELETE FROM`, with the SAME cascade the Trash
   * purge already performs on this table (`features/trash/adapters/post.ts`): `post_revisions`
   * holds a full copy of every version of the post, and the search projection would keep the
   * content findable after the row it belongs to is gone. An unknown id or another workspace's row
   * matches nothing: a no-op.
   *
   * @complexity O(r) for r revisions of the one post, plus one indexed row delete on each table.
   */
  async hardDelete(required: { workspaceId: string; id: string }): Promise<void> {
    await this.kernel.transaction(async () => {
      await this.kernel.run((db) =>
        db.withTables<PostTables>()
          .deleteFrom("post_revisions")
          .where("workspace_id", "=", required.workspaceId)
          .where("post_id", "=", required.id)
          .execute()
      );
      const removed = await this.kernel.run((db) =>
        db.withTables<PostTables>()
          .deleteFrom("posts")
          .where("workspace_id", "=", required.workspaceId)
          .where("id", "=", required.id)
          .returning("id")
          .execute()
      );
      // Keyed on the post id alone (no workspace column on the projection), so it is dropped only
      // when the scoped delete above actually removed the row it projects.
      if (removed.length > 0) await this.search.remove({ kernel: this.searchKernel, postId: required.id });
    });
    this.mediaAccessEvidence.invalidate({ owner: this });
  }

  /** See `PostRepoPort.readAutosave`'s own doc. `autosave_json` is the only column read — never
   *  routed through `toRecord`, which has no field for it. */
  async readAutosave(required: { workspaceId: string; id: string }): Promise<PostAutosaveSnapshot | null> {
    const row = await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .selectFrom("posts")
        .select("autosave_json")
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .executeTakeFirst()
    );
    const raw = row?.autosave_json;
    return raw ? (JSON.parse(raw) as PostAutosaveSnapshot) : null;
  }

  /**
   * See `PostRepoPort.writeAutosave`'s own doc for the staleness contract. The `version =
   * snapshot.baseVersion` clause IS the whole guard: a mismatch matches zero rows and this reports
   * `applied: false`. One `UPDATE`, no separate read-then-compare.
   */
  async writeAutosave(required: {
    workspaceId: string;
    id: string;
    snapshot: PostAutosaveSnapshot;
  }): Promise<{ applied: boolean }> {
    const updated = await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .updateTable("posts")
        .set({ autosave_json: JSON.stringify(required.snapshot) })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .where("version", "=", required.snapshot.baseVersion)
        .returning("id")
        .execute()
    );
    return { applied: updated.length > 0 };
  }

  /** See `PostRepoPort.clearAutosave`'s own doc — unconditional, no version guard. */
  async clearAutosave(required: { workspaceId: string; id: string }): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .updateTable("posts")
        .set({ autosave_json: null })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .execute()
    );
  }

  /**
   * See `PostRepoPort.appendRevision`'s own doc for the append-only contract. `previousId` is the
   * latest existing row for this `(workspaceId, postId)` (by `seq DESC`), read BEFORE the insert.
   *
   * No other append may land between that read and the insert. A transaction alone does not
   * guarantee it on Postgres (READ COMMITTED: two appends can read the same latest row), so the
   * transaction first takes `lockKey` on the post's revision stream: a concurrent append for the
   * same post waits for this commit and then reads this row as its previous. (SQLite: the
   * transaction's `BEGIN IMMEDIATE` already serializes writers.) Proven with two connections in
   * `__tests__/repo.postgres.test.ts`.
   *
   * @complexity O(1) — one indexed lookup plus one insert.
   */
  async appendRevision(input: PostRevisionInput): Promise<PostRevisionAppendResult> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(this.runtime.postRevisionLockKey({ workspaceId: input.workspaceId, postId: input.postId }));
      const prior = await this.kernel.run((db) =>
        db.withTables<PostTables>()
          .selectFrom("post_revisions")
          .select("id")
          .where("workspace_id", "=", input.workspaceId)
          .where("post_id", "=", input.postId)
          .orderBy("seq", "desc")
          .limit(1)
          .executeTakeFirst()
      );
      const id = this.runtime.newId();
      await this.kernel.run((db) => db.withTables<PostTables>().insertInto("post_revisions").values(toRevisionRow({ input, id, hashJsonText: this.runtime.hashJsonText })).execute());
      return { id, previousId: prior?.id ?? null };
    });
  }

  /** See `PostRepoPort.listRevisions`'s own doc — the only read surface over `appendRevision`'s
   *  writes. Ascending `seq` (oldest first), matching a ledger's natural read order. */
  async listRevisions(required: { workspaceId: string; postId: string }): Promise<PostRevisionRecord[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<PostTables>()
        .selectFrom("post_revisions")
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("post_id", "=", required.postId)
        .orderBy("seq", "asc")
        .execute()
    );
    return rows.map(row => toRevisionRecord({ row }));
  }

  /** See `PostRepoPort.transaction`'s own doc: repo calls made inside `fn` join ONE transaction
   *  (the post write, then `appendRevision`). Nested calls join the outer one. */
  async transaction<T>({ fn }: { fn: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
    try { return await this.kernel.transaction(fn); }
    finally { this.mediaAccessEvidence.invalidate({ owner: this }); }
  }
}

/** The post repo for `kernel`, with its dialect's search projection. */
export function bindPostRepoFor<TRawKernel>(required: Omit<ConstructorParameters<typeof SqlPostRepo>[0], "kernel" | "search" | "mediaAccessEvidence"> & {
  searchHost: Parameters<typeof postSearchFor>[1];
  eraseKernel(required: { store: TRawKernel }, optional: Record<string, never>): PostSearchKernel;
}, _optional: Record<string, never> = {}) {
  return ({ kernel, mediaAccessEvidence }: { kernel: TRawKernel; mediaAccessEvidence: MediaAccessEvidence }, _optional: Record<string, never> = {}): SqlPostRepo => {
    const erased = required.eraseKernel({ store: kernel }, {});
    return new SqlPostRepo({ ...required, kernel: erased, mediaAccessEvidence, search: postSearchFor(erased, required.searchHost) });
  };
}
