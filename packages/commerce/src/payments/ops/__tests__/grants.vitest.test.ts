import { describe, expect, test } from "vitest";

import { createMemoryGrantStore, sameGrantBinding, type MoneyGrantBinding } from "../grants.js";

const binding: MoneyGrantBinding = {
  op: "refund", workspaceId: "ws", mode: "test", paymentId: "pay_1", amount: { minorUnits: 3_000, currency: "USD" }, idempotencyKey: "rk-1",
};

function store() {
  let clock = 1_000;
  let seq = 0;
  const grants = createMemoryGrantStore({ now: () => clock, newToken: () => `tok_${++seq}` });
  return { grants, tick: (ms: number) => { clock += ms; } };
}

describe("sameGrantBinding", () => {
  test.each([
    ["op", { op: "capture" as const }],
    ["workspace", { workspaceId: "ws-2" }],
    ["mode", { mode: "live" as const }],
    ["payment", { paymentId: "pay_2" }],
    ["amount", { amount: { minorUnits: 3_001, currency: "USD" } }],
    ["currency", { amount: { minorUnits: 3_000, currency: "EUR" } }],
    ["no amount vs an amount", { amount: null }],
    ["idempotency key", { idempotencyKey: "rk-2" }],
  ])("a different %s does not match", (_name, change) => {
    expect(sameGrantBinding({ a: binding, b: { ...binding, ...change } })).toBe(false);
    expect(sameGrantBinding({ a: { ...binding, ...change }, b: binding })).toBe(false);
  });
  test("equal bindings match, with or without an amount", () => {
    expect(sameGrantBinding({ a: binding, b: { ...binding, amount: { ...binding.amount! } } })).toBe(true);
    expect(sameGrantBinding({ a: { ...binding, amount: null }, b: { ...binding, amount: null } })).toBe(true);
  });
});

describe("createMemoryGrantStore", () => {
  test("a grant redeems exactly once for its exact binding", async () => {
    const { grants } = store();
    const grant = await grants.mint({ binding, expiresAt: 5_000 });
    expect(grant).toBe("tok_1");
    expect(await grants.redeem({ grant, binding })).toBe(true);
    expect(await grants.redeem({ grant, binding })).toBe(false);
  });

  test("a mismatching redeem is refused and does NOT consume the grant", async () => {
    const { grants } = store();
    const grant = await grants.mint({ binding, expiresAt: 5_000 });
    expect(await grants.redeem({ grant, binding: { ...binding, amount: { minorUnits: 9_999, currency: "USD" } } })).toBe(false);
    expect(await grants.redeem({ grant, binding })).toBe(true);
  });

  test("an unknown token is refused", async () => {
    const { grants } = store();
    expect(await grants.redeem({ grant: "guess", binding })).toBe(false);
  });

  test("an expired grant is refused, at and after expiry", async () => {
    const { grants, tick } = store();
    const grant = await grants.mint({ binding, expiresAt: 2_000 });
    tick(1_000);
    expect(await grants.redeem({ grant, binding })).toBe(false);
    tick(1);
    expect(await grants.redeem({ grant, binding })).toBe(false);
  });

  test("the stored binding is a copy: mutating the caller's object later changes nothing", async () => {
    const { grants } = store();
    const mine = { ...binding };
    const grant = await grants.mint({ binding: mine, expiresAt: 5_000 });
    (mine as { paymentId: string }).paymentId = "pay_other";
    expect(await grants.redeem({ grant, binding })).toBe(true);
  });

  test("concurrent redeems of one grant: exactly one wins", async () => {
    const { grants } = store();
    const grant = await grants.mint({ binding, expiresAt: 5_000 });
    const results = await Promise.all([1, 2, 3].map(() => grants.redeem({ grant, binding })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a token source that repeats a live token is refused at mint", async () => {
    const grants = createMemoryGrantStore({ now: () => 0, newToken: () => "same" });
    await grants.mint({ binding, expiresAt: 5 });
    await expect(grants.mint({ binding, expiresAt: 5 })).rejects.toThrow(/repeated a live token/);
  });
});
