import { expect, it, vi } from "vitest";
import { readChatAttachmentForOwner, type AttachmentReadPorts } from "../attachment-owner-read.js";
import { isNativeMessageImage, prepareMessageAttachments } from "../../attachment-content.js";

const ref = "attachment:12345678";
const record = { id: ref, filePath: "/upload/12345678/file", name: "file", kind: "file", size: 1,
  batchId: "12345678", dev: 1, ino: 2, mtimeMs: 3, ctimeMs: 4, createdAt: 0, ownerId: "owner" };
const stat = { isFile: () => true, dev: 1, ino: 2, size: 1, mtimeMs: 3, ctimeMs: 4 };
function ports(sidecar: object = record, bytes = new Uint8Array([7])) {
  const info = { ...stat, size: bytes.byteLength };
  const handle = { stat: vi.fn(async () => info),
    read: vi.fn(async ({ buffer }: { buffer: Uint8Array; position: number; length: number }) => { buffer.set(bytes.subarray(0, buffer.byteLength)); return { bytesRead: buffer.byteLength }; }),
    readFile: vi.fn(async () => bytes), close: vi.fn(async () => {}) };
  const io: AttachmentReadPorts = { readSidecarText: async () => JSON.stringify(sidecar), realpath: async ({ path }) => path,
    lstat: vi.fn(async () => info), openNoFollow: vi.fn(async () => handle) };
  return { io, handle };
}

it("an ownerless or differently owned attachment never opens", async () => {
  const { ownerId, ...ownerless } = record;
  for (const sidecar of [ownerless, { ...record, ownerId: "other" }]) {
    const { io, handle } = ports(sidecar);
    expect(await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId, io }, { selectRead: () => "prefix", maxFullBytes: 1 })).toEqual({ ok: false, refusal: "not-owner" });
    expect(handle.read).not.toHaveBeenCalled();
    expect(io.openNoFollow).not.toHaveBeenCalled();
    expect(io.lstat).not.toHaveBeenCalled();
  }
});
it("an identity change at open refuses before bytes and still closes", async () => {
  const { io, handle } = ports();
  handle.stat.mockResolvedValue({ ...stat, ino: 99 });
  expect(await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId: "owner", io }, { selectRead: () => "prefix", maxFullBytes: 1 })).toEqual({ ok: false, refusal: "integrity" });
  expect(handle.read).not.toHaveBeenCalled();
  expect(handle.readFile).not.toHaveBeenCalled();
  expect(handle.close).toHaveBeenCalledTimes(1);
});
it("an over-cap native image gets a verified prefix but no full read", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const { io, handle } = ports({ ...record, size: bytes.byteLength }, bytes);
  const selectRead = vi.fn(() => "full" as const);
  expect(await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId: "owner", io }, { selectRead, maxFullBytes: bytes.byteLength - 1 })).toEqual({ ok: false, refusal: "too-large" });
  expect(handle.read).toHaveBeenCalledExactlyOnceWith({ buffer: bytes, position: 0, length: bytes.byteLength });
  expect(selectRead).toHaveBeenCalledExactlyOnceWith({ prefix: bytes }, {});
  expect(handle.readFile).not.toHaveBeenCalled();
  expect(handle.close).toHaveBeenCalledTimes(1);
});
it("delivery reads only a video prefix and delivers an admitted PNG as exact base64 pixels", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const video = new Uint8Array(64 * 1024 + 1);
  video.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
  for (const bytes of [video, png]) {
    const { io, handle } = ports({ ...record, size: bytes.byteLength }, bytes);
    if (bytes === video) handle.readFile.mockRejectedValue(new Error("video payload must not be read"));
    const mimeType = bytes === png ? "image/png" : "video/mp4";
    const result = await prepareMessageAttachments({ refs: [ref], read: async () => {
      const read = await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId: "owner", io }, {
        selectRead: ({ prefix }) => {
          expect(prefix).toEqual(bytes.subarray(0, 64 * 1024));
          return isNativeMessageImage({ mimeType }) ? "full" : "prefix";
        }, maxFullBytes: png.byteLength,
      });
      if (!read.ok) throw new Error(read.refusal);
      return { name: "file", mimeType, bytes: read.bytes };
    } });
    expect(handle.read).toHaveBeenCalledExactlyOnceWith({ buffer: bytes.subarray(0, 64 * 1024), position: 0, length: Math.min(bytes.byteLength, 64 * 1024) });
    expect(handle.close).toHaveBeenCalledTimes(1);
    if (bytes === png) {
      expect(result.images).toEqual([{ mimeType, data: Buffer.from(png).toString("base64") }]);
      expect(handle.readFile).toHaveBeenCalledTimes(1);
    } else {
      expect(result).toEqual({ images: [], imagePaths: [], notice: "\n\nAttachments to this message:\nfile: video attachments are unsupported by this runtime." });
      expect(handle.readFile).not.toHaveBeenCalled();
    }
  }
});
it("a changed pre-open observation refuses before opening", async () => {
  const { io } = ports();
  io.lstat = vi.fn(async () => ({ ...stat, ino: 99 }));
  expect(await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId: "owner", io })).toEqual({ ok: false, refusal: "integrity" });
  expect(io.openNoFollow).not.toHaveBeenCalled();
});
