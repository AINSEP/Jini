/** The in-memory copy-plan store: bounded, single-use, bound to its maker, and time-limited. */
import { expect, it } from "vitest";
import { DatabaseTransferPlanStore, type DatabaseTransferPlanContent } from "../../tools/index.js";

const content = (site: string): DatabaseTransferPlanContent => ({
  connectionString: "postgresql://fixture/db", destination: { host: "h", port: "5432", database: "db", user: "u" },
  replaces: null, snapshot: Buffer.from(site), snapshotAt: "fixed", site, schema: "app", tableCount: 1, rowCount: 1, leftOut: [],
});
const owner = { principalId: "owner", workspaceId: "ws" };

it("keeps at most two plans, evicting the oldest first when a third is saved", () => {
  const store = new DatabaseTransferPlanStore({}, { now: () => 0 });
  const first = store.save({ ...owner, content: content("first") });
  const second = store.save({ ...owner, content: content("second") });
  const third = store.save({ ...owner, content: content("third") });
  expect(store.take({ ...owner, planId: first.planId })).toEqual({ ok: false, code: "PLAN_NOT_FOUND" });
  expect(store.take({ ...owner, planId: second.planId })).toMatchObject({ ok: true, plan: { site: "second" } });
  expect(store.take({ ...owner, planId: third.planId })).toMatchObject({ ok: true, plan: { site: "third" } });
});

it("drops expired plans on save so they never take a slot from a live one", () => {
  let now = 0;
  const store = new DatabaseTransferPlanStore({}, { now: () => now });
  const stale = store.save({ ...owner, content: content("stale") });
  const live = store.save({ ...owner, content: content("live") });
  expect(live.expiresAtMs).toBe(600_000);
  now = 600_000;
  // `stale` and `live` both expire exactly at 10 minutes: both are pruned, so the fresh plan evicts nothing.
  const fresh = store.save({ ...owner, content: content("fresh") });
  expect(store.take({ ...owner, planId: stale.planId })).toEqual({ ok: false, code: "PLAN_NOT_FOUND" });
  expect(store.take({ ...owner, planId: live.planId })).toEqual({ ok: false, code: "PLAN_NOT_FOUND" });
  expect(store.take({ ...owner, planId: fresh.planId })).toMatchObject({ ok: true, plan: { site: "fresh", expiresAtMs: 1_200_000 } });
});

it("stamps expiry from the system clock when no clock is injected", () => {
  const store = new DatabaseTransferPlanStore();
  const before = Date.now();
  const plan = store.save({ ...owner, content: content("site") });
  const after = Date.now();
  expect(plan.expiresAtMs).toBeGreaterThanOrEqual(before + 600_000);
  expect(plan.expiresAtMs).toBeLessThanOrEqual(after + 600_000);
  expect(store.take({ ...owner, planId: plan.planId })).toMatchObject({ ok: true, plan: { planId: plan.planId, ...owner } });
});

it("refuses another workspace's plan without consuming it", () => {
  const store = new DatabaseTransferPlanStore({}, { now: () => 0 });
  const plan = store.save({ ...owner, content: content("site") });
  expect(store.take({ principalId: "owner", workspaceId: "other", planId: plan.planId })).toEqual({ ok: false, code: "PLAN_NOT_FOUND" });
  expect(store.take({ ...owner, planId: plan.planId })).toMatchObject({ ok: true });
});
