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
it("an owned attachment within the limit returns its bytes; an oversized one or a missing reader is refused", async () => {
  const files = { stat: vi.fn(async () => ({ size: 1 })), read: vi.fn(async () => new Uint8Array([1])) };
  const request = parse({ source: { kind: "zip", attachmentRef: "attachment:12345678" } });
  const bytes = new Uint8Array([9, 8, 7]);
  const owned = vi.fn(async () => ({ ok: true as const, bytes }));
  expect(await readPluginInstallArchive({ request, ownerId: "o", runId: "r", maxBytes: 3, files, messages }, { readAttachment: owned })).toBe(bytes);
  const big = vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array(4) }));
  await expect(readPluginInstallArchive({ request, ownerId: "o", runId: "r", maxBytes: 3, files, messages }, { readAttachment: big })).rejects.toThrow("too large");
  await expect(readPluginInstallArchive({ request, ownerId: "o", runId: "r", maxBytes: 3, files, messages })).rejects.toThrow("unavailable");
  expect(files.stat).not.toHaveBeenCalled();
});
it("parses folder and zip paths with replace defaulting to false, and refuses every malformed request shape with its message", () => {
  expect(parse({ source: { kind: "folder", path: "/plugins/a" } })).toEqual({ kind: "folder", path: "/plugins/a", replace: false });
  expect(parse({ source: { kind: "zip", attachmentRef: "attachment:12345678" }, replace: true })).toEqual({ kind: "zip", attachmentRef: "attachment:12345678", replace: true });
  for (const source of [undefined, null, "zip", ["zip"]]) expect(() => parse({ source })).toThrow("source is required.");
  for (const kind of [undefined, "tar", 1]) expect(() => parse({ source: { kind, path: "/a.zip" } })).toThrow("source.kind must be 'folder' or 'zip'.");
  for (const source of [{ kind: "zip" }, { kind: "zip", path: "/a.zip", attachmentRef: "attachment:12345678" }]) {
    expect(() => parse({ source })).toThrow("Exactly one of source.path/source.attachmentRef is required.");
  }
  expect(() => parse({ source: { kind: "zip", attachmentRef: "uploads/a.zip" } })).toThrow("source.attachmentRef must be an attachment:<uuid> ZIP reference.");
  expect(() => parse({ source: { kind: "zip", path: 42 } })).toThrow("absolute required");
  expect(() => parse({ source: { kind: "zip", path: "/a.zip" }, replace: "yes" })).toThrow("replace must be a boolean.");
});
it("a readable local ZIP within the limit is returned; an unreadable path is named in the refusal; a pathless request is refused", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const ok = { stat: vi.fn(async () => ({ size: 3 })), read: vi.fn(async () => bytes) };
  expect(await readPluginInstallArchive({ request: parse({ source: { kind: "zip", path: "/a.zip" } }), ownerId: "o", runId: "r", maxBytes: 3, files: ok, messages })).toBe(bytes);
  expect(ok.read).toHaveBeenCalledWith({ path: "/a.zip" });
  const missing = { stat: async () => { throw new Error("ENOENT"); }, read: vi.fn(async () => bytes) };
  await expect(readPluginInstallArchive({ request: parse({ source: { kind: "zip", path: "/gone.zip" } }), ownerId: "o", runId: "r", maxBytes: 3, files: missing, messages })).rejects.toThrow("no ZIP /gone.zip");
  expect(missing.read).not.toHaveBeenCalled();
  await expect(readPluginInstallArchive({ request: { kind: "zip", replace: false } as never, ownerId: "o", runId: "r", maxBytes: 3, files: ok, messages })).rejects.toThrow("Plugin ZIP source has no path.");
});
