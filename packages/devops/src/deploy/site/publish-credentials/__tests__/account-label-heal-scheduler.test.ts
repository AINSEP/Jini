import { describe, expect, it } from "vitest";

import { createAccountLabelHealScheduler, idsNeedingAccountLabelHeal } from "../account-label-heal-scheduler.js";
import type { PublishCredentialSummary } from "../types.js";

/**
 * @file Regression coverage for a reported bug: an existing credential row saved before its first
 * auto-verify ever succeeded (or predating the verify/heal wiring entirely) stays `accountLabel: null`
 * forever unless a human clicks the per-row "Verify" action — an assistant then has no account to
 * default a publish's `owner` to, and refuses rather than guess (the correct behavior, but not what a
 * non-technical owner expects to have to fix by hand).
 *
 * This module is the fix: the host's human-gated list handler — the ONE non-agent-reachable read for
 * this table (only a human-gated caller may ever trigger a provider probe, never an agent tool) — calls
 * {@link idsNeedingAccountLabelHeal} to find every currently-null, healable-provider row, then
 * {@link AccountLabelHealScheduler.triggerFor} to heal each one in the background, non-blocking.
 *
 * `createAccountLabelHealScheduler`'s own tests are the load-bearing half of this coverage: the
 * scheduler sits directly behind a route handler's already-sent response — an async handler whose
 * background work rejects unguarded can take down the WHOLE server process (Express 4 does not catch
 * an async handler's own rejection). Every test below that exercises a REJECTING `heal` also asserts no
 * `unhandledRejection` fires, not just that `onHealError` was called — the callback firing proves the
 * happy path; the missing process event proves the guard.
 *
 * The reporter is a required input here (this package never logs); the host's bound reporter text is
 * pinned by the host's own test.
 */

function summary(overrides: Partial<PublishCredentialSummary> & Pick<PublishCredentialSummary, "id" | "providerId" | "accountLabel">): PublishCredentialSummary {
  return {
    credentialType: "vendor",
    worksFor: [overrides.providerId],
    publishHosts: [overrides.providerId],
    defaultFor: [],
    vendorId: overrides.providerId,
    label: "a token",
    tokenTail: "1234",
    configured: true,
    isDefault: false,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

/** Node's event loop runs all pending microtasks (promise `.then`/`.catch`/`.finally` chains) before
 *  any macrotask — `setImmediate` is a macrotask, so awaiting one guarantees every microtask queued so
 *  far (including a fire-and-forget `heal` promise's own settle-then-`.finally()` chain) has already
 *  run. A bare `await Promise.resolve()` only guarantees ONE microtask tick, which is not enough for a
 *  `.catch().finally()` chain (two extra ticks) — microtask assumptions are fragile, prefer a
 *  macrotask flush. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A reporter for tests that do not assert on failures; the scheduler requires one. */
const ignoreHealError = (): void => {};

describe("idsNeedingAccountLabelHeal", () => {
  it("selects only null-labeled rows on a healable provider", () => {
    const rows: PublishCredentialSummary[] = [
      summary({ id: "1", providerId: "github-pages", accountLabel: null }),
      summary({ id: "2", providerId: "github-pages", accountLabel: "octocat" }), // already healed
      summary({ id: "3", providerId: "netlify", accountLabel: null }), // never yields a label
    ];
    const canYield = (providerId: string) => providerId === "github-pages";

    expect(idsNeedingAccountLabelHeal({ credentials: rows, canYieldAccountLabel: canYield })).toStrictEqual(["1"]);
  });

  it("empty input, empty output (no false-positive candidates)", () => {
    expect(idsNeedingAccountLabelHeal({ credentials: [], canYieldAccountLabel: () => true })).toStrictEqual([]);
  });
});

describe("createAccountLabelHealScheduler", () => {
  it("calls heal exactly once per new id", () => {
    const calls: string[] = [];
    const scheduler = createAccountLabelHealScheduler({ heal: async ({ id }) => void calls.push(id), onHealError: ignoreHealError });

    scheduler.triggerFor(["a", "b"]);

    expect(calls).toStrictEqual(["a", "b"]);
  });

  it("does not re-trigger a heal already in flight", async () => {
    let callCount = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const scheduler = createAccountLabelHealScheduler({
      heal: async () => {
        callCount += 1;
        await gate;
      },
      onHealError: ignoreHealError,
    });

    scheduler.triggerFor(["a"]);
    scheduler.triggerFor(["a"]); // still in flight — must be skipped, not queued or re-called

    expect(callCount).toBe(1);
    releaseFirst();
    await flush();
  });

  it("re-triggers the SAME id once its previous attempt has settled", async () => {
    let callCount = 0;
    const scheduler = createAccountLabelHealScheduler({ heal: async () => void (callCount += 1), onHealError: ignoreHealError });

    scheduler.triggerFor(["a"]);
    await flush();
    scheduler.triggerFor(["a"]);
    await flush();

    expect(callCount).toBe(2);
  });

  it("a rejected heal is reported via onHealError, never thrown, and never an unhandled rejection", async () => {
    const errors: Array<{ id: string; err: unknown }> = [];
    const scheduler = createAccountLabelHealScheduler({
      heal: async () => {
        throw new Error("provider unreachable");
      },
      onHealError: ({ id, err }) => {
        errors.push({ id, err });
      },
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(() => scheduler.triggerFor(["a"])).not.toThrow();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(errors.length).toBe(1);
    expect(errors[0]!.id).toBe("a");
    expect(unhandled).toStrictEqual([]);
  });

  it("defends against a heal that throws synchronously instead of returning a rejected promise", () => {
    const errors: Array<{ id: string; err: unknown }> = [];
    const scheduler = createAccountLabelHealScheduler({
      // Deliberately NOT `async` — violates the documented `heal` contract (always return a Promise),
      // to prove the scheduler does not simply trust callers to get that right.
      heal: (() => {
        throw new Error("sync boom");
      }) as unknown as (required: { id: string }, optional?: Record<string, never>) => Promise<unknown>,
      onHealError: ({ id, err }) => {
        errors.push({ id, err });
      },
    });

    expect(() => scheduler.triggerFor(["a"])).not.toThrow();
    expect(errors.length).toBe(1);
  });

  it("an id that failed is eligible again on the next triggerFor (no permanent blacklist)", async () => {
    let callCount = 0;
    const scheduler = createAccountLabelHealScheduler({
      heal: async () => {
        callCount += 1;
        throw new Error("still unreachable");
      },
      onHealError: () => {},
    });

    scheduler.triggerFor(["a"]);
    await flush();
    scheduler.triggerFor(["a"]);
    await flush();

    expect(callCount).toBe(2);
  });

  it("an error reporter that itself throws is caught once more and reported under '*', never thrown back", () => {
    const reports: Array<{ id: string; message: string }> = [];
    const scheduler = createAccountLabelHealScheduler({
      heal: () => { throw new Error("sync heal failure"); },
      onHealError: ({ id, err }) => {
        reports.push({ id, message: (err as Error).message });
        if (id !== "*") throw new Error("reporter failed");
      },
    });
    expect(() => scheduler.triggerFor(["a", "b"])).not.toThrow();
    expect(reports).toStrictEqual([{ id: "a", message: "sync heal failure" }, { id: "*", message: "reporter failed" }]);
  });

  it("hands a failed heal's id and error to the injected reporter", async () => {
    const reported: Array<{ id: string; err: unknown }> = [];
    const failure = new Error("vault locked");
    createAccountLabelHealScheduler({ heal: async () => { throw failure; }, onHealError: (args) => { reported.push(args); } }).triggerFor(["cred-9"]);
    await flush();
    expect(reported).toStrictEqual([{ id: "cred-9", err: failure }]);
  });
});
