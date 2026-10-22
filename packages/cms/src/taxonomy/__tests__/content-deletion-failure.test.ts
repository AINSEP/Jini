import assert from "node:assert/strict";
import { test } from "vitest";
import { onContentDeleted } from "../write-service.js";

const event = { workspaceId: "ws-1", contentType: "post", contentId: "post-1" };

test("cleanup absorbs repository rejection and logs the original error and content identity", async () => {
  const error = new Error("repository offline");
  const logs: unknown[] = [];
  await assert.doesNotReject(onContentDeleted({ event, entryTerms: { deleteByContent: async (input) => {
    assert.deepEqual(input, event);
    throw error;
  } } }, { logger: { warn: (record) => { logs.push(record); } } }));
  assert.deepEqual(logs, [{ message: "content-deletion taxonomy cleanup failed", error, event }]);
});

test("cleanup remains best effort when no logger is supplied or the logger rejects", async () => {
  const required = { event, entryTerms: { deleteByContent: async () => { throw new Error("offline"); } } };
  await assert.doesNotReject(onContentDeleted(required));
  await assert.doesNotReject(onContentDeleted(required, { logger: { warn: async () => { throw new Error("logger offline"); } } }));
});

test("successful cleanup produces no warning", async () => {
  const logs: unknown[] = [];
  await onContentDeleted({ event, entryTerms: { deleteByContent: async () => 2 } },
    { logger: { warn: (record) => { logs.push(record); } } });
  assert.deepEqual(logs, []);
});
