import { describe, expect, it } from "vitest";

import type { CollectionsHostKit } from "../collections-host-kit.js";
import { bindCollectionsRules, describeEditFieldsError, lifecycleCopy, validateKey } from "../rules.js";

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
};

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
