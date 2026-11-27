import { constants } from "node:fs";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readReviewedFile, type ReviewedFileSystem } from "../reviewed-file.js";

function fixture() {
  const ids = { dev: 1n, ino: 9007199254740993n, nlink: 1n };
  const file = { root: "/site", absPath: "/site/themes/a", bytes: 4, mtimeMs: 2, identity: "1:9007199254740993", nlink: 1 };
  const handle = {
    stat: vi.fn(async () => ({ ...ids, isFile: (): boolean => true, size: 4, mtimeMs: 2 })),
    readFile: vi.fn(async () => Buffer.from("page")), close: vi.fn(async () => {}),
  };
  const fs: ReviewedFileSystem = {
    open: vi.fn(async () => handle),
    lstat: vi.fn(async () => ({ ...ids, isSymbolicLink: () => false, isDirectory: () => true })),
    realpath: vi.fn(async file => file),
  };
  return { file, ids, handle, fs };
}

describe("reviewed file reads", () => {
  it("reads unchanged bytes with nonblocking, no-follow, no-controlling-terminal flags", async () => {
    const f = fixture();
    expect(await readReviewedFile({ file: f.file }, { fileSystem: f.fs })).toEqual(Buffer.from("page"));
    expect(f.fs.open).toHaveBeenCalledWith(f.file.absPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0) | (constants.O_NOCTTY ?? 0));
    expect(f.handle.close).toHaveBeenCalledOnce();
  });
  it.each(["inode", "ancestor", "hardlink", "walk-leaf", "realpath", "fifo"])("rejects a %s swap without reading bytes", async kind => {
    const f = fixture();
    if (kind === "inode") f.file.identity = "1:9007199254740992";
    if (kind === "ancestor") f.fs.lstat = async () => ({ ...f.ids, isSymbolicLink: () => true, isDirectory: () => true });
    if (kind === "hardlink") f.ids.nlink = 2n;
    if (kind === "walk-leaf") f.fs.lstat = async () => ({ ...f.ids, ino: 7n, isSymbolicLink: () => false, isDirectory: () => true });
    if (kind === "realpath") f.fs.realpath = async file => file === f.file.absPath ? "/outside/a" : file;
    if (kind === "fifo") f.handle.stat.mockImplementation(async () => ({ ...f.ids, isFile: () => false, size: 4, mtimeMs: 2 }));
    expect(await readReviewedFile({ file: f.file }, { fileSystem: f.fs })).toBeNull();
    expect(f.handle.readFile).not.toHaveBeenCalled();
    expect(f.handle.close).toHaveBeenCalledOnce();
  });
  it("supports an inode-zero filesystem through the path proof", async () => {
    const f = fixture(); f.ids.ino = 0n;
    expect(await readReviewedFile({ file: { ...f.file, identity: null } }, { fileSystem: f.fs })).toEqual(Buffer.from("page"));
  });
  it("keeps already-hardlinked backups readable", async () => {
    const f = fixture(); f.ids.nlink = 2n; f.file.nlink = 2;
    expect(await readReviewedFile({ file: f.file }, { fileSystem: f.fs })).toEqual(Buffer.from("page"));
  });
});

it("rejects a short descriptor read even when the reviewed metadata still matches", async () => {
  const f = fixture();
  f.handle.readFile.mockResolvedValue(Buffer.from("pag"));
  expect(await readReviewedFile({ file: f.file }, { fileSystem: f.fs })).toBeNull();
  expect(f.handle.close).toHaveBeenCalledOnce();
});

it("returns no bytes if the reviewed path disappears before open", async () => {
  const f = fixture();
  f.fs.open = async () => { throw Object.assign(new Error("file removed"), { code: "ENOENT" }); };
  expect(await readReviewedFile({ file: f.file }, { fileSystem: f.fs })).toBeNull();
  expect(f.handle.readFile).not.toHaveBeenCalled();
});

it("closes the reviewed descriptor while propagating a read error unchanged", async () => {
  const f = fixture();
  const failure = Object.assign(new Error("device read failed"), { code: "EIO" });
  f.handle.readFile.mockRejectedValue(failure);
  await expect(readReviewedFile({ file: f.file }, { fileSystem: f.fs })).rejects.toBe(failure);
  expect(f.handle.close).toHaveBeenCalledOnce();
});

it.each(["root itself", "sibling", "missing ancestor", "non-directory ancestor", "changed size", "changed mtime"])(
  "refuses a reviewed file with %s before reading its contents",
  async reason => {
    const f = fixture();
    if (reason === "root itself") f.file.absPath = f.file.root;
    if (reason === "sibling") f.file.absPath = "/site-other/themes/a";
    if (reason === "missing ancestor") f.fs.lstat = async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
    if (reason === "non-directory ancestor") f.fs.lstat = async () => ({ ...f.ids, isSymbolicLink: () => false, isDirectory: () => false });
    if (reason === "changed size") f.file.bytes = 5;
    if (reason === "changed mtime") f.file.mtimeMs = 3;
    expect(await readReviewedFile({ file: f.file }, { fileSystem: f.fs })).toBeNull();
    expect(f.handle.readFile).not.toHaveBeenCalled();
    expect(f.handle.close).toHaveBeenCalledOnce();
  },
);

it("reopens a real reviewed file with the default filesystem and refuses it after the bytes change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reviewed-file-"));
  try {
    const root = await realpath(dir);
    const absPath = join(root, "original");
    await writeFile(absPath, Buffer.from([1, 255, 2]));
    const stat = await lstat(absPath);
    const exact = await lstat(absPath, { bigint: true });
    const file = { root, absPath, bytes: stat.size, mtimeMs: stat.mtimeMs, nlink: stat.nlink,
      identity: exact.ino === 0n ? null : `${exact.dev}:${exact.ino}` };
    expect(await readReviewedFile({ file })).toEqual(Buffer.from([1, 255, 2]));
    await writeFile(absPath, Buffer.from([7, 6, 5, 4]));
    expect(await readReviewedFile({ file })).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
