import type { StorageKernel } from "@jini-ai/db/kernel";
import { decodeKeysetCursor, encodeKeysetCursor } from "../../core/keyset-cursor.js";
import type { CommentRepoPort } from "../ports.js";
import { type CommentTables, type ModerationLogTables, toLogEntry, toLogRow, toRecord, toRow } from "./repo.rows.js";
import type { CommentRecord, CommentStatus, CommentThreadNode, ModerationAction, ModerationLogEntry, ModerationQueuePage } from "../types.js";

/**
 * @file THE comments repository: one Kysely query body for every database the storage kernel
 * drives, over the host's comments tables declared through dataModule (ADR-023 §2/§7). Those tables are not in
 * the migrated core schema, so each query starts from `db.withTables<CommentTables>()`.
 *
 * Every statement goes through `kernel.run` and is awaited. A write that spans the comment row and
 * its moderation-log row runs in `kernel.transaction`, and a read-then-write (moderate, purge)
 * takes `lockKey` on the comment first so two moderators cannot interleave on Postgres.
 */

const buildThread = (comments: readonly CommentRecord[], parentId: string | null): CommentThreadNode[] =>
  comments
    .filter((c) => c.parentId === parentId)
    .map((comment) => ({ comment, replies: buildThread(comments, comment.id) }));

/** Host-supplied identifiers, quoted by Kysely; no product table defaults. */
export interface CommentSqlTables { comments: string; moderationLog: string }
export interface CommentSqlRequired { kernel: StorageKernel<unknown>; tables: CommentSqlTables }

export class SqlCommentRepo implements CommentRepoPort {
  protected readonly kernel: StorageKernel<unknown>;
  protected readonly tables: CommentSqlTables;

  /** Binds a storage kernel to the host's comments tables; neither table name has a default. */
  constructor({ kernel, tables }: CommentSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  async findById(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<CommentRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<CommentTables>()
        .selectFrom(this.tables.comments)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .executeTakeFirst()
    );
    return row ? toRecord(row) : null;
  }

  async listThreadForEntry(required: {
    workspaceId: string;
    entryId: string;
    includeStatuses?: readonly CommentStatus[];
  }, _optional: Record<string, never> = {}): Promise<CommentThreadNode[]> {
    const statuses = [...(required.includeStatuses ?? ["approved"])];
    if (statuses.length === 0) return [];
    const rows = await this.kernel.run((db) =>
      db
        .withTables<CommentTables>()
        .selectFrom(this.tables.comments)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("entry_id", "=", required.entryId)
        .where("status", "in", statuses)
        .orderBy("created_at", "asc")
        .execute()
    );
    return buildThread(rows.map((row) => toRecord(row)), null);
  }

  /** Keyset page over `(created_at, id)`, fetching `limit + 1` rows to learn whether more follow.
   *  The cursor carries the last row's `(createdAt, id)` itself (`platform/db/keyset-cursor.ts`), so
   *  a page resumes after that row even when it has since been moderated out of the queue or purged.
   *  @throws {ToolInputError} `invalid cursor` when the cursor is malformed: it used to read as
   *  "no cursor" and silently restart at page 1. */
  async listModerationQueue(required: {
    workspaceId: string;
    status: CommentStatus;
    limit: number;
    cursor?: string | null;
  }, _optional: Record<string, never> = {}): Promise<ModerationQueuePage> {
    const marker = required.cursor ? decodeKeysetCursor({ cursor: required.cursor }) : undefined;
    const rows = await this.kernel.run(async (db) => {
      let query = db
        .withTables<CommentTables>()
        .selectFrom(this.tables.comments)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("status", "=", required.status);
      if (marker) {
        // `(created_at, id) > (?, ?)` spelled out, so no dialect's row-value support is assumed.
        query = query.where((eb) =>
          eb.or([
            eb("created_at", ">", marker.createdAt),
            eb.and([eb("created_at", "=", marker.createdAt), eb("id", ">", marker.id)]),
          ])
        );
      }
      return query.orderBy("created_at", "asc").orderBy("id", "asc").limit(required.limit + 1).execute();
    });

    const hasMore = rows.length > required.limit;
    const page = rows.slice(0, required.limit).map((row) => toRecord(row));
    const last = page[page.length - 1];
    return { items: page, nextCursor: hasMore && last ? encodeKeysetCursor(last) : null };
  }

  async countByStatus(required: { workspaceId: string; entryId?: string; status: CommentStatus }, _optional: Record<string, never> = {}): Promise<number> {
    const row = await this.kernel.run((db) => {
      let query = db
        .withTables<CommentTables>()
        .selectFrom(this.tables.comments)
        .select((eb) => eb.fn.countAll().as("n"))
        .where("workspace_id", "=", required.workspaceId)
        .where("status", "=", required.status);
      if (required.entryId !== undefined) query = query.where("entry_id", "=", required.entryId);
      return query.executeTakeFirst();
    });
    // Postgres returns a COUNT as a bigint string.
    return Number(row?.n ?? 0);
  }

  /** OQ-3 (SPEC-035): the comment and its `submit` log row land as ONE atomic transaction.
   * Storage errors propagate; with a log, either both inserts commit or neither does.
   * @complexity O(1) queries and application space; storage costs depend on the kernel.
   * @example repo.create({ record }, { submitLog })
   */
  async create({ record }: { record: CommentRecord }, { submitLog }: { submitLog?: ModerationLogEntry } = {}): Promise<void> {
    const insertComment = () =>
      this.kernel.run((db) => db.withTables<CommentTables>().insertInto(this.tables.comments).values(toRow(record)).execute());
    if (!submitLog) {
      await insertComment();
      return;
    }
    await this.kernel.transaction(async () => {
      await insertComment();
      await this.kernel.run((db) =>
        db.withTables<ModerationLogTables>().insertInto(this.tables.moderationLog).values(toLogRow(submitLog)).execute()
      );
    });
  }

  async listModerationLog(required: { workspaceId: string; commentId: string }, _optional: Record<string, never> = {}): Promise<ModerationLogEntry[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<ModerationLogTables>()
        .selectFrom(this.tables.moderationLog)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("comment_id", "=", required.commentId)
        .orderBy("at", "asc")
        .orderBy("id", "asc")
        .execute()
    );
    return rows.map((row) => toLogEntry(row));
  }

  async applyModeration(required: {
    workspaceId: string;
    id: string;
    expectedVersion: number;
    action: ModerationAction;
    toStatus: CommentStatus;
    actorPrincipalId: string;
    note: string | null;
    at: string;
  }, _optional: Record<string, never> = {}): ReturnType<CommentRepoPort["applyModeration"]> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(`comments:${required.workspaceId}:${required.id}`);
      const current = await this.findById({ workspaceId: required.workspaceId, id: required.id });
      if (!current) return { ok: false, reason: "not-found" } as const;
      if (current.version !== required.expectedVersion) {
        return { ok: false, reason: "conflict", currentVersion: current.version } as const;
      }

      const logId = `${required.id}-${required.at}-${current.version + 1}`;
      const updated = await this.kernel.run((db) =>
        db
          .withTables<CommentTables>()
          .updateTable(this.tables.comments)
          .set((eb) => ({ status: required.toStatus, updated_at: required.at, version: eb("version", "+", 1) }))
          .where("workspace_id", "=", required.workspaceId)
          .where("id", "=", required.id)
          .where("version", "=", required.expectedVersion)
          .returning("id")
          .execute()
      );
      if (updated.length === 0) {
        const latest = await this.findById({ workspaceId: required.workspaceId, id: required.id });
        return { ok: false, reason: "conflict", currentVersion: latest?.version } as const;
      }

      const log: ModerationLogEntry = {
        id: logId,
        workspaceId: required.workspaceId,
        commentId: required.id,
        actorPrincipalId: required.actorPrincipalId,
        action: required.action,
        fromStatus: current.status,
        toStatus: required.toStatus,
        at: required.at,
        note: required.note,
      };
      await this.kernel.run((db) => db.withTables<ModerationLogTables>().insertInto(this.tables.moderationLog).values(toLogRow(log)).execute());
      const record = await this.findById({ workspaceId: required.workspaceId, id: required.id });
      return { ok: true, record: record!, log } as const;
    });
  }

  async purge(required: {
    workspaceId: string;
    id: string;
    actorPrincipalId: string;
    note: string | null;
    at: string;
  }, _optional: Record<string, never> = {}): ReturnType<CommentRepoPort["purge"]> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(`comments:${required.workspaceId}:${required.id}`);
      const current = await this.findById({ workspaceId: required.workspaceId, id: required.id });
      if (!current) return { ok: false, reason: "not-found" } as const;

      const log: ModerationLogEntry = {
        id: `${required.id}-${required.at}-purge`,
        workspaceId: required.workspaceId,
        commentId: required.id,
        actorPrincipalId: required.actorPrincipalId,
        action: "purge",
        fromStatus: current.status,
        toStatus: current.status,
        at: required.at,
        note: required.note,
      };
      await this.kernel.run((db) =>
        db
          .withTables<CommentTables>()
          .deleteFrom(this.tables.comments)
          .where("workspace_id", "=", required.workspaceId)
          .where("id", "=", required.id)
          .execute()
      );
      await this.kernel.run((db) => db.withTables<ModerationLogTables>().insertInto(this.tables.moderationLog).values(toLogRow(log)).execute());
      return { ok: true, log } as const;
    });
  }
}

/** The comments repo for `kernel`. */
export function commentRepoFor(required: CommentSqlRequired, optional: Record<string, never> = {}): SqlCommentRepo {
  return new SqlCommentRepo(required, optional);
}
