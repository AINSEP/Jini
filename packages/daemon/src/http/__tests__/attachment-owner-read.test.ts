import { expect, it, vi } from "vitest";
import { readChatAttachmentForOwner, type AttachmentReadPorts } from "../attachment-owner-read.js";

const ref = "attachment:12345678";
const record = { id: ref, filePath: "/upload/12345678/file", name: "file", kind: "file", size: 1,
  batchId: "12345678", dev: 1, ino: 2, mtimeMs: 3, ctimeMs: 4, createdAt: 0, ownerId: "owner" };
const stat = { isFile: () => true, dev: 1, ino: 2, size: 1, mtimeMs: 3, ctimeMs: 4 };
function ports(sidecar: object = record) {
  const handle = { stat: vi.fn(async () => stat), readFile: vi.fn(async () => new Uint8Array([7])), close: vi.fn(async () => {}) };
  const io: AttachmentReadPorts = { readSidecarText: async () => JSON.stringify(sidecar), realpath: async ({ path }) => path,
    lstat: vi.fn(async () => stat), openNoFollow: vi.fn(async () => handle) };
  return { io, handle };
}

it("an ownerless or differently owned attachment never opens", async () => {
  const { ownerId, ...ownerless } = record;
  for (const sidecar of [ownerless, { ...record, ownerId: "other" }]) {
    const { io } = ports(sidecar);
    expect(await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId, io })).toEqual({ ok: false, refusal: "not-owner" });
    expect(io.openNoFollow).not.toHaveBeenCalled();
    expect(io.lstat).not.toHaveBeenCalled();
  }
});
it("an identity change at open refuses before bytes and still closes", async () => {
  const { io, handle } = ports();
  handle.stat.mockResolvedValue({ ...stat, ino: 99 });
  expect(await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId: "owner", io })).toEqual({ ok: false, refusal: "integrity" });
  expect(handle.readFile).not.toHaveBeenCalled();
  expect(handle.close).toHaveBeenCalledTimes(1);
});
it("a changed pre-open observation refuses before opening", async () => {
  const { io } = ports();
  io.lstat = vi.fn(async () => ({ ...stat, ino: 99 }));
  expect(await readChatAttachmentForOwner({ uploadDirectory: "/upload", ref, ownerId: "owner", io })).toEqual({ ok: false, refusal: "integrity" });
  expect(io.openNoFollow).not.toHaveBeenCalled();
});
