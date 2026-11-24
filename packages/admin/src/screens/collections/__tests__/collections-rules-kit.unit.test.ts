import { describe, expect, it } from "vitest";

import type { CollectionsHostKit } from "../collections-host-kit.js";
import { addDraftField, bindCollectionsRules, collectionEmbedSnippet, createDraftRowIdCounter, describeEditFieldsError, draftFieldsFromContentType, emptyField, lifecycleCopy, validateKey } from "../rules.js";

/**
 * @file Pins the injected {@link CollectionsHostKit} seam of the collections rules: translated copy
 * comes from `kit.translate` with the caller's locale, the 409 branch narrows on `kit.isApiError`,
 * and {@link bindCollectionsRules} forwards the same kit into every bound rule.
 */

class FakeApiError extends Error {
  constructor(readonly status: number) { super(`status ${status}`); }
}

const kit: CollectionsHostKit = {
  translate: ({ locale, key }) => `${locale}:${key}`,
  isApiError: (e): e is FakeApiError => e instanceof FakeApiError,
  describeApiError: ({ e, fallback }) => (e instanceof Error ? `described ${e.message}` : fallback),
  isVersionConflict: ({ error }) => error instanceof FakeApiError && error.status === 409,
  embedMarkerSnippet: ({ type, key, value }) => `marker(${type},${key},${value})`,
  nextDraftRowId: createDraftRowIdCounter(),
};

function freshKit(): CollectionsHostKit {
  return { ...kit, nextDraftRowId: createDraftRowIdCounter() };
}

describe("collections rules — host kit", () => {
  it("translates through the kit with the caller's locale", () => {
    expect(validateKey({ key: "Bad", kit }, { locale: "fr" })).toMatch(/^fr:Key must start/);
    expect(lifecycleCopy({ op: "tombstone", kit }, { locale: "de" }).title).toBe("de:Delete content type");
  });

  it("narrows the stale-version branch on the kit's error predicate only", () => {
    expect(describeEditFieldsError({ e: new FakeApiError(409), kit })).toMatch(/changed since you loaded it/);
    const lookalike = Object.assign(new Error("plain"), { status: 409 });
    expect(describeEditFieldsError({ e: lookalike, kit })).toBe("described plain");
  });

  it("bindCollectionsRules forwards the kit into every bound rule", () => {
    const rules = bindCollectionsRules({ kit });
    expect(rules.validateKey({ key: "Bad" }, { locale: "ja" })).toMatch(/^ja:/);
    expect(rules.validateNewContentTypeDraft({ draft: { key: "ok", label: "", fields: [] } }, { locale: "it" })).toBe("it:Label is required.");
    expect(rules.validateEditFieldsDraft({ fields: [] }, { localeOrTranslate: "es" })).toBe("es:At least one field is required.");
    expect(rules.lifecycleCopy({ op: "deprecate" }, { locale: "pl" }).title).toBe("pl:Deprecate content type");
    expect(rules.describeEditFieldsError({ e: new FakeApiError(409) })).toMatch(/changed since/);
    expect(rules.validateFieldName({ name: "Bad" }, { localeOrTranslate: "ko" })).toMatch(/^ko:/);
    expect(rules.firstDraftFieldError({ fields: [{ _rowId: 1, name: "Bad", kind: "text", required: false, queryable: false }] }, { localeOrTranslate: "hu" })).toMatch(/^Field "Bad": hu:/);
    const items = rules.contentTypeMenuItems({ contentType: { workspaceId: "w", key: "k", label: "K", fields: [], status: "active", version: 1 }, handlers: { onEditFields: () => {}, onDeprecate: () => {}, onReactivate: () => {}, onTombstone: () => {} }, locale: "tr" });
    expect(items.map((i) => i.label)).toEqual(["tr:Edit fields", "tr:Deprecate", "tr:Delete"]);
    expect(rules.visibleEntryEditorError({ updateError: new FakeApiError(409), createError: null, lifecycleError: null, saveFallback: "s", lifecycleFallback: null, versionConflictMessage: "conflict" })).toBe("conflict");
  });
});

describe("collections rules — injected embed marker builder", () => {
  it("collectionEmbedSnippet builds a `collection` marker keyed by `id` through the kit", () => {
    expect(collectionEmbedSnippet({ key: "recipe", kit })).toBe("marker(collection,id,recipe)");
    expect(bindCollectionsRules({ kit }).collectionEmbedSnippet({ key: "faq" })).toBe("marker(collection,id,faq)");
  });
});

describe("collections rules — draft row ids come from the kit's counter", () => {
  it("createDraftRowIdCounter starts at 1 and increments by one per call", () => {
    const next = createDraftRowIdCounter();
    expect([next(), next(), next()]).toEqual([1, 2, 3]);
  });

  it("two counters are independent (no module-level shared state)", () => {
    const a = createDraftRowIdCounter();
    const b = createDraftRowIdCounter();
    a();
    a();
    expect(b()).toBe(1);
    expect(a()).toBe(3);
  });

  it("emptyField / draftFieldsFromContentType / addDraftField draw unique, increasing ids off ONE kit counter", () => {
    const k = freshKit();
    const first = emptyField({ kit: k });
    const seeded = draftFieldsFromContentType({ fields: [
      { name: "a", kind: "text", required: false, queryable: false },
      { name: "b", kind: "text", required: false, queryable: false },
    ], kit: k });
    const grown = addDraftField({ fields: seeded, kit: k });
    expect([first._rowId, ...grown.map((f) => f._rowId)]).toEqual([1, 2, 3, 4]);
    expect(seeded.map((f) => f.name)).toEqual(["a", "b"]);
  });

  it("bound rules share the bound kit's counter across New/Edit drafts (open New, cancel, open Edit continues)", () => {
    const rules = bindCollectionsRules({ kit: freshKit() });
    const newDraftFirst = rules.emptyField({})._rowId;
    const editDraft = rules.draftFieldsFromContentType({ fields: [{ name: "x", kind: "text", required: false, queryable: false }] });
    const added = rules.addDraftField({ fields: editDraft });
    expect(newDraftFirst).toBe(1);
    expect(added.map((f) => f._rowId)).toEqual([2, 3]);
  });
});
