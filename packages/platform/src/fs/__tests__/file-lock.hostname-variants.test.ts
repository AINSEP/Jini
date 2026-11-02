import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { FileLockTimeoutError, withFileLock, withFileLockSync } from "../file-lock.js";

// Demo practice run (2026-11-02): on every boot of one site an Agent Plugin timed out on its state
// lock and stayed off. Those locks never age out (`staleMs: Infinity`), so a lock a killed process
// left behind is reclaimed only when its owner is proven dead, and a holder on another host is never
// probed. macOS reports ONE machine as `name.lan`, `name.local` or `name` as its network changes, so
// a lock left under one spelling was "foreign" under the next and wedged the boot forever. The same
// first label AND the same kernel boot now prove the same machine, and its dead pid is reclaimed.
const roots: string[] = [];
function lockPathIn(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hostname-variant-lock-"));
  roots.push(root);
  return path.join(root, ".plugin-state-example.lock");
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const BOOT = { id: "1762000000000", startedAtMs: 1_762_000_000_000 };
function plant(lockPath: string, holder: Record<string, unknown>): string {
  const raw = JSON.stringify({ pid: 4242, hostname: "LAs-MacBook-Pro.lan", token: "killed", acquiredAt: "2026-11-02T10:00:00.000Z", bootId: BOOT.id, ...holder });
  fs.writeFileSync(lockPath, raw);
  return raw;
}
function options({ hostname = "LAs-MacBook-Pro.local", alive = false, boot = BOOT }: { hostname?: string; alive?: boolean; boot?: typeof BOOT } = {}) {
  let elapsed = 0;
  return {
    staleMs: Infinity, timeoutMs: 50, pollMs: 1, hostname: () => hostname,
    process: { pid: 4243, isAlive: vi.fn(() => alive), bootIdentity: () => boot },
    clock: { nowMs: () => elapsed }, sleep: () => { elapsed += 1; },
  };
}

for (const adapter of ["sync", "async"] as const) {
  const lock = async (lockPath: string, opts: ReturnType<typeof options>) => {
    const required = { lockPath, run: () => "acquired" };
    return adapter === "sync" ? withFileLockSync(required, opts) : await withFileLock(required, opts);
  };

  test.each(["LAs-MacBook-Pro.local", "LAs-MacBook-Pro", "las-macbook-pro.LAN"])(
    `${adapter} reclaims a dead holder written on this machine under another hostname spelling (now %s)`,
    async (hostname) => {
      const lockPath = lockPathIn();
      plant(lockPath, {});
      const opts = options({ hostname });
      await expect(lock(lockPath, opts)).resolves.toBe("acquired");
      expect(opts.process.isAlive).toHaveBeenCalledWith({ pid: 4242 });
      expect(fs.existsSync(lockPath)).toBe(false);
    },
  );

  test(`${adapter} keeps a live holder across hostname spellings`, async () => {
    const lockPath = lockPathIn();
    const raw = plant(lockPath, {});
    await expect(lock(lockPath, options({ alive: true }))).rejects.toThrow(FileLockTimeoutError);
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  });

  test.each([
    ["another machine name", { hostname: "build-box.lan" }],
    ["no recorded boot", { bootId: undefined }],
    ["a different kernel boot id", { bootId: "0b9f2c1e-0000-4000-8000-000000000000" }],
  ])(`${adapter} still never probes a holder from %s`, async (_case, holder) => {
    const lockPath = lockPathIn();
    const raw = plant(lockPath, holder);
    const opts = options();
    await expect(lock(lockPath, opts)).rejects.toThrow(FileLockTimeoutError);
    expect(opts.process.isAlive).not.toHaveBeenCalled();
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  });
}
