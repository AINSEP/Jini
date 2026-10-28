import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import type { ToolExecutionContext } from "@jini-ai/core";

import { buildMediaRegistrations, type MediaToolDeps } from "../tool-registrations.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES } from "../html-attributes.js";
import type { MediaRecord } from "../types.js";
import { uploadMedia } from "../media-service.js";

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
  const mediaRepo = new InMemoryMediaRepo({});
  const assetBlobRepo = new InMemoryAssetBlobRepo({});
  const assetRenditionRepo = new InMemoryAssetRenditionRepo({});
  let counter = 0;
  const deps: MediaToolDeps = {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    workspaceId: WORKSPACE_ID,
    clock: { nowMs: () => Date.parse(NOW)},
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload);

  await assert.rejects(
    () => upload.handler(executionContext({ dataBase64: PNG_BYTES.toString("base64"), filename: "logo.png", contentType: "image/png" })),
    /content-type store unavailable/
  );
});

/**
 * Covers `MediaToolDeps.maxUploadBytes` (2026-09-21) — a host-supplied override of
 * `uploadMedia`'s own `DEFAULT_MAX_UPLOAD_BYTES` (10 MiB), forwarded from `media_upload_asset`'s
 * handler as `uploadMedia`'s third (`optional`) argument. Before this fix the handler called
 * `uploadMedia({ deps, input })` with no third argument at all, so every host's assistant upload
 * tool was hard-capped at 10 MiB regardless of what cap the host's own HTTP upload route enforced.
 */
const ELEVEN_MIB = 11 * 1024 * 1024;

test("media_upload_asset accepts a file over the 10 MiB default when the host supplies a higher maxUploadBytes cap", async () => {
  const { deps } = fakeDeps({ maxUploadBytes: 20 * 1024 * 1024 });
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload, "media_upload_asset must be wired");

  const bigBytes = Buffer.alloc(ELEVEN_MIB, 0xab);
  const result = (await upload.handler(
    executionContext({ dataBase64: bigBytes.toString("base64"), filename: "big.png", contentType: "image/png" })
  )) as { media: { id: string } };

  assert.ok(result.media.id, "an 11 MiB upload must succeed once the host's maxUploadBytes cap is 20 MiB");
});

test("media_upload_asset still rejects a file over 10 MiB when the host supplies no maxUploadBytes cap (today's default, unchanged)", async () => {
  const { deps } = fakeDeps(); // no maxUploadBytes override
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
  const upload = registrations.find((r) => r.descriptor.id === "media_upload_asset");
  assert.ok(upload);

  const bigBytes = Buffer.alloc(ELEVEN_MIB, 0xab);
  await assert.rejects(
    () => upload.handler(executionContext({ dataBase64: bigBytes.toString("base64"), filename: "big.png", contentType: "image/png" })),
    /exceeds/
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
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
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
  const update = registrations.find((r) => r.descriptor.id === "media_update_metadata");
  assert.ok(update);

  const schema = update.descriptor.inputSchema as { properties: Record<string, { description?: string }> };
  assert.ok(schema.properties.cssClass, "cssClass must be published in the schema");
  assert.ok(schema.properties.htmlAttributes, "htmlAttributes must be published in the schema");
  for (const name of MEDIA_HTML_ATTRIBUTE_ALLOWED_NAMES) {
    assert.ok(schema.properties.htmlAttributes!.description?.includes(name), `htmlAttributes description must name '${name}'`);
  }
});

/**
 * Covers `media_update_metadata`'s 2026-09-16 `slug` field and every media tool view's new `slug`
 * field (owner report: the assistant said "media assets have no slug field at all", which was false
 * — `MediaRecord.slug` shipped 2026-09-07 but no tool view ever returned it).
 */
test("media tool views include the asset slug", async () => {
  const { deps } = fakeDeps();
  const mediaId = await seedAsset(deps);
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
  const list = registrations.find((r) => r.descriptor.id === "media_list_assets");
  assert.ok(list);

  const result = (await list.handler(executionContext({}))) as { media: Array<{ id: string; slug: string }> };
  const row = result.media.find((m) => m.id === mediaId);
  assert.ok(row, "the seeded asset must appear in the list");
  assert.ok(row!.slug, "every media tool view must carry a non-empty slug");
});

test("media_update_metadata changes the slug", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const mediaId = await seedAsset(deps);
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
  const update = registrations.find((r) => r.descriptor.id === "media_update_metadata");
  assert.ok(update);

  const result = (await update.handler(executionContext({ mediaId, slug: "sample-commercial-edit" }))) as { media: { slug: string } };
  assert.equal(result.media.slug, "sample-commercial-edit");

  const row = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: mediaId });
  assert.equal(row?.slug, "sample-commercial-edit");
});

test("media_update_metadata refuses a slug another asset already uses and writes nothing", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const firstId = await seedAsset(deps);
  const secondId = await seedAsset(deps);
  const registrations = buildMediaRegistrations(deps, { resolvePublicUrls: deps.resolvePublicUrls, recordUploadContentType: deps.recordUploadContentType, maxUploadBytes: deps.maxUploadBytes });
  const update = registrations.find((r) => r.descriptor.id === "media_update_metadata");
  assert.ok(update);

  await update.handler(executionContext({ mediaId: firstId, slug: "taken-slug" }));
  const before = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: secondId });

  await assert.rejects(
    () => update.handler(executionContext({ mediaId: secondId, slug: "taken-slug" })),
    /taken-slug.*already used/
  );

  const after = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: secondId });
  assert.equal(after?.version, before?.version, "a refused slug conflict must leave the row's version unchanged");
});

function tool(deps: MediaToolDeps, id: string, optional: Parameters<typeof buildMediaRegistrations>[1] = {}) {
  const found = buildMediaRegistrations(deps, optional).find((r) => r.descriptor.id === id);
  assert.ok(found, `${id} must be wired`);
  return found;
}

async function seedDocument(deps: MediaToolDeps, filename: string, body: string): Promise<MediaRecord> {
  const { media } = await uploadMedia({
    deps: { clock: deps.clock, idGen: deps.idGen, mediaRepo: deps.mediaRepo, blobRepo: deps.assetBlobRepo, renditionRepo: deps.assetRenditionRepo, blobStore: deps.blobStore },
    input: { workspaceId: WORKSPACE_ID, kind: "document", filename, contentType: "application/octet-stream", bytes: Buffer.from(body), createdByPrincipal: "uploader" },
  });
  return media;
}

test("library_list lists only active documents, with display filename, content type and stored byte size", async () => {
  const { deps } = fakeDeps();
  const guide = await seedDocument(deps, "guide.md", "# Guide\n");
  const trashed = await seedDocument(deps, "old.txt", "old");
  await tool(deps, "media_trash_asset").handler(executionContext({ mediaId: trashed.id }));
  await seedAsset(deps);
  const result = await tool(deps, "library_list").handler(executionContext({}));
  assert.deepEqual(result, { documents: [{
    id: guide.id, title: "guide", filename: "guide.md", originalFilename: "guide.md", contentType: "text/markdown",
    byteSize: 8, createdAt: NOW, createdBy: "uploader", publicUrl: null, source: { kind: 'upload' },
  }], nextCursor: null });
});

test("library_list reports an unknown byte size when the blob row is gone or the store cannot size blobs", async () => {
  const { deps, assetBlobRepo } = fakeDeps();
  const kept = await seedDocument(deps, "kept.md", "kept");
  const orphan = await seedDocument(deps, "orphan.md", "orphan");
  await assetBlobRepo.remove({ workspaceId: WORKSPACE_ID, sha256: orphan.source.sha256 });
  const sizes = (result: unknown) => (result as { documents: Array<{ id: string; byteSize: number | null }> }).documents.map((d) => [d.id, d.byteSize]);
  assert.deepEqual(sizes(await tool(deps, "library_list").handler(executionContext({}))), [[kept.id, 4], [orphan.id, null]]);
  const store = new InMemoryBlobStore();
  const unsized = { put: store.put.bind(store), putIfAbsent: store.putIfAbsent.bind(store), get: store.get.bind(store), exists: store.exists.bind(store), remove: store.remove.bind(store) };
  assert.deepEqual(sizes(await tool({ ...deps, blobStore: unsized }, "library_list").handler(executionContext({}))), [[kept.id, null], [orphan.id, null]]);
});

test("library_read returns a document's untrusted text, and a bad offset or unknown id is rejected with the tool schema attached", async () => {
  const { deps } = fakeDeps();
  const guide = await seedDocument(deps, "guide.md", "# Guide\n");
  const read = tool(deps, "library_read");
  const result = await read.handler(executionContext({ documentId: guide.id })) as { text: string; untrusted: boolean };
  assert.equal(result.text, "# Guide\n");
  assert.equal(result.untrusted, true);
  await assert.rejects(read.handler(executionContext({ documentId: guide.id, offset: "2" })), /offset must be a non-negative byte offset[\s\S]*Schema for 'library_read'/);
  await assert.rejects(read.handler(executionContext({ documentId: "missing" })), /document was not found[\s\S]*Schema for 'library_read'/);
});

test("media_trash_asset soft-deletes the asset and returns its trashed view", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const mediaId = await seedAsset(deps);
  const result = await tool(deps, "media_trash_asset").handler(executionContext({ mediaId })) as { media: { id: string; status: string } };
  assert.equal(result.media.id, mediaId);
  assert.equal(result.media.status, "trashed");
  assert.equal((await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: mediaId }))?.status, "trashed");
});

test("media_upload_asset and media_update_metadata carry string text fields through; an update ignores non-string ones", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const uploaded = await tool(deps, "media_upload_asset").handler(executionContext({
    dataBase64: PNG_BYTES.toString("base64"), filename: "logo.png", contentType: "image/png", alt: " Logo ", caption: "Cap", credit: "Me",
  })) as { media: { id: string; alt: string; caption: string; credit: string } };
  assert.deepEqual([uploaded.media.alt, uploaded.media.caption, uploaded.media.credit], ["Logo", "Cap", "Me"]);
  const updated = await tool(deps, "media_update_metadata").handler(executionContext({
    mediaId: uploaded.media.id, title: "Brand", alt: "Alt", caption: "New caption", credit: "Studio",
  })) as { media: { title: string; alt: string; caption: string; credit: string } };
  assert.deepEqual([updated.media.title, updated.media.alt, updated.media.caption, updated.media.credit], ["Brand", "Alt", "New caption", "Studio"]);
  const ignored = await tool(deps, "media_update_metadata").handler(executionContext({ mediaId: uploaded.media.id, title: 1, alt: null })) as { media: { title: string; alt: string } };
  assert.deepEqual([ignored.media.title, ignored.media.alt], ["Brand", "Alt"]);
  assert.equal((await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: uploaded.media.id }))?.credit, "Studio");
});

test("media views resolve publicUrl through the host's batch resolver and show unknown attribution as null", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const mediaId = await seedAsset(deps);
  const seeded = await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: mediaId });
  const { createdBy: _createdBy, ...legacy } = seeded!;
  await mediaRepo.remove({ workspaceId: WORKSPACE_ID, id: mediaId });
  await mediaRepo.save(legacy);
  const batches: string[][] = [];
  const resolvePublicUrls = async ({ assets }: { assets: readonly MediaRecord[] }) => {
    batches.push(assets.map((asset) => asset.id));
    return new Map([[mediaId, `https://cdn.example/${mediaId}.png`]]);
  };
  const result = await tool(deps, "media_list_assets", { resolvePublicUrls }).handler(executionContext({})) as { media: Array<{ id: string; createdBy: string | null; publicUrl: string | null }> };
  assert.deepEqual(batches, [[mediaId]]);
  assert.deepEqual(result.media.map(({ id, createdBy, publicUrl }) => ({ id, createdBy, publicUrl })), [{ id: mediaId, createdBy: null, publicUrl: `https://cdn.example/${mediaId}.png` }]);
});

test("library_list shows unknown attribution as null and refuses to guess a type for a document row with no original filename", async () => {
  const { deps, mediaRepo } = fakeDeps();
  const guide = await seedDocument(deps, "guide.md", "# Guide\n");
  const { createdBy: _createdBy, ...unattributed } = guide;
  // Kind, filename and creator are preserved on save, so these legacy rows are seeded directly.
  const legacy = new InMemoryMediaRepo({}, { initialRows: [unattributed] });
  const listed = await tool({ ...deps, mediaRepo: legacy }, "library_list").handler(executionContext({})) as { documents: Array<{ createdBy: string | null }> };
  assert.deepEqual(listed.documents.map((d) => d.createdBy), [null]);
  const { originalFilename: _name, ...nameless } = guide;
  const broken = new InMemoryMediaRepo({}, { initialRows: [nameless] });
  await assert.rejects(tool({ ...deps, mediaRepo: broken }, "library_list").handler(executionContext({})), /document filename must be a plain filename/);
  assert.equal((await mediaRepo.list({ workspaceId: WORKSPACE_ID })).length, 1);
});
