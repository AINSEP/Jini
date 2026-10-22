import fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { defaultPlatformMessages } from "../../messages.js";
import {
  syncDirectoryBestEffortAsync, writeFileAtomic, writeFileAtomicAsync, writeJsonFileAtomic, writeJsonFileAtomicAsync,
  type AtomicAsyncFilesystem, type AtomicFilesystemPort,
} from "../atomic-write.js";

type Call = [string, unknown];
function fake(calls: Call[] = []): AtomicFilesystemPort {
  let descriptor = 0;
  return {
    stat: () => ({ mode: 0o640 }), lstat: () => ({ mode: 0o640, isSymbolicLink: () => false }),
    open: args => { calls.push(["open", args]); return ++descriptor; },
    write: args => { calls.push(["write", args]); }, sync: args => { calls.push(["sync", args]); },
    close: args => { calls.push(["close", args]); }, chmod: args => { calls.push(["chmod", args]); },
    rename: args => { calls.push(["rename", args]); }, remove: args => { calls.push(["remove", args]); },
  };
}
const names = (calls: Call[]): string[] => calls.map(call => call[0]);
const coded = (code: string, message = code): Error => Object.assign(new Error(message), { code });
const missing = (): Error => coded("ENOENT", "ENOENT: no such file or directory");
const roots: string[] = [];
function target(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-bounds-")); roots.push(root); return path.join(root, "state"); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

// --- mode resolution -------------------------------------------------------
test("missing destination uses defaultMode when no explicit mode is given", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  filesystem.stat = ({ path }) => { if (path === "/fixture/state") throw missing(); return { mode: 0o666 }; };
  writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit", defaultMode: 0o666, platform: "win32" });
  expect(calls[0]).toEqual(["open", { path: "/fixture/.state.unit.tmp", flags: "wx", mode: 0o666 }]);
});
test("explicit mode overrides the preserved destination mode", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit", mode: 0o600, platform: "win32" });
  expect(calls[0]).toEqual(["open", { path: "/fixture/.state.unit.tmp", flags: "wx", mode: 0o600 }]);
});
test("preserved mode drops setuid/sticky bits above 0777", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  filesystem.stat = () => ({ mode: 0o104755 });
  writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit", platform: "win32" });
  expect(calls[0]).toEqual(["open", { path: "/fixture/.state.unit.tmp", flags: "wx", mode: 0o755 }]);
});
for (const mode of [-1, 0o1000, 1.5, Number.NaN]) {
  test(`sync writer refuses mode ${mode} with RangeError before any temp is created`, () => {
    const calls: Call[] = [], filesystem = fake(calls);
    expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { mode, tempName: () => "unit" }))
      .toThrow(new RangeError(defaultPlatformMessages.atomicModeInvalid()));
    expect(calls).toEqual([]);
  });
}
test("async writer refuses an out-of-range mode with RangeError and creates nothing", async () => {
  const filePath = target();
  await expect(writeFileAtomicAsync({ filePath, content: "v" }, { mode: 0o1000 })).rejects.toThrow(new RangeError(defaultPlatformMessages.atomicModeInvalid()));
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
});
test("custom messages replace the default refusal text", () => {
  const messages = { ...defaultPlatformMessages, atomicModeInvalid: () => "custom mode text" };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: fake() }, { mode: -1, messages })).toThrow("custom mode text");
});

// --- temp naming -----------------------------------------------------------
for (const token of ["", ".", "..", "a/b", "a\\b", "a\0b"]) {
  test(`temp name ${JSON.stringify(token)} is refused as not one safe segment`, () => {
    const calls: Call[] = [];
    expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: fake(calls) }, { tempName: () => token }))
      .toThrow(new RangeError(defaultPlatformMessages.atomicTempNameInvalid()));
    expect(calls).toEqual([]);
  });
}
test("tempName receives the destination path", () => {
  const tempName = vi.fn(() => "unit");
  writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: fake() }, { tempName, platform: "win32" });
  expect(tempName).toHaveBeenCalledWith({ filePath: "/fixture/state" });
});
test("a same-directory tempPath is used verbatim and tempName is not consulted", () => {
  const calls: Call[] = [];
  writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: fake(calls) }, {
    tempPath: ({ filePath }) => `${filePath}.legacy.tmp`, tempName: () => { throw new Error("must not run"); }, platform: "win32",
  });
  expect(calls[0]).toEqual(["open", { path: "/fixture/state.legacy.tmp", flags: "wx", mode: 0o640 }]);
  expect(calls).toContainEqual(["rename", { from: "/fixture/state.legacy.tmp", to: "/fixture/state" }]);
});
for (const [label, temp] of [
  ["a different directory", "/elsewhere/state.tmp"],
  ["a parent-traversal directory", "/fixture/../state.tmp"],
  ["the destination itself", "/fixture/state"],
  ["the destination spelled through dot segments", "/fixture/./state"],
  ["a NUL byte", "/fixture/state\0.tmp"],
] as const) {
  test(`tempPath naming ${label} is refused before any temp is created`, () => {
    const calls: Call[] = [];
    expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: fake(calls) }, { tempPath: () => temp }))
      .toThrow(new RangeError(defaultPlatformMessages.atomicTempPathInvalid()));
    expect(calls).toEqual([]);
  });
}

// --- sync symlink refusal --------------------------------------------------
test("sync refuseSymlink with an absent destination writes and renames", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  filesystem.lstat = () => { throw missing(); };
  writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { refuseSymlink: true, tempName: () => "unit", platform: "win32" });
  expect(calls[0]).toEqual(["open", { path: "/fixture/.state.unit.tmp", flags: "wx", mode: 0o600 }]);
  expect(names(calls)).toContain("rename");
});
test("sync refuseSymlink propagates a non-ENOENT lstat failure before creating a temp", () => {
  const calls: Call[] = [], filesystem = fake(calls), error = coded("EACCES");
  filesystem.lstat = () => { throw error; };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { refuseSymlink: true, tempName: () => "unit" })).toThrow(error);
  expect(calls).toEqual([]);
});
test("sync refuseSymlink refuses a symlink that appears before rename and removes the owned temp", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  let lstats = 0;
  filesystem.lstat = () => ({ mode: 0o640, isSymbolicLink: () => ++lstats > 1 });
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { refuseSymlink: true, tempName: () => "unit" }))
    .toThrow(defaultPlatformMessages.atomicSymlinkRefused());
  expect(names(calls)).not.toContain("rename");
  expect(calls.slice(-1)).toEqual([["remove", { path: "/fixture/.state.unit.tmp" }]]);
  expect(names(calls).filter(name => name === "close")).toHaveLength(1);
});
test("sync refuseSymlink propagates a non-ENOENT pre-rename lstat failure and removes the temp", () => {
  const calls: Call[] = [], filesystem = fake(calls), error = coded("EIO");
  let lstats = 0;
  filesystem.lstat = () => { if (++lstats > 1) throw error; return { mode: 0o640, isSymbolicLink: () => false }; };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { refuseSymlink: true, tempName: () => "unit" })).toThrow(error);
  expect(names(calls)).not.toContain("rename");
  expect(calls.at(-1)).toEqual(["remove", { path: "/fixture/.state.unit.tmp" }]);
});
test("sync refuseSymlink tolerates the destination vanishing before rename", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  let lstats = 0;
  filesystem.lstat = () => { if (++lstats > 1) throw missing(); return { mode: 0o640, isSymbolicLink: () => false }; };
  writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { refuseSymlink: true, tempName: () => "unit", platform: "win32" });
  expect(names(calls)).toContain("rename");
});

// --- sync cleanup ----------------------------------------------------------
test("sync rename failure removes the temp without re-closing the already closed descriptor", () => {
  const calls: Call[] = [], filesystem = fake(calls), error = coded("EXDEV");
  filesystem.rename = () => { throw error; };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit" })).toThrow(error);
  expect(names(calls)).toEqual(["open", "write", "chmod", "sync", "close", "remove"]);
});
test("sync owner-only refusal on POSIX closes and removes the temp", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit", verifyOwnerOnly: true, platform: "linux" }))
    .toThrow(defaultPlatformMessages.atomicPermissionsRefused());
  expect(names(calls)).toEqual(["open", "write", "chmod", "close", "remove"]);
});
test("sync owner-only verification is skipped on Windows", () => {
  const calls: Call[] = [];
  writeFileAtomic({ filePath: "C:\\fixture\\state", content: "v", fs: fake(calls) }, { tempName: () => "unit", verifyOwnerOnly: true, platform: "win32" });
  expect(names(calls)).toContain("rename");
});
test("sync cleanup close failure is swallowed so the original write failure surfaces", () => {
  const calls: Call[] = [], filesystem = fake(calls), error = new Error("write failed");
  filesystem.write = () => { throw error; };
  filesystem.close = () => { throw new Error("close failed"); };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit" })).toThrow(error);
  expect(calls.at(-1)).toEqual(["remove", { path: "/fixture/.state.unit.tmp" }]);
});
test("sync cleanup remove failure is swallowed so the original write failure surfaces", () => {
  const filesystem = fake(), error = new Error("write failed");
  filesystem.write = () => { throw error; };
  filesystem.remove = () => { throw new Error("remove failed"); };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit" })).toThrow(error);
});
test("sync file fsync failure closes the descriptor and removes the temp before rename", () => {
  const calls: Call[] = [], filesystem = fake(calls), error = coded("EIO");
  filesystem.sync = () => { throw error; };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit" })).toThrow(error);
  expect(names(calls)).toEqual(["open", "write", "chmod", "close", "remove"]);
});
test("sync close failure after fsync removes the temp and is not retried", () => {
  const calls: Call[] = [], filesystem = fake(calls), error = coded("EIO");
  filesystem.close = () => { calls.push(["close", null]); throw error; };
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { tempName: () => "unit" })).toThrow(error);
  expect(names(calls)).toEqual(["open", "write", "chmod", "sync", "close", "remove"]);
});

// --- sync JSON -------------------------------------------------------------
test("sync JSON refuses unserializable data with TypeError before touching the filesystem", () => {
  const calls: Call[] = [];
  expect(() => writeJsonFileAtomic({ filePath: "/fixture/state.json", data: undefined, fs: fake(calls) }))
    .toThrow(new TypeError(defaultPlatformMessages.atomicJsonUnserializable()));
  expect(calls).toEqual([]);
});

// --- async directory flush -------------------------------------------------
test("async directory flush rethrows a real fsync error and still closes the handle", async () => {
  const error = coded("EIO"), close = vi.fn(async () => {});
  await expect(syncDirectoryBestEffortAsync({ directory: "/fixture", open: async () => ({ sync: async () => { throw error; }, close }) }, { platform: "linux" })).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(1);
});
test("async directory flush rethrows a real open error without a handle to close", async () => {
  const error = coded("EIO");
  await expect(syncDirectoryBestEffortAsync({ directory: "/fixture", open: async () => { throw error; } }, { platform: "linux" })).rejects.toBe(error);
});
test("async directory flush ignores an unsupported open error", async () => {
  await expect(syncDirectoryBestEffortAsync({ directory: "/fixture", open: async () => { throw coded("EISDIR"); } }, { platform: "darwin" })).resolves.toBeUndefined();
});
test("async directory flush never opens on Windows", async () => {
  const open = vi.fn(async () => ({ sync: async () => {}, close: async () => {} }));
  await syncDirectoryBestEffortAsync({ directory: "C:\\fixture", open }, { platform: "win32" });
  expect(open).not.toHaveBeenCalled();
});

// --- async writer ----------------------------------------------------------
function asyncFsWith(overrides: Partial<AtomicAsyncFilesystem>): AtomicAsyncFilesystem {
  return { stat: asyncFs.stat, lstat: asyncFs.lstat, open: asyncFs.open, chmod: asyncFs.chmod, rename: asyncFs.rename, rm: asyncFs.rm, mkdir: asyncFs.mkdir, ...overrides };
}
test("async writer propagates a non-ENOENT stat failure before creating a temp", async () => {
  const filePath = target(), error = coded("EACCES");
  await expect(writeFileAtomicAsync({ filePath, content: "v" }, { fs: asyncFsWith({ stat: async () => { throw error; } }) })).rejects.toBe(error);
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
});
test("async writer defaults a new destination to 0600 and honours defaultMode", async () => {
  const first = target(), second = `${first}-shared`;
  await writeFileAtomicAsync({ filePath: first, content: "a" });
  await writeFileAtomicAsync({ filePath: second, content: "b" }, { defaultMode: 0o640 });
  expect(fs.statSync(first).mode & 0o777).toBe(0o600);
  expect(fs.statSync(second).mode & 0o777).toBe(0o640);
});
test("async writer without createParent fails on a missing parent and leaves nothing behind", async () => {
  const filePath = path.join(target(), "missing", "state");
  await expect(writeFileAtomicAsync({ filePath, content: "v" })).rejects.toMatchObject({ code: "ENOENT" });
  expect(fs.existsSync(path.dirname(filePath))).toBe(false);
});
test("async refuseSymlink writes an absent destination", async () => {
  const filePath = target();
  await writeFileAtomicAsync({ filePath, content: "v" }, { refuseSymlink: true });
  expect(fs.readFileSync(filePath, "utf8")).toBe("v");
});
test("async refuseSymlink preserves a regular destination's mode", async () => {
  const filePath = target(); fs.writeFileSync(filePath, "old", { mode: 0o644 });
  await writeFileAtomicAsync({ filePath, content: "new" }, { refuseSymlink: true });
  expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);
  expect(fs.readFileSync(filePath, "utf8")).toBe("new");
});
test("async refuseSymlink refuses a symlink that appears before rename and removes the owned temp", async () => {
  const filePath = target(), link = `${filePath}.link`; fs.writeFileSync(filePath, "original");
  const realLstat = asyncFs.lstat;
  let lstats = 0;
  const lstat = (async (input: fs.PathLike) => {
    if (++lstats === 2) fs.symlinkSync(filePath, link);
    return realLstat(input);
  }) as AtomicAsyncFilesystem["lstat"];
  await expect(writeFileAtomicAsync({ filePath: link, content: "changed" }, { refuseSymlink: true, tempName: () => "unit", fs: asyncFsWith({ lstat }) }))
    .rejects.toThrow(defaultPlatformMessages.atomicSymlinkRefused());
  expect(fs.readFileSync(filePath, "utf8")).toBe("original");
  expect(fs.readdirSync(path.dirname(filePath)).sort()).toEqual(["state", "state.link"]);
});
test("async refuseSymlink propagates a non-ENOENT pre-rename lstat failure and removes the temp", async () => {
  const filePath = target(), error = coded("EIO");
  let lstats = 0;
  const lstat = (async () => { if (++lstats === 1) throw missing(); throw error; }) as AtomicAsyncFilesystem["lstat"];
  await expect(writeFileAtomicAsync({ filePath, content: "v" }, { refuseSymlink: true, fs: asyncFsWith({ lstat }) })).rejects.toBe(error);
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
});
test("async rename failure removes the temp and does not close the handle twice", async () => {
  const filePath = target(), error = coded("EXDEV");
  let handle: asyncFs.FileHandle | undefined;
  const open = (async (file: fs.PathLike, flags?: string | number, mode?: fs.Mode) => {
    const opened = await asyncFs.open(file, flags, mode); if (flags === "wx") { handle = opened; vi.spyOn(opened, "close"); } return opened;
  }) as AtomicAsyncFilesystem["open"];
  await expect(writeFileAtomicAsync({ filePath, content: "v" }, { fs: asyncFsWith({ open, rename: async () => { throw error; } }) })).rejects.toBe(error);
  expect(vi.mocked(handle!.close)).toHaveBeenCalledTimes(1);
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
});
test("async cleanup close and rm failures are swallowed so the original failure surfaces", async () => {
  const filePath = target(), error = new Error("write failed");
  const open = (async (file: fs.PathLike, flags?: string | number, mode?: fs.Mode) => {
    const opened = await asyncFs.open(file, flags, mode);
    vi.spyOn(opened, "writeFile").mockRejectedValue(error);
    const realClose = opened.close.bind(opened);
    vi.spyOn(opened, "close").mockImplementation(async () => { await realClose(); throw new Error("close failed"); });
    return opened;
  }) as AtomicAsyncFilesystem["open"];
  await expect(writeFileAtomicAsync({ filePath, content: "v" }, { tempName: () => "unit", fs: asyncFsWith({ open, rm: async () => { throw new Error("rm failed"); } }) })).rejects.toBe(error);
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([".state.unit.tmp"]);
});
test("async owner-only refusal on POSIX removes the temp before rename", async () => {
  const filePath = target();
  const open = (async (file: fs.PathLike, flags?: string | number, mode?: fs.Mode) => {
    const opened = await asyncFs.open(file, flags, mode);
    const broad = await opened.stat(); broad.mode = 0o100644;
    vi.spyOn(opened, "stat").mockResolvedValue(broad);
    return opened;
  }) as AtomicAsyncFilesystem["open"];
  await expect(writeFileAtomicAsync({ filePath, content: "v" }, { mode: 0o600, verifyOwnerOnly: true, platform: "linux", fs: asyncFsWith({ open }) }))
    .rejects.toThrow(defaultPlatformMessages.atomicPermissionsRefused());
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
});
test("async directory flush EIO is reported after the replacement landed", async () => {
  const filePath = target(), error = coded("EIO");
  const open = (async (file: fs.PathLike, flags?: string | number, mode?: fs.Mode) => {
    const opened = await asyncFs.open(file, flags, mode); if (flags === "r") vi.spyOn(opened, "sync").mockRejectedValue(error); return opened;
  }) as AtomicAsyncFilesystem["open"];
  await expect(writeFileAtomicAsync({ filePath, content: "new" }, { platform: "linux", fs: asyncFsWith({ open }) })).rejects.toBe(error);
  expect(fs.readFileSync(filePath, "utf8")).toBe("new");
});

// --- async JSON ------------------------------------------------------------
test("async JSON refuses unserializable data with TypeError before touching the filesystem", async () => {
  const filePath = target();
  await expect(writeJsonFileAtomicAsync({ filePath, data: () => 1 })).rejects.toThrow(new TypeError(defaultPlatformMessages.atomicJsonUnserializable()));
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
});
test("async JSON omits the trailing newline by default", async () => {
  const filePath = target();
  await writeJsonFileAtomicAsync({ filePath, data: [1] });
  expect(fs.readFileSync(filePath, "utf8")).toBe("[\n  1\n]");
});
test("async refuseSymlink refuses an existing symlink destination before opening a temp", async () => {
  const filePath = target(), link = `${filePath}.link`; fs.writeFileSync(filePath, "original"); fs.symlinkSync(filePath, link);
  const open = vi.fn(asyncFs.open);
  await expect(writeFileAtomicAsync({ filePath: link, content: "changed" }, { refuseSymlink: true, fs: asyncFsWith({ open }) }))
    .rejects.toThrow(defaultPlatformMessages.atomicSymlinkRefused());
  expect(open).not.toHaveBeenCalled();
});
test("sync refuseSymlink refuses an existing symlink destination before opening a temp", () => {
  const calls: Call[] = [], filesystem = fake(calls);
  filesystem.lstat = () => ({ mode: 0o777, isSymbolicLink: () => true });
  expect(() => writeFileAtomic({ filePath: "/fixture/state", content: "v", fs: filesystem }, { refuseSymlink: true }))
    .toThrow(defaultPlatformMessages.atomicSymlinkRefused());
  expect(calls).toEqual([]);
});
