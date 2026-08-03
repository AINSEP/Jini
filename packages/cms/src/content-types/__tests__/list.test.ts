import assert from "node:assert/strict";
import { test } from "vitest";

import { listContentTypes } from "../list.js";
import type { ContentTypeRecord } from "../types.js";

/**
 * @file design-spec.md §1.9 backend-gap closure — `listContentTypes` (this dispatch).
 */

function fakeListPort(rows: ContentTypeRecord[]) {
  const calls: Array<{ workspaceId: string }> = [];
  return {
    calls,
    listByWorkspace: async (params: { workspaceId: string }) => {
      calls.push(params);
      return rows.filter((r) => r.workspaceId === params.workspaceId);
    },
  };
}

function makeRow(overrides: Partial<ContentTypeRecord> = {}): ContentTypeRecord {
  return { workspaceId: "ws-1", key: "recipe", label: "Recipe", fields: [], status: "active", version: 1, tombstonedAt: null, ...overrides };
}

test("listContentTypes: returns every content type for the given workspace", async () => {
  const repo = fakeListPort([makeRow({ key: "recipe" }), makeRow({ key: "product" })]);
  const result = await listContentTypes({ repo, workspaceId: "ws-1" });

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((r) => r.key),
    ["recipe", "product"]
  );
  assert.deepEqual(repo.calls, [{ workspaceId: "ws-1" }]);
});

test("listContentTypes: an empty registry returns an empty items array, not an error", async () => {
  const repo = fakeListPort([]);
  const result = await listContentTypes({ repo, workspaceId: "ws-1" });

  assert.deepEqual(result.items, []);
});

test("listContentTypes: never leaks a different workspace's rows across the port boundary", async () => {
  const repo = fakeListPort([makeRow({ workspaceId: "ws-1", key: "recipe" }), makeRow({ workspaceId: "ws-2", key: "product" })]);
  const result = await listContentTypes({ repo, workspaceId: "ws-1" });

  assert.deepEqual(
    result.items.map((r) => r.key),
    ["recipe"]
  );
});
