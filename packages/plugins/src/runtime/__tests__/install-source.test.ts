import { expect, it, vi } from "vitest";
import { readPluginInstallArchive, readPluginInstallRequest } from "../install-source.js";
const messages = { attachmentUnavailable: "unavailable", tooLarge: "too large", noReadableZip: ({ path }: { path: string }) => `no ZIP ${path}` };
const parse = (input: unknown) => readPluginInstallRequest({ input, isAbsolutePath: ({ path }) => path.startsWith("/"), absolutePathMessage: "absolute required" });
it("opaque attachment never reaches filesystem methods and receives owner/run/max", async () => {
  const files = { stat: vi.fn(async () => ({ size: 1 })), read: vi.fn(async () => new Uint8Array([1])) };
  const readAttachment = vi.fn(async () => ({ ok: false as const, refusal: "not-owner" as const }));
  await expect(readPluginInstallArchive({ request: parse({ source: { kind: "zip", attachmentRef: "attachment:12345678" } }), ownerId: "owner", runId: "run", maxBytes: 8, files, messages }, { readAttachment })).rejects.toThrow("unavailable");
  expect(readAttachment).toHaveBeenCalledWith({ ref: "attachment:12345678", ownerId: "owner", runId: "run" }, { maxBytes: 8 });
  expect(files.stat).not.toHaveBeenCalled();
  expect(files.read).not.toHaveBeenCalled();
});
it("a source that grows during the read is refused", async () => {
  const files = { stat: async () => ({ size: 1 }), read: async () => new Uint8Array(9) };
  await expect(readPluginInstallArchive({ request: parse({ source: { kind: "zip", path: "/a.zip" } }), ownerId: "o", runId: "r", maxBytes: 8, files, messages })).rejects.toThrow("too large");
});
it("a relative source.path is refused", () => {
  expect(() => parse({ source: { kind: "zip", path: "relative.zip" } })).toThrow("absolute required");
});
it("attachmentRef with kind: 'folder' is refused", () => {
  expect(() => parse({ source: { kind: "folder", attachmentRef: "attachment:12345678" } })).toThrow("ZIP reference");
});
it("a ZIP larger than maxBytes is refused from stat before any read", async () => {
  const files = { stat: async () => ({ size: 9 }), read: vi.fn(async () => new Uint8Array(1)) };
  await expect(readPluginInstallArchive({ request: parse({ source: { kind: "zip", path: "/a.zip" } }), ownerId: "o", runId: "r", maxBytes: 8, files, messages })).rejects.toThrow("too large");
  expect(files.read).not.toHaveBeenCalled();
});
