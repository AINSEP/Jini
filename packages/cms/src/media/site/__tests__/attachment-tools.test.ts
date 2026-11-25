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
  return { workspaceId: "w", authorize: async () => ({ allowed: true, reason: "matched" }), clock: { nowMs: () => 0 }, idGen: { newId: () => "id" },
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
