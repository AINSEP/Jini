import { expect, it } from "vitest";

import { CONTENT_HASH_VERSION } from "../content-hash.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../transfer/index.js";
import {
  applyPublishScope,
  includeReferencedEntities,
  selectBundleEntities,
  type PublishContentExportEnvelope,
  type ReferenceHandlers,
} from "../export-bundle.js";
import { collectBodyReferences } from "../content-references.js";
import { entityKey } from "../plan-rows.js";
import type { PackedEntity } from "../../transfer/index.js";

/**
 * @file `selectBundleEntities` — the point at which an operator unchecking a row in the Publish
 * Content dialog stops being a UI state and becomes a fact about what the destination is given
 * (owner-directed, 2026-09-19).
 *
 * The property under test is the reason the selection is applied HERE rather than at apply time: a
 * deselected entity must be absent from the bundle, not merely skipped by something downstream. The
 * blob-manifest assertions matter for the same reason — the bytes of a deselected image must not be
 * uploaded to the live site either.
 */

function entity(over: { entityType: string; id: string; requiredBlobs?: readonly string[] }): PackedEntity {
  return {
    entityType: over.entityType,
    id: over.id,
    schemaVersion: 1,
    contentHash: `hash-${over.id}`,
    hashVersion: CONTENT_HASH_VERSION,
    requiredBlobs: over.requiredBlobs ?? [],
    state: { slug: over.id },
  };
}

const ENVELOPE: PublishContentExportEnvelope = {
  artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION,
  hashVersion: CONTENT_HASH_VERSION,
  sourceLabel: "Example Site",
  entities: [
    entity({ entityType: "media", id: "m1", requiredBlobs: ["sha-a"] }),
    entity({ entityType: "media", id: "m2", requiredBlobs: ["sha-b"] }),
    entity({ entityType: "post", id: "p1" }),
  ],
  blobManifest: ["sha-a", "sha-b"],
  skipped: [],
};

it("keeps exactly the selected entities and drops every other one", () => {
  const narrowed = selectBundleEntities({ envelope: ENVELOPE, selectedKeys: new Set([entityKey({ entityType: "media", entityId: "m1" }), entityKey({ entityType: "post", entityId: "p1" })]) });

  expect(narrowed.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id }))).toStrictEqual(["media:m1", "post:p1"]);
  expect(narrowed.entities.length, "the deselected entity is absent, not marked").toBe(2);
});

it("recomputes the blob manifest so a deselected asset's bytes are never uploaded", () => {
  const narrowed = selectBundleEntities({ envelope: ENVELOPE, selectedKeys: new Set([entityKey({ entityType: "media", entityId: "m1" })]) });

  expect(narrowed.blobManifest).toStrictEqual(["sha-a"]);
  expect(!narrowed.blobManifest.includes("sha-b"), "the deselected media's bytes must not travel").toBeTruthy();
});

it("an empty selection produces an empty bundle, not the whole corpus", () => {
  // "The operator unchecked everything" and "the operator expressed no preference" are different
  // answers; only the CALLER can tell them apart, so this function never treats one as the other.
  const narrowed = selectBundleEntities({ envelope: ENVELOPE, selectedKeys: new Set() });

  expect(narrowed.entities).toStrictEqual([]);
  expect(narrowed.blobManifest).toStrictEqual([]);
});

it("a key naming nothing in the bundle adds nothing to it", () => {
  const narrowed = selectBundleEntities({ envelope: ENVELOPE, selectedKeys: new Set(["post:p1", "post:does-not-exist"]) });

  expect(narrowed.entities.map((e) => e.id)).toStrictEqual(["p1"]);
});

it("never narrows `skipped` — a skipped unit was never selectable in the first place", () => {
  const withSkipped: PublishContentExportEnvelope = {
    ...ENVELOPE,
    skipped: [{ entityType: "theme-files", id: "static/x", label: "static/x", reason: "blocked" }],
  };
  const narrowed = selectBundleEntities({ envelope: withSkipped, selectedKeys: new Set(["post:p1"]) });
  expect(narrowed.skipped).toStrictEqual(withSkipped.skipped);
});

it("carries the envelope's own versions and label through untouched", () => {
  const narrowed = selectBundleEntities({ envelope: ENVELOPE, selectedKeys: new Set(["post:p1"]) });

  expect(narrowed.artifactFormatVersion).toBe(ENVELOPE.artifactFormatVersion);
  expect(narrowed.hashVersion).toBe(ENVELOPE.hashVersion);
  expect(narrowed.sourceLabel).toBe(ENVELOPE.sourceLabel);
  expect(narrowed.entities, "the original envelope is never mutated").not.toBe(ENVELOPE.entities);
  expect(ENVELOPE.entities.length).toBe(3);
});

/**
 * @file `applyPublishScope` — `plan-publish-sections-2026-09-25.md` S1. Narrows an export envelope to
 * a section (or a section plus specific rows) BEFORE `selectBundleEntities` runs, so a "Publish pages"
 * dialog never even stages a media blob. `entityTypes` and `entityKeys` both narrow (AND) when both
 * are given. `skipped` is narrowed by the SAME predicate — a refused theme tree only appears in a
 * theme-files-scoped plan, never a pages-scoped one.
 */
const SKIPPED_THEME = { entityType: "theme-files", id: "static/x", label: "Theme: static/x", reason: "blocked" };

const SCOPED_ENVELOPE: PublishContentExportEnvelope = {
  ...ENVELOPE,
  skipped: [SKIPPED_THEME],
};

it("applyPublishScope with entityTypes keeps only that type, and recomputes blobManifest", () => {
  const scoped = applyPublishScope({ envelope: SCOPED_ENVELOPE, scope: { entityTypes: ["post"] } });

  expect(scoped.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id }))).toStrictEqual(["post:p1"]);
  expect(scoped.blobManifest, "post p1 has no requiredBlobs").toStrictEqual([]);
});

it("applyPublishScope with entityTypes shrinks the blob manifest to the kept type's blobs", () => {
  const scoped = applyPublishScope({ envelope: SCOPED_ENVELOPE, scope: { entityTypes: ["media"] } });

  expect(scoped.entities.map((e) => e.id)).toStrictEqual(["m1", "m2"]);
  expect(scoped.blobManifest).toStrictEqual(["sha-a", "sha-b"]);
});

it("applyPublishScope with entityKeys keeps only those exact rows", () => {
  const scoped = applyPublishScope({ envelope: SCOPED_ENVELOPE, scope: { entityKeys: [entityKey({ entityType: "media", entityId: "m1" })] } });

  expect(scoped.entities.map((e) => e.id)).toStrictEqual(["m1"]);
  expect(scoped.blobManifest).toStrictEqual(["sha-a"]);
});

it("applyPublishScope with both entityTypes and entityKeys ANDs them", () => {
  // A key from a type not in `entityTypes` matches nothing.
  const scoped = applyPublishScope({
                                     envelope: SCOPED_ENVELOPE,
                                     scope: {
      entityTypes: ["post"],
      entityKeys: [entityKey({ entityType: "media", entityId: "m1" }), entityKey({ entityType: "post", entityId: "p1" })],
    }
                                   });

  expect(scoped.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id }))).toStrictEqual(["post:p1"]);
});

it("applyPublishScope filters `skipped` by the same scope — present under its own type", () => {
  const scoped = applyPublishScope({ envelope: SCOPED_ENVELOPE, scope: { entityTypes: ["theme-files"] } });
  expect(scoped.skipped).toStrictEqual([SKIPPED_THEME]);
});

it("applyPublishScope filters `skipped` by the same scope — absent under a different type", () => {
  const scoped = applyPublishScope({ envelope: SCOPED_ENVELOPE, scope: { entityTypes: ["page"] } });
  expect(scoped.skipped).toStrictEqual([]);
});

it("applyPublishScope carries envelope metadata through untouched and never mutates the input", () => {
  const scoped = applyPublishScope({ envelope: SCOPED_ENVELOPE, scope: { entityTypes: ["post"] } });

  expect(scoped.artifactFormatVersion).toBe(SCOPED_ENVELOPE.artifactFormatVersion);
  expect(scoped.hashVersion).toBe(SCOPED_ENVELOPE.hashVersion);
  expect(scoped.sourceLabel).toBe(SCOPED_ENVELOPE.sourceLabel);
  expect(SCOPED_ENVELOPE.entities.length, "the original envelope is never mutated").toBe(3);
  expect(SCOPED_ENVELOPE.skipped.length, "the original envelope is never mutated").toBe(1);
});

/**
 * @file `includeReferencedEntities` — owner decision 2026-09-25 ("images go along with pages and
 * posts"), generalized by plan G3: a scoped run carries along what its in-scope rows use, and nothing
 * else. Matched by id OR slug (a `/m/{slug}/…` URL), never adding a row the narrowed bundle already
 * holds, and following carried rows' own references.
 */
function stated(entityType: string, id: string, state: Record<string, unknown>, requiredBlobs: readonly string[] = []): PackedEntity {
  return { ...entity({ entityType, id, requiredBlobs }), state };
}

const bodyReferences = { references: ({ entity: e }: { entity: PackedEntity }) => collectBodyReferences({ state: e.state }) };
const REF_HANDLERS: ReferenceHandlers = new Map([
  ["page", bodyReferences],
  ["post", bodyReferences],
]);

const REF_SOURCE: PublishContentExportEnvelope = {
  ...ENVELOPE,
  entities: [
    stated("media", "m1", { slug: "logo" }, ["sha-a"]),
    stated("media", "m2", { slug: "hero" }, ["sha-b"]),
    stated("media", "m3", { slug: "unused" }, ["sha-c"]),
    stated("page", "pg1", { bodyJson: { type: "doc", content: [{ type: "image", attrs: { assetId: "m1" } }] } }),
    stated("page", "pg2", { bodyHtml: `<img src="/m/hero/original">`, seoExtJson: JSON.stringify({ ogImage: "m1:public" }) }),
    stated("redirect", "r1", { bodyJson: { type: "doc", content: [{ type: "image", attrs: { assetId: "m3" } }] } }),
  ],
  blobManifest: ["sha-a", "sha-b", "sha-c"],
};

it('gallery image dependencies and their blobs accompany a scoped page export', () => {
  const source: PublishContentExportEnvelope = {
    ...REF_SOURCE,
    entities: [...REF_SOURCE.entities.filter(e => e.entityType === 'media'), stated('page', 'gallery-page', {
      bodyHtml: `<div data-embed-config='{"type":"gallery","layout":"grid","images":[{"mediaId":"m1","alt":"Logo"},{"mediaId":"m2","alt":"Hero"},{"mediaId":"m1","alt":"Again"}]}'></div>`,
    })],
  };
  const { envelope, includedFor } = includeReferencedEntities({ envelope: applyPublishScope({ envelope: source, scope: { entityTypes: ['page'] } }), source, handlers: REF_HANDLERS });
  expect(envelope.entities.map(e => entityKey({ entityType: e.entityType, entityId: e.id })).sort()).toStrictEqual(['media:m1', 'media:m2', 'page:gallery-page']);
  expect([...envelope.blobManifest].sort()).toStrictEqual(['sha-a', 'sha-b']);
  expect(Object.fromEntries(includedFor)).toStrictEqual({ 'media:m1': ['page:gallery-page'], 'media:m2': ['page:gallery-page'] });
});

it("includeReferencedEntities adds exactly the media the kept pages reference, by id or slug", () => {
  const scoped = applyPublishScope({ envelope: REF_SOURCE, scope: { entityTypes: ["page"] } });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: scoped, source: REF_SOURCE, handlers: REF_HANDLERS });

  expect(envelope.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id })).sort()).toStrictEqual(["media:m1", "media:m2", "page:pg1", "page:pg2"]);
  expect(envelope.blobManifest.slice().sort(), "an unreferenced asset's bytes never travel").toStrictEqual(["sha-a", "sha-b"]);
  expect(Object.fromEntries(includedFor)).toStrictEqual({ "media:m1": ["page:pg1", "page:pg2"], "media:m2": ["page:pg2"] });
});

it("includeReferencedEntities follows the operator's row selection — a deselected page brings nothing", () => {
  const scoped = applyPublishScope({ envelope: REF_SOURCE, scope: { entityTypes: ["page"] } });
  const selected = selectBundleEntities({ envelope: scoped, selectedKeys: new Set([entityKey({ entityType: "page", entityId: "pg1" })]) });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: selected, source: REF_SOURCE, handlers: REF_HANDLERS });

  expect(envelope.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id })).sort()).toStrictEqual(["media:m1", "page:pg1"]);
  expect(Object.fromEntries(includedFor)).toStrictEqual({ "media:m1": ["page:pg1"] });
});

it("includeReferencedEntities never reads references off a type whose handler has no references()", () => {
  const scoped = applyPublishScope({ envelope: REF_SOURCE, scope: { entityTypes: ["redirect"] } });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: scoped, source: REF_SOURCE, handlers: REF_HANDLERS });

  expect(envelope.entities.map((e) => e.id)).toStrictEqual(["r1"]);
  expect(includedFor.size).toBe(0);
});

it("includeReferencedEntities leaves a media row the bundle already holds as an ordinary row", () => {
  const scoped = applyPublishScope({ envelope: REF_SOURCE, scope: { entityTypes: ["page", "media"] } });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: scoped, source: REF_SOURCE, handlers: REF_HANDLERS });

  expect(envelope.entities.length, "nothing is added twice").toBe(scoped.entities.length);
  expect(includedFor.size, "an in-scope media row is the operator's own choice, not an add-on").toBe(0);
});

// page → widget (by slug, from an html marker) → form, and a widget area → the same widget.
const refsFrom = (field: string, entityType: string) => ({
  references: ({ entity: e }: { entity: PackedEntity }) => (typeof e.state[field] === "string" ? [{ entityType, key: e.state[field] as string }] : []),
});
const CHAIN_HANDLERS: ReferenceHandlers = new Map([
  ["page", bodyReferences],
  ["widget", refsFrom("formSlug", "form")],
  ["widget-area", refsFrom("widgetId", "widget")],
  ["term", refsFrom("parentId", "term")],
]);
const CHAIN_SOURCE: PublishContentExportEnvelope = {
  ...ENVELOPE,
  entities: [
    stated("form", "contact", { slug: "contact" }),
    stated("form", "other", { slug: "other" }),
    stated("widget", "w1", { slug: "signup", formSlug: "contact" }),
    stated("widget-area", "sidebar", { widgetId: "w1" }),
    stated("page", "pg1", { bodyHtml: `<div data-embed-config='{"type":"widget","slug":"signup"}'></div>` }),
    stated("term", "t1", { parentId: "t2" }),
    stated("term", "t2", { parentId: "t3" }),
    stated("term", "t3", { parentId: "t2" }),
  ],
  blobManifest: [],
};

it("carries the exact ID and its blobs when a different record has the same slug", () => {
  const page = stated("page", "landing", { bodyJson: { type: "doc", content: [{ type: "image", attrs: { assetId: "hero" } }] } });
  const source: PublishContentExportEnvelope = { ...ENVELOPE, entities: [
    stated("media", "first", { slug: "hero" }, ["slug-only-blob"]),
    stated("media", "hero", { slug: "other" }, ["exact-id-blob"]),
    page,
  ] };
  const scoped = applyPublishScope({ envelope: source, scope: { entityTypes: ["page"] } });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: scoped, source, handlers: REF_HANDLERS });
  expect(envelope.entities.map(({ entityType, id }) => `${entityType}:${id}`)).toEqual(["media:hero", "page:landing"]);
  expect(envelope.blobManifest).toEqual(["exact-id-blob"]);
  expect([...includedFor]).toEqual([["media:hero", ["page:landing"]]]);
});

it("includeReferencedEntities follows carried rows' own references, naming the in-scope roots for each", () => {
  const scoped = applyPublishScope({ envelope: CHAIN_SOURCE, scope: { entityTypes: ["page", "widget-area"] } });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: scoped, source: CHAIN_SOURCE, handlers: CHAIN_HANDLERS });

  expect(envelope.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id })), "carried rows come first, in the order they were reached").toStrictEqual(["widget:w1", "form:contact", "widget-area:sidebar", "page:pg1"]);
  expect(Object.fromEntries(includedFor)).toStrictEqual({
    "widget:w1": ["page:pg1", "widget-area:sidebar"],
    "form:contact": ["page:pg1", "widget-area:sidebar"],
  });
});

it("includeReferencedEntities does not walk through a row the bundle already holds", () => {
  const scoped = applyPublishScope({ envelope: CHAIN_SOURCE, scope: { entityTypes: ["widget", "widget-area"] } });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: scoped, source: CHAIN_SOURCE, handlers: CHAIN_HANDLERS });

  expect(envelope.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id }))).toStrictEqual(["form:contact", "widget:w1", "widget-area:sidebar"]);
  expect(Object.fromEntries(includedFor), "the form is the widget's, not the area's").toStrictEqual({ "form:contact": ["widget:w1"] });
});

it("includeReferencedEntities stops on a reference cycle instead of looping", () => {
  const scoped = selectBundleEntities({ envelope: CHAIN_SOURCE, selectedKeys: new Set([entityKey({ entityType: "term", entityId: "t1" })]) });
  const { envelope, includedFor } = includeReferencedEntities({ envelope: scoped, source: CHAIN_SOURCE, handlers: CHAIN_HANDLERS });

  expect(envelope.entities.map((e) => entityKey({ entityType: e.entityType, entityId: e.id }))).toStrictEqual(["term:t2", "term:t3", "term:t1"]);
  expect(Object.fromEntries(includedFor)).toStrictEqual({ "term:t2": ["term:t1"], "term:t3": ["term:t1"] });
});

it("L163 reference traversal keeps depth-first order, deduplicates cycles, and sorts shared root labels", () => {
  const roots = [stated("page", "z", {}), stated("page", "a", {})];
  const source = { ...ENVELOPE, entities: [...roots, stated("media", "one", {}, ["first"]), stated("media", "two", {}, ["second", "first"])] };
  const handlers: ReferenceHandlers = new Map([
    ["page", { references: () => [{ entityType: "media", key: "absent" }, { entityType: "media", key: "one" }, { entityType: "media", key: "two" }] }],
    ["media", { references: () => [{ entityType: "media", key: "one" }, { entityType: "media", key: "two" }] }],
  ]);
  const result = includeReferencedEntities({ envelope: { ...ENVELOPE, entities: roots }, source, handlers });
  expect(result.envelope.entities.map(e => entityKey({ entityType: e.entityType, entityId: e.id }))).toStrictEqual(["media:two", "media:one", "page:z", "page:a"]);
  expect(result.envelope.blobManifest).toStrictEqual(["second", "first"]);
  expect([...result.includedFor]).toStrictEqual([["media:two", ["page:a", "page:z"]], ["media:one", ["page:a", "page:z"]]]);
  const unchanged = includeReferencedEntities({ envelope: source, source, handlers: new Map() });
  expect(unchanged.envelope).toBe(source);
  expect(unchanged.includedFor.size).toBe(0);
});
