import assert from "node:assert/strict";
import { test } from "vitest";

import { restoreUnseededUpgrades, seedWithBundledIdUpgrade, upgradeRenamedBundledPlugins, type BundledIdUpgradePort, type InstalledRevision, type WorkspaceLockRunner } from "../bundled-id-upgrade.js";
import type { WorkspaceMigrationOwnership } from "../../../core/persistent-state.js";

/**
 * @file The publisher-ID upgrade's decisions over injected ports: what it refuses to move and how it
 * puts a moved copy back. The rename map and the held-reason wording are host-injected.
 */

const RENAMED = new Map([["alpha", { from: "old-pub/alpha", to: "new-pub/alpha" }]]);
const LEDGER_REASON = "host wording: not installed by the host's own build";
const REVISION: InstalledRevision = { pluginId: "alpha", id: "old-pub/alpha", archiveDigest: "a".repeat(64), packageRoot: "/ws/alpha/package/sha256/aaa" };

/** A port over fixed answers that records every rename instead of touching a disk. */
function fakePort({ ledgerDigest = REVISION.archiveDigest, sourceId = "new-pub/alpha", repackDigest = REVISION.archiveDigest, revision = REVISION, renames = [] as string[][], failRenameFrom = "" } = {}): BundledIdUpgradePort {
  return {
    listInstalledPlugins: async () => [revision],
    readBundledAgentPluginDigests: async () => new Map([["alpha", ledgerDigest]]),
    packAgentPluginDirectory: async () => ({ sha256: repackDigest }),
    readBundledSourceManifest: async () => JSON.stringify({ extensions: { jini: { id: sourceId } } }),
    filesystem: {
      stat: (async () => ({ mode: 0o40555 })) as unknown as BundledIdUpgradePort["filesystem"]["stat"],
      mkdir: (async () => undefined) as BundledIdUpgradePort["filesystem"]["mkdir"],
      chmod: async () => undefined,
      rename: async (from, to) => {
        if (String(from) === failRenameFrom) throw Object.assign(new Error("EBUSY: device busy"), { code: "EBUSY" });
        renames.push([String(from), String(to)]);
      },
    },
  };
}

const upgrade = (port: BundledIdUpgradePort) => upgradeRenamedBundledPlugins({ workspaceRoot: "/ws", port, renamed: RENAMED, ledgerMismatchReason: LEDGER_REASON });

test("a revision the ledger does not name is held with the INJECTED wording, never moved", async () => {
  const renames: string[][] = [];
  assert.deepEqual(await upgrade(fakePort({ ledgerDigest: "b".repeat(64), renames })),
    [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: LEDGER_REASON }]);
  assert.deepEqual(renames, []);
});

test("a revision published under another id is held and not moved", async () => {
  const renames: string[][] = [];
  const outcomes = await upgrade(fakePort({ revision: { ...REVISION, id: "other/alpha" }, renames }));
  assert.deepEqual(outcomes, [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: "its installed copy is published as 'other/alpha', not 'old-pub/alpha'" }]);
  assert.deepEqual(renames, []);
});

test("a revision edited after install (re-pack differs) is held and not moved", async () => {
  const renames: string[][] = [];
  const outcomes = await upgrade(fakePort({ repackDigest: "c".repeat(64), renames }));
  assert.deepEqual(outcomes, [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: "its installed files were changed after install" }]);
  assert.deepEqual(renames, []);
});

test("nothing moves when this build does not ship the canonical package", async () => {
  const renames: string[][] = [];
  assert.deepEqual(await upgrade(fakePort({ sourceId: "old-pub/alpha", renames })), []);
  assert.deepEqual(renames, []);
});

test("an already-upgraded site yields no outcomes and never reads the ledger", async () => {
  const port = { ...fakePort({ revision: { ...REVISION, id: "new-pub/alpha" } }), readBundledAgentPluginDigests: async () => { throw new Error("must not read"); } };
  assert.deepEqual(await upgrade(port), []);
});

test("a moved copy whose replacement did not seed is put back and reported as restored", async () => {
  const renames: string[][] = [];
  const port = fakePort({ renames });
  const upgrades = await upgrade(port);
  const savedAt = `/ws/.bundled-id-upgrade/alpha/${REVISION.archiveDigest}`;
  assert.deepEqual(upgrades, [{ status: "upgraded", pluginId: "alpha", to: "new-pub/alpha", moved: [{ packageRoot: REVISION.packageRoot, savedAt }] }]);
  const restored = await restoreUnseededUpgrades({ outcomes: upgrades, seededIds: new Set(), filesystem: port.filesystem });
  assert.equal(restored[0]?.status, "restored");
  assert.deepEqual(renames, [[REVISION.packageRoot, savedAt], [savedAt, REVISION.packageRoot]]);
  assert.deepEqual(await restoreUnseededUpgrades({ outcomes: upgrades, seededIds: new Set(["alpha"]), filesystem: port.filesystem }), upgrades);
});

const SAVED_AT = `/ws/.bundled-id-upgrade/alpha/${REVISION.archiveDigest}`;

test("a failed put-back is held with the saved copy kept, never reported as restored", async () => {
  const renames: string[][] = [];
  const port = fakePort({ renames, failRenameFrom: SAVED_AT });
  const upgrades = await upgrade(port);
  const result = await restoreUnseededUpgrades({ outcomes: upgrades, seededIds: new Set(), filesystem: port.filesystem });
  assert.deepEqual(result, [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: "its earlier copy could not be put back yet; the saved copy is kept for the next start" }]);
  // Only the move aside happened: the saved copy is still where the move left it.
  assert.deepEqual(renames, [[REVISION.packageRoot, SAVED_AT]]);
});

/** A workspace lock that records when it is taken and released, over a fixed ownership token. */
function recordingLock(events: string[]): { runner: WorkspaceLockRunner; ownership: WorkspaceMigrationOwnership } {
  let held = false;
  const ownership: WorkspaceMigrationOwnership = { workspaceRoot: "/ws", lockPath: "/ws/.agent-plugin-layout-migrated.lock", isHeld: () => held };
  const runner: WorkspaceLockRunner = async ({ workspaceRoot, run }) => {
    events.push(`lock ${workspaceRoot}`); held = true;
    try { return await run({ ownership }); } finally { held = false; events.push("unlock"); }
  };
  return { runner, ownership };
}

test("the move, the seed and the put-back all run inside one held workspace lock", async () => {
  const events: string[] = [];
  const { runner, ownership } = recordingLock(events);
  const port = fakePort();
  const tracked: BundledIdUpgradePort = { ...port, listInstalledPlugins: async (input) => { events.push("list"); return port.listInstalledPlugins(input); },
    filesystem: { ...port.filesystem, rename: async (from, to) => { events.push(`rename ${String(from)}`); await port.filesystem.rename(from, to); } } };
  const result = await seedWithBundledIdUpgrade({ workspaceRoot: "/ws", port: tracked, renamed: RENAMED, ledgerMismatchReason: LEDGER_REASON, withWorkspaceLock: runner,
    seed: async ({ ownership: passed, heldPluginIds }) => {
      events.push("seed"); assert.equal(passed, ownership); assert.equal(passed.isHeld(), true); assert.deepEqual([...heldPluginIds], []);
      return { outcomes: [{ pluginId: "alpha", status: "failed" as const }] };
    } });
  assert.deepEqual(events, ["lock /ws", "list", `rename ${REVISION.packageRoot}`, "seed", `rename ${SAVED_AT}`, "unlock"]);
  assert.equal(result.idUpgrades[0]?.status, "restored");
});

test("a held move keeps that id out of the seed while unrelated ids seed as before", async () => {
  const events: string[] = [];
  const { runner } = recordingLock(events);
  let seenHeld: ReadonlyMap<string, string> = new Map();
  const result = await seedWithBundledIdUpgrade({ workspaceRoot: "/ws", port: fakePort({ ledgerDigest: "b".repeat(64) }), renamed: RENAMED, ledgerMismatchReason: LEDGER_REASON, withWorkspaceLock: runner,
    seed: async ({ heldPluginIds }) => { seenHeld = heldPluginIds; return { outcomes: [{ pluginId: "beta", status: "seeded" as const }] }; } });
  assert.deepEqual([...seenHeld], [["alpha", LEDGER_REASON]]);
  assert.deepEqual(result.idUpgrades, [{ status: "held", pluginId: "alpha", to: "new-pub/alpha", reason: LEDGER_REASON }]);
  assert.deepEqual(result.seeded.outcomes, [{ pluginId: "beta", status: "seeded" }]);
});

test("a seed fault still releases the workspace lock", async () => {
  const events: string[] = [];
  const { runner } = recordingLock(events);
  await assert.rejects(seedWithBundledIdUpgrade({ workspaceRoot: "/ws", port: fakePort(), renamed: RENAMED, ledgerMismatchReason: LEDGER_REASON, withWorkspaceLock: runner,
    seed: async () => { throw new Error("seed crashed"); } }), /seed crashed/);
  assert.equal(events.at(-1), "unlock");
});
