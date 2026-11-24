/**
 * @file Task 1 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4, task 1.
 *
 * `contentHash()` is the property the whole feature's safety case rests on (plan §5, risk #1/#2/#3):
 * it is what lets an importer tell "this row is untouched since we last synced" from "someone edited
 * it on the live site" WITHOUT relying on `version` (which differs across two independently-running
 * databases even when the content is identical) or `updatedAt` (same problem, plus clock skew).
 *
 * Covers exactly the three properties the task table calls for:
 *  1. same content, different `version`/`updatedAt` (as if read from two different DBs) → equal hash
 *  2. changing any real content field → different hash
 *  3. a pinned snapshot of the algorithm's literal output, so a future change to the algorithm
 *     itself is a conscious `CONTENT_HASH_VERSION` bump, not a silent drift.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { CONTENT_HASH_VERSION, canonicalize, contentHash } from "../content-hash.js";

/** A representative "post-shaped" state — deliberately includes every field kind `canonicalize`
 *  has to handle: the always-excluded identity/bookkeeping fields, a nested JSON document
 *  (`bodyJson`, TipTap-shaped), a `null` field, and an absent (`undefined`) optional field. */
function fixtureState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
    status: "draft",
    kind: "post",
    bodyFormat: "doc",
    bodyHtml: null,
    ext: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Identity/bookkeeping fields never affect the hash
// ---------------------------------------------------------------------------

test("same content on two databases with different version/updatedAt (and different id/workspaceId) hashes equal", () => {
  const onDbA = fixtureState({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    workspaceId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const onDbB = fixtureState({
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    workspaceId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    version: 47,
    updatedAt: "2026-09-18T12:34:56.000Z",
  });

  assert.equal(contentHash({ entityType: "post", state: onDbA }), contentHash({ entityType: "post", state: onDbB }));
});

test("an autosaveJson field (per-editor standing draft) never affects the hash even when present", () => {
  const withoutAutosave = fixtureState();
  const withAutosave = fixtureState({ autosaveJson: JSON.stringify({ bodyJson: { type: "doc", content: [] } }) });

  assert.equal(contentHash({ entityType: "post", state: withoutAutosave }), contentHash({ entityType: "post", state: withAutosave }));
});

// Task 15 (plan §4 task 15) — authorship provenance fields must never perturb the content hash, the
// same way id/workspaceId/version/updatedAt already don't (this file's header, `EXCLUDED_KEYS` doc).
test("same content with different createdByPrincipalId/createdAt (as if authored on two different instances) hashes equal", () => {
  const authoredHere = fixtureState({
    createdByPrincipalId: "11111111-2222-3333-4444-555555555555",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const authoredThere = fixtureState({
    createdByPrincipalId: "99999999-8888-7777-6666-555555555555",
    createdAt: "2026-09-18T12:34:56.000Z",
  });

  assert.equal(contentHash({ entityType: "post", state: authoredHere }), contentHash({ entityType: "post", state: authoredThere }));
});

test("a createdByPrincipalId/createdAt of null (pre-migration row) hashes the same as any other value for those fields", () => {
  const withAuthor = fixtureState({ createdByPrincipalId: "11111111-2222-3333-4444-555555555555", createdAt: "2026-01-01T00:00:00.000Z" });
  const withoutAuthor = fixtureState({ createdByPrincipalId: null, createdAt: null });

  assert.equal(contentHash({ entityType: "post", state: withAuthor }), contentHash({ entityType: "post", state: withoutAuthor }));
});

// ---------------------------------------------------------------------------
// 2. Any real content field changes the hash
// ---------------------------------------------------------------------------

const CONTENT_FIELD_CHANGES: ReadonlyArray<{ field: string; changed: unknown }> = [
  { field: "title", changed: "Different Title" },
  { field: "slug", changed: "different-slug" },
  { field: "bodyJson", changed: { type: "doc", content: [] } },
  { field: "status", changed: "published" },
  { field: "kind", changed: "page" },
  { field: "bodyFormat", changed: "html" },
  { field: "bodyHtml", changed: "<p>hi</p>" },
  { field: "seoExtJson", changed: '{"metaTitle":"x"}' },
  { field: "ext", changed: { somePlugin: { flag: true } } },
  { field: "deletedAt", changed: "2026-02-01T00:00:00.000Z" },
  { field: "templateChoice", changed: "blog-post.html" },
  { field: "overridesThemePage", changed: true },
  { field: "memberAccessJson", changed: '{"visibility":"members"}' },
];

for (const { field, changed } of CONTENT_FIELD_CHANGES) {
  test(`changing '${field}' changes the hash`, () => {
    const baseline = fixtureState();
    const mutated = fixtureState({ [field]: changed });
    assert.notEqual(
      contentHash({ entityType: "post", state: baseline }),
      contentHash({ entityType: "post", state: mutated }),
      `expected changing '${field}' to change the content hash`
    );
  });
}

test("changing entityType alone (same state) changes the hash — the discriminator is part of the hashed identity", () => {
  const state = fixtureState();
  assert.notEqual(contentHash({ entityType: "post", state }), contentHash({ entityType: "page", state }));
});

// ---------------------------------------------------------------------------
// 3. Canonicalization contract: stable key order, no whitespace, explicit null for absent
// ---------------------------------------------------------------------------

test("canonicalize produces stable key order regardless of input property order", () => {
  const a = canonicalize({ entityType: "post", state: { b: 1, a: 2, c: 3 } });
  const b = canonicalize({ entityType: "post", state: { c: 3, a: 2, b: 1 } });
  assert.equal(a, b);
  assert.equal(a, '{"entityType":"post","state":{"a":2,"b":1,"c":3}}');
});

test("canonicalize emits no whitespace", () => {
  const out = canonicalize({ entityType: "post", state: { a: 1 } });
  assert.equal(/\s/.test(out), false);
});

test("canonicalize writes an explicit null for an undefined field rather than dropping the key", () => {
  const out = canonicalize({ entityType: "post", state: { a: undefined } });
  assert.equal(out, '{"entityType":"post","state":{"a":null}}');
});

test("canonicalize sorts keys and nulls-out undefined recursively inside nested objects", () => {
  const out = canonicalize({ entityType: "post", state: { outer: { b: 1, a: undefined } } });
  assert.equal(out, '{"entityType":"post","state":{"outer":{"a":null,"b":1}}}');
});

test("canonicalize excludes id, workspaceId, version, updatedAt, autosaveJson, createdByPrincipalId, and createdAt", () => {
  const out = canonicalize({ entityType: "post", state: {
    id: "x",
    workspaceId: "y",
    version: 99,
    updatedAt: "z",
    autosaveJson: "w",
    createdByPrincipalId: "author-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "kept",
  } });
  assert.equal(out, '{"entityType":"post","state":{"title":"kept"}}');
});

// ---------------------------------------------------------------------------
// 4. Snapshot pin — a change to the algorithm itself must be a deliberate version bump
// ---------------------------------------------------------------------------

test("CONTENT_HASH_VERSION is pinned at 1", () => {
  assert.equal(CONTENT_HASH_VERSION, 1);
});

test("contentHash output is pinned for a fixed fixture — a change here means the algorithm changed and CONTENT_HASH_VERSION must bump", () => {
  const pinned = fixtureState({
    id: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    version: 3,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  assert.equal(contentHash({ entityType: "post", state: pinned }), "b0eac00a251d3a8b6973e539141998515aecfc13a8fee165c3d572070b612309");
});

test("canonicalize preserves array order while sorting object keys inside array elements", () => {
  const paragraphs = [
    { type: "paragraph", content: [{ type: "text", text: "first" }] },
    { type: "paragraph", content: [{ type: "text", text: "second" }] },
  ];
  const state = { bodyJson: { type: "doc", content: paragraphs }, termIds: ["a", "b"] };
  const equivalent = { termIds: ["a", "b"], bodyJson: { content: paragraphs.map(({ type, content }) => ({ content, type })), type: "doc" } };
  assert.equal(contentHash({ entityType: "post", state }), contentHash({ entityType: "post", state: equivalent }));
  assert.deepEqual(JSON.parse(canonicalize({ entityType: "post", state })).state.bodyJson.content, paragraphs);
  assert.notEqual(contentHash({ entityType: "post", state }), contentHash({ entityType: "post", state: { ...state, termIds: ["b", "a"] } }));
  assert.notEqual(contentHash({ entityType: "post", state }), contentHash({ entityType: "post", state: { ...state, bodyJson: { type: "doc", content: [...paragraphs].reverse() } } }));
});

// H4 (2026-11-24) — `createdByKind` is the same provenance class: an agent-made and a person-made
// copy of identical content must not read as a content edit.
test("same content with a different createdByKind (agent vs person) hashes equal", () => {
  assert.equal(
    contentHash({ entityType: "post", state: fixtureState({ createdByKind: "agent" }) }),
    contentHash({ entityType: "post", state: fixtureState({ createdByKind: "person" }) }),
  );
});
