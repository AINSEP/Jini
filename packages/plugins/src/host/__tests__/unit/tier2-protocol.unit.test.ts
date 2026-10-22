import assert from "node:assert/strict";
import { test } from "vitest";

import { decodeTier2Reply } from "../support/protocol.js";

/**
 * @file `decodeTier2Reply()` — the server-side check on a Tier-2 worker's untrusted reply.
 *
 * Requirement-to-test map:
 * - well-formed failure / probe / beforeSave replies decode to themselves -> the accept tests.
 * - anything else, including a success of the wrong kind, is rejected -> the reject table.
 */

const INVALID = { message: "invalid tier-2 worker reply" };

test("a failure reply with a known stage decodes, whatever kind was asked", () => {
  for (const stage of ["import", "export", "setup", "hook"] as const) {
    assert.deepEqual(decodeTier2Reply({ ok: false, stage, error: "boom" }, "probe"), { ok: false, stage, error: "boom" });
  }
});

test("a probe reply carries the attached hook names", () => {
  assert.deepEqual(decodeTier2Reply({ ok: true, kind: "probe", hooks: ["content.entry.beforeSave"] }, "probe"), {
    ok: true,
    kind: "probe",
    hooks: ["content.entry.beforeSave"],
  });
});

test("a beforeSave reply carries its patch unvalidated (hook-registry validates it against declared fields)", () => {
  assert.deepEqual(decodeTier2Reply({ ok: true, kind: "beforeSave", patch: [1] }, "beforeSave"), {
    ok: true,
    kind: "beforeSave",
    patch: [1],
  });
});

const rejected: ReadonlyArray<[string, unknown, "probe" | "beforeSave"]> = [
  ["null", null, "probe"],
  ["a string", "ok", "probe"],
  ["ok missing", { kind: "probe", hooks: [] }, "probe"],
  ["unknown failure stage", { ok: false, stage: "boot", error: "x" }, "probe"],
  ["non-string failure stage", { ok: false, stage: 1, error: "x" }, "probe"],
  ["non-string failure error", { ok: false, stage: "hook", error: 1 }, "probe"],
  ["probe answered as beforeSave", { ok: true, kind: "beforeSave", patch: {} }, "probe"],
  ["beforeSave answered as probe", { ok: true, kind: "probe", hooks: [] }, "beforeSave"],
  ["probe without hooks", { ok: true, kind: "probe" }, "probe"],
  ["probe with a non-string hook", { ok: true, kind: "probe", hooks: [1] }, "probe"],
];
for (const [label, message, kind] of rejected) {
  test(`rejects ${label}`, () => {
    assert.throws(() => decodeTier2Reply(message, kind), INVALID);
  });
}
