import { constants } from "node:fs";
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
