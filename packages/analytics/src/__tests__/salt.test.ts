import assert from "node:assert/strict";
import { test } from "vitest";

import { deriveDailySalt } from "../salt.js";

const POLICY = { maxEventPropCount: 20, maxEventPropStringLength: 200, sessionWindowMinutes: 30 };
const SALT_CONTEXT = { extractionSalt: "fixture-analytics-hkdf-v1", infoPrefix: "analytics-salt:" };

const ROOT_KEY_SEED = "test-root-key-seed-do-not-use-in-prod";

test("deriveDailySalt is deterministic for a fixed (rootKeySeed, workspaceId, utcDate) triple", () => {
  const first = deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT });
  const second = deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT });

  assert.equal(first.equals(second), true);
  assert.equal(first.length, 32);
});

test("deriveDailySalt rotates across UTC days (salt rotation)", () => {
  const day1 = deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT });
  const day2 = deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-1", utcDate: "2026-07-11" }, saltContext: SALT_CONTEXT });

  assert.equal(day1.equals(day2), false);
});

test("deriveDailySalt is workspace-scoped (no cross-workspace salt reuse)", () => {
  const workspaceA = deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-a", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT });
  const workspaceB = deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-b", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT });

  assert.equal(workspaceA.equals(workspaceB), false);
});

test("deriveDailySalt changes when the root key seed changes", () => {
  const seedA = deriveDailySalt({ ...{ rootKeySeed: "seed-a", workspaceId: "workspace-1", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT });
  const seedB = deriveDailySalt({ ...{ rootKeySeed: "seed-b", workspaceId: "workspace-1", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT });

  assert.equal(seedA.equals(seedB), false);
});

test("deriveDailySalt rejects an empty workspaceId", () => {
  assert.throws(() => deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "", utcDate: "2026-07-10" }, saltContext: SALT_CONTEXT }), RangeError);
});

test("C50: deriveDailySalt rejects an empty root key seed", () => {
  assert.throws(() => deriveDailySalt({ rootKeySeed: "", workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext: SALT_CONTEXT }), RangeError);
});

test("deriveDailySalt rejects an empty utcDate", () => {
  assert.throws(() => deriveDailySalt({ ...{ rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-1", utcDate: "" }, saltContext: SALT_CONTEXT }), RangeError);
});

test("deriveDailySalt rejects an empty info prefix or extraction salt, string or bytes", () => {
  const base = { rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10" };
  for (const saltContext of [
    { ...SALT_CONTEXT, infoPrefix: "" },
    { ...SALT_CONTEXT, extractionSalt: "" },
    { ...SALT_CONTEXT, extractionSalt: new Uint8Array(0) },
  ]) {
    assert.throws(() => deriveDailySalt({ ...base, saltContext }), new RangeError("deriveDailySalt: salt context must not be empty"));
  }
});

test("deriveDailySalt accepts a byte-array extraction salt equal to its string form", () => {
  const base = { rootKeySeed: ROOT_KEY_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10" };
  const fromString = deriveDailySalt({ ...base, saltContext: SALT_CONTEXT });
  const fromBytes = deriveDailySalt({ ...base, saltContext: { ...SALT_CONTEXT, extractionSalt: Buffer.from(SALT_CONTEXT.extractionSalt) } });
  assert.equal(fromBytes.equals(fromString), true);
});
