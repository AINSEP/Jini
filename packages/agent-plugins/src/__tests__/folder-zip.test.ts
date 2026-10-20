import assert from "node:assert/strict";
import { test } from "vitest";
import { crc32, FOLDER_MAX_FILES, FolderZipError, zipFolderFiles } from "../folder-zip.js";

function picked(required: { name: string; relative?: string; bytes?: Uint8Array }, _optional: Record<string, never> = {}): File {
  const file = new File([new Uint8Array(required.bytes ?? [])], required.name);
  if (required.relative !== undefined) Object.defineProperty(file, "webkitRelativePath", { value: required.relative });
  return file;
}

async function archive(required: { files: File[]; maxBytes?: number }, _optional: Record<string, never> = {}) {
  const file = await zipFolderFiles({ files: required.files, maxBytes: required.maxBytes ?? 10000 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { file, bytes, view: new DataView(bytes.buffer) };
}

test("CRC-32 matches the standard check vector and empty input", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("an empty selection returns the empty-folder refusal", async () => {
  await assert.rejects(() => zipFolderFiles({ files: [], maxBytes: 0 }), new FolderZipError("empty", "That folder is empty."));
});

test("file count is refused before reading or checking raw size", async () => {
  const file = picked({ name: "a" });
  file.arrayBuffer = async () => { throw new Error("must not read"); };
  await assert.rejects(() => zipFolderFiles({ files: Array(FOLDER_MAX_FILES + 1).fill(file), maxBytes: -1 }), {
    reason: "too-many", message: "More than 4096 files.",
  });
});

test("raw size is refused before attempting a file read", async () => {
  const file = picked({ name: "a", bytes: new Uint8Array([1, 2]) });
  file.arrayBuffer = async () => { throw new Error("must not read"); };
  await assert.rejects(() => zipFolderFiles({ files: [file], maxBytes: 1 }), {
    reason: "too-large", message: "Folder is over the upload limit.",
  });
});

test("a failed file read is translated to the unreadable-folder refusal", async () => {
  const file = picked({ name: "a" });
  file.arrayBuffer = async () => { throw new Error("read failed"); };
  await assert.rejects(() => zipFolderFiles({ files: [file], maxBytes: 1000 }), {
    reason: "unreadable", message: "Could not read that folder. Try again.",
  });
});

test("ZIP overhead is included in the limit and equality is accepted", async () => {
  const file = picked({ name: "a" });
  await assert.rejects(() => zipFolderFiles({ files: [file], maxBytes: 99 }), { reason: "too-large" });
  const result = await archive({ files: [file], maxBytes: 100 });
  assert.equal(result.bytes.length, 100);
  assert.equal(result.file.name, "folder.zip");
  assert.equal(result.file.type, "application/zip");
});

test("stored ZIP headers preserve binary bytes, CRC, fixed dates and DOS file attributes", async () => {
  const data = new Uint8Array([0x89, 0, 0xff, 0x80]);
  const { bytes, view } = await archive({ files: [picked({ name: "a", relative: "picked/a", bytes: data })] });
  const central = 35;
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(4, true), 20);
  assert.equal(view.getUint16(6, true), 0);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint16(10, true), 0);
  assert.equal(view.getUint16(12, true), 33);
  assert.equal(view.getUint32(14, true), crc32(data));
  assert.equal(view.getUint32(18, true), 4);
  assert.equal(view.getUint32(22, true), 4);
  assert.deepEqual(bytes.subarray(31, 35), data);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  assert.equal(view.getUint16(central + 4, true), 20);
  assert.equal(view.getUint16(central + 6, true), 20);
  assert.equal(view.getUint16(central + 8, true), 0);
  assert.equal(view.getUint16(central + 14, true), 33);
  assert.equal(view.getUint32(central + 16, true), crc32(data));
  assert.equal(view.getUint32(central + 20, true), 4);
  assert.equal(view.getUint32(central + 24, true), 4);
  assert.equal(view.getUint32(central + 38, true), 0);
  assert.equal(view.getUint32(central + 42, true), 0);
  const end = central + 47;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 8, true), 1);
  assert.equal(view.getUint16(end + 10, true), 1);
  assert.equal(view.getUint32(end + 12, true), 47);
  assert.equal(view.getUint32(end + 16, true), central);
});

test("non-ASCII paths set UTF-8 flags in both headers and normalize backslashes", async () => {
  const { file, bytes, view } = await archive({ files: [picked({ name: "é", relative: "picked\\nested\\é" })] });
  const name = new TextEncoder().encode("nested/é");
  assert.equal(file.name, "picked.zip");
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint16(26, true), name.length);
  assert.deepEqual(bytes.subarray(30, 30 + name.length), name);
  const central = 30 + name.length;
  assert.equal(view.getUint16(central + 8, true), 0x0800);
  assert.equal(view.getUint16(central + 28, true), name.length);
  assert.deepEqual(bytes.subarray(central + 46, central + 46 + name.length), name);
});

test("input order is preserved and the first nonempty folder names the archive", async () => {
  const { file, bytes, view } = await archive({ files: [
    picked({ name: "z" }), picked({ name: "a", relative: "first/a" }), picked({ name: "b", relative: "second/b" }),
  ] });
  assert.equal(file.name, "first.zip");
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 31)), "z");
  assert.equal(new TextDecoder().decode(bytes.subarray(61, 62)), "a");
  assert.equal(new TextDecoder().decode(bytes.subarray(92, 93)), "b");
  const central = 93;
  assert.equal(view.getUint32(central + 42, true), 0);
  assert.equal(view.getUint32(central + 47 + 42, true), 31);
  assert.equal(view.getUint32(central + 94 + 42, true), 62);
});

test("relative paths without a slash stay intact and an empty folder uses the fallback name", async () => {
  const { file, bytes } = await archive({ files: [picked({ name: "ignored", relative: "standalone" })] });
  assert.equal(file.name, "folder.zip");
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 40)), "standalone");
});

test("the exact entry cap is accepted", async () => {
  const { view, bytes } = await archive({ files: Array(FOLDER_MAX_FILES).fill(picked({ name: "a" })), maxBytes: 1000000 });
  assert.equal(view.getUint16(bytes.length - 14, true), FOLDER_MAX_FILES);
});
