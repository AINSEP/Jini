import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import type { AssetRenditionRecord, MediaRecord, TransformDefinitionRecord } from "../../media/index.js";
import { resolveSeoImageRef } from "./support/legacy-api.fixture.js";

/**
 * @file T023 — failing-first unit certification of `resolveSeoImageRef`
 * (ADR-PIPE-008 Decision §6, C-013, EC-07): valid ref -> composed URL; deleted
 * asset / unregistered transform -> `undefined` (never throws); already-
 * absolute URL -> pass-through unchanged.
 */

const WORKSPACE = "workspace-1";

function makeAsset(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "asset-1",
    workspaceId: WORKSPACE,
    title: "A photo",
    // A pre-slug row, as `media-repo.ts` reads one back (`slug: row.slug ?? row.id`); the
    // slug-keyed tests below override this with a real slug.
    slug: "asset-1",
    alt: "",
    caption: "",
    credit: "",
    source: { sha256: "abc123" },
    status: "active",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    width: null,
    height: null,
    cssClass: null,
    htmlAttributes: null,
    ...overrides,
  };
}

function makeTransformDef(overrides: Partial<TransformDefinitionRecord> = {}): TransformDefinitionRecord {
  return {
    id: "transform-1",
    workspaceId: WORKSPACE,
    name: "og",
    version: 1,
    params: { width: 1200, height: 630, fit: "cover", format: "jpeg" },
    owner: "core",
    createdAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function makeRendition(overrides: Partial<AssetRenditionRecord> = {}): AssetRenditionRecord {
  return {
    id: "rendition-1",
    workspaceId: WORKSPACE,
    assetId: "asset-1",
    transformName: "og",
    version: 1,
    storageKey: "ws/workspace-1/blobs/ab/abc123",
    createdAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

test("resolveSeoImageRef: an already-absolute URL passes through unchanged", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "https://cdn.example.com/x.jpg" });
  assert.equal(result, "https://cdn.example.com/x.jpg");
});

test("resolveSeoImageRef: a valid {assetId}:{transformName} ref composes the frozen /m/ URL", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset()] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [makeRendition()] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [makeTransformDef()] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "asset-1:og" });
  assert.ok(result);
  assert.equal(result, "/m/asset-1/og.v1/image.jpg");
});

test("resolveSeoImageRef: a deleted/missing asset resolves undefined, never throws", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [makeRendition()] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [makeTransformDef()] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "asset-1:og" });
  assert.equal(result, undefined);
});

test("resolveSeoImageRef: a trashed asset resolves undefined", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset({ status: "trashed" })] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [makeRendition()] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [makeTransformDef()] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "asset-1:og" });
  assert.equal(result, undefined);
});

test("resolveSeoImageRef: an unregistered transform name resolves undefined", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset()] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "asset-1:unregistered" });
  assert.equal(result, undefined);
});

test("resolveSeoImageRef: a registered transform with no generated rendition yet STILL composes the URL (AMENDED 2026-09-05 — EC-07's 'never generates' clause overturned; the public /m/ route always lazily generates the latest registered version, so this URL is guaranteed servable)", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset()] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [makeTransformDef()] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "asset-1:og" });
  assert.ok(result, "no rendition row yet must NOT block the URL from being emitted");
  assert.equal(result, "/m/asset-1/og.v1/image.jpg");
});

test("resolveSeoImageRef: multiple registered versions of the same transform resolve to the HIGHEST version, regardless of registration order", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset()] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [makeRendition({ id: "rendition-3", version: 3 })] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [
      makeTransformDef({ id: "transform-2", version: 2 }),
      makeTransformDef({ id: "transform-1", version: 1 }),
      makeTransformDef({ id: "transform-3", version: 3, params: { width: 1200, height: 630, fit: "cover", format: "webp" } }),
    ] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "asset-1:og" });
  assert.ok(result);
  assert.equal(result, "/m/asset-1/og.v3/image.webp");
});

test("resolveSeoImageRef: a ref built from the asset's SLUG (not its id) resolves the same way a ref built from its id does", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset({ slug: "a-photo" })] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [makeRendition()] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [makeTransformDef()] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "a-photo:og" });
  assert.ok(result, "a slug-keyed ref must resolve, the same as an id-keyed one");
  assert.equal(result, "/m/a-photo/og.v1/image.jpg");
});

test("resolveSeoImageRef: a ref built from the asset's id emits the asset's CURRENT SLUG in the URL, not the id (readable-slugs S4)", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset({ slug: "a-photo" })] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [makeRendition()] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [makeTransformDef()] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "asset-1:og" });
  assert.ok(result);
  assert.equal(result, "/m/a-photo/og.v1/image.jpg");
});

test("resolveSeoImageRef: a trashed asset resolves undefined even when looked up by its slug", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset({ slug: "a-photo", status: "trashed" })] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [makeRendition()] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [makeTransformDef()] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "a-photo:og" });
  assert.equal(result, undefined);
});

test("resolveSeoImageRef: a malformed ref (no colon) resolves undefined", async () => {
  const deps = {
    mediaRepo: new InMemoryMediaRepo({}, { initialRows: [makeAsset()] }),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
    transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
  };

  const result = await resolveSeoImageRef(deps, { workspaceId: WORKSPACE, ref: "not-a-valid-ref" });
  assert.equal(result, undefined);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
