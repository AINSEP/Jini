import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryAssetBlobRepo, InMemoryBlobStore, InMemoryVersionedMediaRepo, type MediaRecord } from "../../index.js";
import { importMediaEntity, type ImportMediaEntityDeps } from "../import-media-entity.js";
import { bytesMatchSha256, isValidSha256Hex } from "../../../publish/transfer/blob-staging.js";

/**
 * @file Characterization of `importMediaEntity` (`../import-media-entity.ts`) in the package: the
 * source id survives the import, and the byte/slug preconditions refuse before any write. The host
 * keeps its wider suite (render, rethrow, race cases) against this same module.
 */

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const HELLO_BYTES = new TextEncoder().encode("hello world");
/** Pinned literal, not recomputed, so a hashing regression cannot rubber-stamp itself. */
const HELLO_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

function makeRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "source-asset-1", workspaceId: WORKSPACE_ID, title: "A Photo", slug: "a-photo", alt: "", caption: "", credit: "",
    source: { sha256: HELLO_SHA256 }, status: "active", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", version: 1, width: null, height: null, cssClass: null, htmlAttributes: null,
    ...overrides,
  };
}

function makeDeps() {
  let n = 0;
  return {
    mediaRepo: new InMemoryVersionedMediaRepo({}),
    assetBlobRepo: new InMemoryAssetBlobRepo({}),
    blobStore: new InMemoryBlobStore(),
    clock: { nowIso: () => "2026-09-18T00:00:00.000Z" },
    idGen: { newId: () => `generated-${++n}` },
    sha256: { isValidSha256Hex, bytesMatchSha256 },
  } satisfies ImportMediaEntityDeps;
}

test("importMediaEntity saves the row under the SOURCE id and stamps a new blob", async () => {
  const deps = makeDeps();
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.deepEqual(result, { status: "imported", id: "source-asset-1", blobWritten: true });
  assert.equal((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }))?.id, "source-asset-1");
  const blob = await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 });
  assert.equal(blob?.createdByPrincipal, "importer-1");
});

test("importMediaEntity refuses bytes that do not hash to the claimed sha256 and writes nothing", async () => {
  const deps = makeDeps();
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: new TextEncoder().encode("tampered"), blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.equal(result.status, "blocked");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
  assert.equal(await deps.assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: HELLO_SHA256 }), null);
});

test("importMediaEntity blocks a slug held by a different id", async () => {
  const deps = makeDeps();
  await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord({ id: "holder" }),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord({ id: "other" }),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.equal(result.status, "blocked");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "other" }), null);
});

test("importMediaEntity checks the staged bytes through the host's injected sha256 rule", async () => {
  // The digest rule arrives through deps (the media domain never reaches the publish transfer module);
  // a checker that refuses every claim must block the write before any repo read.
  const deps = { ...makeDeps(), sha256: { isValidSha256Hex: () => true, bytesMatchSha256: () => false } };
  const result = await importMediaEntity({ deps, input: { workspaceId: WORKSPACE_ID, record: makeRecord(),
    bytes: HELLO_BYTES, blobCreatedByPrincipal: "importer-1", baseVersion: null } });
  assert.equal(result.status, "blocked");
  assert.equal(result.status === "blocked" ? result.code : undefined, "precondition");
  assert.equal(await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "source-asset-1" }), null);
});
