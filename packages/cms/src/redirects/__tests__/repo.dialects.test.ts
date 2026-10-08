import assert from "node:assert/strict";
import { test } from "vitest";

import { describeEachDialect } from "../../core/__tests__/support/dialect-matrix.js";
import { createTables } from "./support/redirects-tables.fixture.js";
import { RedirectSlugChangeCapture } from "../capture.js";
import { type SqlRedirectRepo, redirectRepoFor } from "../sql/repo.js";
import { RedirectNotFoundError, type RedirectRecord, type RedirectRevision } from "../types.js";

/**
 * @file The redirect repo on every dialect through the kernel's matrix (`describeEachDialect` + ONE
 * factory: one query body serves every dialect).
 */

const WS = "ws-dialects";
const OTHER = "other-ws";

function rule(id: string, overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id,
    workspaceId: WS,
    matchType: "exact",
    fromPattern: `/${id}`,
    toTarget: "/target",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: "user-1",
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function revision(record: RedirectRecord, seq = 1, tombstoned = false): RedirectRevision {
  return {
    redirectId: record.id,
    workspaceId: record.workspaceId,
    seq,
    state: record,
    tombstoned,
    actorId: "user-1",
    recordedAt: record.updatedAt,
  };
}

async function saveRule(repo: SqlRedirectRepo, record: RedirectRecord): Promise<void> {
  await repo.save({ record, revision: revision(record) });
}

describeEachDialect<SqlRedirectRepo>(
  { title: "redirect repo", options: {
    tables: ["redirects", "redirect_revisions"], createTables,
    make: (kernel) => redirectRepoFor({ kernel, tables: { redirects: "redirects", revisions: "redirect_revisions" } }, {}),
  }, body: (makeRepo) => {
    test("save round-trips every field incl. optionals and booleans; re-save replaces the row", async () => {
      const repo = makeRepo();
      const full = rule("full", {
        override: true,
        priority: 5,
        source: "auto_slug_change",
        sourceEntryId: "e1",
        fromPathAtCapture: "/a",
        toPathAtCapture: "/b",
        createdByPluginId: "plug",
      });
      await saveRule(repo, full);
      assert.deepEqual(await repo.findById({ workspaceId: WS, id: "full" }), full);
      const replaced = { ...full, toTarget: "/changed", override: false, version: 2, sourceEntryId: undefined };
      await repo.save({ record: replaced, revision: revision(replaced, 2) });
      assert.deepEqual(await repo.findById({ workspaceId: WS, id: "full" }), replaced);
      assert.equal((await repo.list({ workspaceId: WS })).length, 1);
      assert.deepEqual(
        (await repo.listRevisionsForTests({ redirectId: "full" }, {})).map((r) => r.seq),
        [1, 2]
      );
    });

    test("findById misses an unknown id and another workspace's row", async () => {
      const repo = makeRepo();
      await saveRule(repo, rule("a"));
      assert.equal(await repo.findById({ workspaceId: WS, id: "nope" }), null);
      assert.equal(await repo.findById({ workspaceId: OTHER, id: "a" }), null);
    });

    test("lookupExact hits by path, honours override-only, prefers priority, isolates workspaces", async () => {
      const repo = makeRepo();
      await saveRule(repo, rule("lo", { fromPattern: "/p", priority: 1 }));
      await saveRule(repo, rule("hi", { fromPattern: "/p", priority: 9, override: true }));
      await saveRule(repo, rule("gone", { fromPattern: "/q", status: "disabled" }));
      assert.equal((await repo.lookupExact({ workspaceId: WS, path: "/p", includeOverrideOnly: false }))?.id, "hi");
      await saveRule(repo, rule("plain", { fromPattern: "/z" }));
      assert.equal(await repo.lookupExact({ workspaceId: WS, path: "/z", includeOverrideOnly: true }), null);
      assert.equal(await repo.lookupExact({ workspaceId: WS, path: "/q", includeOverrideOnly: false }), null);
      assert.equal(await repo.lookupExact({ workspaceId: OTHER, path: "/p", includeOverrideOnly: false }), null);
    });

    for (const matchType of ["exact", "prefix", "wildcard"] as const) {
      test(`${matchType}: equal priority prefers newest timestamp, then smallest id`, async () => {
        const repo = makeRepo();
        const fromPattern = matchType === "wildcard" ? "/tie/*" : "/tie";
        const older = rule("a-old", { matchType, fromPattern, priority: 7, updatedAt: "2026-01-01T00:00:00.000Z", toTarget: "/old" });
        const newer = rule("z-new", { matchType, fromPattern, priority: 7, updatedAt: "2026-02-01T00:00:00.000Z", toTarget: "/new" });
        const sameTimeSmallerId = rule("b-new", { ...newer, id: "b-new", toTarget: "/id-winner" });
        // Insertion order and id order both favor the older row if recency is ignored.
        await saveRule(repo, older);
        await saveRule(repo, newer);
        const selected = async () => matchType === "exact"
          ? repo.lookupExact({ workspaceId: WS, path: "/tie", includeOverrideOnly: false })
          : matchType === "prefix"
            ? repo.lookupLongestPrefix({ workspaceId: WS, path: "/tie/nested", includeOverrideOnly: false })
            : (await repo.listDynamic({ workspaceId: WS, includeOverrideOnly: false, limit: 1 }))[0];
        const newest = await selected();
        assert.equal(newest?.id, newer.id);
        assert.equal(newest?.toTarget, newer.toTarget);
        await saveRule(repo, sameTimeSmallerId);
        const idWinner = await selected();
        assert.equal(idWinner?.id, sameTimeSmallerId.id);
        assert.equal(idWinner?.toTarget, sameTimeSmallerId.toTarget);
      });
    }

    test("lookupLongestPrefix picks the longest matching prefix; misses non-matches and other workspaces", async () => {
      const repo = makeRepo();
      await saveRule(repo, rule("short", { matchType: "prefix", fromPattern: "/docs" }));
      await saveRule(repo, rule("long", { matchType: "prefix", fromPattern: "/docs/api/" }));
      await saveRule(repo, rule("ov", { matchType: "prefix", fromPattern: "/x", override: true }));
      const hit = (path: string, includeOverrideOnly = false) =>
        repo.lookupLongestPrefix({ workspaceId: WS, path, includeOverrideOnly });
      assert.equal((await hit("/docs/api/v1"))?.id, "long");
      assert.equal((await hit("/docs/other"))?.id, "short");
      assert.equal((await hit("/docs"))?.id, "short");
      assert.equal(await hit("/docsx"), null);
      assert.equal((await hit("/x/y", true))?.id, "ov");
      assert.equal(await hit("/docs/a", true), null);
      assert.equal(await repo.lookupLongestPrefix({ workspaceId: OTHER, path: "/docs/a", includeOverrideOnly: false }), null);
    });

    test("listDynamic returns active wildcard rules, longest first, capped by limit, per workspace", async () => {
      const repo = makeRepo();
      await saveRule(repo, rule("w1", { matchType: "wildcard", fromPattern: "/a/*" }));
      await saveRule(repo, rule("w2", { matchType: "wildcard", fromPattern: "/a/b/*", override: true }));
      await saveRule(repo, rule("w3", { matchType: "wildcard", fromPattern: "/c/*", status: "disabled" }));
      await saveRule(repo, rule("e1"));
      const ids = async (limit: number, includeOverrideOnly = false) =>
        (await repo.listDynamic({ workspaceId: WS, includeOverrideOnly, limit })).map((r) => r.id);
      assert.deepEqual(await ids(10), ["w2", "w1"]);
      assert.deepEqual(await ids(1), ["w2"]);
      assert.deepEqual(await ids(10, true), ["w2"]);
      assert.deepEqual(await repo.listDynamic({ workspaceId: OTHER, includeOverrideOnly: false, limit: 10 }), []);
    });

    test("list filters by status, source and matchType and stays inside the workspace", async () => {
      const repo = makeRepo();
      await saveRule(repo, rule("m", { source: "manual" }));
      await saveRule(repo, rule("c", { source: "auto_slug_change", matchType: "prefix" }));
      await saveRule(repo, rule("t", { status: "disabled" }));
      await saveRule(repo, rule("o", { workspaceId: OTHER }));
      const ids = async (filter: object) =>
        (await repo.list({ workspaceId: WS, ...filter })).map((r) => r.id).sort();
      assert.deepEqual(await ids({}), ["c", "m", "t"]);
      assert.deepEqual(await ids({ status: "disabled" }), ["t"]);
      assert.deepEqual(await ids({ source: "auto_slug_change" }), ["c"]);
      assert.deepEqual(await ids({ matchType: "prefix" }), ["c"]);
      assert.deepEqual(await repo.list({ workspaceId: "empty" }), []);
    });

    test("findByFromPattern prefers an exact active rule; misses tombstoned and other workspaces", async () => {
      const repo = makeRepo();
      await saveRule(repo, rule("pre", { matchType: "prefix", fromPattern: "/same" }));
      await saveRule(repo, rule("ex", { fromPattern: "/same" }));
      await saveRule(repo, rule("dead", { fromPattern: "/dead", status: "disabled" }));
      assert.equal((await repo.findByFromPattern({ workspaceId: WS, fromPattern: "/same" }))?.id, "ex");
      assert.equal(await repo.findByFromPattern({ workspaceId: WS, fromPattern: "/dead" }), null);
      assert.equal(await repo.findByFromPattern({ workspaceId: OTHER, fromPattern: "/same" }), null);
    });

    test("tombstone writes the tombstoned state + revision; unknown or other-workspace id throws and writes nothing", async () => {
      const repo = makeRepo();
      const live = rule("t1");
      await saveRule(repo, live);
      const dead = { ...live, status: "disabled" as const, version: 2 };
      await repo.tombstone({ workspaceId: WS, id: "t1", revision: revision(dead, 2, true) });
      assert.equal((await repo.findById({ workspaceId: WS, id: "t1" }))?.status, "disabled");
      const ledger = await repo.listRevisionsForTests({ redirectId: "t1" }, {});
      assert.deepEqual(ledger.map((r) => r.tombstoned), [false, true]);
      await assert.rejects(
        repo.tombstone({ workspaceId: WS, id: "nope", revision: revision(rule("nope"), 1, true) }),
        RedirectNotFoundError
      );
      await assert.rejects(
        repo.tombstone({ workspaceId: OTHER, id: "t1", revision: revision({ ...dead, workspaceId: OTHER }, 3, true) }),
        RedirectNotFoundError
      );
      assert.equal((await repo.listRevisionsForTests({ redirectId: "nope" }, {})).length, 0);
      assert.equal((await repo.listRevisionsForTests({ redirectId: "t1" }, {})).length, 2);
    });

    test("a save whose revision fails rolls the redirect row back too", async () => {
      const repo = makeRepo();
      const record = rule("r1");
      const bad = { ...revision(record), state: { toJSON: () => { throw new Error("boom"); } } } as unknown as RedirectRevision;
      await assert.rejects(repo.save({ record, revision: bad }), /boom/);
      assert.equal(await repo.findById({ workspaceId: WS, id: "r1" }), null);
    });

    test("a transaction's writes roll back together; a nested one joins", async () => {
      const repo = makeRepo();
      const record = rule("tx");
      await assert.rejects(
        repo.transaction(async () => {
          await repo.insertRedirect(record);
          await repo.transaction(async () => repo.insertRevision(revision(record)));
          throw new Error("boom");
        }),
        /boom/
      );
      assert.equal(await repo.findById({ workspaceId: WS, id: "tx" }), null);
      assert.deepEqual(await repo.listRevisionsForTests({ redirectId: "tx" }, {}), []);
      await repo.transaction(async () => {
        await repo.insertRedirect(record);
        await repo.insertRevision(revision(record));
      });
      assert.equal((await repo.listRevisionsForTests({ redirectId: "tx" }, {})).length, 1);
    });

    test("slug capture after renames a→b→a→c→a→b resolves /a to the live /b, not into a /a→/c→/a loop", async () => {
      const repo = makeRepo();
      let ms = Date.parse("2026-09-28T00:00:00.000Z");
      let n = 0;
      const capture = new RedirectSlugChangeCapture({ repo, db: repo,
        clock: { nowMs: () => (ms += 1000) }, idGen: { newId: () => `cap-${++n}` } });
      const path = ["/a", "/b", "/a", "/c", "/a", "/b"];
      for (let i = 1; i < path.length; i++) {
        const oldPath = path[i - 1], newPath = path[i];
        assert.ok(oldPath);
        assert.ok(newPath);
        await capture.onSlugChange({ workspaceId: WS, entryId: "post-1", oldPath, newPath,
          actor: "user-1", changeSetId: `cs-${i}` });
      }
      const winner = await repo.lookupExact({ workspaceId: WS, path: "/a", includeOverrideOnly: false });
      assert.equal(winner?.toTarget, "/b");
    });
  }
}, {}
);
