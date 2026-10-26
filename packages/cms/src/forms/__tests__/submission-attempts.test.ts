/** Boundary behaviour of the in-memory attempt store's `once` claim. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { createSubmissionAttempts, DUPLICATE_ATTEMPT, FORM_ATTEMPT_MAX_AGE_MS } from "../submission-attempts.js";

const identity = (value: string): string => value;

test("issuance: only a known scoped token supplies server age; rollback and expiry skip timing", () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  const scope = { workspaceId: "ws", slug: "contact", attemptToken: "issued" };
  attempts.issue({ ...scope, issuedAtMs: 100 });
  assert.equal(attempts.ageMs({ ...scope, nowMs: 100 }), 0);
  assert.equal(attempts.ageMs({ ...scope, nowMs: 1099 }), 999);
  assert.equal(attempts.ageMs({ ...scope, nowMs: 1100 }), 1000);
  for (const attemptToken of [undefined, null, 42, ["issued"], "unknown"]) {
    assert.equal(attempts.ageMs({ ...scope, attemptToken, nowMs: 100 }), undefined);
  }
  assert.equal(attempts.ageMs({ ...scope, workspaceId: "other", nowMs: 100 }), undefined);
  assert.equal(attempts.ageMs({ ...scope, slug: "other", nowMs: 100 }), undefined);
  assert.equal(attempts.ageMs({ ...scope, nowMs: 99 }), undefined);
  assert.equal(attempts.ageMs({ ...scope, nowMs: Number.NaN }), undefined);
  assert.equal(attempts.ageMs({ ...scope, nowMs: 100 + FORM_ATTEMPT_MAX_AGE_MS - 1 }), FORM_ATTEMPT_MAX_AGE_MS - 1);
  assert.equal(attempts.ageMs({ ...scope, nowMs: 100 + FORM_ATTEMPT_MAX_AGE_MS }), undefined);
  assert.equal(attempts.ageMs({ ...scope, nowMs: 100 }), undefined, "expired evidence cannot be resurrected by clock rollback");
});

test("issuance: at 10,000 entries the oldest is evicted without affecting newer evidence", () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  const scope = { workspaceId: "ws", slug: "contact" };
  for (let i = 0; i <= 10_000; i++) attempts.issue({ ...scope, attemptToken: `token-${i}`, issuedAtMs: 0 });
  assert.equal(attempts.ageMs({ ...scope, attemptToken: "token-0", nowMs: 0 }), undefined);
  assert.equal(attempts.ageMs({ ...scope, attemptToken: "token-1", nowMs: 0 }), 0);
  assert.equal(attempts.ageMs({ ...scope, attemptToken: "token-10000", nowMs: 0 }), 0);
});

test("issuance: registering again neither resets age nor changes scope and never claims a submit", async () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  const scope = { workspaceId: "ws", slug: "contact", attemptToken: "issued" };
  attempts.issue({ ...scope, issuedAtMs: 0 });
  attempts.issue({ ...scope, slug: "other", issuedAtMs: 100 });
  assert.equal(attempts.ageMs({ ...scope, nowMs: 100 }), 100);
  assert.equal(attempts.ageMs({ ...scope, slug: "other", nowMs: 100 }), undefined);
  const run = () => attempts.once({ key: "issued", nowMs: () => 100, submit: async () => "stored" });
  assert.equal(await run(), "stored");
  assert.equal(await run(), DUPLICATE_ATTEMPT);
  assert.equal(attempts.ageMs({ ...scope, nowMs: 101 }), 101);
});

test("issuance: expired records are forgotten as new pages are issued", () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  const scope = { workspaceId: "ws", slug: "contact" };
  attempts.issue({ ...scope, attemptToken: "old", issuedAtMs: 0 });
  attempts.issue({ ...scope, attemptToken: "fresh", issuedAtMs: FORM_ATTEMPT_MAX_AGE_MS });
  // Looking back with a rolled-back clock cannot resurrect the pruned old record.
  assert.equal(attempts.ageMs({ ...scope, attemptToken: "old", nowMs: 0 }), undefined);
  assert.equal(attempts.ageMs({ ...scope, attemptToken: "fresh", nowMs: FORM_ATTEMPT_MAX_AGE_MS }), 0);
});

test("issuance: invalid server times do not create evidence or reset a previously issued token", () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  const scope = { workspaceId: "ws", slug: "contact" };
  attempts.issue({ ...scope, attemptToken: "known", issuedAtMs: 0 });
  for (const issuedAtMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    attempts.issue({ ...scope, attemptToken: "invalid", issuedAtMs });
    attempts.issue({ ...scope, attemptToken: "known", issuedAtMs });
    assert.equal(attempts.ageMs({ ...scope, attemptToken: "invalid", nowMs: 1000 }), undefined);
    assert.equal(attempts.ageMs({ ...scope, attemptToken: "known", nowMs: 1000 }), 1000);
  }
});

function deferred(): { promise: Promise<string>; resolve: (value: string) => void; reject: (error: Error) => void } {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("once: two copies started in the same tick run submit once; the second is a duplicate", async () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  let calls = 0;
  const submit = async (): Promise<string> => { calls += 1; return "stored"; };
  const [first, second] = await Promise.all([
    attempts.once({ key: "k", nowMs: () => 0, submit }),
    attempts.once({ key: "k", nowMs: () => 0, submit }),
  ]);
  assert.deepEqual([first, second, calls], ["stored", DUPLICATE_ATTEMPT, 1]);
});

test("once: a copy waiting on a failed first copy runs submit itself", async () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  const gate = deferred();
  const first = attempts.once({ key: "k", nowMs: () => 0, submit: () => gate.promise });
  const second = attempts.once({ key: "k", nowMs: () => 0, submit: async () => "retry" });
  gate.reject(new Error("disk full"));
  await assert.rejects(first, { message: "disk full" });
  assert.equal(await second, "retry");
});

test("once: an accepted attempt outside the window runs submit again", async () => {
  const attempts = createSubmissionAttempts({ hash: identity }, { windowMs: 10 });
  let now = 0;
  await attempts.once({ key: "k", nowMs: () => now, submit: async () => "first" });
  now = 10;
  assert.equal(await attempts.once({ key: "k", nowMs: () => now, submit: async () => "again" }), "again");
});

test("once: an accepted attempt inside the window is a duplicate without calling submit", async () => {
  const attempts = createSubmissionAttempts({ hash: identity }, { windowMs: 10 });
  let now = 0;
  let calls = 0;
  const submit = async (): Promise<string> => { calls += 1; return "stored"; };
  await attempts.once({ key: "k", nowMs: () => now, submit });
  now = 9;
  assert.deepEqual([await attempts.once({ key: "k", nowMs: () => now, submit }), calls], [DUPLICATE_ATTEMPT, 1]);
});

test("once: a rejected submit frees the claim so the next attempt runs", async () => {
  const attempts = createSubmissionAttempts({ hash: identity });
  await assert.rejects(attempts.once({ key: "k", nowMs: () => 0, submit: async () => { throw new Error("db down"); } }), { message: "db down" });
  assert.equal(await attempts.once({ key: "k", nowMs: () => 0, submit: async () => "ok" }), "ok");
});

test("once: a claim evicted while pending is still remembered as accepted when it succeeds", async () => {
  const attempts = createSubmissionAttempts({ hash: identity }, { maxEntries: 1 });
  const gate = deferred();
  const first = attempts.once({ key: "a", nowMs: () => 0, submit: () => gate.promise });
  // maxEntries 1: claiming "b" evicts the pending "a" entry.
  await attempts.once({ key: "b", nowMs: () => 0, submit: async () => "b" });
  gate.resolve("a");
  assert.equal(await first, "a");
  assert.equal(await attempts.once({ key: "a", nowMs: () => 0, submit: async () => "again" }), DUPLICATE_ATTEMPT);
});

test("once: a claim evicted while pending does not remove a newer claim on the same key when it fails", async () => {
  const attempts = createSubmissionAttempts({ hash: identity }, { maxEntries: 1 });
  const gate = deferred();
  const first = attempts.once({ key: "a", nowMs: () => 0, submit: () => gate.promise });
  await attempts.once({ key: "b", nowMs: () => 0, submit: async () => "b" });
  // "a" was evicted, so this copy claims afresh and is accepted.
  assert.equal(await attempts.once({ key: "a", nowMs: () => 0, submit: async () => "newer" }), "newer");
  gate.reject(new Error("late failure"));
  await assert.rejects(first, { message: "late failure" });
  assert.equal(await attempts.once({ key: "a", nowMs: () => 0, submit: async () => "third" }), DUPLICATE_ATTEMPT);
});

test("once: a copy that waited on an accepted first copy is a duplicate, whatever its own clock reads on waking", async () => {
  const attempts = createSubmissionAttempts({ hash: identity }, { windowMs: 10 });
  const gate = deferred();
  let calls = 0;
  const first = attempts.once({ key: "k", nowMs: () => 0, submit: () => gate.promise });
  const waiter = attempts.once({ key: "k", nowMs: () => 100, submit: async () => { calls += 1; return "second"; } });
  gate.resolve("first");
  assert.deepEqual([await first, await waiter, calls], ["first", DUPLICATE_ATTEMPT, 0]);
});
