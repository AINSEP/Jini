import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImportDatabase, type ImportDatabaseHost, type ImportWorkerChild, type RebuildImportDatabaseOptions } from "../import-database.js";

/** A neutral host: distinct exit codes, a private prefix and a redactor that masks `secret-<token>` shapes. */
const PREFIX = "pkg-import-db-";
const REFUSAL_CODE = 41;
const SCHEMA_CODE = 42;
const VERSION_MESSAGE = "This archive was made by a different version.";
const plenty = async () => ({ bavail: 1024 * 1024, bsize: 4096 });
const cleanup: string[] = [];
afterEach(() => { for (const root of cleanup.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

function host(over: Partial<ImportDatabaseHost> = {}): ImportDatabaseHost {
  return {
    redact: ({ text }) => ({ text: text.replace(/secret-[A-Za-z0-9]+/g, "[REDACTED]") }),
    withFileLock: async ({ run }) => run(),
    limits: { maxExpandedBytes: 1024 },
    stagingPrefix: PREFIX,
    helperStem: "./worker/repo",
    versionMismatchMessage: VERSION_MESSAGE,
    schemaMismatchExitCode: SCHEMA_CODE,
    refusalExitCode: REFUSAL_CODE,
    workerEnv: ({ root }) => ({ PKG_PROFILE_DIR: path.join(root, "profile") }),
    inheritedEnv: () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }),
    ...over,
  } as ImportDatabaseHost;
}
function api(over: Partial<ImportDatabaseHost> = {}) { return createImportDatabase<{ bytes: Buffer }>({ host: host(over) }); }

/** A forked helper stand-in: reports its exit asynchronously, like a real process. */
class FakeHelper extends EventEmitter {
  readonly kills: string[] = [];
  stderr: PassThrough | null = null;
  kill(signal: NodeJS.Signals): boolean { this.kills.push(signal); setImmediate(() => this.emit("close", null)); return true; }
}
function forkThat(behave: (input: { root: string; child: FakeHelper }) => void, { stderr = false }: { stderr?: boolean } = {}) {
  const roots: string[] = [];
  const children: FakeHelper[] = [];
  const calls: { helper: string; options: childProcess.ForkOptions }[] = [];
  const fork: NonNullable<RebuildImportDatabaseOptions["fork"]> = (helper, args, options) => {
    const child = new FakeHelper();
    if (stderr) child.stderr = new PassThrough();
    roots.push(args[0]!);
    children.push(child);
    calls.push({ helper, options });
    cleanup.push(args[0]!);
    setImmediate(() => behave({ root: args[0]!, child }));
    return child as unknown as ImportWorkerChild;
  };
  return { fork, roots, children, calls };
}
function writeOutputs(root: string, bytes = Buffer.from("rebuilt")): void {
  fs.writeFileSync(path.join(root, "output.db"), bytes);
  fs.writeFileSync(path.join(root, "media.json"), JSON.stringify([{ storageKey: "blobs/a" }]));
  fs.writeFileSync(path.join(root, "documents.json"), JSON.stringify([]));
  fs.writeFileSync(path.join(root, "notices.json"), "[]");
  fs.writeFileSync(path.join(root, "credential-warnings.json"), JSON.stringify([{ path: "a.db:t.c", kind: "key shape" }]));
}
const input = { snapshot: Buffer.from("input"), moduleUrl: "file:///app/src/x.ts" };

describe("importWorkerLaunch", () => {
  it("runs TypeScript source through tsx and a build's JavaScript directly, both with a heap ceiling", () => {
    const { importWorkerLaunch } = api();
    expect(importWorkerLaunch({ moduleUrl: "file:///app/src/import.ts" })).toEqual({ helper: fileURLToPath("file:///app/src/worker/repo.ts"), execArgv: ["--import", "tsx", "--max-old-space-size=512"] });
    expect(importWorkerLaunch({ moduleUrl: "file:///app/dist/import.js" })).toEqual({ helper: fileURLToPath("file:///app/dist/worker/repo.js"), execArgv: ["--max-old-space-size=512"] });
  });
});

describe("rebuildImportDatabase", () => {
  it("refuses an oversized snapshot and a staging area without room before any helper starts", async () => {
    const { fork, roots } = forkThat(() => { throw new Error("no helper may start"); });
    await expect(api().rebuildImportDatabase({ ...input, snapshot: Buffer.alloc(1025) }, { statfs: plenty, fork })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", message: "Import database exceeds 300 MiB." });
    await expect(api().rebuildImportDatabase(input, { statfs: async () => ({ bavail: 1, bsize: 4096 }), fork })).rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE" });
    expect(roots).toEqual([]);
  });

  it("returns the rebuilt database and manifests, with host env merged in and the staging root removed", async () => {
    const { fork, roots, calls } = forkThat(({ root, child }) => { writeOutputs(root); child.emit("close", 0); });
    const result = await api().rebuildImportDatabase(input, { statfs: plenty, fork });
    expect(result).toEqual({ bytes: Buffer.from("rebuilt"), media: [{ storageKey: "blobs/a" }], documents: [], notices: [], credentialWarnings: [{ path: "a.db:t.c", kind: "key shape" }] });
    expect(path.basename(roots[0]!).startsWith(PREFIX)).toBe(true);
    expect(fs.existsSync(roots[0]!)).toBe(false);
    const env = calls[0]!.options.env!;
    expect(env).toMatchObject({ TMPDIR: roots[0], HOME: roots[0], PKG_PROFILE_DIR: path.join(roots[0]!, "profile"), XDG_DATA_HOME: path.join(roots[0]!, "data"), APPDATA: path.join(roots[0]!, "appdata") });
  });

  it("refuses a rebuilt database over the cap even when the helper succeeded", async () => {
    const { fork, roots } = forkThat(({ root, child }) => { writeOutputs(root, Buffer.alloc(64)); child.emit("close", 0); });
    await expect(api().rebuildImportDatabase(input, { limits: { maxExpandedBytes: 32 }, statfs: plenty, fork })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", message: "Rebuilt import database exceeds 300 MiB." });
    expect(fs.existsSync(roots[0]!)).toBe(false);
  });

  it("maps the helper's exit codes: a typed refusal shows its file, a schema mismatch the host message, anything else is generic", async () => {
    const refused = forkThat(({ root, child }) => { fs.writeFileSync(path.join(root, "refusal.txt"), "Cannot build schema."); child.emit("close", REFUSAL_CODE); });
    await expect(api().rebuildImportDatabase(input, { statfs: plenty, fork: refused.fork })).rejects.toMatchObject({ code: "INVALID_DATABASE", message: "Import database refused: Cannot build schema." });
    const version = forkThat(({ child }) => child.emit("close", SCHEMA_CODE));
    await expect(api().rebuildImportDatabase(input, { statfs: plenty, fork: version.fork })).rejects.toMatchObject({ code: "INVALID_DATABASE", message: VERSION_MESSAGE });
    const other = forkThat(({ child }) => child.emit("close", 1));
    await expect(api().rebuildImportDatabase(input, { statfs: plenty, fork: other.fork })).rejects.toMatchObject({ code: "INVALID_DATABASE", message: "Import database has unsupported schema, invalid references or unsafe data." });
  });

  it("surfaces a helper that fails to start with its own error and removes the root", async () => {
    const spawnError = new Error("spawn EACCES");
    const fails = forkThat(({ child }) => { child.emit("error", spawnError); child.emit("close", null); });
    await expect(api().rebuildImportDatabase(input, { statfs: plenty, fork: fails.fork })).rejects.toBe(spawnError);
    expect(fs.existsSync(fails.roots[0]!)).toBe(false);
  });

  it("kills the helper as soon as it starts when cancellation lands while staging", async () => {
    const controller = new AbortController();
    const { fork, children } = forkThat(() => undefined);
    const statfs = async () => { controller.abort(); return plenty(); };
    await expect(api().rebuildImportDatabase(input, { signal: controller.signal, statfs, fork })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(children[0]!.kills).toEqual(["SIGKILL"]);
  });

  it("redacts every helper stderr line through the injected redactor before it reaches the server log", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => { logged.push(line); });
    const { fork } = forkThat(({ root, child }) => {
      child.stderr!.write("failure token secret-abc123 here\n");
      child.stderr!.end();
      // The line reader drains on its own ticks; report the exit only afterwards.
      setTimeout(() => { writeOutputs(root); child.emit("close", 0); }, 20);
    }, { stderr: true });
    await api().rebuildImportDatabase(input, { statfs: plenty, fork });
    expect(logged.join("\n")).toContain("failure token [REDACTED] here");
    expect(logged.join("\n")).not.toContain("secret-abc123");
  });

  it("takes the injected file lock on a sibling `.lock` path before creating the staging root", async () => {
    const seen: { lockPath: string; existedAtLock: boolean; options: unknown }[] = [];
    const lock: ImportDatabaseHost["withFileLock"] = async ({ lockPath, run }, options) => {
      seen.push({ lockPath, existedAtLock: fs.existsSync(lockPath.slice(0, -5)), options });
      return run();
    };
    const { fork } = forkThat(({ root, child }) => { writeOutputs(root); child.emit("close", 0); });
    await api({ withFileLock: lock }).rebuildImportDatabase(input, { statfs: plenty, fork });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.lockPath.endsWith(".lock") && path.basename(seen[0]!.lockPath).startsWith(PREFIX)).toBe(true);
    expect(seen[0]!.existedAtLock).toBe(false);
    expect(seen[0]!.options).toMatchObject({ staleMs: Infinity });
  });
});

describe("tidyImportDatabases", () => {
  it("removes only leftover directories and `.lock` files carrying the host's prefix", async () => {
    const tmp = os.tmpdir();
    const tag = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const mine = path.join(tmp, tag), unrelated = path.join(tmp, `other-${tag}`);
    fs.mkdirSync(mine); fs.mkdirSync(unrelated);
    fs.writeFileSync(mine + ".lock", "x");
    cleanup.push(mine, mine + ".lock", unrelated);
    await api().tidyImportDatabases({});
    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it("skips a leftover whose lock another owner or the OS still holds, and rethrows anything else", async () => {
    const tmp = os.tmpdir();
    const mine = path.join(tmp, `${PREFIX}${Date.now()}-busy`);
    fs.mkdirSync(mine); cleanup.push(mine);
    for (const code of ["EBUSY", "EPERM", "EACCES"]) {
      await api({ withFileLock: async () => { throw Object.assign(new Error(code), { code }); } }).tidyImportDatabases({});
    }
    expect(fs.existsSync(mine)).toBe(true);
    await expect(api({ withFileLock: async () => { throw Object.assign(new Error("boom"), { code: "EIO" }); } }).tidyImportDatabases({})).rejects.toThrow("boom");
  });
});
