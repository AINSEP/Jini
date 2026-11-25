import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withFileLock } from "../file-lock.js";
import { OWNED_TEMP_ROOT_LOCK_SUFFIX, OWNED_TEMP_ROOT_MARKER_SUFFIX, sweepOwnedTempRoots, withOwnedTempRoot, type OwnedTempRootLock } from "../owned-temp-root.js";

const PREFIX = "scratch-a-";
const DAY = 86_400_000;
const DEAD = 111, LIVE = 222;
const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
const later = { nowMs: () => Date.now() + 2 * DAY };
// The liveness probe is injected through the lock adapter: only pid LIVE answers.
const probed: OwnedTempRootLock = (required, options) => withFileLock(required, { ...options, hostname: () => "host-a", process: { pid: 999, isAlive: ({ pid }) => pid === LIVE || pid === 999 } });

let base: string, parent: string;
beforeEach(async () => { base = await fsp.mkdtemp(join(tmpdir(), "owned-root-test-")); parent = join(base, "parent"); await fsp.mkdir(parent); });
afterEach(async () => { await fsp.rm(base, { recursive: true, force: true }); });

async function plant({ dir = parent, name, pid, marker = true, root = true }: { dir?: string; name: string; pid?: number; marker?: boolean; root?: boolean }) {
  const path = join(dir, name);
  if (root) { await fsp.mkdir(path); await fsp.writeFile(join(path, "data.bin"), "x"); }
  if (marker) await fsp.writeFile(path + OWNED_TEMP_ROOT_MARKER_SUFFIX, "{}");
  if (pid !== undefined) await fsp.writeFile(path + OWNED_TEMP_ROOT_LOCK_SUFFIX, JSON.stringify({ pid, hostname: "host-a", token: `t-${name}`, acquiredAt: new Date().toISOString() }));
  return path;
}
const sweep = (over: Partial<Parameters<typeof sweepOwnedTempRoots>[0]> = {}, optional = {}) =>
  sweepOwnedTempRoots({ roots: [{ parent, prefix: PREFIX }], fs: fsp, lock: probed, clock: later, signal: new AbortController().signal, ...over }, optional);
const outcomeOf = (report: Awaited<ReturnType<typeof sweep>>, path: string) => report.entries.find((entry) => entry.path === path);

describe("sweepOwnedTempRoots", () => {
  it("only named prefixes in the named root are touched", async () => {
    const exact = await plant({ name: PREFIX + uuid(1), pid: DEAD });
    const suffixed = await plant({ name: PREFIX + uuid(2) + "-extra", pid: DEAD });
    const notUuid = await plant({ name: PREFIX + "not-a-uuid", pid: DEAD });
    const otherPrefix = await plant({ name: "scratch-b-" + uuid(3), pid: DEAD });
    const elsewhere = join(base, "elsewhere"); await fsp.mkdir(elsewhere);
    const unnamedRoot = await plant({ dir: elsewhere, name: PREFIX + uuid(4), pid: DEAD });
    const report = await sweep();
    expect(outcomeOf(report, exact)).toMatchObject({ outcome: "removed" });
    expect(existsSync(exact)).toBe(false);
    expect(existsSync(exact + OWNED_TEMP_ROOT_LOCK_SUFFIX) || existsSync(exact + OWNED_TEMP_ROOT_MARKER_SUFFIX)).toBe(false);
    for (const untouched of [suffixed, notUuid, otherPrefix, unnamedRoot]) {
      expect(existsSync(join(untouched, "data.bin"))).toBe(true);
      expect(existsSync(untouched + OWNED_TEMP_ROOT_LOCK_SUFFIX)).toBe(true);
      expect(outcomeOf(report, untouched)).toBeUndefined();
    }
  });

  it("a root with a live marker from another process is kept", async () => {
    const live = await plant({ name: PREFIX + uuid(1), pid: LIVE });
    const foreign = await plant({ name: PREFIX + uuid(2), marker: true });
    await fsp.writeFile(foreign + OWNED_TEMP_ROOT_LOCK_SUFFIX, JSON.stringify({ pid: DEAD, hostname: "host-b", token: "t", acquiredAt: new Date(0).toISOString() }));
    const report = await sweep();
    expect(outcomeOf(report, live)).toMatchObject({ outcome: "kept", reason: "owner-alive" });
    expect(outcomeOf(report, foreign)).toMatchObject({ outcome: "kept", reason: "owner-alive" });
    expect(existsSync(join(live, "data.bin")) && existsSync(join(foreign, "data.bin"))).toBe(true);
  });

  it("pre-protocol leftover is report-only", async () => {
    const legacy = await plant({ name: PREFIX + uuid(1), marker: false });
    const unconfirmed = await plant({ name: PREFIX + uuid(2), pid: DEAD, marker: false });
    const report = await sweep();
    expect(outcomeOf(report, legacy)).toMatchObject({ outcome: "report-only", reason: "legacy" });
    expect(outcomeOf(report, unconfirmed)).toMatchObject({ outcome: "report-only", reason: "unconfirmed" });
    expect(existsSync(join(legacy, "data.bin")) && existsSync(join(unconfirmed, "data.bin"))).toBe(true);
  });

  it("symlinked root skipped", async () => {
    const target = join(base, "target"); await fsp.mkdir(target); await fsp.writeFile(join(target, "keep.txt"), "k");
    const link = join(parent, PREFIX + uuid(1));
    await fsp.symlink(target, link, "dir");
    await plant({ name: PREFIX + uuid(1), pid: DEAD, root: false });
    const report = await sweep();
    expect(outcomeOf(report, link)).toMatchObject({ outcome: "kept", reason: "not-a-directory" });
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
    expect((await fsp.lstat(link)).isSymbolicLink()).toBe(true);
  });

  it("a dead-owner lock with no root is removed through the stale-break path", async () => {
    const orphan = await plant({ name: PREFIX + uuid(1), pid: DEAD, root: false });
    const liveOrphan = await plant({ name: PREFIX + uuid(2), pid: LIVE, root: false });
    const report = await sweep();
    expect(outcomeOf(report, orphan)).toMatchObject({ outcome: "removed", reason: "orphan-lock" });
    expect(existsSync(orphan + OWNED_TEMP_ROOT_LOCK_SUFFIX) || existsSync(orphan + OWNED_TEMP_ROOT_MARKER_SUFFIX)).toBe(false);
    expect(outcomeOf(report, liveOrphan)).toMatchObject({ outcome: "kept", reason: "owner-alive" });
    expect(existsSync(liveOrphan + OWNED_TEMP_ROOT_LOCK_SUFFIX)).toBe(true);
  });

  it("keeps young roots, a root replaced under exclusion, and stops at the limit or abort", async () => {
    const young = await plant({ name: PREFIX + uuid(1), pid: DEAD });
    expect(outcomeOf(await sweep({ clock: { nowMs: () => Date.now() } }), young)).toMatchObject({ outcome: "kept", reason: "young" });
    const swapping: OwnedTempRootLock = (required, options) => probed({ lockPath: required.lockPath, run: async () => { await fsp.rename(young, young + "-moved"); await fsp.mkdir(young); return required.run(); } }, options);
    expect(outcomeOf(await sweep({ lock: swapping }), young)).toMatchObject({ outcome: "kept", reason: "changed" });
    expect(existsSync(young)).toBe(true);
    await plant({ name: PREFIX + uuid(2), pid: DEAD }); await plant({ name: PREFIX + uuid(3), pid: DEAD });
    expect((await sweep({}, { limit: 1 })).truncated).toBe(true);
    const aborted = new AbortController(); aborted.abort();
    expect((await sweep({ signal: aborted.signal })).entries).toEqual([]);
  });
});

describe("withOwnedTempRoot", () => {
  it("writer creates the lock before the folder", async () => {
    const seen: string[] = [];
    const spyFs = { ...fsp, mkdir: (async (path: string, options: { mode: number }) => {
      seen.push(`lock=${existsSync(path + OWNED_TEMP_ROOT_LOCK_SUFFIX)} marker=${existsSync(path + OWNED_TEMP_ROOT_MARKER_SUFFIX)} root=${existsSync(path)}`);
      return fsp.mkdir(path, options);
    }) as typeof fsp.mkdir };
    let root = "", mode = 0;
    const result = await withOwnedTempRoot({ parent, prefix: PREFIX, id: () => uuid(7), fs: spyFs, lock: probed, work: async ({ root: r }) => { root = r; mode = (await fsp.stat(r)).mode & 0o777; return "done"; } });
    expect(result).toBe("done");
    expect(seen).toEqual(["lock=true marker=true root=false"]);
    expect(root).toBe(join(parent, PREFIX + uuid(7)));
    expect(mode).toBe(0o700);
    expect(existsSync(root) || existsSync(root + OWNED_TEMP_ROOT_LOCK_SUFFIX) || existsSync(root + OWNED_TEMP_ROOT_MARKER_SUFFIX)).toBe(false);
  });

  it("refuses an id that is not an exact UUID", async () => {
    await expect(withOwnedTempRoot({ parent, prefix: PREFIX, id: () => "../escape", fs: fsp, lock: probed, work: async () => 1 })).rejects.toThrow(RangeError);
  });

  it("root kept while the worker runs", async () => {
    let swept: Awaited<ReturnType<typeof sweep>> | undefined, root = "";
    // A real child process; the default lock probes this test process, which is alive.
    const realLock: OwnedTempRootLock = (required, options) => withFileLock(required, options);
    await withOwnedTempRoot({ parent, prefix: PREFIX, id: () => uuid(5), fs: fsp, lock: realLock, work: async ({ root: r }) => {
      root = r;
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 150)"]);
      swept = await sweep({ lock: realLock });
      expect(existsSync(r)).toBe(true);
      await new Promise((resolve) => child.on("close", resolve));
      expect(existsSync(r)).toBe(true);
    } });
    expect(outcomeOf(swept!, root)).toMatchObject({ outcome: "kept", reason: "owner-alive" });
    expect(existsSync(root)).toBe(false);
  });

  it("keeps the provenance marker when removal fails, so a later sweep can finish", async () => {
    const failures: unknown[] = [];
    const failingRm = { ...fsp, rm: (async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); }) as typeof fsp.rm };
    const root = await withOwnedTempRoot({ parent, prefix: PREFIX, id: () => uuid(6), fs: failingRm, lock: probed, work: async ({ root: r }) => r }, { onRemovalError: ({ error }) => failures.push(error) });
    expect(failures).toHaveLength(1);
    expect(existsSync(root) && existsSync(root + OWNED_TEMP_ROOT_MARKER_SUFFIX)).toBe(true);
    expect(existsSync(root + OWNED_TEMP_ROOT_LOCK_SUFFIX)).toBe(false);
    expect(outcomeOf(await sweep(), root)).toMatchObject({ outcome: "removed" });
    expect(existsSync(root) || existsSync(root + OWNED_TEMP_ROOT_MARKER_SUFFIX)).toBe(false);
  });
});
