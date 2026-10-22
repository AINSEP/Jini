import type { Insertable, Selectable } from "kysely";

import type { CommentRecord, CommentStatus, ModerationAction, ModerationLogEntry } from "../types.js";

/**
 * @file Row types and mapping for the host's comments tables declared through the plugin data-module seam, shared by
 * every dialect. These tables are created by the dataModule engine (`data-module-install.ts`), not
 * by the migrated core schema, so they are NOT in `ContentDatabase`; the repo brings them into a
 * query with Kysely's `withTables<CommentTables>()`. snake_case columns, exactly as the manifest
 * (`COMMENTS_DATA_MODULE` in `types.ts`) declares them.
 */

export type CommentTableRow = {
  id: string;
  workspace_id: string;
  entry_id: string;
  parent_id: string | null;
  thread_root_id: string;
  depth: number;
  status: string;
  author_principal_id: string | null;
  author_name: string;
  author_email: string | null;
  author_url: string | null;
  author_ip_hash: string | null;
  body_text: string;
  spam_score: number | null;
  spam_provider: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type ModerationLogTableRow = {
  id: string;
  workspace_id: string;
  comment_id: string;
  actor_principal_id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  at: string;
  note: string | null;
};

/** The tables the comments repo adds to the content kernel's schema. Type aliases, not interfaces:
 *  Kysely's `withTables` needs the implicit index signature only an alias has. */
export type CommentTables = Record<string, CommentTableRow>;
export type ModerationLogTables = Record<string, ModerationLogTableRow>;

export function toRecord(row: Selectable<CommentTableRow>, _optional: Record<string, never> = {}): CommentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entryId: row.entry_id,
    parentId: row.parent_id,
    threadRootId: row.thread_root_id,
    depth: row.depth,
    status: row.status as CommentStatus,
    authorPrincipalId: row.author_principal_id,
    authorName: row.author_name,
    authorEmail: row.author_email,
    authorUrl: row.author_url,
    authorIpHash: row.author_ip_hash,
    bodyText: row.body_text,
    spamScore: row.spam_score,
    spamProvider: row.spam_provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function toRow(record: CommentRecord, _optional: Record<string, never> = {}): Insertable<CommentTableRow> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    entry_id: record.entryId,
    parent_id: record.parentId,
    thread_root_id: record.threadRootId,
    depth: record.depth,
    status: record.status,
    author_principal_id: record.authorPrincipalId,
    author_name: record.authorName,
    author_email: record.authorEmail,
    author_url: record.authorUrl,
    author_ip_hash: record.authorIpHash,
    body_text: record.bodyText,
    spam_score: record.spamScore,
    spam_provider: record.spamProvider,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

export function toLogRow(entry: ModerationLogEntry, _optional: Record<string, never> = {}): Insertable<ModerationLogTableRow> {
  return {
    id: entry.id,
    workspace_id: entry.workspaceId,
    comment_id: entry.commentId,
    actor_principal_id: entry.actorPrincipalId,
    action: entry.action,
    from_status: entry.fromStatus,
    to_status: entry.toStatus,
    at: entry.at,
    note: entry.note,
  };
}

export function toLogEntry(row: Selectable<ModerationLogTableRow>, _optional: Record<string, never> = {}): ModerationLogEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    commentId: row.comment_id,
    actorPrincipalId: row.actor_principal_id,
    action: row.action as ModerationAction,
    fromStatus: row.from_status as CommentStatus | null,
    toStatus: row.to_status as CommentStatus,
    at: row.at,
    note: row.note,
  };
}
