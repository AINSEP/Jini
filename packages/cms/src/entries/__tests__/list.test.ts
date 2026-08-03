import assert from "node:assert/strict";
import { test } from "vitest";

import { listEntries } from "../list.js";
import type { EntryRecord } from "../types.js";

/**
 * @file design-spec.md §1.9 backend-gap closure — `listEntries` (this dispatch).
 */

function makeEntry(overrides: Partial<EntryRecord> = {}): EntryRecord {
  return {
    id: "e1",
    workspaceId: "ws-1",
    type: "recipe",
    slug: "eggs",
    status: "draft",
    title: "Eggs",
    bodyJson: null,
    fieldsJson: { ext: { site: {} } },
    publishedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function fakeListPort(rows: EntryRecord[]) {
  return {
    listByWorkspace: async (params: { workspaceId: string; type?: string }) =>
      rows.filter((r) => r.workspaceId === params.workspaceId && (!params.type || r.type === params.type)),
  };
}

test("listEntries: narrows to one content type when 'type' is supplied", async () => {
  const repo = fakeListPort([makeEntry({ id: "e1", type: "recipe" }), makeEntry({ id: "e2", type: "product" })]);
  const result = await listEntries({ repo, workspaceId: "ws-1", type: "recipe" });

  assert.deepEqual(
    result.items.map((e) => e.id),
    ["e1"]
  );
});

test("listEntries: lists across every content type when 'type' is omitted", async () => {
  const repo = fakeListPort([makeEntry({ id: "e1", type: "recipe" }), makeEntry({ id: "e2", type: "product" })]);
  const result = await listEntries({ repo, workspaceId: "ws-1" });

  assert.equal(result.items.length, 2);
});

test("listEntries: an empty workspace returns an empty items array", async () => {
  const repo = fakeListPort([]);
  const result = await listEntries({ repo, workspaceId: "ws-1" });

  assert.deepEqual(result.items, []);
});
