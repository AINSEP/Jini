import fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { defaultPlatformMessages, type PlatformMessages } from "../../messages.js";
import { FileLockLostError, FileLockTimeoutError, withFileLock, withFileLockSync } from "../file-lock.js";
import { BOOT_CLOCK_TOLERANCE_MS } from "../boot-identity.js";

/** Boundary pins for both lock adapters: failure classification, cleanup ownership and defaults. */
const roots: string[] = [];
function target(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "lock-bounds-")); roots.push(root); return path.join(root, "file.lock"); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const coded = (code: string) => Object.assign(new Error(code), { code });
const messages: PlatformMessages = { ...defaultPlatformMessages, fileLockIntervalsInvalid: () => "custom intervals", fileLockLost: () => "custom lost", fileLockTimeout: () => "custom timeout" };
const deadOwner = { process: { pid: process.pid, isAlive: () => false }, timeoutMs: 0, staleMs: 30_000 };

test("invalid intervals use the default or the host message", () => {
  for (const invalid of [{ timeoutMs: -1 }, { timeoutMs: 1.5 }, { staleMs: 0 }, { staleMs: -Infinity }, { staleMs: Number.NaN }, { pollMs: 0 }, { pollMs: 0.5 }]) {
    expect(() => withFileLockSync({ lockPath: target(), run: () => undefined }, invalid)).toThrow(RangeError);
  }
  expect(() => withFileLockSync({ lockPath: target(), run: () => undefined }, { pollMs: 0, messages })).toThrow("custom intervals");
  expect(withFileLockSync({ lockPath: target(), run: () => "ok" }, { staleMs: Infinity, timeoutMs: 0 })).toBe("ok");
});

test("token format without a boot identity omits the boot suffix", () => {
  const lockPath = target();
  const raw = withFileLockSync({ lockPath, run: () => fs.readFileSync(lockPath, "utf8") }, { format: "token", token: () => "t", process: { pid: 7, isAlive: () => true } });
  expect(raw).toBe("7:t");
});

test("JSON format without a boot identity omits bootId and the default port reads this process", () => {
  const lockPath = target();
  const holder = withFileLockSync({ lockPath, run: () => JSON.parse(fs.readFileSync(lockPath, "utf8")) }, { process: { pid: 7, isAlive: () => true }, hostname: () => "h", token: () => "t" });
  expect(holder).toEqual({ pid: 7, hostname: "h", token: "t", acquiredAt: expect.any(String) });
  const own = withFileLockSync({ lockPath, run: () => JSON.parse(fs.readFileSync(lockPath, "utf8")) });
  expect(own.pid).toBe(process.pid);
});

test("legacy holders with unusable pids have unknown liveness and are only age-stolen", () => {
  for (const raw of ["0:x", "x:y", "", "{\"pid\":7}", "[1]", "null"]) {
    const lockPath = target(); fs.writeFileSync(lockPath, raw);
    expect(() => withFileLockSync({ lockPath, run: () => undefined }, deadOwner)).toThrow(FileLockTimeoutError);
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  }
});

test("legacy holders: boot id suffix decides, otherwise lock mtime against boot start", () => {
  const boot = (startedAtMs: number) => ({ process: { pid: process.pid, isAlive: () => true, bootIdentity: () => ({ id: "now", startedAtMs }) }, timeoutMs: 0, staleMs: Infinity });
  const lockPath = target();
  fs.writeFileSync(lockPath, "42:x:now");
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, boot(0))).toThrow(FileLockTimeoutError);
  fs.writeFileSync(lockPath, "42:x:before");
  expect(withFileLockSync({ lockPath, run: () => "reclaimed" }, { ...boot(0), timeoutMs: 100 })).toBe("reclaimed");
  fs.writeFileSync(lockPath, "42:x");
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, boot(0))).toThrow(FileLockTimeoutError);
  // A boot start a minute after the lock's mtime is clock-step noise, not a reboot.
  fs.writeFileSync(lockPath, "42:x");
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, boot(Date.now() + 60_000))).toThrow(FileLockTimeoutError);
  expect(withFileLockSync({ lockPath, run: () => "reclaimed" }, { ...boot(Date.now() + BOOT_CLOCK_TOLERANCE_MS + 60_000), timeoutMs: 100 })).toBe("reclaimed");
});

test("without a boot identity, a live owner is never treated as restarted", () => {
  const options = { hostname: () => "here", process: { pid: process.pid, isAlive: () => true }, timeoutMs: 0, staleMs: Infinity };
  for (const raw of ["42:x:other-boot", JSON.stringify({ pid: 42, hostname: "here", token: "x", acquiredAt: "2000-01-01T00:00:00Z", bootId: "other-boot" })]) {
    const lockPath = target(); fs.writeFileSync(lockPath, raw);
    expect(() => withFileLockSync({ lockPath, run: () => undefined }, options)).toThrow(FileLockTimeoutError);
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  }
});

test("JSON holders: foreign hosts are unknown; boot id or acquiredAt decides a restart", () => {
  const options = (startedAtMs: number) => ({ hostname: () => "here", process: { pid: process.pid, isAlive: () => true, bootIdentity: () => ({ id: "now", startedAtMs }) }, timeoutMs: 0, staleMs: Infinity });
  const lockPath = target();
  const plant = (holder: Record<string, unknown>) => fs.writeFileSync(lockPath, JSON.stringify({ pid: 42, hostname: "here", token: "x", acquiredAt: "2000-01-01T00:00:00Z", ...holder }));
  plant({ hostname: "there", bootId: "before" });
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, options(0))).toThrow(FileLockTimeoutError);
  plant({ bootId: "now" });
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, options(0))).toThrow(FileLockTimeoutError);
  plant({ bootId: 5 });
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, options(0))).toThrow(FileLockTimeoutError);
  expect(withFileLockSync({ lockPath, run: () => "reclaimed" }, { ...options(Date.parse("2001-01-01T00:00:00Z")), timeoutMs: 100 })).toBe("reclaimed");
});

test("timeouts carry host messages, the custom timeout copy and the observed holder", async () => {
  const lockPath = target(); fs.writeFileSync(lockPath, `${process.pid}:live`);
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, { timeoutMs: 0, messages })).toThrow("custom timeout");
  await expect(withFileLock({ lockPath, run: () => undefined }, { timeoutMs: 0, timeoutMessage: ({ lockPath: at, waitMs }) => `${path.basename(at)} ${waitMs}` })).rejects.toThrow("file.lock 0");
});

test("inspection: a vanished or contended lock retries; other open failures surface", async () => {
  for (const code of ["ENOENT", "EEXIST"]) {
    const lockPath = target(); fs.writeFileSync(lockPath, `${process.pid}:live`);
    const real = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => { if (flags === "r") throw coded(code); return real(file, flags, mode); }) as typeof fs.openSync);
    expect(() => withFileLockSync({ lockPath, run: () => undefined }, { timeoutMs: 0 })).toThrow(expect.objectContaining({ holder: undefined }));
    vi.restoreAllMocks();
    const filesystem = { ...asyncFs, open: async (file: Parameters<typeof asyncFs.open>[0], flags: Parameters<typeof asyncFs.open>[1], mode?: Parameters<typeof asyncFs.open>[2]) => { if (flags === "r") throw coded(code); return asyncFs.open(file, flags, mode); } };
    await expect(withFileLock({ lockPath, run: () => undefined }, { timeoutMs: 0, filesystem })).rejects.toMatchObject({ holder: undefined });
  }
  const lockPath = target(); fs.writeFileSync(lockPath, `${process.pid}:live`);
  const real = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => { if (flags === "r") throw "not an error object"; return real(file, flags, mode); }) as typeof fs.openSync);
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, { timeoutMs: 0 })).toThrow("not an error object");
  vi.restoreAllMocks();
  const filesystem = { ...asyncFs, open: async (file: Parameters<typeof asyncFs.open>[0], flags: Parameters<typeof asyncFs.open>[1], mode?: Parameters<typeof asyncFs.open>[2]) => { if (flags === "r") throw coded("EIO"); return asyncFs.open(file, flags, mode); } };
  await expect(withFileLock({ lockPath, run: () => undefined }, { timeoutMs: 0, filesystem })).rejects.toThrow("EIO");
});

test("sync ownership write that makes no progress fails and removes its own lock", () => {
  const lockPath = target();
  vi.spyOn(fs, "writeSync").mockReturnValue(0);
  expect(() => withFileLockSync({ lockPath, run: () => undefined })).toThrow(defaultPlatformMessages.fileLockWriteNoProgress());
  vi.restoreAllMocks();
  expect(fs.existsSync(lockPath)).toBe(false);
  vi.spyOn(fs, "writeSync").mockReturnValue(0);
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, { messages: { ...messages, fileLockWriteNoProgress: () => "custom stall" } })).toThrow("custom stall");
});

test("sync ownership write keeps a partially written chunked holder", () => {
  const lockPath = target(); const real = fs.writeSync;
  vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, buffer: Buffer, offset: number) => real(fd, buffer, offset, 1)) as typeof fs.writeSync);
  expect(withFileLockSync({ lockPath, run: () => fs.readFileSync(lockPath, "utf8") }, { format: "token", token: () => "abc", process: { pid: 9, isAlive: () => true } })).toBe("9:abc");
});

test("sync creation failure keeps a replacement owner and preserves the original error", () => {
  const lockPath = target();
  vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { fs.rmSync(lockPath); fs.writeFileSync(lockPath, "replacement"); throw new Error("write failed"); });
  expect(() => withFileLockSync({ lockPath, run: () => undefined })).toThrow("write failed");
  expect(fs.readFileSync(lockPath, "utf8")).toBe("replacement");
  vi.restoreAllMocks(); fs.rmSync(lockPath);
  vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { fs.rmSync(lockPath); throw new Error("write failed"); });
  expect(() => withFileLockSync({ lockPath, run: () => undefined })).toThrow("write failed");
});

test("async creation failure removes only its own lock and preserves the original error", async () => {
  const failing = (before: (lockPath: string) => Promise<void>) => ({ ...asyncFs, open: async (file: Parameters<typeof asyncFs.open>[0], flags: Parameters<typeof asyncFs.open>[1], mode?: Parameters<typeof asyncFs.open>[2]) => {
    const handle = await asyncFs.open(file, flags, mode);
    if (flags !== "wx") return handle;
    return Object.assign(Object.create(handle) as typeof handle, { stat: handle.stat.bind(handle), close: handle.close.bind(handle), writeFile: async () => { await before(String(file)); throw new Error("write failed"); } });
  } });
  const lockPath = target();
  await expect(withFileLock({ lockPath, run: () => undefined }, { filesystem: failing(async () => {}) })).rejects.toThrow("write failed");
  expect(fs.existsSync(lockPath)).toBe(false);
  await expect(withFileLock({ lockPath, run: () => undefined }, { filesystem: failing(async (at) => { fs.rmSync(at); fs.writeFileSync(at, "replacement"); }) })).rejects.toThrow("write failed");
  expect(fs.readFileSync(lockPath, "utf8")).toBe("replacement");
  fs.rmSync(lockPath);
  await expect(withFileLock({ lockPath, run: () => undefined }, { filesystem: failing(async (at) => { fs.rmSync(at); }) })).rejects.toThrow("write failed");
  await expect(withFileLock({ lockPath, run: () => undefined }, { filesystem: { ...failing(async () => {}), rm: async () => { throw coded("EACCES"); } } })).rejects.toThrow("write failed");
});

test("non-contention create failures surface from the async adapter", async () => {
  const filesystem = { ...asyncFs, open: async () => { throw coded("EACCES"); } };
  await expect(withFileLock({ lockPath: target(), run: () => undefined }, { filesystem })).rejects.toThrow("EACCES");
});

test("async createParent makes the private parent directory", async () => {
  const lockPath = path.join(path.dirname(target()), "nested", "deeper", "file.lock");
  await expect(withFileLock({ lockPath, run: () => fs.existsSync(lockPath) }, { createParent: true })).resolves.toBe(true);
  expect(fs.statSync(path.dirname(lockPath)).mode & 0o777).toBe(0o700);
  expect(withFileLockSync({ lockPath, run: () => "sync" }, { createParent: true })).toBe("sync");
});

test("stale removal tolerates a lock that vanished first and surfaces other removal failures", async () => {
  const plant = () => { const lockPath = target(); fs.writeFileSync(lockPath, "4242:dead"); return lockPath; };
  let lockPath = plant(); const realRm = fs.rmSync;
  vi.spyOn(fs, "rmSync").mockImplementationOnce(((at: fs.PathLike) => { realRm(at); throw coded("ENOENT"); }) as typeof fs.rmSync);
  const removed = vi.fn();
  expect(withFileLockSync({ lockPath, run: () => "won" }, { ...deadOwner, timeoutMs: 100, onStaleLockRemoved: removed })).toBe("won");
  expect(removed).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  lockPath = plant();
  vi.spyOn(fs, "rmSync").mockImplementationOnce(() => { throw coded("EACCES"); });
  expect(() => withFileLockSync({ lockPath, run: () => undefined }, deadOwner)).toThrow("EACCES");
  vi.restoreAllMocks();
  lockPath = plant();
  const vanish = { ...asyncFs, stat: async (at: Parameters<typeof asyncFs.stat>[0]) => { fs.rmSync(String(at)); throw coded("ENOENT"); } };
  await expect(withFileLock({ lockPath, run: () => "won" }, { ...deadOwner, timeoutMs: 100, filesystem: vanish })).resolves.toBe("won");
  lockPath = plant();
  const denied = { ...asyncFs, rm: async (at: Parameters<typeof asyncFs.rm>[0], options?: Parameters<typeof asyncFs.rm>[1]) => { if (fs.readFileSync(String(at), "utf8") === "4242:dead") throw coded("EACCES"); return asyncFs.rm(at, options); } };
  await expect(withFileLock({ lockPath, run: () => undefined }, { ...deadOwner, filesystem: denied })).rejects.toThrow("EACCES");
  lockPath = plant();
  const removedAsync = vi.fn();
  await expect(withFileLock({ lockPath, run: () => "won" }, { ...deadOwner, timeoutMs: 100, onStaleLockRemoved: removedAsync })).resolves.toBe("won");
  expect(removedAsync).toHaveBeenCalledWith({ holder: undefined });
  lockPath = plant();
  expect(withFileLockSync({ lockPath, run: () => "won" }, { ...deadOwner, timeoutMs: 100, onStaleLockRemoved: removed })).toBe("won");
  expect(removed).toHaveBeenCalledWith({ holder: undefined });
});

test("async stale removal skips a lock that vanished before the final inspection", async () => {
  const lockPath = target(); fs.writeFileSync(lockPath, "4242:dead");
  let reads = 0;
  const filesystem = { ...asyncFs, open: async (file: Parameters<typeof asyncFs.open>[0], flags: Parameters<typeof asyncFs.open>[1], mode?: Parameters<typeof asyncFs.open>[2]) => {
    if (flags === "r" && ++reads === 3) { fs.rmSync(lockPath); throw coded("ENOENT"); }
    return asyncFs.open(file, flags, mode);
  } };
  const removed = vi.fn();
  await expect(withFileLock({ lockPath, run: () => "won" }, { ...deadOwner, timeoutMs: 100, filesystem, onStaleLockRemoved: removed })).resolves.toBe("won");
  expect(removed).not.toHaveBeenCalled();
});

test("async stale removal skips a lock whose pathname stat changed after the final inspection", async () => {
  const lockPath = target(); fs.writeFileSync(lockPath, "4242:dead");
  const filesystem = { ...asyncFs, stat: (async (at: Parameters<typeof asyncFs.stat>[0]) => { const info = await asyncFs.stat(at); return Object.assign(info, { mtimeMs: info.mtimeMs + 1 }); }) as typeof asyncFs.stat };
  await expect(withFileLock({ lockPath, run: () => undefined }, { ...deadOwner, filesystem })).rejects.toThrow(FileLockTimeoutError);
  expect(fs.readFileSync(lockPath, "utf8")).toBe("4242:dead");
});

test("lost ownership uses host messages in both adapters", async () => {
  const lockPath = target();
  expect(() => withFileLockSync({ lockPath, run: (lock) => { fs.writeFileSync(lockPath, "other"); lock.assertHeld({}); } }, { messages })).toThrow(new FileLockLostError({ lockPath }, { messages }));
  fs.rmSync(lockPath);
  expect(() => withFileLockSync({ lockPath, run: (lock) => { fs.writeFileSync(lockPath, "other"); lock.assertHeld({}); } })).toThrow(defaultPlatformMessages.fileLockLost());
  fs.rmSync(lockPath);
  await expect(withFileLock({ lockPath, run: async (lock) => { fs.writeFileSync(lockPath, "other"); await lock.assertHeld({}); } }, { messages })).rejects.toThrow("custom lost");
  expect(fs.readFileSync(lockPath, "utf8")).toBe("other");
});

test("async release: completed sections surface failures unless suppressed; failed sections keep their error", async () => {
  const lockPath = target();
  const filesystem = { ...asyncFs, rm: async () => { throw coded("EACCES"); } };
  await expect(withFileLock({ lockPath, run: () => "done" }, { filesystem })).rejects.toThrow("EACCES");
  fs.rmSync(lockPath);
  await expect(withFileLock({ lockPath, run: () => "done" }, { filesystem, suppressReleaseErrors: true })).resolves.toBe("done");
  fs.rmSync(lockPath);
  await expect(withFileLock({ lockPath, run: () => { throw new Error("section failed"); } }, { filesystem })).rejects.toThrow("section failed");
  fs.rmSync(lockPath);
  const vanished = { ...asyncFs, rm: async () => { throw coded("ENOENT"); } };
  await expect(withFileLock({ lockPath, run: () => "done" }, { filesystem: vanished })).resolves.toBe("done");
  fs.rmSync(lockPath);
  vi.spyOn(fs, "rmSync").mockImplementation(() => { throw coded("EACCES"); });
  expect(withFileLockSync({ lockPath, run: () => "done" }, { suppressReleaseErrors: true })).toBe("done");
  expect(() => withFileLockSync({ lockPath: target(), run: () => { throw new Error("section failed"); } })).toThrow("section failed");
});
