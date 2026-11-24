import assert from "node:assert/strict";
import { test } from "vitest";

import { commitWithCopiedDatabases, type CopiedDatabaseFilesystem } from "../copied-site-databases.js";

/**
 * @file Snapshot / commit / rollback ordering over an in-memory filesystem: the call order, that a
 * failing snapshot, detach or commit restores every detached pointer and removes only the created
 * folder, that an existing target aborts untouched, and that backups go only after a good commit.
 */

function fakeFilesystem({ existing = [], links = [], failRename }: { existing?: string[]; links?: string[]; failRename?: string } = {}) {
  const calls: string[] = [];
  const present = new Set(existing);
  const symlinks = new Set(links);
  const filesystem: CopiedDatabaseFilesystem = {
    exists: ({ path }) => present.has(path),
    makeDirectory: ({ path, recursive }) => {
      if (!recursive && present.has(path)) throw new Error("exists");
      calls.push(`mkdir ${path}${recursive ? " -p" : ""}`);
      present.add(path);
    },
    removeTree: ({ path }) => { calls.push(`rm ${path}`); present.delete(path); },
    rename: ({ from, to }) => {
      if (to === failRename) throw new Error("rename failed");
      calls.push(`mv ${from} ${to}`);
      if (symlinks.delete(from)) symlinks.add(to);
      else if (symlinks.delete(to)) symlinks.add(from);
    },
    unlink: ({ path }) => { calls.push(`unlink ${path}`); symlinks.delete(path); },
    isSymbolicLink: ({ path }) => symlinks.has(path),
  };
  return { filesystem, calls, symlinks };
}

const sources = [{ from: "/orig/content.db", to: "/app/new-id/content.db" }, { from: "/orig/chat.db", to: "/app/new-id/chat.db" }];
const pointerPaths = ["/copy/data.nosync", "/copy/content.db", "/copy/chat.db"];
const backupPath = ({ index }: { index: number }) => `/copy/.backup-${index}`;

test("with no sources it only commits", () => {
  const { filesystem, calls } = fakeFilesystem();
  let committed = 0;
  commitWithCopiedDatabases({ sources: [], pointerPaths, backupPath, commit: () => { committed += 1; }, filesystem, snapshot: () => assert.fail("no snapshot") });
  assert.equal(committed, 1);
  assert.deepEqual(calls, []);
});

test("a good run snapshots, detaches only symlinks, commits, then drops the backups", () => {
  const { filesystem, calls, symlinks } = fakeFilesystem({ links: ["/copy/data.nosync", "/copy/chat.db"] });
  const order: string[] = [];
  commitWithCopiedDatabases({
    sources, pointerPaths, backupPath, filesystem,
    snapshot: ({ from, to }) => order.push(`snap ${from}>${to}`),
    commit: () => order.push(`commit after ${calls.length} fs calls`),
  });
  assert.deepEqual(order, ["snap /orig/content.db>/app/new-id/content.db", "snap /orig/chat.db>/app/new-id/chat.db", "commit after 4 fs calls"]);
  assert.deepEqual(calls, [
    "mkdir /app -p", "mkdir /app/new-id",
    "mv /copy/data.nosync /copy/.backup-0", "mv /copy/chat.db /copy/.backup-1",
    "unlink /copy/.backup-0", "unlink /copy/.backup-1",
  ]);
  assert.equal(symlinks.size, 0);
});

test("an existing target aborts before anything is touched", () => {
  const { filesystem, calls } = fakeFilesystem({ existing: ["/app/new-id"] });
  assert.throws(() => commitWithCopiedDatabases({ sources, pointerPaths, backupPath, filesystem, snapshot: () => assert.fail("no snapshot"), commit: () => assert.fail("no commit") }), /Copied database target already exists\./);
  assert.deepEqual(calls, []);
});

for (const failure of ["snapshot", "commit", "detach"] as const) {
  test(`a failing ${failure} restores detached pointers newest first and removes the created folder`, () => {
    const { filesystem, calls, symlinks } = fakeFilesystem({
      links: ["/copy/data.nosync", "/copy/chat.db"],
      ...(failure === "detach" ? { failRename: "/copy/.backup-1" } : {}),
    });
    const boom = new Error(`${failure} boom`);
    assert.throws(() => commitWithCopiedDatabases({
      sources, pointerPaths, backupPath, filesystem,
      snapshot: () => { if (failure === "snapshot") throw boom; },
      commit: () => { if (failure === "commit") throw boom; },
    }), failure === "detach" ? /rename failed/ : /boom/);
    assert.equal(calls.at(-1), "rm /app/new-id");
    assert.ok(!calls.some((call) => call.startsWith("unlink")), "no backup is dropped on failure");
    assert.deepEqual([...symlinks].sort(), ["/copy/chat.db", "/copy/data.nosync"], "every pointer is back where it was");
    if (failure === "commit") assert.deepEqual(calls.filter((c) => c.startsWith("mv")), [
      "mv /copy/data.nosync /copy/.backup-0", "mv /copy/chat.db /copy/.backup-1", "mv /copy/.backup-1 /copy/chat.db", "mv /copy/.backup-0 /copy/data.nosync",
    ]);
  });
}
