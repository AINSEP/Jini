import assert from "node:assert/strict";
import { test } from "vitest";

import { decodeTier2Reply, type Tier2Request } from "../protocol.js";

const rejected: ReadonlyArray<readonly [string, unknown, Tier2Request["kind"]]> = [
  ["null", null, "probe"],
  ["undefined", undefined, "probe"],
  ["a string", "ok", "probe"],
  ["a number", 1, "probe"],
  ["a function", () => {}, "probe"],
  ["an empty array", [], "probe"],
  ["missing ok", { kind: "probe", hooks: [] }, "probe"],
  ["non-boolean ok", { ok: 1, kind: "probe", hooks: [] }, "probe"],
  ["missing stage", { ok: false, error: "x" }, "probe"],
  ["non-string stage", { ok: false, stage: 1, error: "x" }, "probe"],
  ["unknown stage", { ok: false, stage: "boot", error: "x" }, "probe"],
  ["non-string error", { ok: false, stage: "hook", error: 1 }, "probe"],
  ["missing error", { ok: false, stage: "hook" }, "beforeSave"],
  ["missing kind", { ok: true, hooks: [] }, "probe"],
  ["beforeSave answering probe", { ok: true, kind: "beforeSave", patch: {} }, "probe"],
  ["probe answering beforeSave", { ok: true, kind: "probe", hooks: [] }, "beforeSave"],
  ["missing hooks", { ok: true, kind: "probe" }, "probe"],
  ["non-array hooks", { ok: true, kind: "probe", hooks: "hook" }, "probe"],
  ["a non-string hook", { ok: true, kind: "probe", hooks: ["hook", 1] }, "probe"],
];

test.each(rejected)("rejects %s with the established transport error", (_label, message, expectedKind) => {
  assert.throws(() => decodeTier2Reply({ message, expectedKind }), {
    name: "Error", message: "invalid tier-2 worker reply",
  });
});

test.each(["import", "export", "setup", "hook"] as const)("accepts failure stage %s for either request kind", (stage) => {
  for (const expectedKind of ["probe", "beforeSave"] as const) {
    const message = { ok: false, stage, error: "", kind: "ignored", extra: true };
    const reply = decodeTier2Reply({ message, expectedKind });
    assert.deepEqual(reply, { ok: false, stage, error: "" });
    assert.notEqual(reply, message);
  }
});

test.each([{ hooks: [] }, { hooks: ["host.hook"] }, { hooks: ["", "host.hook", "host.hook"] }])("preserves probe hook strings and their array identity: %j", ({ hooks }) => {
  const reply = decodeTier2Reply({ message: { ok: true, kind: "probe", hooks, extra: true }, expectedKind: "probe" });
  assert.deepEqual(reply, { ok: true, kind: "probe", hooks });
  assert.equal(reply.ok && reply.kind === "probe" && reply.hooks, hooks);
});

test.each([undefined, null, false, 0, "patch", [1], { value: true }].map((patch) => ({ patch })))("leaves beforeSave patch validation to the hook owner: %j", ({ patch }) => {
  const reply = decodeTier2Reply({ message: { ok: true, kind: "beforeSave", patch, extra: true }, expectedKind: "beforeSave" });
  assert.deepEqual(reply, { ok: true, kind: "beforeSave", patch });
  assert.equal(reply.ok && reply.kind === "beforeSave" && reply.patch, patch);
});

test("accepts a missing beforeSave patch as undefined", () => {
  assert.deepEqual(decodeTier2Reply({ message: { ok: true, kind: "beforeSave" }, expectedKind: "beforeSave" }), {
    ok: true, kind: "beforeSave", patch: undefined,
  });
});

test("accepts holes in a probe hook array (reported, not fixed)", () => {
  // Array.every skips holes, so the existing string check accepts a sparse wire array.
  const hooks = new Array<string>(2);
  hooks[1] = "host.hook";
  const reply = decodeTier2Reply({ message: { ok: true, kind: "probe", hooks }, expectedKind: "probe" });
  assert.deepEqual(reply, { ok: true, kind: "probe", hooks });
  assert.equal(reply.ok && reply.kind === "probe" && reply.hooks, hooks);
  assert.equal(0 in hooks, false);
});
