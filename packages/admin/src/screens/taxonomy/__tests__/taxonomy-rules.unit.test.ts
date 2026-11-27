import { describe, expect, it } from "vitest";

import type { AdminTaxonomyWithTerms, AdminTerm } from "../api/taxonomy-api.types.js";
import {
  describeDeleteBlocked,
  describeTrashError,
  findSelectedTerm,
  findTermByName,
  otherMergeTargets,
  splitTermNames,
  termDepth,
  termPickerSubject,
} from "../rules.js";
import type { TaxonomyApiErrorLike, TaxonomyErrorKit } from "../taxonomy-host-kit.js";

const term = (id: string, parentId: string | null = null, name = id): AdminTerm => ({ id, taxonomyId: "tx", parentId, name, status: "active", updatedAt: "2026-11-01", version: 1 });
const group = (id: string, terms: AdminTerm[]): AdminTaxonomyWithTerms => ({ taxonomy: { id, name: id, hierarchical: true, status: "active", updatedAt: "2026-11-01", version: 1 }, terms });

class FakeApiError extends Error implements TaxonomyApiErrorLike {
  constructor(readonly status: number, readonly code?: string, readonly body?: Record<string, unknown>) { super(`api ${status}`); }
}

/** The host's error kit: only `FakeApiError` counts as its request error; everything else goes to the describer. */
const errors: TaxonomyErrorKit = {
  isApiError: (e: unknown): e is TaxonomyApiErrorLike => e instanceof FakeApiError,
  describeApiError: ({ e, fallback }) => `described(${(e as Error).message}, ${fallback})`,
};

describe("termDepth", () => {
  it("counts ancestors, stops at a missing parent, and survives a parent cycle", () => {
    const root = term("root");
    const child = term("child", "root");
    const grandchild = term("grand", "child");
    const orphan = term("orphan", "gone");
    const byId = new Map([root, child, grandchild, orphan].map((t) => [t.id, t]));
    expect(termDepth({ term: root, byId })).toBe(0);
    expect(termDepth({ term: grandchild, byId })).toBe(2);
    expect(termDepth({ term: orphan, byId })).toBe(1);

    const a = term("a", "b");
    const b = term("b", "a");
    expect(termDepth({ term: a, byId: new Map([[a.id, a], [b.id, b]]) })).toBe(2);
  });

  it("caps a pathological chain at 33 steps", () => {
    const chain = Array.from({ length: 50 }, (_, i) => term(`n${i}`, i === 49 ? null : `n${i + 1}`));
    const byId = new Map(chain.map((t) => [t.id, t]));
    const first = chain[0];
    if (!first) throw new Error("empty chain");
    expect(termDepth({ term: first, byId })).toBe(33);
  });
});

describe("term lookups", () => {
  const groups = [group("tags", [term("t1"), term("t2")]), group("cats", [term("c1")])];

  it("lists merge targets other than the term itself", () => {
    expect(otherMergeTargets({ taxonomy: groups[0] ?? group("x", []), excludeTermId: "t1" }).map((t) => t.id)).toEqual(["t2"]);
  });

  it("finds the selected term with its taxonomy, or null", () => {
    expect(findSelectedTerm({ taxonomies: groups, selectedTermId: "c1" })).toEqual({ taxonomy: groups[1], term: groups[1]?.terms[0] });
    expect(findSelectedTerm({ taxonomies: groups, selectedTermId: "missing" })).toBeNull();
    expect(findSelectedTerm({ taxonomies: null, selectedTermId: "c1" })).toBeNull();
    expect(findSelectedTerm({ taxonomies: groups, selectedTermId: null })).toBeNull();
  });

  it("matches term names case- and whitespace-insensitively", () => {
    const terms = [term("x", null, "News"), term("y", null, "Sports")];
    expect(findTermByName({ terms, name: "  sPORTS " })?.id).toBe("y");
    expect(findTermByName({ terms, name: "Arts" })).toBeUndefined();
  });
});

describe("describeDeleteBlocked", () => {
  it("only explains the host's TERM_HAS_CHILDREN error, pluralizing the count", () => {
    expect(describeDeleteBlocked({ e: new Error("plain"), errors })).toBeNull();
    expect(describeDeleteBlocked({ e: new FakeApiError(409, "OTHER"), errors })).toBeNull();
    expect(describeDeleteBlocked({ e: new FakeApiError(409, "TERM_HAS_CHILDREN", { count: 1 }), errors })).toEqual({
      code: "TERM_HAS_CHILDREN", count: 1, message: "This term has 1 sub-term. Move them under another parent or delete them first.",
    });
    expect(describeDeleteBlocked({ e: new FakeApiError(409, "TERM_HAS_CHILDREN", { count: 3 }), errors })?.message).toBe(
      "This term has 3 sub-terms. Move them under another parent or delete them first.",
    );
  });

  it("treats a missing or non-numeric count as zero", () => {
    expect(describeDeleteBlocked({ e: new FakeApiError(409, "TERM_HAS_CHILDREN", { count: "4" }), errors })?.count).toBe(0);
    expect(describeDeleteBlocked({ e: new FakeApiError(409, "TERM_HAS_CHILDREN"), errors })?.message).toBe(
      "This term has 0 sub-terms. Move them under another parent or delete them first.",
    );
  });
});

describe("describeTrashError", () => {
  it("is silent with no error and treats a 404 as already gone", () => {
    expect(describeTrashError({ e: null, fallback: "f", errors })).toEqual({ alreadyGone: false, message: null });
    expect(describeTrashError({ e: new FakeApiError(404), fallback: "f", errors })).toEqual({ alreadyGone: true, message: null });
  });

  it("names a version conflict, and hands every other error to the host describer", () => {
    expect(describeTrashError({ e: new FakeApiError(409, "TRASH_VERSION_CHANGED"), fallback: "f", errors })).toEqual({
      alreadyGone: false, message: "This item changed since you loaded it. Reload and try again.",
    });
    expect(describeTrashError({ e: new FakeApiError(500, "OOPS"), fallback: "f", errors })).toEqual({ alreadyGone: false, message: "described(api 500, f)" });
    expect(describeTrashError({ e: new Error("net"), fallback: "f", errors })).toEqual({ alreadyGone: false, message: "described(net, f)" });
  });
});

describe("term picker text rules", () => {
  it("names posts and pages as themselves and everything else an entry", () => {
    expect(termPickerSubject({ contentType: "post" })).toBe("post");
    expect(termPickerSubject({ contentType: "page" })).toBe("page");
    expect(termPickerSubject({ contentType: "recipe" })).toBe("entry");
  });

  it("splits flat names on commas, de-duplicating case-insensitively and dropping blanks", () => {
    expect(splitTermNames({ text: " News, news ,, Sports ", hierarchical: false })).toEqual(["News", "Sports"]);
  });

  it("keeps a hierarchical name whole, commas included", () => {
    expect(splitTermNames({ text: " Food, Drink ", hierarchical: true })).toEqual(["Food, Drink"]);
    expect(splitTermNames({ text: "   ", hierarchical: true })).toEqual([]);
  });
});
