import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryRedirectRepo } from "../repo.memory.js";
import { SqlRedirectRepo } from "../sql/repo.js";
import { eachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { createTables } from "./support/redirects-tables.fixture.js";
import type { RedirectRepoPort } from "../ports.js";
import { RedirectNotFoundError, type RedirectRecord, type RedirectRevision } from "../types.js";

/**
 * @file T007 — shared `RedirectRepoPort` contract-test suite, run against
 * BOTH `repo.memory.ts` and `repo.sqlite.ts` (rule-of-two, ADR-006). Covers
 * rule CRUD (`save`/`tombstone`/`findById`/`list`), the index-backed lookups
 * (`lookupExact`/`lookupLongestPrefix`/`listDynamic`), and
 * `findByFromPattern` (write-time collapse/cycle detection support).
 */

function makeRecord(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id: overrides.id ?? "redirect-1",
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

function runContractSuite(label: string, makeRepo: () => RedirectRepoPort & { listRevisionsForTests(required: { redirectId: string }, optional?: Record<string, never>): RedirectRevision[] | Promise<RedirectRevision[]> }) {
  test(`[${label}] save() then findById() round-trips the record`, async () => {
    const repo = makeRepo();
    const record = makeRecord();
    await repo.save({ record, revision: makeRevision(record) });

    const found = await repo.findById({ workspaceId: "workspace-1", id: record.id });
    assert.ok(found);
    assert.equal(found?.fromPattern, "/old");
    assert.equal(found?.toTarget, "/new");
  });

  test(`[${label}] findById returns null for a different workspace`, async () => {
    const repo = makeRepo();
    const record = makeRecord();
    await repo.save({ record, revision: makeRevision(record) });

    const found = await repo.findById({ workspaceId: "workspace-other", id: record.id });
    assert.equal(found, null);
  });

  test(`[${label}] lookupExact finds an active exact rule by path`, async () => {
    const repo = makeRepo();
    const record = makeRecord({ id: "r-exact", matchType: "exact", fromPattern: "/a" });
    await repo.save({ record, revision: makeRevision(record) });

    const found = await repo.lookupExact({
      workspaceId: "workspace-1",
      path: "/a",
      includeOverrideOnly: false,
    });
    assert.ok(found);
    assert.equal(found?.id, "r-exact");
  });

  test(`[${label}] lookupExact excludes a disabled rule`, async () => {
    const repo = makeRepo();
    const record = makeRecord({ id: "r-disabled", matchType: "exact", fromPattern: "/a", status: "disabled" });
    await repo.save({ record, revision: makeRevision(record) });

    const found = await repo.lookupExact({
      workspaceId: "workspace-1",
      path: "/a",
      includeOverrideOnly: false,
    });
    assert.equal(found, null);
  });

  test(`[${label}] lookupExact with includeOverrideOnly excludes non-override rules`, async () => {
    const repo = makeRepo();
    const record = makeRecord({ id: "r-non-override", matchType: "exact", fromPattern: "/a", override: false });
    await repo.save({ record, revision: makeRevision(record) });

    const found = await repo.lookupExact({
      workspaceId: "workspace-1",
      path: "/a",
      includeOverrideOnly: true,
    });
    assert.equal(found, null);
  });

  test(`[${label}] lookupLongestPrefix picks the longest matching prefix`, async () => {
    const repo = makeRepo();
    const short = makeRecord({ id: "short", matchType: "prefix", fromPattern: "/a" });
    const long = makeRecord({ id: "long", matchType: "prefix", fromPattern: "/a/b" });
    await repo.save({ record: short, revision: makeRevision(short) });
    await repo.save({ record: long, revision: makeRevision(long) });

    const found = await repo.lookupLongestPrefix({
      workspaceId: "workspace-1",
      path: "/a/b/c",
      includeOverrideOnly: false,
    });
    assert.equal(found?.id, "long");
  });

  test(`[${label}] lookupLongestPrefix with includeOverrideOnly skips a longer non-override prefix`, async () => {
    const repo = makeRepo();
    const overrideShort = makeRecord({ id: "override-short", matchType: "prefix", fromPattern: "/a", override: true });
    const plainLong = makeRecord({ id: "plain-long", matchType: "prefix", fromPattern: "/a/b", override: false });
    await repo.save({ record: overrideShort, revision: makeRevision(overrideShort) });
    await repo.save({ record: plainLong, revision: makeRevision(plainLong) });
    // Never prefix candidates, however long: an exact rule and a disabled prefix rule.
    const exactLonger = makeRecord({ id: "exact-longer", matchType: "exact", fromPattern: "/a/b/c", override: true });
    const disabledLonger = makeRecord({ id: "disabled-longer", matchType: "prefix", fromPattern: "/a/b/c", status: "disabled", override: true });
    await repo.save({ record: exactLonger, revision: makeRevision(exactLonger) });
    await repo.save({ record: disabledLonger, revision: makeRevision(disabledLonger) });

    const overrideOnly = await repo.lookupLongestPrefix({ workspaceId: "workspace-1", path: "/a/b/c", includeOverrideOnly: true });
    assert.equal(overrideOnly?.id, "override-short");
    const any = await repo.lookupLongestPrefix({ workspaceId: "workspace-1", path: "/a/b/c", includeOverrideOnly: false });
    assert.equal(any?.id, "plain-long");
  });

  test(`[${label}] listDynamic returns only active wildcard rules, capped at limit`, async () => {
    const repo = makeRepo();
    for (const matchType of ["exact", "prefix"] as const) {
      const record = makeRecord({ id: `distractor-${matchType}`, matchType, fromPattern: "/a-very-long-distractor" });
      await repo.save({ record, revision: makeRevision(record) });
    }
    for (let i = 0; i < 3; i++) {
      const record = makeRecord({
        id: `wc-${i}`,
        matchType: "wildcard",
        fromPattern: `/wc-${"long".repeat(i)}/*`,
        toTarget: "/x/$1",
      });
      await repo.save({ record, revision: makeRevision(record) });
    }
    const disabled = makeRecord({ id: "wc-disabled", matchType: "wildcard", fromPattern: "/d/*", status: "disabled" });
    await repo.save({ record: disabled, revision: makeRevision(disabled) });

    const dynamic = await repo.listDynamic({ workspaceId: "workspace-1", includeOverrideOnly: false, limit: 2 });
    assert.equal(dynamic.length, 2);
    assert.ok(dynamic.every((r) => r.status === "active"));
    assert.deepEqual(dynamic.map(r => r.id), ["wc-2", "wc-1"]);
  });

  test(`[${label}] list applies status/source/matchType filters`, async () => {
    const repo = makeRepo();
    const a = makeRecord({ id: "a", matchType: "exact", fromPattern: "/a", source: "manual" });
    const b = makeRecord({ id: "b", matchType: "prefix", fromPattern: "/b", source: "import", status: "disabled" });
    await repo.save({ record: a, revision: makeRevision(a) });
    await repo.save({ record: b, revision: makeRevision(b) });

    const onlyDisabled = await repo.list({ workspaceId: "workspace-1", status: "disabled" });
    assert.deepEqual(onlyDisabled.map((r) => r.id), ["b"]);

    const onlyImport = await repo.list({ workspaceId: "workspace-1", source: "import" });
    assert.deepEqual(onlyImport.map((r) => r.id), ["b"]);

    const onlyPrefix = await repo.list({ workspaceId: "workspace-1", matchType: "prefix" });
    assert.deepEqual(onlyPrefix.map((r) => r.id), ["b"]);

    const all = await repo.list({ workspaceId: "workspace-1" });
    assert.equal(all.length, 2);
  });

  test(`[${label}] findByFromPattern finds an active rule with the given fromPattern`, async () => {
    const repo = makeRepo();
    const record = makeRecord({ id: "chain-a", fromPattern: "/a", toTarget: "/b" });
    await repo.save({ record, revision: makeRevision(record) });

    const found = await repo.findByFromPattern({ workspaceId: "workspace-1", fromPattern: "/a" });
    assert.equal(found?.id, "chain-a");
  });

  test(`[${label}] findByFromPattern returns null when no rule matches`, async () => {
    const repo = makeRepo();
    const found = await repo.findByFromPattern({ workspaceId: "workspace-1", fromPattern: "/none" });
    assert.equal(found, null);
  });

  test(`[${label}] tombstone flips status to disabled and appends the tombstone revision`, async () => {
    const repo = makeRepo();
    const record = makeRecord({ id: "to-tombstone" });
    await repo.save({ record, revision: makeRevision(record) });

    const tombstoned: RedirectRecord = { ...record, status: "disabled", version: 2, updatedAt: "2026-07-14T00:00:00.000Z" };
    const revision: RedirectRevision = {
      redirectId: record.id,
      workspaceId: record.workspaceId,
      seq: 2,
      state: tombstoned,
      tombstoned: true,
      actorId: "user-1",
      recordedAt: "2026-07-14T00:00:00.000Z",
    };
    await repo.tombstone({ workspaceId: "workspace-1", id: record.id, revision });

    const found = await repo.findById({ workspaceId: "workspace-1", id: record.id });
    assert.equal(found?.status, "disabled");
    const ledger = await repo.listRevisionsForTests({ redirectId: record.id }, {});
    assert.deepEqual(ledger.map(r => [r.redirectId, r.workspaceId, r.seq, r.tombstoned, r.actorId, r.recordedAt, r.state]), [
      [record.id, record.workspaceId, 1, false, "user-1", record.createdAt, record],
      [record.id, record.workspaceId, 2, true, "user-1", "2026-07-14T00:00:00.000Z", tombstoned],
    ]);

    // Tombstoned but still listable when no status filter is applied (AC-07).
    const listed = await repo.list({ workspaceId: "workspace-1" });
    assert.equal(listed.length, 1);

    // No longer matched (AC-07's other half — via lookupExact).
    const matched = await repo.lookupExact({ workspaceId: "workspace-1", path: record.fromPattern, includeOverrideOnly: false });
    assert.equal(matched, null);
  });

  test(`[${label}] save() upserts (an update replaces the prior record state)`, async () => {
    const repo = makeRepo();
    const record = makeRecord({ id: "upsert-me", toTarget: "/first" });
    await repo.save({ record, revision: makeRevision(record) });

    const updated = { ...record, toTarget: "/second", version: 2, updatedAt: "2026-07-14T00:00:00.000Z" };
    await repo.save({ record: updated, revision: makeRevision(updated, 2) });

    const found = await repo.findById({ workspaceId: "workspace-1", id: record.id });
    assert.equal(found?.toTarget, "/second");
    assert.equal(found?.version, 2);
  });
}

runContractSuite("memory", () => new InMemoryRedirectRepo());

for (const dialect of eachDialect({
  tables: ["redirects", "redirect_revisions"],
  createTables,
  make: (kernel) => new SqlRedirectRepo({ kernel, tables: { redirects: "redirects", revisions: "redirect_revisions" } }, {}),
}, {})) runContractSuite(dialect.name, dialect.make);

test("InMemoryRedirectRepo: constructor seeding and listRevisionsForTests", async () => {
  const seedRecord = makeRecord({ id: "seed-1" });
  const repo = new InMemoryRedirectRepo({ seed: [seedRecord] }, {});
  const found = await repo.findById({ workspaceId: "workspace-1", id: "seed-1" });
  assert.equal(found?.id, "seed-1");

  // listRevisionsForTests
  repo.insertRevision(makeRevision(seedRecord, 2));
  repo.insertRevision(makeRevision(seedRecord, 1));
  const revs = repo.listRevisionsForTests({ redirectId: "seed-1" }, {});
  assert.ok(revs[0]);
  assert.equal(revs[0].seq, 1);
  assert.ok(revs[1]);
  assert.equal(revs[1].seq, 2);
  assert.deepEqual(repo.listRevisionsForTests({ redirectId: "non-existent" }, {}), []);
});

test("InMemoryRedirectRepo: tombstone throws RedirectNotFoundError if not found or workspace mismatch", async () => {
  const repo = new InMemoryRedirectRepo();
  const record = makeRecord({ id: "t-1", workspaceId: "ws-1" });
  await repo.save({ record, revision: makeRevision(record) });

  await assert.rejects(
    () => repo.tombstone({ workspaceId: "ws-1", id: "non-existent", revision: makeRevision(record) }),
    RedirectNotFoundError
  );
  await assert.rejects(
    () => repo.tombstone({ workspaceId: "ws-other", id: "t-1", revision: makeRevision(record) }),
    RedirectNotFoundError
  );
});

test("InMemoryRedirectRepo: lookupLongestPrefix with trailing slash, exact path, override filter, null when none match", async () => {
  const repo = new InMemoryRedirectRepo();
  const slashPrefix = makeRecord({ id: "slash", matchType: "prefix", fromPattern: "/docs/", override: false });
  const exactPrefix = makeRecord({ id: "exact-p", matchType: "prefix", fromPattern: "/about", override: true });
  await repo.save({ record: slashPrefix, revision: makeRevision(slashPrefix) });
  await repo.save({ record: exactPrefix, revision: makeRevision(exactPrefix) });

  // trailing slash pattern matches subpath
  const foundSub = await repo.lookupLongestPrefix({ workspaceId: "workspace-1", path: "/docs/page", includeOverrideOnly: false });
  assert.equal(foundSub?.id, "slash");

  // exact path match on prefix rule
  const foundExact = await repo.lookupLongestPrefix({ workspaceId: "workspace-1", path: "/about", includeOverrideOnly: false });
  assert.equal(foundExact?.id, "exact-p");

  // includeOverrideOnly excludes slashPrefix
  const foundOverride = await repo.lookupLongestPrefix({ workspaceId: "workspace-1", path: "/docs/page", includeOverrideOnly: true });
  assert.equal(foundOverride, null);

  // no match
  const foundNone = await repo.lookupLongestPrefix({ workspaceId: "workspace-1", path: "/nomatch", includeOverrideOnly: false });
  assert.equal(foundNone, null);
});

test("InMemoryRedirectRepo: listDynamic with includeOverrideOnly and tie-breaking", async () => {
  const repo = new InMemoryRedirectRepo();
  const wc1 = makeRecord({ id: "wc-1", matchType: "wildcard", fromPattern: "/a/*", priority: 1, override: false });
  const wc2 = makeRecord({ id: "wc-2", matchType: "wildcard", fromPattern: "/b/*", priority: 2, override: true });
  const wc3 = makeRecord({ id: "wc-3", matchType: "wildcard", fromPattern: "/b/*", priority: 2, override: true, updatedAt: "2026-07-15T00:00:00.000Z" });
  await repo.save({ record: wc1, revision: makeRevision(wc1) });
  await repo.save({ record: wc2, revision: makeRevision(wc2) });
  await repo.save({ record: wc3, revision: makeRevision(wc3) });

  // override only
  const overrideOnly = await repo.listDynamic({ workspaceId: "workspace-1", includeOverrideOnly: true, limit: 10 });
  assert.equal(overrideOnly.length, 2);
  assert.ok(overrideOnly[0]);
  assert.equal(overrideOnly[0].id, "wc-3"); // higher recency

  // lookupExact tie-break
  const ex1 = makeRecord({ id: "ex-1", matchType: "exact", fromPattern: "/tie", priority: 5 });
  const ex2 = makeRecord({ id: "ex-2", matchType: "exact", fromPattern: "/tie", priority: 10 });
  await repo.save({ record: ex1, revision: makeRevision(ex1) });
  await repo.save({ record: ex2, revision: makeRevision(ex2) });
  const foundTie = await repo.lookupExact({ workspaceId: "workspace-1", path: "/tie", includeOverrideOnly: false });
  assert.equal(foundTie?.id, "ex-2"); // higher priority
});

test("InMemoryRedirectRepo: findByFromPattern tie breaks exact before prefix, then by id", async () => {
  const repo = new InMemoryRedirectRepo();
  const pref = makeRecord({ id: "b-pref", matchType: "prefix", fromPattern: "/pattern" });
  const exact = makeRecord({ id: "a-exact", matchType: "exact", fromPattern: "/pattern" });
  await repo.save({ record: pref, revision: makeRevision(pref) });
  await repo.save({ record: exact, revision: makeRevision(exact) });

  const found = await repo.findByFromPattern({ workspaceId: "workspace-1", fromPattern: "/pattern" });
  assert.equal(found?.id, "a-exact");

  // Two exact rules tie break by id
  const repo2 = new InMemoryRedirectRepo();
  const e1 = makeRecord({ id: "id-b", matchType: "exact", fromPattern: "/same" });
  const e2 = makeRecord({ id: "id-a", matchType: "exact", fromPattern: "/same" });
  await repo2.save({ record: e1, revision: makeRevision(e1) });
  await repo2.save({ record: e2, revision: makeRevision(e2) });
  const found2 = await repo2.findByFromPattern({ workspaceId: "workspace-1", fromPattern: "/same" });
  assert.equal(found2?.id, "id-a");
});
