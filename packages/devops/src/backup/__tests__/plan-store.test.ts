import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { DEFAULT_MAX_PLANS, DEFAULT_MAX_TOTAL_PLANS, DEFAULT_PLAN_TTL_MS, SiteBackupPlanStore } from "../plan-store.node.js";

/**
 * @file `plan-store.ts`'s proof: a plan is single-use, bound to the principal and workspace that made
 * it, expires, and the store never holds more than its cap (each plan carries a database snapshot).
 */

const CONTENT: { readonly database: { readonly bytes: Buffer; readonly watermarkAtCapture: number } } = {
  database: { bytes: Buffer.from("db"), watermarkAtCapture: 1 },
};

afterEach(() => vi.restoreAllMocks());

function makeStore(overrides: { maxPlans?: number; maxTotalPlans?: number } = {}): { store: SiteBackupPlanStore<typeof CONTENT>; clock: { ms: number } } {
  const clock = { ms: 1_000 };
  let n = 0;
  const store = new SiteBackupPlanStore<typeof CONTENT>({}, { now: () => clock.ms, ttlMs: 60_000, newId: () => `plan-${++n}`, ...overrides });
  return { store, clock };
}

const OWNER = { principalId: "owner", workspaceId: "ws" };

test("a plan can be taken once, by the principal and workspace that made it", () => {
  const { store } = makeStore();
  const plan = store.save({ ...OWNER, content: CONTENT });
  assert.equal(plan.expiresAtMs, 61_000);
  const first = store.take({ planId: plan.planId, ...OWNER });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.plan.database?.bytes.toString(), "db");
  assert.deepEqual(store.take({ planId: plan.planId, ...OWNER }), { ok: false, code: "PLAN_NOT_FOUND" });
});

test("another principal or workspace reads the plan as not found, and cannot use it up", () => {
  const { store } = makeStore();
  const plan = store.save({ ...OWNER, content: CONTENT });
  assert.deepEqual(store.take({ planId: plan.planId, principalId: "intruder", workspaceId: "ws" }), { ok: false, code: "PLAN_NOT_FOUND" });
  assert.deepEqual(store.take({ planId: plan.planId, principalId: "owner", workspaceId: "other-ws" }), { ok: false, code: "PLAN_NOT_FOUND" });
  assert.equal(store.take({ planId: plan.planId, ...OWNER }).ok, true);
});

test("an expired plan reads as expired, and is gone afterwards", () => {
  const { store, clock } = makeStore();
  const plan = store.save({ ...OWNER, content: CONTENT });
  clock.ms = plan.expiresAtMs;
  assert.deepEqual(store.take({ planId: plan.planId, ...OWNER }), { ok: false, code: "PLAN_EXPIRED" });
  assert.deepEqual(store.take({ planId: plan.planId, ...OWNER }), { ok: false, code: "PLAN_NOT_FOUND" });
});

test("the store holds at most its cap: the oldest plan is evicted first", () => {
  const { store } = makeStore({ maxPlans: 2 });
  const a = store.save({ ...OWNER, content: CONTENT });
  const b = store.save({ ...OWNER, content: CONTENT });
  const c = store.save({ ...OWNER, content: CONTENT });
  assert.equal(store.take({ planId: a.planId, ...OWNER }).ok, false);
  assert.equal(store.take({ planId: b.planId, ...OWNER }).ok, true);
  assert.equal(store.take({ planId: c.planId, ...OWNER }).ok, true);
});

test("T48: other principals and workspaces cannot evict a caller's live backup plan", () => {
  for (const other of [
    { ...OWNER, principalId: "other-owner" },
    { ...OWNER, workspaceId: "other-ws" },
  ]) {
    const { store } = makeStore({ maxPlans: 2 });
    const plan = store.save({ ...OWNER, content: CONTENT });
    store.save({ ...other, content: CONTENT });
    store.save({ ...other, content: CONTENT });

    assert.deepEqual(store.take({ ...OWNER, planId: plan.planId }), { ok: true, plan },
      "another caller's plans must not consume this caller's retention budget");
  }
});

test("expired plans are swept on save, so they never push out a live one", () => {
  const { store, clock } = makeStore({ maxPlans: 2 });
  const stale = store.save({ ...OWNER, content: CONTENT });
  const other = { ...OWNER, workspaceId: "expired-workspace" };
  const otherStale = store.save({ ...other, content: CONTENT });
  clock.ms += 10_000;
  const live = store.save({ ...OWNER, content: CONTENT });
  clock.ms = stale.expiresAtMs;
  const fresh = store.save({ ...OWNER, content: CONTENT });
  assert.equal(store.take({ planId: live.planId, ...OWNER }).ok, true, "the live plan survived: the expired one made the room");
  assert.equal(store.take({ planId: fresh.planId, ...OWNER }).ok, true);
  assert.deepEqual(store.take({ planId: otherStale.planId, ...other }), { ok: false, code: "PLAN_NOT_FOUND" });
});

test("default plans use UUID ids, a ten-minute lifetime and a two-plan cap", () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  const store = new SiteBackupPlanStore<typeof CONTENT>({});
  const first = store.save({ ...OWNER, content: CONTENT });
  const second = store.save({ ...OWNER, content: CONTENT });
  const third = store.save({ ...OWNER, content: CONTENT });
  assert.equal(DEFAULT_PLAN_TTL_MS, 600_000);
  assert.equal(DEFAULT_MAX_PLANS, 2);
  assert.equal(DEFAULT_MAX_TOTAL_PLANS, 8);
  assert.equal(first.expiresAtMs, 601_000);
  assert.match(first.planId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set([first.planId, second.planId, third.planId]).size, 3);
  assert.deepEqual(store.take({ ...OWNER, planId: first.planId }), { ok: false, code: "PLAN_NOT_FOUND" });
  assert.deepEqual(store.take({ ...OWNER, planId: second.planId }), { ok: true, plan: second });
  assert.deepEqual(store.take({ ...OWNER, planId: third.planId }), { ok: true, plan: third });
});

test("a zero configured cap keeps only the plan just returned instead of looping on an empty store", () => {
  const { store } = makeStore({ maxPlans: 0 });
  const first = store.save({ ...OWNER, content: CONTENT });
  const second = store.save({ ...OWNER, content: CONTENT });
  assert.deepEqual(store.take({ ...OWNER, planId: first.planId }), { ok: false, code: "PLAN_NOT_FOUND" });
  assert.deepEqual(store.take({ ...OWNER, planId: second.planId }), { ok: true, plan: second });
});

test("the overall cap evicts the oldest plan across owners before the per-owner cap is reached", () => {
  const { store } = makeStore({ maxPlans: 3, maxTotalPlans: 2 });
  const other = { ...OWNER, principalId: "other-owner" };
  const first = store.save({ ...OWNER, content: CONTENT });
  const second = store.save({ ...other, content: CONTENT });
  const third = store.save({ ...OWNER, content: CONTENT });
  assert.deepEqual(store.take({ ...OWNER, planId: first.planId }), { ok: false, code: "PLAN_NOT_FOUND" });
  assert.deepEqual(store.take({ ...other, planId: second.planId }), { ok: true, plan: second });
  assert.deepEqual(store.take({ ...OWNER, planId: third.planId }), { ok: true, plan: third });
});
