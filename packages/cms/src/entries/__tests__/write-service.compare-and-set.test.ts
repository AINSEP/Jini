import assert from "node:assert/strict";
import { test } from "vitest";

import { VersionConflictError } from "../errors.js";
import { InMemoryEntryRepo } from "../repo.memory.js";
import { importEntry, publishEntry, unpublishEntry, updateEntry, type EntryRepoPort, type EntryRevisionInput } from "../write-service.js";
import type { EntryRecord } from "../types.js";

/**
 * @file Entry writes are compare-and-set (wm S3): the version check lives in the repo's `save`,
 * inside the write's own transaction, so two writers that read the same version cannot both land.
 * Covers `InMemoryEntryRepo.save`'s `expectedVersion` contract and every service save that passes it
 * (`updateEntry`, `publishEntry`/`unpublishEntry`, an import-as-update); a loss is the Result's
 * `VersionConflictError`, never a throw.
 */

const WS = "ws-1";
const NOW = "2026-10-04T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const activeType = { findByKey: async () => ({ workspaceId: WS, key: "recipe", status: "active" as const, fields: [] }) };

function entry(overrides: Partial<EntryRecord> = {}): EntryRecord {
  return { id: "entry-1", workspaceId: WS, type: "recipe", slug: "chili", status: "draft", title: "Chili", fieldsJson: { ext: { site: {} } }, bodyJson: null, publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 1, ...overrides };
}

function fakeOutbox() {
  const events: Array<{ name: string }> = [];
  return { events, enqueue: async (event: { name: string }) => { events.push(event); } };
}

/** `InMemoryEntryRepo` that records revisions, and where another writer bumps `raceId` right after the service reads it. */
function racingRepo(seed: EntryRecord[], raceId: string | null) {
  const inner = new InMemoryEntryRepo();
  const revisions: EntryRevisionInput[] = [];
  const repo: EntryRepoPort = {
    findBySlug: (params) => inner.findBySlug(params),
    findById: async (params) => {
      const row = await inner.findById(params);
      if (row && row.id === raceId) await inner.save({ ...row, title: "Other writer", version: row.version + 1 });
      return row;
    },
    save: (row, options) => inner.save(row, options),
    appendRevision: async (revision) => {
      revisions.push(revision);
    },
    transaction: (required) => inner.transaction(required),
  };
  return { inner, repo, revisions, seeded: Promise.all(seed.map((row) => inner.save(row))) };
}

function assertLost(result: { ok: boolean; error?: unknown }, message: string): void {
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof VersionConflictError);
  assert.equal(result.error.message, message);
}

test("InMemoryEntryRepo.save with a matching expectedVersion writes the row", async () => {
  const repo = new InMemoryEntryRepo();
  await repo.save(entry());
  await repo.save(entry({ title: "New", version: 2 }), { expectedVersion: 1 });
  assert.deepEqual(await repo.findById({ workspaceId: WS, id: "entry-1" }), entry({ title: "New", version: 2 }));
});

test("InMemoryEntryRepo.save with a stale expectedVersion throws and leaves the row as it was", async () => {
  const repo = new InMemoryEntryRepo();
  await repo.save(entry({ version: 2 }));
  await assert.rejects(
    () => repo.save(entry({ title: "Stale", version: 2 }), { expectedVersion: 1 }),
    (error: unknown) => error instanceof VersionConflictError && error.message === "expected version 1 for entry 'entry-1', found 2"
  );
  assert.equal((await repo.findById({ workspaceId: WS, id: "entry-1" }))?.title, "Chili");
});

test("InMemoryEntryRepo.save with an expectedVersion finds none for a missing or other-workspace row", async () => {
  const repo = new InMemoryEntryRepo();
  await repo.save(entry({ id: "foreign", workspaceId: "ws-2" }));
  for (const id of ["missing", "foreign"]) {
    await assert.rejects(
      () => repo.save(entry({ id, version: 2 }), { expectedVersion: 1 }),
      (error: unknown) => error instanceof VersionConflictError && error.message === `expected version 1 for entry '${id}', found none`
    );
  }
  assert.equal(await repo.findById({ workspaceId: WS, id: "missing" }), null);
  assert.equal((await repo.findById({ workspaceId: "ws-2", id: "foreign" }))?.version, 1);
});

test("two concurrent updateEntry calls on the same base version: exactly one wins, the other gets a version conflict", async () => {
  const { inner, repo, revisions, seeded } = racingRepo([entry()], null);
  await seeded;
  const outbox = fakeOutbox();
  const edit = (title: string) =>
    updateEntry({ deps: { entryRepo: repo, contentTypeRepo: activeType, clock, authorize: alwaysAllow, outbox }, input: { workspaceId: WS, actorId: "user-1", id: "entry-1", title, expectedVersion: 1 } });
  const results = await Promise.all([edit("First"), edit("Second")]);

  assert.deepEqual(results.map((result) => result.ok), [true, false]);
  assertLost(results[1]!, "expected version 1 for entry 'entry-1', found 2");
  const stored = await inner.findById({ workspaceId: WS, id: "entry-1" });
  assert.deepEqual([stored?.title, stored?.version], ["First", 2]);
  assert.equal(revisions.length, 1, "the losing write appends no revision");
  assert.deepEqual(outbox.events.map((event) => event.name), ["entry.updated"]);
});

test("updateEntry loses to a writer that lands between its read and its save — no revision, no event", async () => {
  const { inner, repo, revisions, seeded } = racingRepo([entry()], "entry-1");
  await seeded;
  const outbox = fakeOutbox();
  const result = await updateEntry({
    deps: { entryRepo: repo, contentTypeRepo: activeType, clock, authorize: alwaysAllow, outbox },
    input: { workspaceId: WS, actorId: "user-1", id: "entry-1", title: "Mine", expectedVersion: 1 },
  });
  assertLost(result, "expected version 1 for entry 'entry-1', found 2");
  assert.equal((await inner.findById({ workspaceId: WS, id: "entry-1" }))?.title, "Other writer");
  assert.deepEqual([revisions, outbox.events], [[], []]);
});

test("updateEntry with a stale expectedVersion is the save's version conflict", async () => {
  const { inner, repo, seeded } = racingRepo([entry({ version: 3 })], null);
  await seeded;
  const result = await updateEntry({
    deps: { entryRepo: repo, contentTypeRepo: activeType, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: WS, actorId: "user-1", id: "entry-1", title: "Clobbered", expectedVersion: 1 },
  });
  assertLost(result, "expected version 1 for entry 'entry-1', found 3");
  assert.equal((await inner.findById({ workspaceId: WS, id: "entry-1" }))?.title, "Chili");
});

test("publishEntry and unpublishEntry lose to a writer that lands between their read and their save", async () => {
  for (const transition of [publishEntry, unpublishEntry]) {
    const { inner, repo, revisions, seeded } = racingRepo([entry()], "entry-1");
    await seeded;
    const outbox = fakeOutbox();
    const result = await transition({
      deps: { entryRepo: repo, contentTypeRepo: activeType, clock, authorize: alwaysAllow, outbox },
      input: { workspaceId: WS, actorId: "user-1", id: "entry-1", expectedVersion: 1 },
    });
    assertLost(result, "expected version 1 for entry 'entry-1', found 2");
    assert.equal((await inner.findById({ workspaceId: WS, id: "entry-1" }))?.status, "draft");
    assert.deepEqual([revisions, outbox.events], [[], []]);
  }
});

test("an import-as-update loses to a writer that lands between its read and its save", async () => {
  const { inner, repo, revisions, seeded } = racingRepo([entry({ version: 2 })], "entry-1");
  await seeded;
  const result = await importEntry({
    deps: { entryRepo: repo, contentTypeRepo: activeType, clock, authorize: alwaysAllow, outbox: fakeOutbox() },
    input: { workspaceId: WS, actorId: "user-1", id: "entry-1", type: "recipe", slug: "chili", title: "Imported", status: "published", fieldsJson: { ext: { site: {} } }, publishedAt: NOW, expectedVersion: 2 },
  });
  assertLost(result, "expected version 2 for entry 'entry-1', found 3");
  assert.equal((await inner.findById({ workspaceId: WS, id: "entry-1" }))?.title, "Other writer");
  assert.deepEqual(revisions, []);
});

test("an error other than a version conflict thrown inside the write still propagates", async () => {
  const { repo, seeded } = racingRepo([entry()], null);
  await seeded;
  await assert.rejects(
    () =>
      updateEntry({
        deps: { entryRepo: repo, contentTypeRepo: activeType, clock, authorize: alwaysAllow, outbox: fakeOutbox(), onWritten: async () => { throw new Error("extractor failed"); } },
        input: { workspaceId: WS, actorId: "user-1", id: "entry-1", title: "Mine", expectedVersion: 1 },
      }),
    /^Error: extractor failed$/
  );
});
