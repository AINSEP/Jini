import assert from "node:assert/strict";
import { constants } from "node:fs";
import path from "node:path";
import { beforeEach, test, vi } from "vitest";
import { FOLDER_MAX_FILES, FolderZipError, zipFolderFiles } from "../folder-zip.js";
import { zipLocalFolder } from "../folder-zip-node.js";

type Entry = { name: string; isDirectory(): boolean; isFile(): boolean };
type Handle = {
  stat(): Promise<{ size: number; isFile(): boolean }>;
  read(buffer: Buffer, offset: number, length: number, position: null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
};
const filesystem = vi.hoisted(() => ({
  realpath: vi.fn<(filename: string) => Promise<string>>(),
  lstat: vi.fn<(filename: string) => Promise<{ isDirectory(): boolean }>>(),
  opendir: vi.fn<(filename: string) => Promise<AsyncIterable<Entry>>>(),
  open: vi.fn<(filename: string, flags: number) => Promise<Handle>>(),
}));
vi.mock("node:fs/promises", () => filesystem);

const root = path.resolve("/picked");
let entries: Entry[];
let content: Buffer;
let info: { size: number; isFile(): boolean };
let cursor: number;
const handle = {
  stat: vi.fn<Handle["stat"]>(),
  read: vi.fn<Handle["read"]>(),
  close: vi.fn<Handle["close"]>(),
} satisfies Handle;

function entry(required: { name: string; kind?: "file" | "directory" | "special" }, _optional: Record<string, never> = {}): Entry {
  const kind = required.kind ?? "file";
  return { name: required.name, isDirectory: () => kind === "directory", isFile: () => kind === "file" };
}

async function* listing(required: { entries: Entry[] }, _optional: Record<string, never> = {}): AsyncIterable<Entry> {
  yield* required.entries;
}

beforeEach(() => {
  vi.resetAllMocks();
  entries = [entry({ name: "a" })];
  content = Buffer.from([1, 2]);
  info = { size: 2, isFile: () => true };
  cursor = 0;
  filesystem.realpath.mockImplementation(async filename => filename);
  filesystem.lstat.mockResolvedValue({ isDirectory: () => true });
  filesystem.opendir.mockImplementation(async () => listing({ entries }));
  filesystem.open.mockImplementation(async () => { cursor = 0; return handle; });
  handle.stat.mockImplementation(async () => info);
  handle.read.mockImplementation(async (buffer, offset, length) => {
    const count = content.copy(buffer, offset, cursor, cursor + Math.min(length, 1));
    cursor += count;
    return { bytesRead: count };
  });
  handle.close.mockResolvedValue(undefined);
});

const unreadable = { reason: "unreadable", message: "Could not read that folder. Try again." };

test("local reads retain partial chunks, stop at EOF and close the descriptor", async () => {
  const file = new File([new Uint8Array(content)], "a");
  Object.defineProperty(file, "webkitRelativePath", { value: "picked/a" });
  const expected = await zipFolderFiles({ files: [file], maxBytes: 1024 });
  assert.deepEqual(await zipLocalFolder({ path: root, maxBytes: 1024 }), new Uint8Array(await expected.arrayBuffer()));
  assert.equal(handle.read.mock.calls.length, 3);
  assert.deepEqual(handle.read.mock.calls.map(call => [call[1], call[2], call[3]]), [[0, 3, null], [1, 2, null], [2, 1, null]]);
  assert.equal(handle.close.mock.calls.length, 1);
  assert.deepEqual(filesystem.open.mock.calls, [[path.join(root, "a"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK]]);
});

test("an empty file is accepted after its EOF is confirmed", async () => {
  content = Buffer.alloc(0);
  info.size = 0;
  const bytes = await zipLocalFolder({ path: root, maxBytes: 100 });
  assert.equal(bytes.length, 100);
  assert.equal(handle.read.mock.calls.length, 1);
  assert.equal(handle.close.mock.calls.length, 1);
});

test("nested directories are traversed and entries are sorted independently of enumeration order", async () => {
  filesystem.opendir.mockImplementation(async filename => listing({ entries: filename === root
    ? [entry({ name: "z" }), entry({ name: "dir", kind: "directory" }), entry({ name: "a" })]
    : [entry({ name: "b" })] }));
  const files = ["a", "dir/b", "z"].map(name => {
    const file = new File([new Uint8Array(content)], path.basename(name));
    Object.defineProperty(file, "webkitRelativePath", { value: `picked/${name}` });
    return file;
  });
  const expected = await zipFolderFiles({ files, maxBytes: 1024 });
  assert.deepEqual(await zipLocalFolder({ path: root, maxBytes: 1024 }), new Uint8Array(await expected.arrayBuffer()));
  assert.deepEqual(filesystem.opendir.mock.calls, [[root], [path.join(root, "dir")]]);
  assert.equal(handle.close.mock.calls.length, 3);
});

test("equal relative paths keep duplicate files in the archive", async () => {
  entries.push(entry({ name: "a" }));
  const bytes = await zipLocalFolder({ path: root, maxBytes: 1024 });
  assert.equal(new DataView(bytes.buffer).getUint16(bytes.length - 14, true), 2);
  assert.equal(handle.close.mock.calls.length, 2);
});

test("non-directories are refused before opening a directory", async () => {
  filesystem.lstat.mockResolvedValue({ isDirectory: () => false });
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(filesystem.opendir.mock.calls.length, 0);
  assert.equal(filesystem.realpath.mock.calls.length, 1);
});

test("a directory whose real path changes is refused before enumeration", async () => {
  filesystem.realpath.mockResolvedValueOnce(root).mockResolvedValueOnce(path.resolve("/elsewhere"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(filesystem.opendir.mock.calls.length, 0);
});

test("special entries are refused before opening a file", async () => {
  entries = [entry({ name: "link", kind: "special" })];
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(filesystem.open.mock.calls.length, 0);
});

test("files whose real paths differ are refused before opening", async () => {
  filesystem.realpath.mockImplementation(async filename => filename === root ? root : path.resolve("/outside"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(filesystem.open.mock.calls.length, 0);
});

test("an opened special file is refused and its descriptor is closed", async () => {
  info.isFile = () => false;
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(handle.read.mock.calls.length, 0);
  assert.equal(handle.close.mock.calls.length, 1);
});

test("cumulative raw sizes are bounded before the next allocation or read", async () => {
  entries.push(entry({ name: "b" }));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 3 }), {
    reason: "too-large", message: "Folder is over the upload limit.",
  });
  assert.equal(handle.read.mock.calls.length, 3);
  assert.equal(handle.close.mock.calls.length, 2);
});

test("growth beyond the stat size is detected with one extra byte and closes the file", async () => {
  info.size = 1;
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(handle.read.mock.calls.length, 2);
  assert.equal(handle.close.mock.calls.length, 1);
});

test("shrinkage below the stat size is refused and closes the file", async () => {
  info.size = 3;
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(handle.close.mock.calls.length, 1);
});

test("read and stat failures are translated after closing the file", async () => {
  handle.read.mockRejectedValueOnce(new Error("read failed"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(handle.close.mock.calls.length, 1);
  handle.stat.mockRejectedValueOnce(new Error("stat failed"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(handle.close.mock.calls.length, 2);
});

test("close failures override a raw-size refusal and become unreadable", async () => {
  handle.close.mockRejectedValueOnce(new Error("close failed"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1 }), unreadable);
  assert.equal(handle.read.mock.calls.length, 0);
  assert.equal(handle.close.mock.calls.length, 1);
});

test("native root, enumeration and open failures become unreadable refusals", async () => {
  filesystem.realpath.mockRejectedValueOnce(new Error("realpath failed"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  filesystem.opendir.mockRejectedValueOnce(new Error("opendir failed"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  filesystem.open.mockRejectedValueOnce(new Error("open failed"));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), unreadable);
  assert.equal(handle.close.mock.calls.length, 0);
});

test("existing FolderZipError instances are rethrown unchanged", async () => {
  const error = new FolderZipError("too-many", "original message");
  filesystem.realpath.mockRejectedValueOnce(error);
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), caught => caught === error);
});

test("the entry cap counts directories and refuses the next entry before opening it", async () => {
  entries = Array.from({ length: FOLDER_MAX_FILES + 1 }, (_, i) => entry({ name: String(i), kind: "directory" }));
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), {
    reason: "too-many", message: "More than 4096 entries.",
  });
  assert.equal(filesystem.opendir.mock.calls.length, 1);
  assert.equal(filesystem.open.mock.calls.length, 0);
});

test("an empty traversal preserves the encoder's empty-folder refusal", async () => {
  entries = [];
  await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), {
    reason: "empty", message: "That folder is empty.",
  });
});

test("a parent swapped for a symlink after realpath can supply outside bytes (reported, not fixed)", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const temporary = await actual.realpath(await actual.mkdtemp(path.join(tmpdir(), "folder-zip-parent-race-")));
  try {
    const selected = path.join(temporary, "selected");
    const outside = path.join(temporary, "outside");
    await actual.mkdir(selected);
    await actual.mkdir(outside);
    await actual.writeFile(path.join(selected, "a"), "selected bytes");
    await actual.writeFile(path.join(outside, "a"), "outside bytes");
    filesystem.realpath.mockImplementation(filename => actual.realpath(filename));
    filesystem.lstat.mockImplementation(filename => actual.lstat(filename));
    filesystem.opendir.mockImplementation(filename => actual.opendir(filename));
    filesystem.open.mockImplementation(async (filename, flags) => {
      await actual.rename(selected, path.join(temporary, "original"));
      await actual.symlink(outside, selected);
      return actual.open(filename, flags);
    });
    const file = new File(["outside bytes"], "a");
    Object.defineProperty(file, "webkitRelativePath", { value: "picked/a" });
    const expected = await zipFolderFiles({ files: [file], maxBytes: 1024 });
    assert.deepEqual(await zipLocalFolder({ path: selected, maxBytes: 1024 }), new Uint8Array(await expected.arrayBuffer()));
  } finally { await actual.rm(temporary, { recursive: true, force: true }); }
});
