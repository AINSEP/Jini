import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import type { ToolExecutionContext } from "@jini-ai/core";

import { buildMediaRegistrations, type MediaToolDeps } from "../tool-registrations.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES } from "../html-attributes.js";
import type { MediaRecord } from "../types.js";

/**
 * Covers `media_upload_asset`'s {@link MediaToolDeps.recordUploadContentType} hook — the fix for the
 * defect where an asset uploaded through this tool never had ANY content type recorded anywhere
 * (`uploadMedia`/`AssetBlobRecord` deliberately carry no such field — see `media-service.ts`'s own
 * file header), unlike `media_generate_asset` and the HTTP admin upload route, both of which record
 * one through a host-owned content-type store. See this file's sibling `resolvePublicUrls` coverage
 * pattern (`buildMediaRegistrations`'s own header) for why this is another OPTIONAL, host-injected
 * hook rather than a hard dependency: a host with no such store must keep compiling and behaving
 * exactly as before (hook omitted -> never called -> `publicUrl`'s own precedent for "omitted stays
 * silent, no throw").
 */

const WORKSPACE_ID = "ws-media-tool-registrations";
const PRINCIPAL_ID = "principal-under-test";
const NOW = "2026-09-02T00:00:00.000Z";

function executionContext(input: Record<string, unknown>): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, input, signal: new AbortController().signal };
}

function fakeDeps(
  overrides: Partial<MediaToolDeps> = {}
): { deps: MediaToolDeps; mediaRepo: InMemoryMediaRepo; assetBlobRepo: InMemoryAssetBlobRepo; assetRenditionRepo: InMemoryAssetRenditionRepo } {
  const mediaRepo = new InMemoryMediaRepo();
  const assetBlobRepo = new InMemoryAssetBlobRepo();
  const assetRenditionRepo = new InMemoryAssetRenditionRepo();
  let counter = 0;
  const deps: MediaToolDeps = {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    workspaceId: WORKSPACE_ID,
    clock: { nowIso: () => NOW },
    idGen: { newId: () => `id-${++counter}` },
    mediaRepo,
    assetBlobRepo,
    assetRenditionRepo,
    blobStore: new InMemoryBlobStore(),
    ...overrides,
  };
  return { deps, mediaRepo, assetBlobRepo, assetRenditionRepo };
}

// A real PNG signature so a future sniff-based assertion has genuine magic bytes to check, not an
// arbitrary string — mirrors `media-generation`'s own `FAKE_PNG_BYTES` convention, but with a real
// leading signature rather than an arbitrary string, since Defect 2's whole point is bytes vs.
// declared-string fidelity.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);

test("media_upload_asset calls recordUploadContentType with the uploaded bytes and the saved media row, when the hook is provided", async () => {
  const recorded: Array<{ media: MediaRecord; bytes: Uint8Array }> = [];
  const { deps } = fakeDeps({
    recordUploadContentType: async (params) => {
      recorded.push(params);
    },
  });
  const registrations = buildMediaRegistrations(deps);
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload, "media_upload_asset must be wired");

  const result = (await upload.handler(
    executionContext({ dataBase64: PNG_BYTES.toString("base64"), filename: "logo.png", contentType: "image/png" })
  )) as { media: { id: string } };

  assert.equal(recorded.length, 1, "the hook must be called exactly once per upload");
  assert.equal(recorded[0]!.media.id, result.media.id, "the hook must receive the SAME media row the tool just saved");
  assert.deepEqual(Buffer.from(recorded[0]!.bytes), PNG_BYTES, "the hook must receive the exact uploaded bytes, not a re-derived or re-encoded copy");
});

test("media_upload_asset without the hook configured behaves exactly as before — no throw, upload still succeeds", async () => {
  const { deps } = fakeDeps(); // no recordUploadContentType at all
  const registrations = buildMediaRegistrations(deps);
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload);

  const result = (await upload.handler(
    executionContext({ dataBase64: PNG_BYTES.toString("base64"), filename: "logo.png", contentType: "image/png" })
  )) as { media: { id: string } };

  assert.ok(result.media.id, "upload must still succeed when no host has opted into content-type recording");
});

test("a hook that throws propagates — an upload must not be silently reported successful if recording the type fails", async () => {
  const { deps } = fakeDeps({
    recordUploadContentType: async () => {
      throw new Error("content-type store unavailable");
    },
  });
  const registrations = buildMediaRegistrations(deps);
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload);

  await assert.rejects(
    () => upload.handler(executionContext({ dataBase64: PNG_BYTES.toString("base64"), filename: "logo.png", contentType: "image/png" })),
    /content-type store unavailable/
  );
});

test("a hook that throws AFTER uploadMedia() commits does not leave the media/rendition/blob rows orphaned", async () => {
  let uploadedMediaId: string | undefined;
  const { deps, mediaRepo, assetBlobRepo, assetRenditionRepo } = fakeDeps({
    recordUploadContentType: async (params) => {
      uploadedMediaId = params.media.id;
      throw new Error("content-type store unavailable");
    },
  });
  const registrations = buildMediaRegistrations(deps);
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload);

  await assert.rejects(
    () => upload.handler(executionContext({ dataBase64: PNG_BYTES.toString("base64"), filename: "logo.png", contentType: "image/png" })),
    /content-type store unavailable/
  );
  assert.ok(uploadedMediaId, "the hook must have run (and therefore uploadMedia() must have committed) before the throw");

  const sha256 = createHash("sha256").update(PNG_BYTES).digest("hex");

  assert.deepEqual(
    await mediaRepo.list({ workspaceId: WORKSPACE_ID }),
    [],
    "the media row uploadMedia() wrote must be rolled back when the post-upload hook fails"
  );

  assert.deepEqual(
    await assetRenditionRepo.listByAsset({ workspaceId: WORKSPACE_ID, assetId: uploadedMediaId! }),
    [],
    "the rendition row uploadMedia() wrote must be rolled back too"
  );

  const blob = await assetBlobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256 });
  assert.ok(
    blob === null || blob.status === "tombstoned",
    "the orphaned blob must be removed or tombstoned, never left 'active' with nothing pointing at it"
  );
});

/**
 * Covers `media_update_metadata`'s 2026-09-16 `cssClass`/`htmlAttributes` fields (item 1 — an
 * assistant can set a media asset's presentation, enforced through the same allowlist
 * `html-attributes.ts` gives the render path).
 */
async function seedAsset(deps: MediaToolDeps): Promise<string> {
  const registrations = buildMediaRegistrations(deps);
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload, "media_upload_asset must be wired");
  const result = (await upload.handler(
    executionContext({ dataBase64: PNG_BYTES.toString("base64"), filename: "logo.png", contentType: "image/png" })
  )) as { media: { id: string } };
  return result.media.id;
}

test("media_update_metadata writes htmlAttributes through the allowlist and returns it on the view", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const mediaId = await seedAsset(deps);
  const registrations = buildMediaRegistrations(deps);
  const update = registrations.find((r) => r.descriptor.id === "media_update_metadata");
  assert.ok(update, "media_update_metadata must be wired");

  const result = (await update.handler(
    executionContext({ mediaId, htmlAttributes: "autoplay muted loop playsinline" })
  )) as { media: { htmlAttributes: string | null } };

  assert.equal(result.media.htmlAttributes, "autoplay muted loop playsinline");
  const row = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: mediaId });
  assert.equal(row?.htmlAttributes, "autoplay muted loop playsinline");
});

test("media_update_metadata rejects an on* handler and writes nothing", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const mediaId = await seedAsset(deps);
  const registrations = buildMediaRegistrations(deps);
  const update = registrations.find((r) => r.descriptor.id === "media_update_metadata");
  assert.ok(update);
  const before = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: mediaId });

  await assert.rejects(() => update.handler(executionContext({ mediaId, htmlAttributes: 'onerror="x"' })), (error: unknown) => {
    const message = (error as Error).message;
    assert.match(message, /event handler attributes like 'onerror'/);
    assert.match(message, /"additionalProperties":false/);
    return true;
  });

  const after = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: mediaId });
  assert.equal(after?.version, before?.version, "a rejected write must leave the row's version unchanged");
});

test("media_update_metadata sets and clears cssClass", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const mediaId = await seedAsset(deps);
  const registrations = buildMediaRegistrations(deps);
  const update = registrations.find((r) => r.descriptor.id === "media_update_metadata");
  assert.ok(update);

  const set = (await update.handler(executionContext({ mediaId, cssClass: "hero wide" }))) as { media: { cssClass: string | null } };
  assert.equal(set.media.cssClass, "hero wide");

  const cleared = (await update.handler(executionContext({ mediaId, cssClass: "" }))) as { media: { cssClass: string | null } };
  assert.equal(cleared.media.cssClass, null);

  const row = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: mediaId });
  assert.equal(row?.cssClass, null);
});

test("media_update_metadata publishes cssClass and htmlAttributes in its schema, naming every allowlisted attribute", async () => {
  const { deps } = fakeDeps();
  const registrations = buildMediaRegistrations(deps);
  const update = registrations.find((r) => r.descriptor.id === "media_update_metadata");
  assert.ok(update);

  const schema = update.descriptor.inputSchema as { properties: Record<string, { description?: string }> };
  assert.ok(schema.properties.cssClass, "cssClass must be published in the schema");
  assert.ok(schema.properties.htmlAttributes, "htmlAttributes must be published in the schema");
  for (const name of MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES) {
    assert.ok(schema.properties.htmlAttributes!.description?.includes(name), `htmlAttributes description must name '${name}'`);
  }
});
