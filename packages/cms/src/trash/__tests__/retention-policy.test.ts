import { expect, test } from "vitest";
import { computePurgeAfter, createTrashService } from "../write-service.js";
import { startTrashSweeper } from "../sweeper.js";
import { harness, removal, AT, WS } from "./fixture.js";

// REGRESSION (owner decision G7-4): the engine has NO retention default. An untyped caller that
// omits the window is refused loudly instead of silently stamping some engine-chosen number.
// (Typed callers cannot even compile it: see retention-required.typecheck.ts.)
test("omitted retention is refused, never defaulted", async () => {
  const untypedPurgeAfter = computePurgeAfter as (at: { at: string }, policy?: unknown) => string;
  expect(() => untypedPurgeAfter({ at: AT })).toThrow(RangeError);
  expect(() => untypedPurgeAfter({ at: AT }, {})).toThrow(RangeError);
  const h = harness();
  const untypedCreate = createTrashService as (deps: unknown, options?: unknown) => unknown;
  expect(() => untypedCreate(h.deps)).toThrow(RangeError);
  expect(() => untypedCreate(h.deps, { onError: () => {} })).toThrow(RangeError);
});
// PARITY: the stamp is exactly what the host injected.
test("the injected window is what gets stamped", async () => {
  const h = harness({ retentionDays: 30 });
  await h.trash.trash(removal);
  expect((await h.repo.findByEntity({ workspaceId: WS, entityType: "record", entityId: "record-1" }))?.purgeAfter).toBe("2026-10-20T12:00:00.000Z");
});
// PARITY: explicit policy can choose zero retention or a shorter retention.
test("retention stays a host option", () => {
  expect(computePurgeAfter({ at: AT }, { retentionDays: 0 })).toBe(AT);
  expect(computePurgeAfter({ at: AT }, { retentionDays: 2 })).toBe("2026-09-22T12:00:00.000Z");
});
// PARITY: the moved implementation retains eager retention validation from the platform extraction.
test.each([-1, NaN, Infinity])("invalid retention %s refuses service construction", retentionDays => {
  const h = harness();
  expect(() => createTrashService(h.deps, { retentionDays })).toThrow(RangeError);
  expect(h.repo.all({})).toEqual([]);
  expect(() => computePurgeAfter({ at: AT }, { retentionDays })).toThrow(RangeError);
});
// PARITY: invalid removal time is rejected rather than persisted.
test("invalid removal timestamp is refused", () => {
  expect(() => computePurgeAfter({ at: "invalid" }, { retentionDays: 30 })).toThrow(RangeError);
});
// PARITY: nonpositive, noninteger and nonfinite sweep limits remain rejected at construction.
for (const option of ["intervalMs", "batchSize", "leaseMs"] as const) {
  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(`invalid ${option} %s does not schedule`, value => {
    const scheduled: unknown[] = [];
    expect(() => startTrashSweeper({
      clock: { nowMs: () => Date.parse(AT) }, leaseOwner: "worker",
      sweep: async () => ({ claimed: 0, purged: 0, results: [] }),
      scheduler: { schedule: input => { scheduled.push(input); return input; }, cancel() {} },
    }, { [option]: value })).toThrow(RangeError);
    expect(scheduled).toEqual([]);
  });
}
// PARITY: leases require a nonempty owner so they can be reclaimed safely.
test("empty lease owner is refused", () => {
  expect(() => startTrashSweeper({ clock: { nowMs: () => Date.parse(AT) }, leaseOwner: "",
    sweep: async () => ({ claimed: 0, purged: 0, results: [] }), scheduler: { schedule() {}, cancel() {} },
  })).toThrow(RangeError);
});
