import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll as after, beforeAll as before, describe, test } from "vitest";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import pg from "pg";

import { jsonText, listTables, toBool } from "../kernel/index.js";
import {
  acquireOwnerLock,
  assertSocketPathFits,
  defaultPgliteSocketDir,
  ensurePrivateDir,
  pgliteLowMemoryStartParams,
  PGLITE_SOCKET_FILE,
  type PgliteOwner,
  PgliteOwnerLockedError,
  startPgliteOwner,
} from "../pglite/index.js";
import { openPgliteSocketKernel } from "../postgres/index.js";
import type { StorageKernel } from "../kernel/index.js";
import { LOCK_FILE, RUN_DIR, OWNER } from "./helpers.js";

/**
 * @file The PGlite owner (`pglite/owner.ts`) and its socket clients
 * (`postgres/pglite-socket.ts`), on real data dirs in temp directories: the version pin the
 * ReadyForQuery fix depends on, the low-memory settings, owner-only socket permissions, the
 * one-owner lock, kill -9 of the owner mid-write, and the storage kernel's rules through the socket.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "../..");
const scratch = mkdtempSync(join(tmpdir(), "pgo-"));
/** One initdb per file (seconds); every test copies it. */
const template = join(scratch, "template");
let copies = 0;

before(async () => {
  const db = await PGlite.create({ dataDir: template, startParams: pgliteLowMemoryStartParams(PGlite) });
  await db.close();
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A fresh data dir (a copy of the template) and a short private socket dir. */
function freshSite(): { dataDir: string; socketDir: string } {
  copies += 1;
  const dataDir = join(scratch, `data-${copies}`);
  cpSync(template, dataDir, { recursive: true });
  return { dataDir, socketDir: join(scratch, `s${copies}`) };
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(child.stdout);
}

test("@electric-sql/pglite is pinned to exactly 0.5.8 (the ReadyForQuery filter is version-specific)", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    peerDependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(manifest.peerDependencies["@electric-sql/pglite"], "0.5.8");
  assert.equal(manifest.devDependencies["@electric-sql/pglite"], "0.5.8");
  const installed = JSON.parse(
    readFileSync(join(packageRoot, "node_modules/@electric-sql/pglite/package.json"), "utf8")
  ) as { version: string };
  assert.equal(installed.version, "0.5.8");
});

describe("owner lock", () => {
  test("a live owner (this process or another) refuses; a dead pid's lock is taken over", () => {
    const dir = mkdtempSync(join(scratch, "lock-"));
    const release = acquireOwnerLock({ dataDir: dir, lockFileName: LOCK_FILE });
    assert.equal(readFileSync(join(dir, LOCK_FILE), "utf8"), `${process.pid}\n`);
    assert.throws(() => acquireOwnerLock({ dataDir: dir, lockFileName: LOCK_FILE }), PgliteOwnerLockedError);
    release();
    assert.equal(existsSync(join(dir, LOCK_FILE)), false);

    writeFileSync(join(dir, LOCK_FILE), `${process.ppid}\n`);
    assert.throws(() => acquireOwnerLock({ dataDir: dir, lockFileName: LOCK_FILE }), (error: PgliteOwnerLockedError) => error.pid === process.ppid);

    writeFileSync(join(dir, LOCK_FILE), `${deadPid()}\n`);
    const takeover = acquireOwnerLock({ dataDir: dir, lockFileName: LOCK_FILE });
    assert.equal(readFileSync(join(dir, LOCK_FILE), "utf8"), `${process.pid}\n`);
    takeover();
  });

  test("a fresh lock with no pid yet is contended, not removed; an empty one older than the grace period is taken over", () => {
    const dir = mkdtempSync(join(scratch, "lock-"));
    const lockPath = join(dir, LOCK_FILE);
    writeFileSync(lockPath, "");
    assert.throws(() => acquireOwnerLock({ dataDir: dir, lockFileName: LOCK_FILE }), (error: PgliteOwnerLockedError) => error instanceof PgliteOwnerLockedError && error.pid === undefined);
    assert.equal(readFileSync(lockPath, "utf8"), "", "the starter's lock is left alone");

    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    const release = acquireOwnerLock({ dataDir: dir, lockFileName: LOCK_FILE });
    assert.equal(readFileSync(lockPath, "utf8"), `${process.pid}\n`);
    release();
  });

  test("starters racing for one data dir (over a dead pid's lock): exactly one becomes owner", async () => {
    const dir = mkdtempSync(join(scratch, "lock-"));
    writeFileSync(join(dir, LOCK_FILE), `${deadPid()}\n`);
    const startAt = Date.now() + 4_000;
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const child = spawn(process.execPath, ["--import", "tsx", join(here, "fixtures/owner-lock-race-child.ts"), dir, String(startAt)], {
          stdio: ["ignore", "pipe", "inherit"],
        });
        let out = "";
        child.stdout!.on("data", (chunk: Buffer) => (out += chunk.toString()));
        const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
        assert.equal(code, 0, `child output: ${out}`);
        return (JSON.parse(out.trim()) as { owner: boolean }).owner;
      })
    );
    assert.equal(results.filter(Boolean).length, 1, `owners: ${JSON.stringify(results)}`);
    assert.equal(existsSync(join(dir, LOCK_FILE)), false, "the owner released on exit");
    assert.deepEqual(readdirSync(dir), [], "no temp or stale-aside files are left behind");
  });

  test("release never deletes a lock that another owner has taken since", () => {
    const dir = mkdtempSync(join(scratch, "lock-"));
    const release = acquireOwnerLock({ dataDir: dir, lockFileName: LOCK_FILE });
    writeFileSync(join(dir, LOCK_FILE), `${process.ppid}\n`);
    release();
    assert.equal(readFileSync(join(dir, LOCK_FILE), "utf8"), `${process.ppid}\n`);
  });
});

describe("socket location", () => {
  test("socket paths over 103 bytes are refused before the data dir is touched", async () => {
    assert.doesNotThrow(() => assertSocketPathFits(`/${"a".repeat(102)}`));
    assert.throws(() => assertSocketPathFits(`/${"a".repeat(103)}`), /at most 103/);
    const dataDir = join(scratch, "never-created");
    await assert.rejects(startPgliteOwner({ ...OWNER, dataDir }, { socketDir: `/tmp/${"d".repeat(100)}` }), /at most 103/);
    assert.equal(existsSync(dataDir), false);
  });

  test("the default socket dir is under ~/.<runDirName>/run, or /tmp/<runDirName>-<uid> when home is too deep", () => {
    const dir = (dataDir: string, home: string) => defaultPgliteSocketDir({ dataDir, runDirName: RUN_DIR }, { home });
    const short = dir("/sites/a/pglite", "/Users/me");
    assert.match(short, /^\/Users\/me\/\.jinidb\/run\/[0-9a-f]{8}$/);
    assert.equal(dir("/sites/a/pglite", "/Users/me"), short, "stable, so clients can find it");
    assert.notEqual(dir("/sites/b/pglite", "/Users/me"), short, "one per data dir");
    const deep = dir("/sites/a/pglite", `/Users/${"x".repeat(90)}`);
    assert.equal(deep, `/tmp/jinidb-${process.getuid!()}/${short.slice(-8)}`);
    assertSocketPathFits(join(deep, PGLITE_SOCKET_FILE));
  });

  test("the consumer-chosen names must be plain names, so they cannot escape their parent dir", () => {
    for (const bad of ["", "../x", "a/b", ".hidden"]) {
      assert.throws(() => defaultPgliteSocketDir({ dataDir: "/d", runDirName: bad }), new RegExp(`^Error: runDirName must be a plain name: '${bad.replace(/\./g, "\\.")}'$`));
      assert.throws(() => acquireOwnerLock({ dataDir: scratch, lockFileName: bad }), /lockFileName must be a plain name/);
    }
  });

  test("a socket dir that is a symlink is refused", () => {
    const target = mkdtempSync(join(scratch, "target-"));
    const link = join(scratch, "link");
    symlinkSync(target, link);
    assert.throws(() => ensurePrivateDir(link), /not a directory owned by this user/);
  });

  test("the per-user parent (the /tmp/<runDirName>-<uid> fallback) must be a 0700 non-symlink dir of ours, else refused", () => {
    const loose = mkdtempSync(join(scratch, "root-"));
    chmodSync(loose, 0o777);
    assert.throws(() => ensurePrivateDir(join(loose, "key"), { privateParent: true }), /refusing socket parent .*: not a 0700 directory owned by this user/);
    assert.equal(existsSync(join(loose, "key")), false, "nothing is created inside a parent others can write");

    const target = mkdtempSync(join(scratch, "root-target-"));
    const linked = join(scratch, "root-link");
    symlinkSync(target, linked);
    assert.throws(() => ensurePrivateDir(join(linked, "key"), { privateParent: true }), /refusing socket parent/);
    assert.equal(existsSync(join(target, "key")), false);

    const fresh = join(scratch, "root-fresh");
    ensurePrivateDir(join(fresh, "key"), { privateParent: true });
    assert.equal(statSync(fresh).mode & 0o777, 0o700, "a missing parent is created 0700");
    assert.equal(statSync(join(fresh, "key")).mode & 0o777, 0o700);
  });
});

describe("a running owner", () => {
  let owner: PgliteOwner;
  let site: { dataDir: string; socketDir: string };
  let kernel: StorageKernel<ProbeDb>;

  before(async () => {
    site = freshSite();
    owner = await startPgliteOwner({ ...OWNER, dataDir: site.dataDir }, { socketDir: site.socketDir });
    kernel = openPgliteSocketKernel<ProbeDb>({ pg, socketPath: owner.socketPath });
    await kernel.execute(sql`CREATE TABLE kernel_probe (id text PRIMARY KEY NOT NULL, doc jsonb, n integer, flag boolean)`);
  });

  after(async () => {
    await kernel.close();
    await owner.close();
  });

  test("the socket is owner-only (0600 in a 0700 dir) and is not a TCP listener", () => {
    assert.equal(statSync(owner.socketPath).mode & 0o777, 0o600);
    assert.equal(statSync(owner.socketDir).mode & 0o777, 0o700);
    assert.ok(statSync(owner.socketPath).isSocket());
    assert.equal(owner.socketPath, join(site.socketDir, PGLITE_SOCKET_FILE));
  });

  test("the low-memory settings are live", async () => {
    const show = async (name: string) => (await kernel.query<Record<string, string>>(sql.raw(`SHOW ${name}`)))[0]![name];
    assert.deepEqual(
      {
        shared_buffers: await show("shared_buffers"),
        work_mem: await show("work_mem"),
        maintenance_work_mem: await show("maintenance_work_mem"),
        wal_buffers: await show("wal_buffers"),
        max_connections: await show("max_connections"),
      },
      { shared_buffers: "16MB", work_mem: "1MB", maintenance_work_mem: "8MB", wal_buffers: "256kB", max_connections: "1" }
    );
  });

  test("a second owner for the same data dir is refused; another data dir runs side by side", async () => {
    await assert.rejects(
      startPgliteOwner({ ...OWNER, dataDir: site.dataDir }, { socketDir: join(scratch, "other-sock") }),
      (error: PgliteOwnerLockedError) => error instanceof PgliteOwnerLockedError && error.pid === process.pid
    );
    const other = freshSite();
    const second = await startPgliteOwner({ ...OWNER, dataDir: other.dataDir }, { socketDir: other.socketDir });
    try {
      const otherKernel = openPgliteSocketKernel<ProbeDb>({ pg, socketPath: second.socketPath });
      assert.equal((await listTables(otherKernel as StorageKernel<unknown>)).includes("kernel_probe"), false);
      await otherKernel.close();
    } finally {
      await second.close();
    }
    assert.equal(existsSync(join(other.dataDir, LOCK_FILE)), false, "close releases the lock");
    assert.equal(existsSync(second.socketPath), false, "close removes the socket");
  });

  // ---- the storage kernel's rules, through the socket (the `pglite-socket` leg) ----

  const ids = async () =>
    (await kernel.run((db) => db.selectFrom("kernel_probe").select("id").orderBy("id").execute())).map((row) => row.id);
  const insert = (id: string, on: StorageKernel<ProbeDb> = kernel) =>
    on.run((db) => db.insertInto("kernel_probe").values({ id, doc: null, n: null, flag: null }).execute());
  const reset = () => kernel.execute(sql`DELETE FROM kernel_probe`);

  test("socket kernel: commit, roll back, nested join", async () => {
    await reset();
    await kernel.transaction(async () => insert("kept"));
    await assert.rejects(
      kernel.transaction(async () => {
        await kernel.transaction(async () => insert("inner"));
        throw new Error("outer fails");
      }),
      /outer fails/
    );
    assert.deepEqual(await ids(), ["kept"]);
  });

  test("socket kernel: a second client's write waits for the first's transaction, and survives its rollback", async () => {
    await reset();
    const daemon = openPgliteSocketKernel<ProbeDb>({ pg, socketPath: owner.socketPath });
    try {
      let inside!: () => void;
      const opened = new Promise<void>((resolve) => (inside = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const tx = kernel.transaction(async () => {
        await insert("in-tx");
        inside();
        await released;
        throw new Error("roll back");
      });
      await opened;
      const outside = insert("from-daemon", daemon);
      release();
      await assert.rejects(tx, /roll back/);
      await outside;
      assert.deepEqual(await ids(), ["from-daemon"]);
    } finally {
      await daemon.close();
    }
  });

  test("socket kernel: lockKey, booleans, JSON and an ON CONFLICT upsert", async () => {
    await reset();
    const doc = JSON.stringify({ meta: { lang: "en" } });
    const upsert = (n: number, flag: boolean) =>
      kernel.transaction(async () => {
        await kernel.lockKey("probe:upsert");
        await kernel.run((db) =>
          db
            .insertInto("kernel_probe")
            .values({ id: "x", doc, n, flag })
            .onConflict((oc) => oc.column("id").doUpdateSet((eb) => ({ n: eb.ref("excluded.n"), flag: eb.ref("excluded.flag") })))
            .execute()
        );
      });
    await upsert(1, true);
    await upsert(2, false);
    const [row] = await kernel.query<{ n: number; flag: boolean; lang: string }>(
      sql`SELECT n, flag, ${jsonText(kernel.dialect, sql.ref("doc"), ["meta", "lang"])} AS lang FROM kernel_probe`
    );
    assert.deepEqual({ n: row!.n, flag: toBool(row!.flag), lang: row!.lang }, { n: 2, flag: false, lang: "en" });
  });

  test("a schema installed through runExclusive is visible to socket clients", async () => {
    await owner.runExclusive(async (db) => {
      await db.exec("CREATE TABLE IF NOT EXISTS fixture_parent (id text PRIMARY KEY)");
      await db.exec("CREATE TABLE IF NOT EXISTS fixture_child (id text PRIMARY KEY, parent_id text REFERENCES fixture_parent(id))");
    });
    const tables = await listTables(kernel as StorageKernel<unknown>);
    assert.ok(tables.includes("fixture_parent") && tables.includes("fixture_child"), `fixture tables present: ${tables.join(", ")}`);
  });
});

// ---- kill -9 of the owner mid-write ----

interface ProbeDb {
  kernel_probe: { id: string; doc: string | null; n: number | null; flag: boolean | null };
}

async function spawnOwner(dataDir: string, socketDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", join(here, "fixtures/pglite-owner-child.ts"), dataDir, socketDir], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const ready = await new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout! }).once("line", resolve);
    child.once("exit", (code) => reject(new Error(`owner child exited ${code} before it was ready`)));
  });
  assert.equal((JSON.parse(ready) as { ready: boolean }).ready, true);
  return child;
}

async function client(socketDir: string): Promise<pg.Client> {
  const each = new pg.Client({ host: socketDir, port: 5432, user: "postgres", database: "postgres" });
  each.on("error", () => {});
  await each.connect();
  return each;
}

async function killHard(child: ChildProcess): Promise<void> {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
}

test("kill -9 of the owner mid-write: reopen keeps every acked row, no uncommitted row, and takes over the stale lock and socket", async () => {
  const { dataDir, socketDir } = freshSite();
  const children: ChildProcess[] = [];
  try {
    // Round 1: an autocommit writer in flight.
    const first = await spawnOwner(dataDir, socketDir);
    children.push(first);
    const writer = await client(socketDir);
    await writer.query("CREATE TABLE crash_probe (i integer, tag text)");
    const acked: number[] = [];
    const writing = (async () => {
      for (let i = 0; ; i += 1) {
        await writer.query("INSERT INTO crash_probe VALUES ($1, 'acked')", [i]);
        acked.push(i);
      }
    })().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 400));
    await killHard(first);
    await writing;
    assert.ok(acked.length > 0, "the writer was acked before the kill");
    assert.equal(existsSync(join(dataDir, LOCK_FILE)), true, "kill -9 leaves the lock behind");

    // Round 2: a new owner takes over the stale lock; a big transaction is open when it dies.
    const second = await spawnOwner(dataDir, socketDir);
    children.push(second);
    const open = await client(socketDir);
    await open.query("BEGIN");
    await open.query("INSERT INTO crash_probe SELECT g, 'uncommitted' FROM generate_series(1, 500) g");
    await killHard(second);
    await open.end().catch(() => {});
    await writer.end().catch(() => {});

    const owner = await startPgliteOwner({ ...OWNER, dataDir }, { socketDir });
    try {
      const reader = await client(socketDir);
      const tags = await reader.query<{ tag: string }>("SELECT DISTINCT tag FROM crash_probe");
      const acks = await reader.query<{ count: number; distinct: number; min: number; max: number }>(
        "SELECT count(*)::int AS count, count(DISTINCT i)::int AS distinct, min(i) AS min, max(i) AS max FROM crash_probe"
      );
      await reader.end();
      assert.deepEqual(tags.rows.map((row) => row.tag), ["acked"], "no uncommitted row survived");
      const { count, distinct, min, max } = acks.rows[0]!;
      // The insert in flight at the kill may or may not have committed; every acked one did.
      assert.ok(count === acked.length || count === acked.length + 1, `rows ${count}, acked ${acked.length}`);
      assert.deepEqual({ distinct, min, max: max - (count - acked.length) }, { distinct: count, min: 0, max: acked.at(-1) });
    } finally {
      await owner.close();
    }
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
