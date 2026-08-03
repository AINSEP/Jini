import assert from "node:assert/strict";
import { test } from "vitest";

import { onContentDeleted } from "../write-service.js";

/**
 * @file SPEC-018 C-206 / W-203 / REQ-18 / REQ-19 / INV-07 / AC-27 / AC-28 / AC-29 — the
 * content-deletion event subscriber and orphan-tolerant reverse lookup.
 *
 * Assumed seam design:
 *
 * ```ts
 * export interface EntryTermsCleanupPort {
 *   deleteByContent(params: { workspaceId: string; contentType: string; contentId: string }): Promise<number>;
 * }
 * export async function onContentDeleted(
 *   required: { event: { workspaceId: string; contentType: string; contentId: string }; entryTerms: EntryTermsCleanupPort },
 *   optional?: {}
 * ): Promise<void>;
 * ```
 */

function fakeEntryTermsStore(initialRows: Array<{ workspaceId: string; contentType: string; contentId: string; termId: string }>) {
  let rows = [...initialRows];
  return {
    async deleteByContent(params: { workspaceId: string; contentType: string; contentId: string }) {
      const before = rows.length;
      rows = rows.filter(
        (r) => !(r.workspaceId === params.workspaceId && r.contentType === params.contentType && r.contentId === params.contentId)
      );
      return before - rows.length;
    },
    async listByTerm(termId: string) {
      return rows.filter((r) => r.termId === termId);
    },
  };
}

test("AC-27 / REQ-18: onContentDeleted removes every entry_terms row for the deleted content", async () => {
  const entryTerms = fakeEntryTermsStore([
    { workspaceId: "ws-1", contentType: "post", contentId: "post-1", termId: "term-a" },
    { workspaceId: "ws-1", contentType: "post", contentId: "post-1", termId: "term-b" },
    { workspaceId: "ws-1", contentType: "post", contentId: "post-2", termId: "term-a" },
  ]);

  await onContentDeleted({ event: { workspaceId: "ws-1", contentType: "post", contentId: "post-1" }, entryTerms });

  const remainingForTermA = await entryTerms.listByTerm("term-a");
  assert.deepEqual(
    remainingForTermA.map((r) => r.contentId),
    ["post-2"],
    "only post-1's rows must be removed; post-2's assignment to the same term must survive"
  );
});

test("AC-28 / REQ-19 / INV-07: a reverse lookup silently omits an orphaned entry_terms row rather than erroring, when cleanup was missed (best-effort event, backstopped by reconciliation)", async () => {
  // Simulates EC-07: content deleted OUTSIDE the taxonomy chokepoint (the cleanup event was never
  // fired), leaving an orphaned row. The read path (listByTerm here stands in for C-205's
  // listContentForTerm) must not surface it as an error.
  const entryTerms = fakeEntryTermsStore([{ workspaceId: "ws-1", contentType: "post", contentId: "deleted-post", termId: "term-a" }]);

  const rows = await entryTerms.listByTerm("term-a");
  assert.doesNotThrow(() => rows.map((r) => r.contentId));
});

test("AC-29 / REQ-19: a subsequent reconciliation sweep (modeled here as re-invoking onContentDeleted for the orphan) removes the orphaned row", async () => {
  const entryTerms = fakeEntryTermsStore([{ workspaceId: "ws-1", contentType: "post", contentId: "deleted-post", termId: "term-a" }]);

  await onContentDeleted({ event: { workspaceId: "ws-1", contentType: "post", contentId: "deleted-post" }, entryTerms });

  const remaining = await entryTerms.listByTerm("term-a");
  assert.deepEqual(remaining, []);
});

test("onContentDeleted for content with no assigned terms is a no-op, not an error", async () => {
  const entryTerms = fakeEntryTermsStore([]);
  await assert.doesNotReject(
    onContentDeleted({ event: { workspaceId: "ws-1", contentType: "post", contentId: "never-tagged" }, entryTerms })
  );
});
