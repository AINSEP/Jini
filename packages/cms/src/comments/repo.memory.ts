/**
 * @file In-memory `CommentRepoPort` adapter (ADR-006 rule-of-two "test/dev" half;
 * `repo.sqlite.ts` is the durable half).
 */
import { decodeKeysetCursor, encodeKeysetCursor } from "../core/keyset-cursor.js";

import type { CommentRepoPort } from "./ports.js";
import type { CommentRecord, CommentStatus, CommentThreadNode, ModerationLogEntry, ModerationQueuePage } from "./types.js";

function buildThread(comments: readonly CommentRecord[], parentId: string | null): CommentThreadNode[] {
  return comments
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((comment) => ({ comment, replies: buildThread(comments, comment.id) }));
}

export class InMemoryCommentRepo implements CommentRepoPort {
  private comments: CommentRecord[];
  private log: ModerationLogEntry[];

  constructor(
    { initialComments = [], initialLog = [] }: { initialComments?: CommentRecord[]; initialLog?: ModerationLogEntry[] } = {},
    _optional: Record<string, never> = {},
  ) {
    this.comments = [...initialComments];
    this.log = [...initialLog];
  }

  async findById(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<CommentRecord | null> {
    return this.comments.find((c) => c.workspaceId === required.workspaceId && c.id === required.id) ?? null;
  }

  /**
   * Direct upsert of one row. NOT on {@link CommentRepoPort} — the durable half flips its marker
   * with column SQL and needs no such method. This exists so the hermetic composition root can
   * drive a record-store `TrashAdapter` over this double (`server/runtime/composition/app.ts`), the
   * same way the in-memory redirect repo's `insertRedirect` is used there.
   *
   * @complexity O(n) over the held rows.
   */
  async save(record: CommentRecord, _optional: Record<string, never> = {}): Promise<void> {
    const index = this.comments.findIndex((c) => c.workspaceId === record.workspaceId && c.id === record.id);
    if (index === -1) this.comments.push(record);
    else this.comments[index] = record;
  }

  async listThreadForEntry(required: {
    workspaceId: string;
    entryId: string;
    includeStatuses?: readonly CommentStatus[];
  }, _optional: Record<string, never> = {}): Promise<CommentThreadNode[]> {
    const statuses = required.includeStatuses ?? ["approved"];
    const scoped = this.comments.filter(
      (c) => c.workspaceId === required.workspaceId && c.entryId === required.entryId && statuses.includes(c.status)
    );
    return buildThread(scoped, null);
  }

  async listModerationQueue(required: {
    workspaceId: string;
    status: CommentStatus;
    limit: number;
    cursor?: string | null;
  }, _optional: Record<string, never> = {}): Promise<ModerationQueuePage> {
    const scoped = this.comments
      .filter((c) => c.workspaceId === required.workspaceId && c.status === required.status)
      .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));

    // Same keyset contract as `repo.ts`: the cursor carries the last row's position itself, so the
    // page resumes after it even if that comment has since left this status or been purged, and a
    // malformed cursor is refused.
    const marker = required.cursor ? decodeKeysetCursor({ cursor: required.cursor }) : undefined;
    const startIndex = marker
      ? scoped.filter((c) => c.createdAt < marker.createdAt || (c.createdAt === marker.createdAt && c.id.localeCompare(marker.id) <= 0)).length
      : 0;
    const page = scoped.slice(startIndex, startIndex + required.limit);
    const last = page[page.length - 1];
    const nextCursor = startIndex + required.limit < scoped.length && last ? encodeKeysetCursor(last) : null;
    return { items: page, nextCursor };
  }

  async countByStatus(required: { workspaceId: string; entryId?: string; status: CommentStatus }, _optional: Record<string, never> = {}): Promise<number> {
    return this.comments.filter(
      (c) => c.workspaceId === required.workspaceId && c.status === required.status && (required.entryId === undefined || c.entryId === required.entryId)
    ).length;
  }

  /** Copies the comment and optional audit row synchronously so they appear atomically.
   * @complexity O(1) time and space for fixed-shape rows.
   * @example repo.create({ record }, { submitLog })
   */
  async create({ record }: { record: CommentRecord }, { submitLog }: { submitLog?: ModerationLogEntry } = {}): Promise<void> {
    this.comments.push({ ...record });
    if (submitLog) this.log.push({ ...submitLog });
  }

  async listModerationLog(required: { workspaceId: string; commentId: string }, _optional: Record<string, never> = {}): Promise<ModerationLogEntry[]> {
    return this.log
      .filter((entry) => entry.workspaceId === required.workspaceId && entry.commentId === required.commentId)
      .sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));
  }

  async applyModeration(required: {
    workspaceId: string;
    id: string;
    expectedVersion: number;
    action: ModerationLogEntry["action"];
    toStatus: CommentStatus;
    actorPrincipalId: string;
    note: string | null;
    at: string;
  }, _optional: Record<string, never> = {}): ReturnType<CommentRepoPort["applyModeration"]> {
    const index = this.comments.findIndex((c) => c.workspaceId === required.workspaceId && c.id === required.id);
    if (index === -1) return { ok: false, reason: "not-found" };
    const current = this.comments[index]!;
    if (current.version !== required.expectedVersion) {
      return { ok: false, reason: "conflict", currentVersion: current.version };
    }

    const updated: CommentRecord = { ...current, status: required.toStatus, updatedAt: required.at, version: current.version + 1 };
    const logEntry: ModerationLogEntry = {
      id: `modlog-${required.id}-${this.log.length}`,
      workspaceId: required.workspaceId,
      commentId: required.id,
      actorPrincipalId: required.actorPrincipalId,
      action: required.action,
      fromStatus: current.status,
      toStatus: required.toStatus,
      at: required.at,
      note: required.note,
    };

    this.comments[index] = updated;
    this.log.push(logEntry);
    return { ok: true, record: updated, log: logEntry };
  }

  async purge(required: {
    workspaceId: string;
    id: string;
    actorPrincipalId: string;
    note: string | null;
    at: string;
  }, _optional: Record<string, never> = {}): ReturnType<CommentRepoPort["purge"]> {
    const index = this.comments.findIndex((c) => c.workspaceId === required.workspaceId && c.id === required.id);
    if (index === -1) return { ok: false, reason: "not-found" };
    const current = this.comments[index]!;

    const logEntry: ModerationLogEntry = {
      id: `modlog-${required.id}-${this.log.length}`,
      workspaceId: required.workspaceId,
      commentId: required.id,
      actorPrincipalId: required.actorPrincipalId,
      action: "purge",
      fromStatus: current.status,
      toStatus: current.status,
      at: required.at,
      note: required.note,
    };

    this.comments.splice(index, 1);
    this.log.push(logEntry);
    return { ok: true, log: logEntry };
  }
}
