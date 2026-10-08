import assert from "node:assert/strict";
import { test } from "vitest";

import { toLogEntry, toLogRow, toRecord, toRow } from "../sql/repo.rows.js";

// F4.1: the two expectations are independently written, never a round-trip oracle.
const record = {
  id: "reply", workspaceId: "ws-a", entryId: "article", parentId: "parent", threadRootId: "root", depth: 2,
  status: "approved" as const, authorPrincipalId: "member", authorName: "Ada", authorEmail: "ada@example.com",
  authorUrl: "https://ada.example", authorIpHash: "ip-digest", bodyText: "Reply text", spamScore: 0.73,
  spamProvider: "classifier", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", version: 7,
};
const row = {
  id: "reply", workspace_id: "ws-a", entry_id: "article", parent_id: "parent", thread_root_id: "root", depth: 2,
  status: "approved", author_principal_id: "member", author_name: "Ada", author_email: "ada@example.com",
  author_url: "https://ada.example", author_ip_hash: "ip-digest", body_text: "Reply text", spam_score: 0.73,
  spam_provider: "classifier", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z", version: 7,
};

test("maps non-null reply and author metadata to the correct columns in both directions", () => {
  assert.deepEqual(toRow(record), row);
  assert.deepEqual(toRecord(row), record);
});

test("maps moderation actor, note and time independently of the comment's identity", () => {
  const entry = { id: "log", workspaceId: "ws-a", commentId: "reply", actorPrincipalId: "moderator", action: "approve" as const, fromStatus: "pending" as const, toStatus: "approved" as const, at: "2026-09-03T10:00:00Z", note: "Reviewed manually" };
  const logRow = { id: "log", workspace_id: "ws-a", comment_id: "reply", actor_principal_id: "moderator", action: "approve", from_status: "pending", to_status: "approved", at: "2026-09-03T10:00:00Z", note: "Reviewed manually" };
  assert.deepEqual(toLogRow(entry), logRow);
  assert.deepEqual(toLogEntry(logRow), entry);
  assert.deepEqual(toLogEntry({ ...logRow, from_status: null, note: null }), { ...entry, fromStatus: null, note: null });
});
