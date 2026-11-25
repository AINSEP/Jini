/** Concurrent cases for the two writers that used to bypass the blob fence: the import's
 * find-then-put and the publish-content staging PUT, both racing an in-flight unlink. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { blobPutRoute } from "../../admin-http/routes/publish-content/blob-put.js";
import { bytesMatchSha256, isValidSha256Hex } from "../../publish/transfer/blob-staging.js";
import { computeBlobStorageKey } from "../blob-key.js";
import { InMemoryVersionedMediaRepo, type MediaRecord } from "../index.js";
import { importMediaEntity } from "../site/import-media-entity.js";
import { allClearProbes, createGate, createSharedWorld, DAY, WS } from "./support/blob-fence-harness.js";

const BYTES = new TextEncoder().encode("hello world");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const KEY = computeBlobStorageKey({ workspaceId: WS, sha256: SHA });

/** Bytes journaled for unlink, plus an unlinker paused inside the fence after its ownership reads. */
async function pausedUnlink() {
  const world = createSharedWorld();
  await world.blobStore.put({ workspaceId: WS, sha256: SHA, bytes: BYTES });
  await world.blobRepo.save({ id: "b0", workspaceId: WS, sha256: SHA, storageKey: KEY, createdByPrincipal: "u", createdAt: "2026-01-01T00:00:00.000Z", status: "tombstoned", tombstonedAt: "2026-01-01T00:00:00.000Z", purgeReason: "owner-purge" });
  world.advance(31 * DAY);
  await world.gc().deletePass({ signal: new AbortController().signal, workspaceId: WS });
  const gate = createGate();
  const unlinker = world.gc(allClearProbes({ pendingJobOwners: async () => { await gate.wait(); return []; } }));
  const unlinking = unlinker.unlinkPass({ signal: new AbortController().signal });
  await gate.reached;
  return { world, gate, unlinking, writerFence: world.gc() };
}

function record(): MediaRecord {
  return { id: "asset-1", workspaceId: WS, title: "A", slug: "a", alt: "", caption: "", credit: "", source: { sha256: SHA }, status: "active",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1, width: null, height: null, cssClass: null, htmlAttributes: null };
}

test("concurrent import of journaled bytes keeps the file", async () => {
  const { world, gate, unlinking, writerFence } = await pausedUnlink();
  const deps = { mediaRepo: new InMemoryVersionedMediaRepo({}), assetBlobRepo: world.blobRepo, blobStore: world.blobStore, blobFence: writerFence,
    clock: { nowIso: () => "2026-03-01T00:00:00.000Z" }, idGen: { newId: () => "b1" }, sha256: { isValidSha256Hex, bytesMatchSha256 },
    outwardErrorMessage: ({ error }: { error: Error }) => error.message };
  const importing = importMediaEntity({ deps, input: { workspaceId: WS, record: record(), bytes: BYTES, blobCreatedByPrincipal: "importer", baseVersion: null } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  gate.open();
  const [, imported] = await Promise.all([unlinking, importing]);
  assert.equal((imported as { status: string }).status, "imported");
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
  assert.equal((await world.blobRepo.findByHash({ workspaceId: WS, sha256: SHA }))?.status, "active");
});

test("concurrent import resurrects a tombstone instead of trusting it", async () => {
  const world = createSharedWorld();
  await world.blobStore.put({ workspaceId: WS, sha256: SHA, bytes: BYTES });
  await world.blobRepo.save({ id: "b0", workspaceId: WS, sha256: SHA, storageKey: KEY, createdByPrincipal: "u", createdAt: "2026-01-01T00:00:00.000Z", status: "tombstoned", tombstonedAt: "2026-01-01T00:00:00.000Z", purgeReason: "owner-purge" });
  const deps = { mediaRepo: new InMemoryVersionedMediaRepo({}), assetBlobRepo: world.blobRepo, blobStore: world.blobStore, blobFence: world.gc(),
    clock: { nowIso: () => "2026-03-01T00:00:00.000Z" }, idGen: { newId: () => "b1" }, sha256: { isValidSha256Hex, bytesMatchSha256 },
    outwardErrorMessage: ({ error }: { error: Error }) => error.message };
  await importMediaEntity({ deps, input: { workspaceId: WS, record: record(), bytes: BYTES, blobCreatedByPrincipal: "importer", baseVersion: null } });
  world.advance(400 * DAY);
  assert.deepEqual((await world.gc().deletePass({ signal: new AbortController().signal, workspaceId: WS })).map((r) => r.reason), []);
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
});

test("concurrent publish-content blob PUT of journaled bytes keeps the file", async () => {
  const { world, gate, unlinking, writerFence } = await pausedUnlink();
  const deps = { workspaceId: WS, maxUploadBytes: 1024, blobStore: world.blobStore, blobFence: writerFence };
  const putting = blobPutRoute.handle({ input: { claimedSha256: SHA, rawBody: { dataBase64: Buffer.from(BYTES).toString("base64") } }, deps, context: { id: "u1" }, authorize: async () => {} } as never);
  await new Promise((resolve) => setTimeout(resolve, 5));
  gate.open();
  await Promise.all([unlinking, putting]);
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
  assert.equal(world.journal.rows.size, 0);
});
