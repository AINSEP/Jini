import type { MediaAccessEvidence } from "@jini-ai/cms/media/site/access-evidence";

import {
  type PostAutosaveSnapshot,
  type PostRecord,
  type PostRepoPort,
  type PostRevisionAppendResult,
  type PostRevisionInput,
  type PostRevisionRecord,
} from "@jini-ai/cms/posts/post";
import { comparePostsByDisplayDate, isLiveAt } from "@jini-ai/core/scheduled-publish";
import { withoutHeldAgentSchedule, type AgentHoldReader } from "@jini-ai/cms/posts/agent-hold";
import { wentLiveSinceSave, type GoLiveCandidatesPort } from "../entries/go-live.js";

/**
 * SPEC-005 (T021): `ext` needs no special handling here. Unlike `repo.sqlite.ts` — which has to
 * serialize it to a JSON text column and normalize the `{}` default back to an absent field —
 * this adapter stores and returns whole `PostRecord`s verbatim, exactly as it already does for
 * `bodyJson`, so `ext` (present or absent) round-trips unchanged.
 */

class InMemoryPostRepo implements PostRepoPort, GoLiveCandidatesPort {
  private readonly mediaAccessEvidence: MediaAccessEvidence;
  /** H4: optional because ~560 unit tests build this repo bare; without a reader nothing is held. */
  private readonly agentHold: AgentHoldReader | undefined;
  private rows: PostRecord[];
  /** Standing-draft autosave snapshots, keyed apart from `rows` — mirrors `repo.sqlite.ts`'s own
   *  `autosave_json` column being a sibling of the row rather than a `PostRecord` field (see
   *  `PostRepoPort.readAutosave`'s doc for why). */
  private autosaves = new Map<string, PostAutosaveSnapshot>();
  /** This adapter's `post_revisions` stand-in — a plain array mirrors `rows`' own storage choice
   *  (see `PostRepoPort.appendRevision`'s doc for the append-only contract both adapters share). */
  private revisions: PostRevisionRecord[] = [];

  constructor(private readonly runtime: { nowIso: () => string; newId: () => string; hashJsonText: (text: string) => string; createEvidence: () => MediaAccessEvidence }, _required: Record<string, never>, { initialRows = [], mediaAccessEvidence, agentHold }: { initialRows?: PostRecord[]; mediaAccessEvidence?: MediaAccessEvidence; agentHold?: AgentHoldReader } = {}) {
    this.rows = [...initialRows];
    this.agentHold = agentHold;
    // Optional only because ~560 unit tests build this repo bare and never read evidence; a bare repo gets its own private store (per repo, not shared state). Memory composition passes the shared one explicitly.
    this.mediaAccessEvidence = mediaAccessEvidence ?? this.runtime.createEvidence();
  }

  private autosaveKey({ workspaceId, id }: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): string {
    return `${workspaceId}:${id}`;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<PostRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id) ??
      null
    );
  }

  async findBySlug(required: { workspaceId: string; slug: string }): Promise<PostRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.slug === required.slug
      ) ?? null
    );
  }

  async list(required: { workspaceId: string }): Promise<PostRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  /** Same bounded kind-filtered contract as the SQL adapter. */
  async listHtmlByKind(required: { workspaceId: string; kind: import("@jini-ai/core/contracts/site/post-kind").PostKind; limit: number; before?: { updatedAt: string; id: string } }, _options = {}): Promise<PostRecord[]> {
    return this.rows.filter(row => row.workspaceId === required.workspaceId && row.kind === required.kind)
      .filter(row => row.bodyFormat === "html" && row.bodyHtml !== null && !row.deletedAt)
      .filter(row => !required.before || row.updatedAt < required.before.updatedAt || (row.updatedAt === required.before.updatedAt && row.id > required.before.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, required.limit);
  }

  /** See `PostRepoPort.listPublishedPreviews`'s own doc for the exact contract (bounded,
   *  `kind: "post"`-filtered, newest display date first). Filter-sort-slice here is this in-memory
   *  adapter's own stand-in for a real bounded query — `repo.sqlite.ts`'s adapter is the one that
   *  must push the equivalent `WHERE`/`ORDER BY`/`LIMIT` down to SQLite itself. */
  async listPublishedPreviews(required: { workspaceId: string; limit: number; nowIso?: string; offset?: number }): Promise<PostRecord[]> {
    const nowIso = required.nowIso ?? this.runtime.nowIso();
    const offset = required.offset ?? 0;
    const live = this.rows.filter((row) => row.workspaceId === required.workspaceId && row.kind === "post" && isLiveAt({ record: row, nowIso }));
    return (await withoutHeldAgentSchedule({ workspaceId: required.workspaceId, rows: live, agentHold: this.agentHold }))
      .sort(comparePostsByDisplayDate)
      .slice(offset, offset + required.limit);
  }

  /** See `GoLiveCandidatesPort.listGoLiveCandidates` — the in-JS twin of `repo.ts`'s query. */
  async listGoLiveCandidates(required: { workspaceId: string; nowIso: string; afterIso?: string }, _optional: Record<string, never> = {}): Promise<PostRecord[]> {
    const { workspaceId, nowIso, afterIso } = required;
    const candidates = this.rows.filter((row) => row.workspaceId === workspaceId && wentLiveSinceSave({ post: row, nowIso }) && (afterIso === undefined || (row.publishAt as string) > afterIso));
    return (await withoutHeldAgentSchedule({ workspaceId, rows: candidates, agentHold: this.agentHold }))
      // Fixed-width ISO first, so the concatenation orders by go-live time, then `id` — the SQL order.
      .sort((a, b) => (`${a.publishAt}${a.id}` < `${b.publishAt}${b.id}` ? -1 : 1));
  }

  async save(record: PostRecord): Promise<void> {
    this.mediaAccessEvidence.invalidate({ owner: this });
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index === -1) {
      this.rows.push(record);
      return;
    }

    this.rows[index] = record;
  }

  /** See `PostRepoPort.saveIfVersion`'s own doc for the contract this mirrors from
   *  `repo.sqlite.ts`'s conditional `UPDATE`. Deliberately NOT a fall-through to `save()`: a row
   *  that is absent or has moved past `ifVersion` reports `applied: false` and writes nothing at
   *  all — no insert, no partial update, no version bump. The workspace is part of the match here
   *  (unlike `save()` above, which keys on `id` alone) because the SQLite predicate includes it,
   *  and an adapter pair that disagrees on what "the same row" means is how a guard passes its
   *  in-memory tests and fails in production. */
  async saveIfVersion(required: {
    record: PostRecord;
    ifVersion: number;
  }): Promise<{ applied: boolean }> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === required.record.workspaceId && row.id === required.record.id
    );
    if (index === -1 || this.rows[index]?.version !== required.ifVersion) return { applied: false };

    this.rows[index] = required.record;
    this.mediaAccessEvidence.invalidate({ owner: this });
    return { applied: true };
  }

  /**
   * Stamps the trash marker (see `post.ts`'s `PostRecord.deletedAt`). The row is KEPT — that is the
   * whole point of a soft delete — so this is a field update on the existing record, never a splice
   * out of `rows`. A row this adapter dropped could not be restored by `postDeleteReverter`, and
   * `findBySlug` would stop reserving its slug, which `repo.sqlite.ts`'s real unique index would
   * then reject at insert time. Both adapters must behave identically here.
   */
  async softDelete(required: {
    workspaceId: string;
    id: string;
    deletedAt: string;
    updatedAt: string;
    version: number;
  }): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === required.workspaceId && row.id === required.id
    );
    const row = this.rows[index];
    if (row === undefined) return;

    this.mediaAccessEvidence.invalidate({ owner: this });
    this.rows[index] = {
      ...row,
      deletedAt: required.deletedAt,
      updatedAt: required.updatedAt,
      version: required.version,
    };
  }

  /**
   * See `PostRepoPort.hardDelete`'s own doc. Splices the row out of `rows` AND drops its revisions
   * and its parked autosave — the three places this adapter keeps a post's content. Dropping only
   * the row would leave `listRevisions` serving full copies of every version of something the
   * caller was told is permanently gone, which is exactly what the SQLite adapter's cascade exists
   * to prevent; both adapters must behave identically here.
   *
   * @complexity O(n + r) over the rows and revisions this adapter holds.
   */
  async hardDelete(required: { workspaceId: string; id: string }): Promise<void> {
    this.mediaAccessEvidence.invalidate({ owner: this });
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
    this.revisions = this.revisions.filter(
      (revision) => !(revision.workspaceId === required.workspaceId && revision.postId === required.id)
    );
    this.autosaves.delete(this.autosaveKey({ workspaceId: required.workspaceId, id: required.id }));
  }

  /** See `PostRepoPort.readAutosave`'s own doc. */
  async readAutosave(required: { workspaceId: string; id: string }): Promise<PostAutosaveSnapshot | null> {
    return this.autosaves.get(this.autosaveKey({ workspaceId: required.workspaceId, id: required.id })) ?? null;
  }

  /** See `PostRepoPort.writeAutosave`'s own doc for the staleness contract this mirrors from
   *  `repo.sqlite.ts`'s conditional `UPDATE`: a missing row or a `version` that has moved past
   *  `snapshot.baseVersion` both report `applied: false` without touching the parked snapshot. */
  async writeAutosave(required: {
    workspaceId: string;
    id: string;
    snapshot: PostAutosaveSnapshot;
  }): Promise<{ applied: boolean }> {
    const row = await this.findById(required);
    if (!row || row.version !== required.snapshot.baseVersion) return { applied: false };
    this.autosaves.set(this.autosaveKey({ workspaceId: required.workspaceId, id: required.id }), required.snapshot);
    return { applied: true };
  }

  /** See `PostRepoPort.clearAutosave`'s own doc — unconditional, no version guard. */
  async clearAutosave(required: { workspaceId: string; id: string }): Promise<void> {
    this.autosaves.delete(this.autosaveKey({ workspaceId: required.workspaceId, id: required.id }));
  }

  /** See `PostRepoPort.appendRevision`'s own doc. Mirrors `repo.sqlite.ts`'s adapter exactly:
   *  `previousId` is the latest existing row for this `(workspaceId, postId)` found BEFORE the new
   *  row is pushed, and `contentHash` is computed here so both adapters apply the identical rule. */
  async appendRevision(input: PostRevisionInput): Promise<PostRevisionAppendResult> {
    const priorForPost = this.revisions.filter(
      (row) => row.workspaceId === input.workspaceId && row.postId === input.postId
    );
    const previousId = priorForPost.at(-1)?.id ?? null;

    const id = this.runtime.newId();
    const contentHash = this.runtime.hashJsonText(JSON.stringify(input.stateJson));

    this.revisions.push({
      id,
      postId: input.postId,
      workspaceId: input.workspaceId,
      seq: input.seq,
      op: input.op,
      stateJson: input.stateJson,
      contentHash,
      actorId: input.actorId,
      delegatedByWorkspaceId: input.delegatedByWorkspaceId ?? null,
      delegatedById: input.delegatedById ?? null,
      restoredFrom: input.restoredFrom ?? null,
      recordedAt: input.recordedAt,
    });

    return { id, previousId };
  }

  /** See `PostRepoPort.listRevisions`'s own doc — ascending `seq`, matching `repo.sqlite.ts`'s
   *  `ORDER BY seq ASC`. */
  async listRevisions(required: { workspaceId: string; postId: string }): Promise<PostRevisionRecord[]> {
    return this.revisions
      .filter((row) => row.workspaceId === required.workspaceId && row.postId === required.postId)
      .slice()
      .sort((a, b) => a.seq - b.seq);
  }

  /**
   * See `PostRepoPort.transaction`'s own doc for why this exists. No real SQL connection backs
   * this adapter, so "atomic" here means snapshot-and-restore: `rows`/`revisions`/`autosaves` are
   * captured before `fn` runs, and restored verbatim if it throws — safe because JavaScript has no
   * real concurrent access to these arrays between the snapshot and the restore (single-threaded,
   * no I/O yields a competing writer could land in).
   */
  async transaction<T>({ fn }: { fn: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
    const rowsSnapshot = [...this.rows];
    const revisionsSnapshot = [...this.revisions];
    const autosavesSnapshot = new Map(this.autosaves);
    try {
      return await fn();
    } catch (error) {
      this.rows = rowsSnapshot;
      this.revisions = revisionsSnapshot;
      this.autosaves = autosavesSnapshot;
      throw error;
    } finally {
      this.mediaAccessEvidence.invalidate({ owner: this });
    }
  }
}

export function bindInMemoryPostRepo(required: ConstructorParameters<typeof InMemoryPostRepo>[0], _optional: Record<string, never> = {}): new (required: Record<string, never>, optional?: ConstructorParameters<typeof InMemoryPostRepo>[2]) => InMemoryPostRepo {
  return class extends InMemoryPostRepo {
    constructor(input: Record<string, never>, optional: ConstructorParameters<typeof InMemoryPostRepo>[2] = {}) {
      super(required, input, optional);
    }
  };
}
