import { once } from "node:events";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createGuardedFileReader, FsFilePathError, type GuardedReaderFilesystem, type GuardedReaderLimits } from "../guarded-reader.js";

const roots: string[] = [];
function root(files: Record<string, string> = {}): string {
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "guarded-bounds-")); roots.push(dir);
  for (const [name, content] of Object.entries(files)) { nodeFs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); nodeFs.writeFileSync(path.join(dir, name), content); }
  return dir;
}
afterEach(() => { for (const dir of roots.splice(0)) nodeFs.rmSync(dir, { recursive: true, force: true }); });
const denyRules = { segments: new Set(["secrets"]), filenamePatterns: [/^\.env$/i] };
const limits: GuardedReaderLimits = { maxFileBytes: 16, binarySniffBytes: 8, maxListedFiles: 100, maxWalkDepth: 4, maxWalkEntries: 100 };
function reader(rootPath: string, { filesystem = {}, limit = {} }: { filesystem?: Partial<GuardedReaderFilesystem>; limit?: Partial<GuardedReaderLimits> } = {}) {
  return createGuardedFileReader({ rootPath, denyRules, limits: { ...limits, ...limit }, filesystem: { ...nodeFs, ...filesystem } });
}
function refusal(run: () => unknown): FsFilePathError {
  try { run(); } catch (error) { if (error instanceof FsFilePathError) return error; throw error; }
  throw new Error("expected an FsFilePathError refusal");
}
// A real ReadStream opens its file asynchronously and keeps doing I/O after destroy() until it
// closes; settle that before the test ends so afterEach's rmSync cannot race a late open.
async function settled(stream: nodeFs.ReadStream | undefined): Promise<void> {
  if (stream && !stream.closed) await once(stream, "close");
}
async function asyncRefusal(run: () => Promise<unknown>): Promise<FsFilePathError> {
  try { await run(); } catch (error) { if (error instanceof FsFilePathError) return error; throw error; }
  throw new Error("expected an FsFilePathError refusal");
}

// --- construction ----------------------------------------------------------
test("an empty rootPath is refused", () => {
  expect(() => createGuardedFileReader({ rootPath: "", denyRules, limits, filesystem: nodeFs })).toThrow(new TypeError("rootPath is required"));
});
for (const [key, value] of [["maxFileBytes", 0], ["binarySniffBytes", -1], ["maxListedFiles", 1.5], ["maxWalkDepth", Number.NaN], ["maxWalkEntries", 2 ** 53]] as const) {
  test(`limit ${key}=${value} is refused`, () => {
    expect(() => reader(root(), { limit: { [key]: value } })).toThrow(new TypeError("reader limits must be positive safe integers"));
  });
}

// --- Windows spellings on a POSIX host -------------------------------------
test("a backslash-separated denied segment is refused even where '\\' is not the native separator", () => {
  const dir = root();
  expect(refusal(() => reader(dir).resolve({ relativePath: "sub\\secrets\\key.txt" })).message)
    .toBe("path 'sub\\secrets\\key.txt' contains a denied path segment ('secrets') and cannot be accessed");
});
test("a backslash-separated denied leaf name is refused", () => {
  const dir = root();
  expect(refusal(() => reader(dir).resolve({ relativePath: "sub\\.env" })).message).toBe("path 'sub\\.env' matches a denied filename pattern and cannot be accessed");
});
test("backslash '..' spellings collapse in the deny check, so a denied leaf behind them is still refused", () => {
  const dir = root();
  expect(refusal(() => reader(dir).resolve({ relativePath: "a\\..\\.env" })).message).toBe("path 'a\\..\\.env' matches a denied filename pattern and cannot be accessed");
});
test("a drive-letter spelling on POSIX is a literal in-root name, never an escape", () => {
  const dir = root();
  expect(reader(dir).resolve({ relativePath: "C:\\Windows\\win.ini" })).toBe(path.join(nodeFs.realpathSync(dir), "C:\\Windows\\win.ini"));
});
test("a path that is only dot segments resolves to the root itself", () => {
  const dir = root();
  expect(reader(dir).resolve({ relativePath: "./." })).toBe(nodeFs.realpathSync(dir));
});
test("a root that does not exist yet lists as empty", () => {
  expect(reader(path.join(root(), "later")).list({})).toEqual({ files: [], truncated: false });
});
// The deepest existing ancestor of a not-yet-created root is the root's own parent, which is
// outside the lexical base, so the escape check misreports it as a symlink escape.
test("a subpath of a not-yet-created root is refused as a symlink escape (reported, not fixed)", () => {
  const dir = path.join(root(), "later");
  expect(refusal(() => reader(dir).list({}, { relativePath: "x" })).message).toBe("path 'x' resolves outside the allowed root through a symbolic link");
});

// --- text read -------------------------------------------------------------
test("reading a missing file is refused as nonexistent", () => {
  expect(refusal(() => reader(root()).read({ relativePath: "missing.txt" })).message).toBe("file 'missing.txt' does not exist");
});
test("reading a directory is refused as not a regular file", () => {
  const dir = root({ "sub/a.txt": "a" });
  expect(refusal(() => reader(dir).read({ relativePath: "sub" })).message).toBe("path 'sub' is not a regular file");
});
test("a file that grows past the cap between stat and read is refused", () => {
  const dir = root({ "grow.txt": "small" });
  const readSync = ((fd: number, buffer: NodeJS.ArrayBufferView) => { (buffer as Buffer).fill(65); return buffer.byteLength; }) as GuardedReaderFilesystem["readSync"];
  expect(refusal(() => reader(dir, { filesystem: { readSync } }).read({ relativePath: "grow.txt" })).message).toBe("file 'grow.txt' exceeds the 16-byte readable limit");
});
test("short reads are accumulated until end of file", () => {
  const dir = root({ "chunks.txt": "abcdef" });
  const readSync = ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: null) =>
    nodeFs.readSync(fd, buffer, offset, Math.min(length, 2), position)) as GuardedReaderFilesystem["readSync"];
  expect(reader(dir, { filesystem: { readSync } }).read({ relativePath: "chunks.txt" })).toEqual({ content: "abcdef", bytes: 6 });
});
test("a NUL byte beyond the sniff window does not mark text as binary", () => {
  const dir = root({ "late.txt": "abcdefgh\0" });
  expect(reader(dir).read({ relativePath: "late.txt" }).bytes).toBe(9);
});
test("a non-Error stat failure is reported as a typed refusal", () => {
  const dir = root({ "a.txt": "a" });
  const statSync = (() => { throw "EIO string"; }) as GuardedReaderFilesystem["statSync"];
  expect(refusal(() => reader(dir, { filesystem: { statSync } }).read({ relativePath: "a.txt" })).message).toBe("path 'a.txt' could not be read: EIO string");
});

// --- listing ---------------------------------------------------------------
test("an entry that vanishes between readdir and lstat is skipped", () => {
  const dir = root({ "keep.txt": "k", "gone.txt": "g" });
  const lstatSync = ((target: string, options: { throwIfNoEntry: false }) => target.endsWith("gone.txt") ? undefined : nodeFs.lstatSync(target, options)) as GuardedReaderFilesystem["lstatSync"];
  expect(reader(dir, { filesystem: { lstatSync } }).list({})).toEqual({ files: ["keep.txt"], truncated: false });
});
test("special files (FIFOs, sockets) are never listed", () => {
  const dir = root({ "keep.txt": "k", "fifo": "" });
  const lstatSync = ((target: string, options: { throwIfNoEntry: false }) => {
    const stat = nodeFs.lstatSync(target, options)!;
    if (target.endsWith("fifo")) stat.isFile = () => false;
    return stat;
  }) as GuardedReaderFilesystem["lstatSync"];
  expect(reader(dir, { filesystem: { lstatSync } }).list({})).toEqual({ files: ["keep.txt"], truncated: false });
});
test("the result cap reached mid-directory reports truncation", () => {
  const dir = root({ "a.txt": "a", "b.txt": "b", "c.txt": "c" });
  const listing = reader(dir, { limit: { maxListedFiles: 1 } }).list({});
  expect(listing.files).toHaveLength(1); expect(listing.truncated).toBe(true);
});
test("the entry budget reached mid-directory reports truncation", () => {
  const dir = root({ "a.txt": "a", "b.txt": "b", "c.txt": "c" });
  const listing = reader(dir, { limit: { maxWalkEntries: 2 } }).list({});
  expect(listing.files).toHaveLength(2); expect(listing.truncated).toBe(true);
});
test("directories deeper than maxWalkDepth are not descended and report truncation", () => {
  const dir = root({ "a/b/deep.txt": "d", "top.txt": "t" });
  expect(reader(dir, { limit: { maxWalkDepth: 1 } }).list({})).toEqual({ files: ["top.txt"], truncated: true });
});
test("a listing start that exists but stats as absent (raced away) is empty", () => {
  const dir = root({ "sub/a.txt": "a" });
  const statSync = ((target: string, options: { throwIfNoEntry: false }) => target.endsWith("sub") ? undefined : nodeFs.statSync(target, options)) as GuardedReaderFilesystem["statSync"];
  expect(reader(dir, { filesystem: { statSync } }).list({}, { relativePath: "sub" })).toEqual({ files: [], truncated: false });
});
test("listing the root as a file reports '.' as the refused path", () => {
  const dir = root({ "a.txt": "a" });
  const statSync = ((target: string, options: { throwIfNoEntry: false }) => target === dir ? nodeFs.statSync(path.join(dir, "a.txt"), options) : nodeFs.statSync(target, options)) as GuardedReaderFilesystem["statSync"];
  expect(refusal(() => reader(dir, { filesystem: { statSync } }).list({})).message).toBe("path '.' is not a directory");
});
test("a stat failure on the listing root reports '.' as the unreadable path", () => {
  const dir = root();
  const statSync = (() => { throw new Error("ELOOP: too many symbolic links"); }) as GuardedReaderFilesystem["statSync"];
  expect(refusal(() => reader(dir, { filesystem: { statSync } }).list({})).message).toBe("path '.' could not be read: ELOOP: too many symbolic links");
});
test("an explicit empty relativePath lists the root", () => {
  const dir = root({ "a.txt": "a" });
  expect(reader(dir).list({}, { relativePath: "" })).toEqual({ files: ["a.txt"], truncated: false });
});

// --- binary read -----------------------------------------------------------
for (const maxBytes of [0, -1, 1.5, Number.NaN]) {
  test(`readBytes refuses maxBytes ${maxBytes} before touching the filesystem`, async () => {
    const dir = root({ "a.bin": "a" });
    expect((await asyncRefusal(() => reader(dir).readBytes({ relativePath: "a.bin", maxBytes }))).message).toBe("maxBytes must be a positive safe integer");
  });
}
test("readBytes of a missing file is refused as nonexistent", async () => {
  expect((await asyncRefusal(() => reader(root()).readBytes({ relativePath: "nope.bin", maxBytes: 4 }))).message).toBe("file 'nope.bin' does not exist");
});
test("readBytes of a directory is refused as not a regular file", async () => {
  const dir = root({ "sub/a.bin": "a" });
  expect((await asyncRefusal(() => reader(dir).readBytes({ relativePath: "sub", maxBytes: 4 }))).message).toBe("path 'sub' is not a regular file");
});
test("readBytes refuses a traversal before reading", async () => {
  expect((await asyncRefusal(() => reader(root()).readBytes({ relativePath: "../x", maxBytes: 4 }))).message).toBe("path '../x' resolves outside the allowed root");
});
test("readBytes reports a non-Error stream failure as a typed refusal", async () => {
  const dir = root({ "a.bin": "abc" });
  let opened: nodeFs.ReadStream | undefined;
  const createReadStream = ((target: string) => {
    const stream = nodeFs.createReadStream(target);
    stream[Symbol.asyncIterator] = async function* () { yield* []; throw "stream gone"; };
    opened = stream;
    return stream;
  }) as GuardedReaderFilesystem["createReadStream"];
  expect((await asyncRefusal(() => reader(dir, { filesystem: { createReadStream } }).readBytes({ relativePath: "a.bin", maxBytes: 8 }))).message).toBe("path 'a.bin' could not be read: stream gone");
  expect(opened?.destroyed).toBe(true);
  await settled(opened);
});
test("readBytes concatenates every chunk of a multi-chunk stream", async () => {
  const dir = root({ "a.bin": "abcdef" });
  const createReadStream = ((target: string) => nodeFs.createReadStream(target, { highWaterMark: 2 })) as GuardedReaderFilesystem["createReadStream"];
  expect(Buffer.from(await reader(dir, { filesystem: { createReadStream } }).readBytes({ relativePath: "a.bin", maxBytes: 6 })).toString()).toBe("abcdef");
});
test("readBytes reports an Error stream failure by its message", async () => {
  const dir = root({ "a.bin": "abc" });
  let opened: nodeFs.ReadStream | undefined;
  const createReadStream = ((target: string) => {
    const stream = nodeFs.createReadStream(target);
    stream[Symbol.asyncIterator] = async function* () { yield* []; throw new Error("EIO: i/o error, read"); };
    opened = stream;
    return stream;
  }) as GuardedReaderFilesystem["createReadStream"];
  expect((await asyncRefusal(() => reader(dir, { filesystem: { createReadStream } }).readBytes({ relativePath: "a.bin", maxBytes: 8 }))).message).toBe("path 'a.bin' could not be read: EIO: i/o error, read");
  await settled(opened);
});
test("resolving the root itself passes the effective-target deny check", () => {
  const dir = root();
  expect(reader(dir).resolve({ relativePath: "." })).toBe(nodeFs.realpathSync(dir));
});
