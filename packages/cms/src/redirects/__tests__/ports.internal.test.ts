import assert from "node:assert/strict";
import { test } from "vitest";

import { insertRedirectAndRevision, type RedirectDbHandle } from "../ports.internal.js";
import type { RedirectRecord, RedirectRevision } from "../types.js";

/**
 * @file T004 (INV-01) — `insertRedirectAndRevision` is the sole path INV-01
 * depends on: exactly 1 record write + 1 revision write per call, in call
 * order, against whatever `RedirectDbHandle` is passed in (no transaction
 * control of its own — Decision A).
 */

function makeRecord(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id: "redirect-1",
    workspaceId: "workspace-1",
    matchType: "exact",
    fromPattern: "/old",
    toTarget: "/new",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: "user-1",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeRevision(record: RedirectRecord, seq = 1): RedirectRevision {
  return {
    redirectId: record.id,
    workspaceId: record.workspaceId,
    seq,
    state: record,
    tombstoned: false,
    actorId: record.createdByPrincipal,
    recordedAt: record.createdAt,
  };
}

/** A fake `RedirectDbHandle` recording call order — no real storage, no transaction concept. */
function makeFakeDb() {
  const calls: string[] = [];
  const records: RedirectRecord[] = [];
  const revisions: RedirectRevision[] = [];
  const db: RedirectDbHandle = {
    insertRedirect(record) {
      calls.push("insertRedirect");
      records.push(record);
    },
    insertRevision(revision) {
      calls.push("insertRevision");
      revisions.push(revision);
    },
  };
  return { db, calls, records, revisions };
}

test("insertRedirectAndRevision writes exactly 1 record + 1 revision, in call order", async () => {
  const { db, calls, records, revisions } = makeFakeDb();
  const record = makeRecord();
  const revision = makeRevision(record);

  await insertRedirectAndRevision({ db, record, revision });

  assert.deepEqual(calls, ["insertRedirect", "insertRevision"]);
  assert.equal(records.length, 1);
  assert.equal(revisions.length, 1);
  assert.deepEqual(records[0], record);
  assert.deepEqual(revisions[0], revision);
});

test("insertRedirectAndRevision issues no transaction control of its own (no begin/commit-shaped calls)", async () => {
  const { db, records, revisions } = makeFakeDb();
  const transactionCalls: string[] = [];
  const observed = { ...db, begin: () => transactionCalls.push("begin"), commit: () => transactionCalls.push("commit"),
    rollback: () => transactionCalls.push("rollback"), transaction: () => transactionCalls.push("transaction") };
  const record = makeRecord();
  await insertRedirectAndRevision({ db: observed, record, revision: makeRevision(record) });
  assert.deepEqual(records, [record]);
  assert.deepEqual(revisions, [makeRevision(record)]);
  assert.deepEqual(transactionCalls, []);
});

test("insertRedirectAndRevision called twice against the SAME db handle (simulating the chokepoint then the capture slot sharing a connection) persists both", async () => {
  const { db, records, revisions } = makeFakeDb();
  const first = makeRecord({ id: "redirect-1", fromPattern: "/old-1" });
  const firstRevision = makeRevision(first);
  const second = makeRecord({ id: "redirect-2", fromPattern: "/old-2", source: "auto_slug_change" });
  const secondRevision = makeRevision(second);

  // First call: as if from redirects.ts's own-transaction chokepoint path.
  await insertRedirectAndRevision({ db, record: first, revision: firstRevision });
  // Second call: as if from capture.ts's ambient-transaction path, sharing
  // the same connection/handle.
  await insertRedirectAndRevision({ db, record: second, revision: secondRevision });

  assert.equal(records.length, 2);
  assert.equal(revisions.length, 2);
  assert.deepEqual(records.map((r) => r.id), ["redirect-1", "redirect-2"]);
  assert.deepEqual(revisions.map((r) => r.redirectId), ["redirect-1", "redirect-2"]);
});

test("insertRedirectAndRevision propagates a throw from the db handle uncaught", async () => {
  const record = makeRecord();
  const revision = makeRevision(record);
  const db: RedirectDbHandle = {
    insertRedirect() {
      throw new Error("boom");
    },
    insertRevision() {
      throw new Error("should not be reached");
    },
  };

  await assert.rejects(() => insertRedirectAndRevision({ db, record, revision }), /boom/);
});

test("writes await the redirect before the revision and propagate a later asynchronous revision failure", async () => {
  let releaseRedirect!: () => void;
  const redirectWrite = new Promise<void>(resolve => { releaseRedirect = resolve; });
  let rejectRevision!: (err: Error) => void;
  const revisionWrite = new Promise<void>((_, reject) => { rejectRevision = reject; });
  const calls: string[] = [];
  const record = makeRecord();
  let settled = false;
  const done = insertRedirectAndRevision({ record, revision: makeRevision(record), db: {
    insertRedirect: () => { calls.push("redirect"); return redirectWrite; },
    insertRevision: () => { calls.push("revision"); return revisionWrite; },
  } });
  const observed = done.finally(() => { settled = true; });
  const rejection = assert.rejects(observed, { message: "revision disk failure" });
  await new Promise<void>(resolve => setImmediate(resolve));
  const callsBeforeRelease = [...calls];
  const settledBeforeRelease = settled;
  releaseRedirect();
  await new Promise<void>(resolve => setImmediate(resolve));
  const callsBeforeRevisionFailure = [...calls];
  const settledBeforeRevisionFailure = settled;
  rejectRevision(new Error("revision disk failure"));
  await rejection;
  assert.deepEqual(callsBeforeRelease, ["redirect"]);
  assert.equal(settledBeforeRelease, false);
  assert.deepEqual(callsBeforeRevisionFailure, ["redirect", "revision"]);
  assert.equal(settledBeforeRevisionFailure, false);
});
