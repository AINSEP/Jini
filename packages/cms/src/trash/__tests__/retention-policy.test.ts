import { expect, test } from "vitest";
import { computePurgeAfter, createTrashService } from "../write-service.js";
import { startTrashSweeper } from "../sweeper.js";
import { harness, removal, AT, WS } from "./fixture.js";

// REGRESSION: fails if computePurgeAfter again requires retentionDays with no default.
test("omitted retention preserves the historical 60-day promise", async () => {
  expect(computePurgeAfter({ at: AT })).toBe("2026-11-19T12:00:00.000Z");
  const h = harness();
  await h.trash.trash(removal);
  expect((await h.repo.findByEntity({ workspaceId: WS, entityType: "record", entityId: "record-1" }))?.purgeAfter).toBe("2026-11-19T12:00:00.000Z");
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
  expect(() => computePurgeAfter({ at: "invalid" })).toThrow(RangeError);
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
