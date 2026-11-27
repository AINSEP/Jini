import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { routeReply } from "@jini-ai/core/contracts/server";
import type { BlobFence } from "@jini-ai/core/contracts/blob-gc";

import { computeBlobStorageKey, InMemoryBlobStore, MAX_DOCUMENT_BYTES } from "../../../../media/index.js";
import { blobGetRoute, type BlobGetRouteDeps } from "../blob-get.js";
import { blobPutRoute, decodeBlobBytes, type BlobPutRouteDeps } from "../blob-put.js";

/** @file The publish-content blob GET/PUT specs: the pre-session sha 400, the id-free permission asks, every refusal and the happy paths. */

const WS = "ws-1";
const BYTES = new TextEncoder().encode("hello blob");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const PRINCIPAL = { id: "u1" };

function refusalOf(run: () => unknown): unknown {
  try { run(); } catch (error) { const e = (error as { response?: { status: number; body: unknown } }).response; return { status: e?.status, body: e?.body }; }
  throw new Error("expected a refusal");
}
async function refusalOfAsync(run: () => unknown): Promise<unknown> {
  try { await run(); } catch (error) { const e = (error as { response?: { status: number; body: unknown } }).response; return { status: e?.status, body: e?.body }; }
  throw new Error("expected a refusal");
}
function recordingAuthorize(denied = false) {
  const calls: unknown[] = [];
  const authorize = async (args: { permission: string; entityType?: string }, ...scope: unknown[]) => { calls.push(scope.length ? [args, ...scope] : args); if (denied) throw new Error("denied"); };
  return { calls, authorize };
}
const raw = (params: Record<string, string | undefined>, body?: unknown) => ({ params, query: {}, body }) as never;

function getDeps({ documentOnly = false, stored = BYTES as Uint8Array | null } = {}) {
  const reads = { exists: 0, get: 0, media: 0 };
  const deps: BlobGetRouteDeps = {
    workspaceId: WS,
    isDocumentOnlyBlob: async ({ sha256 }) => { reads.media += 1; expect(sha256).toBe(SHA); return documentOnly; },
    storageKeyFor: ({ sha256 }) => `blobs/${WS}/${sha256}`,
    maxTransferBytes: MAX_DOCUMENT_BYTES,
    blobSource: () => ({
      exists: async ({ storageKey }) => { reads.exists += 1; expect(storageKey).toContain(SHA); return stored !== null; },
      get: async () => { reads.get += 1; return stored ?? new Uint8Array(); },
    }),
  };
  return { deps, reads };
}

describe("blobGetRoute", () => {
  it("pins method, path, success status and no body cap", () => {
    expect([blobGetRoute.method, blobGetRoute.path, blobGetRoute.successStatus, blobGetRoute.maxBodyBytes]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha", undefined, undefined]);
  });
  it("refuses a malformed or absent sha in parse with the flat 400", () => {
    for (const sha of [undefined, "ABC", SHA.toUpperCase(), `${SHA}0`]) {
      expect(refusalOf(() => blobGetRoute.parse(raw({ workspaceId: WS, sha })))).toEqual({ status: 400, body: { error: "sha must be a lowercase 64-character hex sha256 digest" } });
    }
    expect(blobGetRoute.parse(raw({ workspaceId: WS, sha: SHA }))).toEqual({ ok: true, value: { sha256: SHA } });
  });
  it("asks publish_content.read with no entity type or scope, then answers the base64 bytes", async () => {
    const { deps, reads } = getDeps();
    const { calls, authorize } = recordingAuthorize();
    const out = await blobGetRoute.handle({ input: { sha256: SHA }, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "publish_content.read" }]);
    expect(out).toEqual({ ok: true, value: { sha256: SHA, dataBase64: Buffer.from(BYTES).toString("base64") } });
    expect(reads).toEqual({ exists: 1, get: 1, media: 1 });
  });
  it("answers a document-only blob with the private, uncached 404 before touching the store", async () => {
    const { deps, reads } = getDeps({ documentOnly: true });
    const out = await blobGetRoute.handle({ input: { sha256: SHA }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(out).toEqual({ ok: true, value: routeReply({ status: 404, body: { error: "blob was not found", code: "BLOB_NOT_FOUND" }, headers: { "Cache-Control": "private, no-store" } }) });
    expect([reads.exists, reads.get]).toEqual([0, 0]);
  });
  it("a denial stops every read", async () => {
    const { deps, reads } = getDeps();
    await expect(blobGetRoute.handle({ input: { sha256: SHA }, deps, context: PRINCIPAL, authorize: recordingAuthorize(true).authorize })).rejects.toThrow("denied");
    expect(reads).toEqual({ exists: 0, get: 0, media: 0 });
  });
  it("fails closed without an authorizer", async () => {
    await expect(blobGetRoute.handle({ input: { sha256: SHA }, deps: getDeps().deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
  it("answers the uncached 404 for a missing blob and the 413 past the transfer limit", async () => {
    const missing = getDeps({ stored: null });
    expect(await refusalOfAsync(() => blobGetRoute.handle({ input: { sha256: SHA }, deps: missing.deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({ status: 404, body: { error: "blob was not found", code: "BLOB_NOT_FOUND" } });
    expect(missing.reads.get).toBe(0);
    const huge = getDeps({ stored: new Uint8Array(MAX_DOCUMENT_BYTES + 1) });
    expect(await refusalOfAsync(() => blobGetRoute.handle({ input: { sha256: SHA }, deps: huge.deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({ status: 413, body: { error: `blob exceeds the ${MAX_DOCUMENT_BYTES}-byte transfer limit`, code: "PAYLOAD_TOO_LARGE" } });
  });
});

function putDeps() {
  const writes: unknown[] = [];
  const store = new InMemoryBlobStore();
  const deps: BlobPutRouteDeps = {
    workspaceId: WS, maxUploadBytes: MAX_DOCUMENT_BYTES,
    blobStore: { putIfAbsent: async (input) => { writes.push(input); return store.putIfAbsent(input); } },
    blobFence: {
      withKeys: async ({ work }) => work(),
      withAsset: async ({ work }) => work(),
    } satisfies BlobFence,
    storageKeyFor: computeBlobStorageKey,
    verifyStoredBlob: async ({ storageKey, sha256, byteLength }) => {
      const stored = await store.get({ storageKey });
      if (stored.byteLength !== byteLength || createHash("sha256").update(stored).digest("hex") !== sha256) {
        throw new Error("Stored blob failed verification");
      }
    },
  };
  return { deps, writes, store };
}
const putInput = (body: unknown, sha = SHA) => ({ claimedSha256: sha, rawBody: body });

describe("blobPutRoute", () => {
  it("blob PUT refuses a short or same-length corrupt stored object", async () => {
    for (const corrupt of [BYTES.slice(1), new TextEncoder().encode("HELLO BLOB")]) {
      const { deps, store } = putDeps();
      const { storageKey } = await store.put({ workspaceId: WS, sha256: SHA, bytes: corrupt });
      await expect(blobPutRoute.handle({ input: putInput({ dataBase64: Buffer.from(BYTES).toString("base64") }),
        deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("Stored blob failed verification");
      expect(await store.get({ storageKey })).toEqual(corrupt);
    }
  });
  it("each writer holds the byte fence across write and publish", async () => {
    const { deps, store, writes } = putDeps();
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entry = new Promise<"entered">((resolve) => { entered = () => resolve("entered"); });
    let held = false;
    const verify = deps.verifyStoredBlob;
    deps.blobFence.withKeys = async ({ workspaceId, storageKeys, work }) => {
      expect(workspaceId).toBe(WS);
      expect(storageKeys).toEqual([computeBlobStorageKey({ workspaceId: WS, sha256: SHA })]);
      entered();
      await gate;
      held = true;
      try { return await work(); } finally { held = false; }
    };
    deps.verifyStoredBlob = async (input) => { expect(held).toBe(true); await verify(input); };
    const pending = blobPutRoute.handle({ input: putInput({ dataBase64: Buffer.from(BYTES).toString("base64") }),
      deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    try {
      expect(await Promise.race([entry, Promise.resolve(pending).then(() => "completed")])).toBe("entered");
      expect(writes).toEqual([]);
    } finally { release(); }
    expect(await pending).toEqual({ ok: true, value: { sha256: SHA, written: true } });
    expect(await store.get({ storageKey: computeBlobStorageKey({ workspaceId: WS, sha256: SHA }) })).toEqual(BYTES);
  });
  it("pins method, path, success status and no body cap", () => {
    expect([blobPutRoute.method, blobPutRoute.path, blobPutRoute.successStatus, blobPutRoute.maxBodyBytes]).toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/publish-content/blobs/:sha", undefined, undefined]);
  });
  it("refuses a malformed sha in parse and keeps the body unread", () => {
    expect(refusalOf(() => blobPutRoute.parse(raw({ workspaceId: WS, sha: "nope" }, { dataBase64: "!!" })))).toEqual({ status: 400, body: { error: "sha must be a lowercase 64-character hex sha256 digest" } });
    expect(blobPutRoute.parse(raw({ workspaceId: WS, sha: SHA }, { x: 1 }))).toEqual({ ok: true, value: { claimedSha256: SHA, rawBody: { x: 1 } } });
  });
  it("asks publish_content.apply before reading the body, and a denial writes nothing", async () => {
    const { deps, writes } = putDeps();
    const { calls, authorize } = recordingAuthorize(true);
    await expect(blobPutRoute.handle({ input: putInput(undefined), deps, context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    expect(calls).toEqual([{ permission: "publish_content.apply" }]);
    expect(writes).toEqual([]);
  });
  it("answers each body refusal with its exact status and body", async () => {
    const authorize = recordingAuthorize().authorize;
    const { deps, writes } = putDeps();
    const bad = { status: 400, body: { error: "dataBase64 is required and must be valid base64" } };
    for (const body of [undefined, {}, { dataBase64: "" }, { dataBase64: 5 }, { dataBase64: "%%%" }]) {
      expect(await refusalOfAsync(() => blobPutRoute.handle({ input: putInput(body), deps, context: PRINCIPAL, authorize }))).toEqual(bad);
    }
    expect(await refusalOfAsync(() => blobPutRoute.handle({ input: putInput({ dataBase64: Buffer.from("other").toString("base64") }), deps, context: PRINCIPAL, authorize }))).toEqual({ status: 422, body: { error: "the uploaded bytes do not hash to the claimed sha256", code: "SHA256_MISMATCH" } });
    const huge = Buffer.alloc(MAX_DOCUMENT_BYTES + 1).toString("base64");
    expect(await refusalOfAsync(() => blobPutRoute.handle({ input: putInput({ dataBase64: huge }), deps, context: PRINCIPAL, authorize }))).toEqual({ status: 413, body: { error: `blob exceeds the ${MAX_DOCUMENT_BYTES}-byte upload limit`, code: "PAYLOAD_TOO_LARGE" } });
    expect(writes).toEqual([]);
  });
  it("stores matching bytes through putIfAbsent and reports whether it wrote", async () => {
    const { deps, writes } = putDeps();
    const authorize = recordingAuthorize().authorize;
    const body = { dataBase64: Buffer.from(BYTES).toString("base64") };
    expect(await blobPutRoute.handle({ input: putInput(body), deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { sha256: SHA, written: true } });
    expect(await blobPutRoute.handle({ input: putInput(body), deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { sha256: SHA, written: false } });
    expect(writes).toEqual([{ workspaceId: WS, sha256: SHA, bytes: BYTES }, { workspaceId: WS, sha256: SHA, bytes: BYTES }]);
  });
  it("decodeBlobBytes refuses non-alphabet input instead of skipping it", () => {
    expect(decodeBlobBytes({ rawBody: { dataBase64: "aGk=" } })).toEqual(new TextEncoder().encode("hi"));
    expect(decodeBlobBytes({ rawBody: { dataBase64: "a$Gk=" } })).toBeNull();
  });
});

it("an inconsistent blob-store key does not verify or report a successful transfer", async () => {
  const { deps } = putDeps();
  const verified: unknown[] = [];
  const writes: unknown[] = [];
  await expect(blobPutRoute.handle({
    input: putInput({ dataBase64: Buffer.from(BYTES).toString("base64") }), context: PRINCIPAL,
    authorize: recordingAuthorize().authorize,
    deps: { ...deps, blobStore: { putIfAbsent: async (input) => { writes.push(input); return { storageKey: "different-key", written: true }; } },
      verifyStoredBlob: async (input) => { verified.push(input); } },
  })).rejects.toThrow(new Error("Stored blob key does not match the fenced key"));
  expect(writes).toEqual([{ workspaceId: WS, sha256: SHA, bytes: BYTES }]);
  expect(verified).toEqual([]);
});
