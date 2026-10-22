/** Deadline and scheduler-failure edges of the surface exchange store, driven by a manual clock and a
 * hand-written scheduler so "the deadline passed but its timer has not fired yet" is reproducible. */
import { expect, test } from "vitest";
import { createSurfaceExchangeStore } from "../surface-exchanges.js";

function manualDeps({ failOnSchedule = Number.POSITIVE_INFINITY }: { failOnSchedule?: number } = {}) {
  let now = 1_000;
  let scheduled = 0;
  const cancelled: number[] = [];
  let ids = 0;
  return {
    advance: (ms: number) => { now += ms; },
    cancelled,
    deps: {
      clock: { nowMs: () => now },
      idGenerator: { newId: () => `exchange-${++ids}` },
      defaultChannel: "mcp-ui" as const,
      scheduler: {
        schedule: () => {
          const handle = ++scheduled;
          if (handle >= failOnSchedule) throw new Error("scheduler offline");
          return () => { cancelled.push(handle); };
        },
      },
    },
  };
}

const binding = { toolId: "t", principalId: "p" };
const emit = async () => {};

test("non-finite or non-positive deadlines are refused when the store is created", () => {
  const { deps } = manualDeps();
  for (const options of [{ idleTtlMs: 0 }, { idleTtlMs: Number.NaN }, { maxLifetimeMs: -1 }, { maxLifetimeMs: Number.POSITIVE_INFINITY }]) {
    expect(() => createSurfaceExchangeStore(deps, options)).toThrow("surface deadlines must be finite and positive");
  }
});

test("a scheduler failure while arming the idle timer cancels the lifetime timer and registers nothing", () => {
  // Handle 1 is the lifetime timer; handle 2 (the idle timer) throws.
  const { deps, cancelled } = manualDeps({ failOnSchedule: 2 });
  const store = createSurfaceExchangeStore(deps, { idleTtlMs: 100, maxLifetimeMs: 1_000 });

  expect(() => store.open({ binding, emit })).toThrow("scheduler offline");
  expect(cancelled).toEqual([1]);
  expect(store.deliver({ exchangeId: "exchange-1", principalId: "p", params: {} })).toEqual({ ok: false, reason: "unknown-or-closed" });
});

test("a delivery that arrives after the idle deadline passed, before its timer fired, expires the exchange instead of landing", async () => {
  const { deps, advance } = manualDeps();
  const store = createSurfaceExchangeStore(deps, { idleTtlMs: 100, maxLifetimeMs: 1_000 });
  const exchange = store.open({ binding, emit });

  advance(100);

  expect(store.deliver({ exchangeId: exchange.id, principalId: "p", params: { late: true } }, { toolId: "t" }))
    .toEqual({ ok: false, reason: "unknown-or-closed" });
  expect(await exchange.receive({})).toEqual({ status: "expired" });
});

test("a scheduler failure on the very first (lifetime) timer leaves nothing to cancel and registers nothing", () => {
  const { deps, cancelled } = manualDeps({ failOnSchedule: 1 });
  const store = createSurfaceExchangeStore(deps, { idleTtlMs: 100, maxLifetimeMs: 1_000 });

  expect(() => store.open({ binding, emit })).toThrow("scheduler offline");
  expect(cancelled).toEqual([]);
  expect(store.deliver({ exchangeId: "exchange-1", principalId: "p", params: {} })).toEqual({ ok: false, reason: "unknown-or-closed" });
});
