import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { ToolInputError } from "@jini-ai/core";
import { buildPromoteChatAttachmentTool } from "../promote-chat-attachment.js";
import { buildLibrarySaveAttachmentTool } from "../library-save-attachment.js";
import { MAX_DOCUMENT_BYTES, type MediaToolDeps } from "../../index.js";
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo } from "../../repo.memory.js";
import { InMemoryBlobStore } from "../../blob-store.memory.js";

const ctx = (input: unknown): ToolExecutionContext => ({ executionId: "e", principal: { id: "owner" }, run: { id: "original-run" }, input, signal: new AbortController().signal });
function deps(): MediaToolDeps & { refuseUnexpectedKeys(input: Record<string, unknown>, allowed: readonly string[]): void } {
  return { createHash, workspaceId: "w", authorize: async () => ({ allowed: true, reason: "matched" }), clock: { nowMs: () => 0 }, idGen: { newId: () => "id" },
    mediaRepo: new InMemoryMediaRepo({}), assetBlobRepo: new InMemoryAssetBlobRepo({}), assetRenditionRepo: new InMemoryAssetRenditionRepo({}), blobStore: new InMemoryBlobStore(),
    refuseUnexpectedKeys: (input, allowed) => { if (Object.keys(input).some(k => !allowed.includes(k))) throw new ToolInputError({ message: "unexpected key" }); } };
}
it("promotion delegates to upload with the original run and sniffed type", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const resolveForRun = vi.fn(async () => ({ path: "/private/file", name: "original.png", kind: "image" as const }));
  const mediaUploadHandler = vi.fn(async () => ({ uploaded: true }));
  const tool = buildPromoteChatAttachmentTool({ getStore: () => ({ resolveForRun }), readFile: async () => bytes,
    mediaUploadHandler, isAttachmentRejected: () => false, encodeBase64: () => "encoded" });
  const input = ctx({ attachmentRef: "attachment:12345678", contentType: "text/plain" });
  const options = {};
  expect(await tool.handler(input, options)).toEqual({ uploaded: true });
  expect(resolveForRun).toHaveBeenCalledWith({ ref: "attachment:12345678", runId: "original-run" });
  expect(mediaUploadHandler).toHaveBeenCalledWith({ ...input, input: { filename: "original.png", contentType: "image/png", dataBase64: "encoded" } }, options);
});
it("a ref not on the current message never reaches the Library resolver", async () => {
  const resolveForRun = vi.fn(async () => undefined);
  const tool = buildLibrarySaveAttachmentTool({ deps: deps(), getStore: () => ({ resolveForRun }), getMessageAttachmentRefs: () => ["attachment:current1"],
    readFile: async () => new Uint8Array(), isAttachmentRejected: () => false, archiveReader: { entries: async function* () { yield* []; } },
    byteLengthUtf8: ({ text }) => text.length, encodeUtf8: () => new Uint8Array(), description: "Save privately" });
  await expect(tool.handler(ctx({ attachmentRef: "attachment:oldref12" }))).rejects.toThrow("not bound to this current message");
  expect(resolveForRun).not.toHaveBeenCalled();
});
it("oversize generated text is never encoded", async () => {
  const encodeUtf8 = vi.fn(() => new Uint8Array());
  const tool = buildLibrarySaveAttachmentTool({ deps: deps(), getStore: () => undefined, getMessageAttachmentRefs: () => [],
    readFile: async () => new Uint8Array(), isAttachmentRejected: () => false, archiveReader: { entries: async function* () { yield* []; } },
    byteLengthUtf8: () => MAX_DOCUMENT_BYTES + 1, encodeUtf8, description: "Save privately" });
  await expect(tool.handler(ctx({ name: "note.md", content: "text" }))).rejects.toThrow("at most 50 MiB");
  expect(encodeUtf8).not.toHaveBeenCalled();
});

it("saves a current-message document using its original name and keeps the persisted bytes private", async () => {
  const media = deps();
  let next = 0;
  media.idGen = { newId: () => `row-${++next}` };
  const bytes = Buffer.from("A useful note");
  const ref = "attachment:current1";
  const resolveForRun = vi.fn(async ({ runId, ref: requested }: { runId: string; ref: string }) =>
    runId === "original-run" && requested === ref ? { path: "/owned/note.txt", name: "Note.txt", kind: "file" as const } : undefined);
  const readFile = vi.fn(async ({ path }: { path: string }) => {
    if (path !== "/owned/note.txt") throw new Error("wrong attachment path");
    return bytes;
  });
  const tool = buildLibrarySaveAttachmentTool({ deps: media, getStore: () => ({ resolveForRun }), getMessageAttachmentRefs: () => [ref], readFile,
    isAttachmentRejected: () => false, archiveReader: { entries: async function* () { throw new Error("not an archive"); } },
    byteLengthUtf8: ({ text }) => Buffer.byteLength(text), encodeUtf8: ({ text }) => Buffer.from(text), description: "Save privately" });
  const receipt = await tool.handler(ctx({ attachmentRef: ref }));
  const [asset] = await media.mediaRepo.list({ workspaceId: "w" });
  expect(receipt).toEqual({ document: { id: asset?.id, title: "Note", filename: "Note.txt", originalFilename: "Note.txt",
    contentType: "text/plain", byteSize: 13, createdAt: "1970-01-01T00:00:00.000Z", createdBy: "owner", publicUrl: null } });
  expect(asset).toMatchObject({ kind: "document", createdBy: "owner" });
  const blob = await media.assetBlobRepo.findByHash({ workspaceId: "w", sha256: createHash("sha256").update(bytes).digest("hex") });
  expect(blob?.documentOwned).toBe(true);
  expect(await media.blobStore.get({ storageKey: blob!.storageKey })).toEqual(bytes);
  expect(resolveForRun.mock.calls).toEqual([[{ ref, runId: "original-run" }]]);
  expect(readFile.mock.calls).toEqual([[{ path: "/owned/note.txt" }]]);
});

it("generated documents refuse non-text extensions and surface typed ingress refusals without persisting", async () => {
  const media = deps();
  const encodeUtf8 = vi.fn(({ text }: { text: string }) => Buffer.from(text));
  const tool = buildLibrarySaveAttachmentTool({ deps: media, getStore: () => undefined, getMessageAttachmentRefs: () => [],
    readFile: async () => { throw new Error("unexpected read"); }, isAttachmentRejected: () => false,
    archiveReader: { entries: async function* () { throw new Error("not an archive"); } },
    byteLengthUtf8: ({ text }) => Buffer.byteLength(text), encodeUtf8, description: "Save privately" });
  await expect(tool.handler(ctx({ name: "note.pdf", content: "plain text" }))).rejects.toThrow("Generated documents need a .md or .txt name");
  expect(encodeUtf8.mock.calls).toEqual([]);
  const refusal = tool.handler(ctx({ name: "folder/note.md", content: "plain text" }));
  await expect(refusal).rejects.toBeInstanceOf(ToolInputError);
  await expect(refusal).rejects.toThrow("document filename must be a plain filename of at most 255 characters");
  expect(await media.mediaRepo.list({ workspaceId: "w" })).toEqual([]);
});

it("promotion treats an invalid attachment claim as a safe refusal and never reads bytes", async () => {
  const ref = "attachment:current1";
  const rejection = new Error("private attachment validation detail");
  const resolver = vi.fn(async () => { throw rejection; });
  const readFile = vi.fn(async () => { throw new Error("unexpected read"); });
  const mediaUploadHandler = vi.fn(async () => { throw new Error("unexpected upload"); });
  let store: { resolveForRun: typeof resolver } | undefined;
  const tool = buildPromoteChatAttachmentTool({ getStore: () => store, readFile, mediaUploadHandler,
    isAttachmentRejected: ({ error }) => error === rejection, encodeBase64: () => { throw new Error("unexpected encode"); } });
  await expect(tool.handler(ctx({ attachmentRef: ref }))).rejects.toThrow("attachment store is not ready");
  store = { resolveForRun: resolver };
  const refused = tool.handler(ctx({ attachmentRef: ref }));
  await expect(refused).rejects.toBeInstanceOf(ToolInputError);
  await expect(refused).rejects.toHaveProperty("message", "attachment 'attachment:current1' is unknown or already claimed by a different run");
  expect(resolver.mock.calls).toEqual([[{ ref, runId: "original-run" }]]);
  expect(readFile.mock.calls).toEqual([]);
  expect(mediaUploadHandler.mock.calls).toEqual([]);
});
