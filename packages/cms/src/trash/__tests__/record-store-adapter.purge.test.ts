import assert from "node:assert/strict";
import { test } from "vitest";

import { MemoryRecordStore, type RecordValue } from "./fixture.js";

import { createRecordStoreTrashAdapter } from "../adapters/record-store.js";
const POST_ENTITY_TYPE = "record";

const WS = "workspace-1";
const AT = "2026-09-20T12:00:00.000Z";

function seed(): RecordValue {
  return {
    id: "post-1",
    workspaceId: WS,
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [] },
    status: "published",
    kind: "post",
    updatedAt: "2026-04-06T00:00:00.000Z",
    version: 3,
  };
}

function adapterOver(postRepo: MemoryRecordStore, optional: { withHardDelete: boolean }) {
  return createRecordStoreTrashAdapter<RecordValue>({
    entityType: POST_ENTITY_TYPE,
    store: postRepo,
    isHidden: ({ record }) => record.deletedAt !== undefined && record.deletedAt !== null,
    hidden: ({ record, at }) => ({ ...record, deletedAt: at, updatedAt: at }),
    shown: ({ record, at }) => ({ ...record, deletedAt: null, updatedAt: at }),
  }, {
    ...(optional.withHardDelete ? { hardDelete: (required) => postRepo.hardDelete(required) } : {}),
  });
}

test("the post adapter purges for real once hardDelete is wired — the row and its ledger are gone", async () => {
  const postRepo = new MemoryRecordStore([seed()]);
  const adapter = adapterOver(postRepo, { withHardDelete: true });
  const hidden = await adapter.hide({ workspaceId: WS, entityId: "post-1", at: AT, expectedVersion: 3 });
  assert.deepEqual(hidden, { ok: true, version: 4 });

  const outcome = await adapter.purge({ workspaceId: WS, entityId: "post-1", expectedVersion: 4 });

  assert.equal(outcome, "purged", "a purge that completed must say so, or the sweeper retries it forever");
  assert.equal(await postRepo.findById({ workspaceId: WS, id: "post-1" }), null, "the row must be gone");
  assert.deepEqual(await postRepo.listRevisions({ workspaceId: WS, postId: "post-1" }), []);
  assert.equal(postRepo.revisions.has("post-1"), false, "the supplied physical-delete callback removes the ledger too");
});

test("without hardDelete the same adapter still stands down rather than claiming a removal", async () => {
  const postRepo = new MemoryRecordStore([seed()]);
  const adapter = adapterOver(postRepo, { withHardDelete: false });
  await adapter.hide({ workspaceId: WS, entityId: "post-1", at: AT, expectedVersion: 3 });

  const outcome = await adapter.purge({ workspaceId: WS, entityId: "post-1", expectedVersion: 4 });

  assert.equal(outcome, "version-changed", "no row removal means no purge — never a false 'purged'");
  assert.ok(await postRepo.findById({ workspaceId: WS, id: "post-1" }), "and the row is untouched");
});

test("hide then unhide restores the stored payload and marker with a fresh timestamp and version", async () => {
  const original = { ...seed(), bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep this body" }] }] } };
  const postRepo = new MemoryRecordStore([original]);
  const adapter = adapterOver(postRepo, { withHardDelete: true });
  assert.deepEqual(await adapter.hide({ workspaceId: WS, entityId: original.id, at: AT, expectedVersion: 3 }), { ok: true, version: 4 });
  assert.deepEqual(await postRepo.findById({ workspaceId: WS, id: original.id }), { ...original, deletedAt: AT, updatedAt: AT, version: 4 });
  const restoredAt = "2026-09-21T12:00:00.000Z";
  assert.deepEqual(await adapter.unhide({ workspaceId: WS, entityId: original.id, at: restoredAt, expectedVersion: 4 }), { ok: true, version: 5 });
  assert.deepEqual(await postRepo.findById({ workspaceId: WS, id: original.id }), { ...original, deletedAt: null, updatedAt: restoredAt, version: 5 });
});
