import { expect, test } from "vitest";
import { withProductAnalyticsGuards, type ProductAnalyticsPort, type ProductEvent, type ProductIdentity } from "../product/index.js";

function deferredConsent() {
  let resolve!: (allowed: boolean) => void;
  const promise = new Promise<boolean>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function recordingPort(): { inner: ProductAnalyticsPort; events: ProductEvent[]; identities: ProductIdentity[] } {
  const events: ProductEvent[] = [];
  const identities: ProductIdentity[] = [];
  return { events, identities, inner: {
    capture: (event) => { events.push(event); }, identify: (identity) => { identities.push(identity); },
  } };
}

test("obs2 #2: a later denial invalidates pending capture and identify approvals for that user", async () => {
  const { inner, events, identities } = recordingPort();
  const pending = deferredConsent();
  let answer: boolean | Promise<boolean> = pending.promise;
  const guarded = withProductAnalyticsGuards({ inner, consent: () => answer }, { consentRevision: () => 1 });
  guarded.capture({ name: "old_capture", userId: "u1" });
  guarded.identify({ userId: "u1", traits: { plan: "old" } });
  answer = false;
  guarded.capture({ name: "revoked", userId: "u1" });
  pending.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([]);
  expect(identities).toEqual([]);
  answer = true;
  guarded.capture({ name: "new_capture", userId: "u1" });
  guarded.identify({ userId: "u1", traits: { plan: "new" } });
  expect(events).toEqual([{ name: "new_capture", userId: "u1" }]);
  expect(identities).toEqual([{ userId: "u1", traits: { plan: "new" } }]);
});

test("an asynchronous denial invalidates earlier approvals before they settle", async () => {
  const { inner, events, identities } = recordingPort();
  const approval = deferredConsent();
  const denial = deferredConsent();
  let answer = approval.promise;
  const guarded = withProductAnalyticsGuards({ inner, consent: () => answer }, { consentRevision: () => 1 });
  guarded.capture({ name: "old_capture", userId: "u1" });
  guarded.identify({ userId: "u1" });
  answer = denial.promise;
  guarded.identify({ userId: "u1" });
  denial.resolve(false);
  await Promise.resolve();
  approval.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([]);
  expect(identities).toEqual([]);
});

test("obs2 #2: a settings revision invalidates approvals without a subsequent event, even after regrant", async () => {
  const { inner, events, identities } = recordingPort();
  const pending = deferredConsent();
  let revision = 1;
  let answer: boolean | Promise<boolean> = pending.promise;
  const revisionReads: string[] = [];
  const guarded = withProductAnalyticsGuards({ inner, consent: () => answer }, {
    consentRevision: ({ userId }) => { revisionReads.push(userId); return revision; },
  });
  guarded.capture({ name: "old_capture", userId: "u1" });
  guarded.identify({ userId: "u1" });
  revision += 1; // The host commits revocation; no analytics event is needed to observe it.
  revision += 1; // Regrant must not resurrect an approval from an earlier consent generation.
  pending.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([]);
  expect(identities).toEqual([]);
  expect(revisionReads).toEqual(["u1", "u1", "u1", "u1"]);
  answer = true;
  guarded.capture({ name: "fresh", userId: "u1" });
  guarded.identify({ userId: "u1" });
  expect(events).toEqual([{ name: "fresh", userId: "u1" }]);
  expect(identities).toEqual([{ userId: "u1" }]);
});

test("concurrent approvals at an unchanged revision both deliver", async () => {
  const { inner, events, identities } = recordingPort();
  const first = deferredConsent();
  const second = deferredConsent();
  const answers = [first.promise, second.promise];
  const guarded = withProductAnalyticsGuards({ inner, consent: () => answers.shift()! }, { consentRevision: () => "current" });
  guarded.capture({ name: "first", userId: "u1" });
  guarded.identify({ userId: "u1" });
  second.resolve(true);
  await Promise.resolve();
  first.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([{ name: "first", userId: "u1" }]);
  expect(identities).toEqual([{ userId: "u1" }]);
});

test("one user's denial does not invalidate another user's pending approval", async () => {
  const { inner, events } = recordingPort();
  const pending = deferredConsent();
  const guarded = withProductAnalyticsGuards({ inner, consent: ({ userId }) => userId === "u1" ? pending.promise : false }, { consentRevision: () => 1 });
  guarded.capture({ name: "allowed", userId: "u1" });
  guarded.identify({ userId: "u2" });
  pending.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([{ name: "allowed", userId: "u1" }]);
});

test.each(["throw", "reject"])("a consent %s invalidates earlier pending approvals", async (failure) => {
  const { inner, events, identities } = recordingPort();
  const pending = deferredConsent();
  let failed = false;
  const guarded = withProductAnalyticsGuards({ inner, consent: () => {
    if (!failed) return pending.promise;
    if (failure === "throw") throw new Error("settings unavailable");
    return Promise.reject(new Error("settings unavailable"));
  } }, { consentRevision: () => 1 });
  guarded.capture({ name: "old_capture", userId: "u1" });
  guarded.identify({ userId: "u1" });
  failed = true;
  guarded.capture({ name: "failed_check", userId: "u1" });
  await Promise.resolve();
  pending.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([]);
  expect(identities).toEqual([]);
});

test.each(["before", "after"])("a revision read failing %s consent drops the event without throwing", async (failure) => {
  const { inner, events, identities } = recordingPort();
  const pending = deferredConsent();
  let failed = failure === "before";
  const guarded = withProductAnalyticsGuards({ inner, consent: () => pending.promise }, {
    consentRevision: () => { if (failed) throw new Error("revision unavailable"); return 1; },
  });
  expect(() => guarded.capture({ name: "failed_check", userId: "u1" })).not.toThrow();
  expect(() => guarded.identify({ userId: "u1" })).not.toThrow();
  failed = true;
  pending.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([]);
  expect(identities).toEqual([]);
});

test("recheck #1: async consent without a revision fails closed; sync consent and async with a revision deliver", async () => {
  const { inner, events, identities } = recordingPort();
  const pending = deferredConsent();
  const unrevised = withProductAnalyticsGuards({ inner, consent: () => pending.promise });
  unrevised.capture({ name: "approved_then_revoked", userId: "u1" });
  unrevised.identify({ userId: "u1" });
  // The host revokes here; no later event or denial ever reaches the guard, then the old read settles.
  pending.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([]);
  expect(identities).toEqual([]);
  withProductAnalyticsGuards({ inner, consent: () => true }).capture({ name: "sync", userId: "u1" });
  const revised = deferredConsent();
  withProductAnalyticsGuards({ inner, consent: () => revised.promise }, { consentRevision: () => 1 }).identify({ userId: "u2" });
  revised.resolve(true);
  await Promise.resolve();
  expect(events).toEqual([{ name: "sync", userId: "u1" }]);
  expect(identities).toEqual([{ userId: "u2" }]);
});
