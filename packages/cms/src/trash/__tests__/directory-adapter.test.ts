import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi, type TestContext } from "vitest";

import { createDirectoryTrashAdapter, unhideIfRemoveThrows } from "../adapters/directory.node.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const native = await importOriginal<typeof import("node:fs/promises")>();
  return { ...native, mkdir: vi.fn(native.mkdir) };
});

const WS = "workspace-1";
const ENTITY = "plugin";
const ID = "plugin-a";
const AT = "2026-09-22T12:00:00.000Z";

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function harness(t: TestContext, forget?: (required: { workspaceId: string; entityId: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "directory-trash-"));
  t.onTestFinished(async () => rm(root, { recursive: true, force: true }));
  const liveParent = join(root, "plugins");
  const liveDir = join(liveParent, ID);
  const parkedDir = join(root, "plugins-trash", ID);
  await mkdir(liveParent, { recursive: true });

  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY,
    locate: async () => ({
      liveParent,
      liveNames: (await pathExists(liveDir)) ? [ID] : [],
      parkedDir,
    }),
    forget,
  });
  return { adapter, liveDir, liveParent, parkedDir };
}

async function makeLive(liveDir: string): Promise<void> {
  await mkdir(liveDir, { recursive: true });
  await writeFile(join(liveDir, "plugin.json"), "plugin-a");
}

function markerArgs() {
  return { workspaceId: WS, entityId: ID, at: AT, expectedVersion: null };
}

test("concurrent hides reserve one park and preserve its single intact tree", async (t) => {
  const { adapter, liveDir, parkedDir } = await harness(t);
  await makeLive(liveDir);
  let entering = 0;
  let release!: () => void;
  const bothEntered = new Promise<void>((resolve) => { release = resolve; });
  const native = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(mkdir).mockImplementation(async (path, options) => {
    if (String(path) === parkedDir) {
      entering += 1;
      if (entering === 2) release();
      await bothEntered;
    }
    return native.mkdir(path, options);
  });
  t.onTestFinished(() => { vi.mocked(mkdir).mockImplementation(native.mkdir); });

  const results = await Promise.all([adapter.hide(markerArgs()), adapter.hide(markerArgs())]);
  assert.equal(entering, 2);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.find((result) => !result.ok), {
    ok: false, reason: "blocked", code: "ALREADY_IN_TRASH", count: 1,
  });
  assert.equal(await pathExists(liveDir), false);
  assert.deepEqual(await readdir(parkedDir), [ID]);
  assert.deepEqual(await readdir(join(parkedDir, ID)), ["plugin.json"]);
  assert.equal(await readFile(join(parkedDir, ID, "plugin.json"), "utf8"), "plugin-a");
});

test("hide rolls back the first directory when moving the second directory fails", async (t) => {
  const { liveParent, parkedDir } = await harness(t);
  for (const name of ["first", "second"]) {
    await mkdir(join(liveParent, name));
    await writeFile(join(liveParent, name, "plugin.json"), name);
  }
  const failure = new Error("second rename failed");
  let failedSecond = false;
  // Inject rename directly so the actual adapter stages and restores real directories while only
  // the second forward move fails; module replacement would bypass the production binding seam.
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY,
    locate: () => ({ liveParent, liveNames: ["first", "second"], parkedDir }),
  }, {
    rename: async (from, to) => {
      if (from === join(liveParent, "second") && !failedSecond) {
        failedSecond = true;
        assert.equal(await readFile(join(parkedDir, "first", "plugin.json"), "utf8"), "first");
        throw failure;
      }
      return fsPromises.rename(from, to);
    },
  });
  await assert.rejects(adapter.hide(markerArgs()), (error) => error === failure);
  assert.equal(failedSecond, true);
  for (const name of ["first", "second"]) {
    assert.equal(await readFile(join(liveParent, name, "plugin.json"), "utf8"), name);
  }
  assert.equal(await pathExists(parkedDir), false);
});


test("purge calls forget once and removes the parked tree", async (t) => {
  const forgotten: string[] = [];
  const { adapter, liveDir, parkedDir } = await harness(t, async ({ entityId }) => void forgotten.push(entityId));
  await makeLive(liveDir);
  await adapter.hide(markerArgs());

  assert.equal(await adapter.purge(markerArgs()), "purged");
  assert.deepEqual(forgotten, [ID]);
  assert.equal(await pathExists(parkedDir), false);
});

test("purge reports already-gone without calling forget when nothing is parked", async (t) => {
  let forgetCalls = 0;
  const { adapter } = await harness(t, async () => void (forgetCalls += 1));

  assert.equal(await adapter.purge(markerArgs()), "already-gone");
  assert.equal(forgetCalls, 0);
});

test("purge restores the parked directory when forget throws", async (t) => {
  const { adapter, liveDir, parkedDir } = await harness(t, async () => {
    throw new Error("forget failed");
  });
  await makeLive(liveDir);
  await adapter.hide(markerArgs());

  await assert.rejects(() => adapter.purge(markerArgs()), /forget failed/);
  assert.equal(await readFile(join(parkedDir, ID, "plugin.json"), "utf8"), "plugin-a");
});

test("hide and unhide preserve a frozen directory's root mode", async (t) => {
  const { adapter, liveDir, parkedDir } = await harness(t);
  await makeLive(liveDir);
  await chmod(join(liveDir, "plugin.json"), 0o444);
  await chmod(liveDir, 0o555);

  await adapter.hide(markerArgs());
  assert.equal((await stat(join(parkedDir, ID))).mode & 0o777, 0o555);
  await adapter.unhide(markerArgs());
  assert.equal((await stat(liveDir)).mode & 0o777, 0o555);
  await chmod(liveDir, 0o755);
});


test("unhideIfRemoveThrows moves the folder back when the Trash row write throws after hide", async (t) => {
  const { adapter, liveDir, parkedDir } = await harness(t);
  await makeLive(liveDir);
  const remove = unhideIfRemoveThrows({ adapter, onRollbackError: ({ error }) => { throw error; }, remove: async (required: { workspaceId: string; id: string; at: string; }) => {
    assert.deepEqual(await adapter.hide({ workspaceId: required.workspaceId, entityId: required.id, at: required.at, expectedVersion: null }), { ok: true, version: null });
    throw new Error("trash row insert failed");
  } });

  await assert.rejects(remove({ workspaceId: WS, id: ID, at: AT }), /trash row insert failed/);
  assert.equal(await readFile(join(liveDir, "plugin.json"), "utf8"), "plugin-a");
  assert.equal(await pathExists(parkedDir), false);
});

test("hide refuses a parking root that resolves inside the live parent through a symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "directory-trash-"));
  t.onTestFinished(async () => rm(root, { recursive: true, force: true }));
  const liveParent = join(root, "plugins");
  const liveDir = join(liveParent, ID);
  await makeLive(liveDir);
  await mkdir(join(liveParent, "inner"));
  await symlink(join(liveParent, "inner"), join(root, "plugins-trash"));
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY,
    locate: () => ({ liveParent, liveNames: [ID], parkedDir: join(root, "plugins-trash", ID) }),
  });

  await assert.rejects(adapter.hide(markerArgs()), /resolves inside live parent/);
  assert.equal(await pathExists(liveDir), true);
});

// Exercise the shared staging lifecycle through real filesystem operations.
for (const operation of ["hide", "unhide"] as const) {
  for (const afterRename of [false, true]) {
    test(`${operation} rolls back every staged root when the second rename throws ${afterRename ? "after moving (reported, not fixed)" : "before moving"}`, async (t) => {
      const { liveParent, parkedDir } = await harness(t);
      const source = operation === "hide" ? liveParent : parkedDir;
      const destination = operation === "hide" ? parkedDir : liveParent;
      await mkdir(source, { recursive: true });
      for (const name of ["first", "second"]) await makeLive(join(source, name));
      const failure = new Error("staged move failed");
      const adapter = createDirectoryTrashAdapter({
        entityType: ENTITY,
        locate: () => ({ liveParent, parkedDir, liveNames: operation === "hide" ? ["first", "second"] : [] }),
      }, {
        rename: async (from, to) => {
          if (from === join(source, "second")) {
            if (afterRename) await fsPromises.rename(from, to);
            throw failure;
          }
          await fsPromises.rename(from, to);
        },
      });
      if (!afterRename) {
        await assert.rejects(adapter[operation](markerArgs()), (error) => error === failure);
      } else if (operation === "hide") {
        // moveDir's finally chmod still addresses the old path when the rename port moved then
        // threw. Its ENOENT masks the original error, which hide classifies as not-found.
        assert.deepEqual(await adapter.hide(markerArgs()), { ok: false, reason: "not-found" });
      } else {
        await assert.rejects(adapter.unhide(markerArgs()), { code: "ENOENT" });
      }
      for (const name of ["first", "second"]) {
        assert.equal(await readFile(join(source, name, "plugin.json"), "utf8"), "plugin-a");
        assert.equal(await pathExists(join(destination, name)), false);
      }
      assert.equal(await pathExists(parkedDir), operation === "unhide");
    });
  }
}

test("hide maps a vanished source to not-found after rolling back earlier roots", async (t) => {
  const { liveParent, parkedDir } = await harness(t);
  for (const name of ["first", "second"]) await makeLive(join(liveParent, name));
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY, locate: () => ({ liveParent, parkedDir, liveNames: ["first", "second"] }),
  }, {
    rename: async (from, to) => {
      if (from === join(liveParent, "second")) throw Object.assign(new Error("vanished"), { code: "ENOENT" });
      await fsPromises.rename(from, to);
    },
  });
  assert.deepEqual(await adapter.hide(markerArgs()), { ok: false, reason: "not-found" });
  assert.equal(await pathExists(join(liveParent, "first")), true);
  assert.equal(await pathExists(parkedDir), false);
});

test("hide validates every listed source before staging any root", async (t) => {
  const { liveParent, parkedDir } = await harness(t);
  await makeLive(join(liveParent, "first"));
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY, locate: () => ({ liveParent, parkedDir, liveNames: ["first", "missing"] }),
  });
  assert.deepEqual(await adapter.hide(markerArgs()), { ok: false, reason: "not-found" });
  assert.equal(await pathExists(join(liveParent, "first")), true);
  assert.equal(await pathExists(parkedDir), false);
});

test("unhide refuses an empty park and a destination collision even when locate lists no live names", async (t) => {
  const { liveParent, parkedDir } = await harness(t);
  await mkdir(parkedDir, { recursive: true });
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY, locate: () => ({ liveParent, parkedDir, liveNames: [] }),
  });
  assert.deepEqual(await adapter.unhide(markerArgs()), { ok: false, reason: "not-found" });
  await makeLive(join(parkedDir, ID));
  await makeLive(join(liveParent, ID));
  assert.deepEqual(await adapter.unhide(markerArgs()), { ok: false, reason: "version-changed" });
  assert.equal(await pathExists(join(parkedDir, ID)), true);
});


test("hide gives an empty existing park the minimum blocked count before considering missing live roots", async (t) => {
  const { liveParent, parkedDir } = await harness(t);
  await mkdir(parkedDir, { recursive: true });
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY, locate: () => ({ liveParent, parkedDir, liveNames: ["missing"] }),
  });
  assert.deepEqual(await adapter.hide(markerArgs()), { ok: false, reason: "blocked", code: "ALREADY_IN_TRASH", count: 1 });
});

test("rollback restores staged roots in reverse order when the third forward move fails", async (t) => {
  const { liveParent, parkedDir } = await harness(t);
  for (const name of ["first", "second", "third"]) await makeLive(join(liveParent, name));
  const failure = new Error("third move failed");
  const moves: string[] = [];
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY, locate: () => ({ liveParent, parkedDir, liveNames: ["first", "second", "third"] }),
  }, {
    rename: async (from, to) => {
      moves.push(String(from));
      if (from === join(liveParent, "third")) throw failure;
      await fsPromises.rename(from, to);
    },
  });
  await assert.rejects(adapter.hide(markerArgs()), error => error === failure);
  assert.deepEqual(moves, [
    join(liveParent, "first"), join(liveParent, "second"), join(liveParent, "third"),
    join(parkedDir, "second"), join(parkedDir, "first"),
  ]);
  for (const name of ["first", "second", "third"]) {
    assert.equal(await readFile(join(liveParent, name, "plugin.json"), "utf8"), "plugin-a");
  }
  assert.equal(await pathExists(parkedDir), false);
});

test("failed compensation reports the rollback error once and retains the remove error", async (t) => {
  const { adapter } = await harness(t);
  const removeError = new Error("remove failed"), rollbackError = new Error("rollback failed");
  const reported: unknown[] = [];
  const remove = unhideIfRemoveThrows({
    adapter: { ...adapter, unhide: async () => { throw rollbackError; } },
    remove: async (_required: { workspaceId: string; id: string; at: string }) => { throw removeError; },
    onRollbackError: ({ error }) => { reported.push(error); },
  });
  await assert.rejects(remove({ workspaceId: WS, id: ID, at: AT }), error => error === removeError);
  assert.deepEqual(reported, [rollbackError]);
});

test("EXDEV retains the existing message and recovers the live tree", async (t) => {
  const { liveParent, parkedDir } = await harness(t);
  await makeLive(join(liveParent, ID));
  const adapter = createDirectoryTrashAdapter({
    entityType: ENTITY, locate: () => ({ liveParent, parkedDir, liveNames: [ID] }),
  }, {
    rename: async () => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); },
  });
  await assert.rejects(adapter.hide(markerArgs()), (error: unknown) => error instanceof Error
    && error.message === `directory Trash cannot move '${join(liveParent, ID)}' across filesystems`
    && !("cause" in error));
  assert.equal(await readFile(join(liveParent, ID, "plugin.json"), "utf8"), "plugin-a");
  assert.equal(await pathExists(parkedDir), false);
});
