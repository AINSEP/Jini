import { expect, test } from "vitest";
import { parseDaemonCallContext, readDaemonCallContext, runWithDaemonCallContext } from "../daemon-call-context.js";

test("parse keeps only well-typed fields of the opaque wire context", () => {
  expect(parseDaemonCallContext({ value: null })).toEqual({});
  expect(parseDaemonCallContext({ value: "x" })).toEqual({});
  expect(parseDaemonCallContext({ value: { conversationId: "c1", attachmentRefs: ["a", "b"], localToolIds: ["t"], extra: 1 } }))
    .toEqual({ conversationId: "c1", attachmentRefs: ["a", "b"], localToolIds: ["t"] });
  expect(parseDaemonCallContext({ value: { conversationId: 7, attachmentRefs: ["a", 2], localToolIds: "t" } })).toEqual({});
});

test("context is visible across awaits inside the call and absent outside it", async () => {
  expect(readDaemonCallContext()).toBeUndefined();
  const seen = await runWithDaemonCallContext({ context: { conversationId: "c2" }, fn: async () => {
    await Promise.resolve();
    return readDaemonCallContext();
  } });
  expect(seen).toEqual({ conversationId: "c2" });
  expect(readDaemonCallContext()).toBeUndefined();
});
