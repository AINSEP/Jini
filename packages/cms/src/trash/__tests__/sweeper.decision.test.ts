import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryTrashRepo, createTrashSweep, bindRemoveEntity, createTrashService } from "../index.js";
import type { TrashAdapter, TrashMarkerResult, TrashPurgeOutcome, TrashRepoPort, TrashPort } from "../ports.js";
import type { TrashSweepOnce } from "../sweeper.js";

/**
 * @file The 60-day backstop, and the one property that matters about it: **a concurrent restore
 * always wins.** Everything else here exists to stop that guarantee being bought by accident.
 *
 * The domain double below is versioned, because the interesting failures are all version-shaped.
 * `purgeCalls` is asserted directly in the restore-race test: the point is not merely that the
 * entity survived, it is that the sweeper never reached for it at all.
 */

const WS = "workspace-1";
const OTHER_WS = "workspace-2";
const ACTOR = { principalId: "principal-1" };
const AT = "2026-09-20T12:00:00.000Z";
/** Comfortably past `AT` + the 60-day retention window. */
const DUE = "2027-01-01T00:00:00.000Z";
const ENTITY = "widget";

interface FakeDomain {
  adapter: TrashAdapter;
  rows: Map<string, { version: number; hidden: boolean }>;
  purgeCalls: string[];
}

/**
 * A versioned domain plus its adapter: `hide`/`unhide` bump the version exactly the way the real
 * post adapter does, so the version the index captures is the one a later purge compares against.
 */
function fakeDomain(entityType = ENTITY): FakeDomain {
  const rows = new Map<string, { version: number; hidden: boolean }>();
  const purgeCalls: string[] = [];

  const move = (
    entityId: string,
    expectedVersion: number | null,
    hidden: boolean
  ): TrashMarkerResult => {
    const row = rows.get(entityId);
    if (!row) return { ok: false, reason: "not-found" };
    if (expectedVersion !== null && row.version !== expectedVersion) {
      return { ok: false, reason: "version-changed" };
    }
    row.hidden = hidden;
    row.version += 1;
    return { ok: true, version: row.version };
  };

  return {
    rows,
    purgeCalls,
    adapter: {
      entityType,
      async hide(required) {
        return move(required.entityId, required.expectedVersion, true);
      },
      async unhide(required) {
        return move(required.entityId, required.expectedVersion, false);
      },
      async purge(required): Promise<TrashPurgeOutcome> {
        purgeCalls.push(required.entityId);
        const row = rows.get(required.entityId);
        if (!row) return "already-gone";
        if (required.expectedVersion !== null && row.version !== required.expectedVersion) {
          return "version-changed";
        }
        rows.delete(required.entityId);
        return "purged";
      },
    },
  };
}

interface Harness {
  repo: InMemoryTrashRepo;
  trash: TrashPort;
  domain: FakeDomain;
  sweep: TrashSweepOnce;
  adapters: Map<string, TrashAdapter>;
}

function harness(optional: { repoWrapper?: (repo: InMemoryTrashRepo) => TrashRepoPort } = {}): Harness {
  const repo = new InMemoryTrashRepo({});
  const domain = fakeDomain();
  const adapters = new Map<string, TrashAdapter>([[ENTITY, domain.adapter]]);
  let seq = 0;
  const passThrough = <T>(fn: () => Promise<T>): Promise<T> => fn();
  const trash = createTrashService({
    repo,
    adapters,
    idGen: { newId: () => `trash-${(seq += 1)}` },
    transaction: ({ work }) => (passThrough)(work),
    entityPolicy: ({ entityType }) => (adapters).has(entityType)
  }, { onError: ({ error }) => console.error("[trash] onChanged hook failed; the trash/restore/purge it followed already committed", error) });
  const sweep = createTrashSweep({
    repo: optional.repoWrapper ? optional.repoWrapper(repo) : repo,
    adapters,
    transaction: ({ work }) => (passThrough)(work),
    entityPolicy: ({ entityType }) => (adapters).has(entityType)
  });
  return { repo, trash, domain, sweep, adapters };
}

/** Trashes a fresh entity through the real write path, so the index row's version is real. */
async function trashOne(h: Harness, entityId: string, workspaceId = WS): Promise<void> {
  h.domain.rows.set(entityId, { version: 1, hidden: false });
  const remove = bindRemoveEntity({
    trash: h.trash,
    entityType: ENTITY
  });
  const result = await remove({
    workspaceId,
    id: entityId,
    display: { title: entityId },
    at: AT,
    expectedVersion: 1,
    actor: ACTOR,
  });
  assert.equal(result.ok, true, `fixture: trashing ${entityId} should have succeeded`);
}

function sweepArgs(now: string, optional: { limit?: number } = {}) {
  return {
    now,
    leaseOwner: "sweeper-under-test",
    leaseUntil: new Date(new Date(now).getTime() + 60_000).toISOString(),
    limit: optional.limit ?? 50,
  };
}

/** Delegating repo that runs `hook` in the window between the claim and the purge. */
function claimThen(repo: InMemoryTrashRepo, hook: () => Promise<void>): TrashRepoPort {
  return {
    insert: (r) => repo.insert(r),
    findByEntity: (r) => repo.findByEntity(r),
    findByIds: (r) => repo.findByIds(r),
    deleteById: (r) => repo.deleteById(r),
    deleteByEntity: (r) => repo.deleteByEntity(r),
    list: (r, optional) => repo.list(r, optional),
    releaseLease: (r) => repo.releaseLease(r),
    async claimDue(r) {
      const claims = await repo.claimDue(r);
      await hook();
      return claims;
    },
  };
}

// PARITY
test("an expired row is purged and its index row goes with it", async () => {
  const h = harness();
  await trashOne(h, "post-1");

  const report = await h.sweep(sweepArgs(DUE));

  assert.deepEqual(report, { claimed: 1, purged: 1, results: [{ id: "trash-1", outcome: "purged" }] });
  assert.equal(h.domain.rows.has("post-1"), false, "the entity row should be physically gone");
  assert.deepEqual(h.repo.all({}), [], "the index row should be gone with it");
});

// PARITY
test("a row that is not yet due is never claimed", async () => {
  const h = harness();
  await trashOne(h, "post-1");

  const report = await h.sweep(sweepArgs("2026-10-01T00:00:00.000Z"));

  assert.deepEqual(report, { claimed: 0, purged: 0, results: [] });
  assert.equal(h.domain.rows.has("post-1"), true);
  assert.equal(h.repo.all({}).length, 1);
});

// PARITY
test("a restore landing between the claim and the purge leaves the entity live and the index row gone", async () => {
  let restored = false;
  const h = harness({
    repoWrapper: (repo) =>
      claimThen(repo, async () => {
        if (restored) return;
        restored = true;
        const outcome = await h.trash.restore({
          workspaceId: WS,
          entityType: ENTITY,
          entityId: "post-1",
          at: DUE,
        });
        assert.equal(outcome, "restored", "fixture: the racing restore itself must succeed");
      }),
  });
  await trashOne(h, "post-1");

  const report = await h.sweep(sweepArgs(DUE));

  // The entity is alive and visible again...
  assert.deepEqual(h.domain.rows.get("post-1"), { version: 3, hidden: false });
  // ...its index row is gone, because removing it IS the restore...
  assert.deepEqual(h.repo.all({}), []);
  // ...and the sweeper never even reached for the entity. Version alone would not have covered
  // this: a domain with a null entity_version has no version to have moved.
  assert.deepEqual(h.domain.purgeCalls, []);
  assert.deepEqual(report, { claimed: 1, purged: 0, results: [{ id: "trash-1", outcome: "not-found" }] });
});

// PARITY
test("a version that moved while the row stayed indexed stands the purge down, and both survive", async () => {
  const h = harness();
  await trashOne(h, "post-1");
  // An out-of-band edit while the entity sat in the Trash: the index's snapshot is now stale.
  h.domain.rows.get("post-1")!.version = 99;

  const report = await h.sweep(sweepArgs(DUE));

  assert.deepEqual(report, {
    claimed: 1,
    purged: 0,
    results: [{ id: "trash-1", outcome: "version-changed" }],
  });
  assert.equal(h.domain.rows.has("post-1"), true, "the safe outcome of a race is that the item survives");
  assert.equal(h.repo.all({}).length, 1, "and the index row survives with it, so it stays selectable");
});

// PARITY
test("an entity already deleted out from under the index is reported, and the index row is cleared", async () => {
  const h = harness();
  await trashOne(h, "post-1");
  h.domain.rows.delete("post-1");

  const report = await h.sweep(sweepArgs(DUE));

  assert.deepEqual(report.results, [{ id: "trash-1", outcome: "already-gone" }]);
  assert.deepEqual(h.repo.all({}), [], "nothing is left to purge, so the row must not linger forever");
});

// PARITY
test("a row whose adapter is uninstalled is reported and left alone, never purged", async () => {
  const h = harness();
  await trashOne(h, "post-1");
  h.adapters.delete(ENTITY);

  const report = await h.sweep(sweepArgs(DUE));

  assert.deepEqual(report, {
    claimed: 1,
    purged: 0,
    results: [{ id: "trash-1", outcome: "adapter-unavailable" }],
  });
  assert.equal(h.repo.all({}).length, 1);
  assert.deepEqual(h.domain.purgeCalls, []);
});

// PARITY
test("a claimed row is invisible to the next sweep until its lease expires", async () => {
  const h = harness();
  await trashOne(h, "post-1");
  h.adapters.delete(ENTITY); // stands the purge down, so the row survives to be re-claimed

  assert.equal((await h.sweep(sweepArgs(DUE))).claimed, 1);
  assert.equal(
    (await h.sweep(sweepArgs(DUE))).claimed,
    0,
    "a second sweep inside the lease window must not claim the same row"
  );
  // `sweepArgs` leases for 60s; past that the row is reclaimable, which is what gives a sweeper
  // that died mid-batch its crash recovery.
  assert.equal((await h.sweep(sweepArgs("2027-01-01T00:02:00.000Z"))).claimed, 1);
});

// PARITY
test("the claim spans every workspace in the file, and each row is purged in its own", async () => {
  const h = harness();
  await trashOne(h, "post-1", WS);
  await trashOne(h, "post-2", OTHER_WS);
  const key = (workspaceId: string, entityId: string) => `${workspaceId}:${entityId}`;
  const rows = new Map([
    [key(WS, "post-1"), { version: 2, hidden: true }],
    [key(OTHER_WS, "post-2"), { version: 2, hidden: true }],
    [key(OTHER_WS, "post-1"), { version: 2, hidden: false }],
    [key(WS, "post-2"), { version: 2, hidden: false }],
  ]);
  const calls: Parameters<TrashAdapter["purge"]>[0][] = [];
  h.adapters.set(ENTITY, {
    ...h.domain.adapter,
    async purge(required) {
      calls.push(required);
      h.domain.purgeCalls.push(required.entityId);
      const id = key(required.workspaceId, required.entityId);
      const row = rows.get(id);
      if (!row) return "already-gone";
      if (!row.hidden || row.version !== required.expectedVersion) return "version-changed";
      rows.delete(id);
      return "purged";
    },
  });

  const report = await h.sweep(sweepArgs(DUE));

  assert.equal(report.purged, 2);
  assert.deepEqual(h.repo.all({}), []);
  assert.deepEqual(h.domain.purgeCalls.sort(), ["post-1", "post-2"]);
  assert.deepEqual(calls, [
    { workspaceId: WS, entityId: "post-1", expectedVersion: 2 },
    { workspaceId: OTHER_WS, entityId: "post-2", expectedVersion: 2 },
  ]);
  assert.deepEqual([...rows], [
    [key(OTHER_WS, "post-1"), { version: 2, hidden: false }],
    [key(WS, "post-2"), { version: 2, hidden: false }],
  ], "live counterparts in the other workspace survive");
});

// PARITY
test("one row's failure never aborts the rest of the batch", async () => {
  const h = harness();
  await trashOne(h, "post-1");
  await trashOne(h, "post-2");
  h.domain.rows.get("post-1")!.version = 99;

  const report = await h.sweep(sweepArgs(DUE));

  assert.equal(report.claimed, 2);
  assert.equal(report.purged, 1);
  assert.deepEqual(
    report.results.map((r) => r.outcome).sort(),
    ["purged", "version-changed"]
  );
});

