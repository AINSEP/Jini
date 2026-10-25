import { describe, expect, test } from "vitest";

import { paymentError } from "../../contract/provider.js";
import { LedgerConstraintError } from "../../ledger/repo.js";
import { NOT_ASSESSED_RISK, REPLAY_RISK, checkText, dispatch, onUniqueRace, outcomeError } from "../common.js";

/** @file Unit pins for `ops/common.ts`: the fixed risk decisions, the text check, dispatch and the idempotency-race retry. */

describe("fixed risk decisions", () => {
  test("NOT_ASSESSED_RISK is an allow that is NOT a fail-policy fallback", () => {
    expect(NOT_ASSESSED_RISK).toEqual({ verdict: "allow", reasons: ["not-assessed"], fallback: false });
  });
  test("REPLAY_RISK is an allow that is NOT a fail-policy fallback", () => {
    expect(REPLAY_RISK).toEqual({ verdict: "allow", reasons: ["idempotent-replay"], fallback: false });
  });
});

describe("checkText", () => {
  test.each([
    ["empty", ""],
    ["whitespace only", "  \t"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("%s is refused with INVALID_REQUEST naming the field", (_label, value) => {
    expect(checkText({ fields: { ok: "fine", reason: value } })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_REQUEST", message: "reason must be a non-empty string" }),
    });
  });
  test("names the FIRST blank field when several are blank", () => {
    expect(checkText({ fields: { a: "x", b: "", c: "" } })?.error.message).toBe("b must be a non-empty string");
  });
  test("all non-empty → null", () => {
    expect(checkText({ fields: { a: "x", b: " y " } })).toBeNull();
  });
});

describe("dispatch", () => {
  const err = paymentError({ code: "PROVIDER_ERROR", message: "boom" });
  test("an ok outcome passes through", async () => {
    expect(await dispatch({ call: async () => ({ kind: "ok", value: 1 }) })).toEqual({ kind: "ok", value: 1 });
  });
  test.each(["rejected", "unknown"] as const)("a readable %s outcome passes through", async (kind) => {
    expect(await dispatch({ call: async () => ({ kind, error: err }) })).toEqual({ kind, error: err });
  });
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["unknown kind", { kind: "maybe" }],
    ["rejected without error", { kind: "rejected" }],
    ["rejected with a non-string code", { kind: "rejected", error: { code: 7 } }],
    ["unknown without error", { kind: "unknown" }],
  ])("%s → unknown (money may have moved), retryable", async (_label, outcome) => {
    const result = await dispatch({ call: async () => outcome as never });
    expect(result).toMatchObject({ kind: "unknown", error: { code: "PROVIDER_ERROR", message: "provider returned no readable Outcome", retryable: true } });
  });
  test("a throwing provider → unknown with the thrown message (Error and non-Error)", async () => {
    expect(await dispatch({ call: async () => { throw new Error("socket hang up"); } })).toMatchObject({ kind: "unknown", error: { message: "provider threw: socket hang up", retryable: true } });
    expect(await dispatch({ call: async () => { throw "plain"; } })).toMatchObject({ kind: "unknown", error: { message: "provider threw: plain" } });
  });
});

describe("outcomeError", () => {
  test("a rejection is never retryable under the spent key, an unknown keeps its flag", () => {
    const retryable = paymentError({ code: "TRANSPORT_ERROR", message: "429" }, { retryable: true });
    expect(outcomeError({ outcome: { kind: "rejected", error: retryable } }).retryable).toBe(false);
    expect(outcomeError({ outcome: { kind: "unknown", error: retryable } }).retryable).toBe(true);
  });
});

describe("onUniqueRace", () => {
  const unique = new LedgerConstraintError({ kind: "unique", table: "payments" });
  test("returns open's result without calling lookup", async () => {
    let looked = 0;
    expect(await onUniqueRace({ open: async () => "mine", lookup: async () => { looked++; return "theirs"; } })).toBe("mine");
    expect(looked).toBe(0);
  });
  test("a unique violation returns the race winner from lookup", async () => {
    expect(await onUniqueRace({ open: async () => { throw unique; }, lookup: async () => "theirs" })).toBe("theirs");
  });
  test("a unique violation with no winner rethrows the original error", async () => {
    await expect(onUniqueRace({ open: async () => { throw unique; }, lookup: async () => null })).rejects.toBe(unique);
  });
  test.each(["foreign-key", "check"] as const)("a %s constraint violation rethrows without lookup", async (kind) => {
    const error = new LedgerConstraintError({ kind, table: "payments" });
    let looked = 0;
    await expect(onUniqueRace({ open: async () => { throw error; }, lookup: async () => { looked++; return "x"; } })).rejects.toBe(error);
    expect(looked).toBe(0);
  });
  test("a non-ledger error rethrows without lookup", async () => {
    const error = Object.assign(new Error("disk"), { kind: "unique" });
    await expect(onUniqueRace({ open: async () => { throw error; }, lookup: async () => "x" })).rejects.toBe(error);
  });
});
