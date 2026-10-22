import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ensurePrivateDir } from "../owner.js";

vi.mock("node:fs", async () => {
  const real = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...real, lstatSync: vi.fn(real.lstatSync), mkdirSync: vi.fn(real.mkdirSync) };
});
const real = await vi.importActual<typeof import("node:fs")>("node:fs");
let root: string;
beforeEach(() => {
  vi.mocked(fs.lstatSync).mockImplementation(real.lstatSync);
  vi.mocked(fs.mkdirSync).mockImplementation(real.mkdirSync);
  root = fs.mkdtempSync(join(tmpdir(), "jw4-owner-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

test("private parents are created or accepted before creating a private socket directory", () => {
  const parent = join(root, "parent");
  const dir = join(parent, "socket");
  ensurePrivateDir(dir, { privateParent: true });
  ensurePrivateDir(dir, { privateParent: true });
  expect(fs.statSync(parent).mode & 0o777).toBe(0o700);
  expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
});

test.each([0o710, 0o701])("an existing parent with permissions %s fails closed without creating the socket directory", mode => {
  const parent = join(root, "parent");
  const dir = join(parent, "socket");
  fs.mkdirSync(parent);
  fs.chmodSync(parent, mode);
  expect(() => ensurePrivateDir(dir, { privateParent: true })).toThrow(`refusing socket parent ${parent}: not a 0700 directory owned by this user`);
  expect(fs.existsSync(dir)).toBe(false);
});

test("a parent symlink or file is refused even when its target is private", () => {
  const target = join(root, "target");
  const link = join(root, "link");
  const file = join(root, "file");
  fs.mkdirSync(target, { mode: 0o700 });
  fs.symlinkSync(target, link);
  fs.writeFileSync(file, "", { mode: 0o600 });
  expect(() => ensurePrivateDir(join(link, "socket"), { privateParent: true })).toThrow("refusing socket parent");
  expect(() => ensurePrivateDir(join(file, "socket"), { privateParent: true })).toThrow("refusing socket parent");
});

test("a parent owned by another uid is refused before the child is created", () => {
  const parent = join(root, "parent");
  fs.mkdirSync(parent, { mode: 0o700 });
  const stat = real.lstatSync(parent);
  vi.mocked(fs.lstatSync).mockReturnValue(Object.assign(stat, { uid: (process.getuid?.() ?? stat.uid) + 1 }));
  expect(() => ensurePrivateDir(join(parent, "socket"), { privateParent: true })).toThrow("refusing socket parent");
  expect(fs.existsSync(join(parent, "socket"))).toBe(false);
});

test("errors other than EEXIST while creating the parent propagate unchanged", () => {
  const failure = Object.assign(new Error("permission denied"), { code: "EACCES" });
  vi.mocked(fs.mkdirSync).mockImplementationOnce(() => { throw failure; });
  expect(() => ensurePrivateDir(join(root, "parent", "socket"), { privateParent: true })).toThrow(failure);
});

test("an explicitly unchecked parent stays loose while the socket directory is tightened", () => {
  const dir = join(root, "socket");
  fs.chmodSync(root, 0o755);
  fs.mkdirSync(dir, { mode: 0o755 });
  ensurePrivateDir(dir, { privateParent: false });
  expect(fs.statSync(root).mode & 0o777).toBe(0o755);
  expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
});

test("the default checks parents directly under /tmp", () => {
  const parent = `/tmp/jw4-owner-${process.pid}`;
  try {
    ensurePrivateDir(join(parent, "socket"));
    expect(fs.statSync(parent).mode & 0o777).toBe(0o700);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("a socket directory symlink is refused without tightening its target", () => {
  const target = join(root, "target");
  const link = join(root, "link");
  fs.mkdirSync(target, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  fs.symlinkSync(target, link);
  expect(() => ensurePrivateDir(link, { privateParent: false })).toThrow("not a directory owned by this user");
  expect(fs.statSync(target).mode & 0o777).toBe(0o755);
});

test("a socket directory owned by another uid is refused", () => {
  const dir = join(root, "socket");
  fs.mkdirSync(dir);
  const stat = real.lstatSync(dir);
  vi.mocked(fs.lstatSync).mockReturnValue(Object.assign(stat, { uid: (process.getuid?.() ?? stat.uid) + 1 }));
  expect(() => ensurePrivateDir(dir, { privateParent: false })).toThrow("not a directory owned by this user");
});
