import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createConsoleLogger } from "@jini-ai/core/primitives";
import { onContentDeleted } from "../content-deletion-cleanup.js";

const event = { workspaceId: "ws-1", contentType: "post", contentId: "post-1" };

test("cleanup absorbs repository rejection and logs the original error and content identity", async () => {
  const error = new Error("repository offline");
  const logs: unknown[] = [];
  await assert.doesNotReject(onContentDeleted({ event, entryTerms: { deleteByContent: async (input) => {
    assert.deepEqual(input, event);
    throw error;
  } } }, { logger: { warn: (record, optional) => { logs.push([record, optional]); } } }));
  assert.deepEqual(logs, [[{ message: "content-deletion taxonomy cleanup failed" }, { meta: { event }, error }]]);
  assert.equal((logs[0] as [unknown, { error: unknown }])[1].error, error);
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

test("cleanup through the default console logger prints the error class only", async () => {
  const printed = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await onContentDeleted({ event, entryTerms: { deleteByContent: async () => { throw new Error("boom api_key=SECRETSECRETSECRETSECRET"); } } },
      { logger: createConsoleLogger({ prefix: "" }) });
    assert.deepEqual(printed.mock.calls, [["content-deletion taxonomy cleanup failed", { event }, "Error"]]);
    for (const leak of ["boom", "SECRETSECRET", "content-deletion-failure.test"]) assert.ok(!JSON.stringify(printed.mock.calls).includes(leak));
  } finally {
    printed.mockRestore();
  }
});
