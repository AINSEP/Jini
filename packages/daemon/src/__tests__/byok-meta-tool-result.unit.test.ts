/**
 * @file Direct tests for `byok-meta-tool-result.ts`'s pure mapping. The end-to-end paths run
 * through `executeMetaTool` in `byok-tool-surface.test.ts`; these cover the two `ToolExecutor`
 * outcomes that surface cannot produce (its executor has no `onConfirm` delegate, and the
 * executor always fills `error` on a failure) plus the guards each helper owns.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolExecutor } from "../tool-executor-types.js";

import { isNonArrayRecord as isRecord } from "@jini-ai/core/records";
import { err, mapToolExecutionResult, ok, resolveDelegatedInput } from "../byok-meta-tool-result.js";

type ExecutionResult = Awaited<ReturnType<ToolExecutor["execute"]>>;

function executionResult(fields: Omit<ExecutionResult, "executionId">): ExecutionResult {
  return { executionId: "exec-1", ...fields };
}

test("a declined confirmation maps to the BYOK confirmation refusal naming the tool", () => {
  assert.deepEqual(mapToolExecutionResult({ result: executionResult({ status: "confirmation-denied" }), toolId: "pin_tool" }), {
    content: 'tool "pin_tool" requires human confirmation, which BYOK mode cannot supply yet',
    isError: true,
  });
});

test("a failure with no error text falls back to a message naming the tool", () => {
  assert.deepEqual(mapToolExecutionResult({ result: executionResult({ status: "failed" }), toolId: "pin_tool" }), { content: 'tool "pin_tool" failed', isError: true });
});

test("a failure with error text passes that text through unchanged", () => {
  assert.deepEqual(mapToolExecutionResult({ result: executionResult({ status: "failed", error: "disk full" }), toolId: "pin_tool" }), { content: "disk full", isError: true });
});

test("a time-out maps to a message naming the tool", () => {
  assert.deepEqual(mapToolExecutionResult({ result: executionResult({ status: "timed-out" }), toolId: "pin_tool" }), { content: 'tool "pin_tool" timed out', isError: true });
});

test("a denial maps to the generic caller-denied message", () => {
  assert.deepEqual(mapToolExecutionResult({ result: executionResult({ status: "denied" }), toolId: "pin_tool" }), { content: 'tool "pin_tool" was denied for this caller', isError: true });
});

test("a completed run renders its output through ok", () => {
  assert.deepEqual(mapToolExecutionResult({ result: executionResult({ status: "completed", output: { n: 1 } }), toolId: "pin_tool" }), { content: '{"n":1}' });
});

test("err flags its message as an error result", () => {
  assert.deepEqual(err({ content: "nope" }), { content: "nope", isError: true });
});

test("ok keeps an image-bearing envelope as provider content blocks", () => {
  const output = { content: [{ type: "text", text: "caption" }, { type: "image", mimeType: "image/png", data: "AAAA" }] };
  assert.deepEqual(ok({ output: output }), { content: output.content });
});

test("ok renders a null output as the JSON text null", () => {
  assert.deepEqual(ok({ output: null }), { content: "null" });
});

test("the non-array record guard this dispatch relies on rejects arrays and null but accepts a plain object", () => {
  assert.deepEqual([isRecord({ value: [] }), isRecord({ value: null }), isRecord({ value: "x" }), isRecord({ value: {} })], [false, false, false, true]);
});

test("resolveDelegatedInput treats a blank string as no input", () => {
  assert.deepEqual(resolveDelegatedInput({ raw: "   " }), { ok: true, input: undefined });
});

test("resolveDelegatedInput refuses an unparseable string, naming the fix", () => {
  assert.deepEqual(resolveDelegatedInput({ raw: "not json" }), { ok: false, message: "'input' must be a JSON object of the tool's input fields, not a plain string." });
});

test("resolveDelegatedInput refuses a boolean, naming its type", () => {
  assert.deepEqual(resolveDelegatedInput({ raw: true }), { ok: false, message: "'input' must be a JSON object of the tool's input fields, not boolean." });
});

test("a cancellation maps to a message naming the tool", () => {
  assert.deepEqual(mapToolExecutionResult({ result: executionResult({ status: "cancelled" }), toolId: "demo" }),
    { content: 'tool "demo" was cancelled', isError: true });
});

test("ok renders a string output verbatim and a plain object as JSON text", () => {
  assert.deepEqual(ok({ output: "plain text" }), { content: "plain text" });
  assert.deepEqual(ok({ output: { a: 1 } }), { content: '{"a":1}' });
  assert.deepEqual(ok({ output: undefined }), { content: "null" });
});

test("ok keeps text and image blocks together as provider content when at least one is an image", () => {
  const output = { content: [{ type: "text", text: "caption" }, { type: "image", mimeType: "image/png", data: "AAAA" }] };
  assert.deepEqual(ok({ output: output }), { content: [{ type: "text", text: "caption" }, { type: "image", mimeType: "image/png", data: "AAAA" }] });
});

test("ok falls back to JSON text when the content envelope has no image, an unknown block, or a malformed block", () => {
  const cases: unknown[] = [
    { content: [{ type: "text", text: "only text" }] },
    { content: [{ type: "image", mimeType: "image/png", data: "AAAA" }, { type: "audio", data: "x" }] },
    { content: [{ type: "image", mimeType: "image/png", data: "AAAA" }, "not-a-block"] },
    { content: [{ type: "image", mimeType: "image/png" }] },
    { content: [{ type: "text", text: 5 }] },
    { content: "not-an-array" },
    [{ type: "image", mimeType: "image/png", data: "AAAA" }],
  ];
  for (const output of cases) {
    assert.deepEqual(ok({ output: output }), { content: JSON.stringify(output) }, JSON.stringify(output));
  }
});

test("resolveDelegatedInput accepts absent input and a record, and parses a JSON-object string", () => {
  assert.deepEqual(resolveDelegatedInput({ raw: undefined }), { ok: true, input: undefined });
  assert.deepEqual(resolveDelegatedInput({ raw: null }), { ok: true, input: undefined });
  assert.deepEqual(resolveDelegatedInput({ raw: { id: "x" } }), { ok: true, input: { id: "x" } });
  assert.deepEqual(resolveDelegatedInput({ raw: '  {"id":"x"}  ' }), { ok: true, input: { id: "x" } });
});

test("resolveDelegatedInput refuses JSON that is not an object, and an array value, naming each", () => {
  const parsedNonObject = resolveDelegatedInput({ raw: "[1,2]" });
  assert.equal(parsedNonObject.ok, false);
  assert.match(parsedNonObject.ok ? "" : parsedNonObject.message, /parsed as JSON but is not an object/);
  const array = resolveDelegatedInput({ raw: [1] });
  assert.equal(array.ok, false);
  assert.match(array.ok ? "" : array.message, /not an array\.$/);
});
