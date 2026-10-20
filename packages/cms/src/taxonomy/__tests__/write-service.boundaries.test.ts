import { describe, expect, it } from "vitest";

import {
  assignTerms,
  createTerm,
  deleteTerm,
  importTaxonomy,
  importTerm,
  renameTerm,
  ContentRecordNotFoundError,
  TaxonomyRecordNotFoundError,
  TaxonomyVersionConflictError,
  TermRecordNotFoundError,
} from "../write-service.js";
import type {
  ContentTypeTaxonomyPolicyPort,
  DeleteTermRequired,
  ImportTaxonomyRequired,
  ImportTermRequired,
  RenameTermRequired,
  Taxonomy,
  TaxonomyRevisionRow,
  Term,
  WriteServiceDeps,
} from "../write-service.js";
import { ParentCrossTaxonomyError, TaxonomyNotApplicableError, TermNotFoundError } from "../validation-chain.js";

/**
 * @file Boundary pins for the write-service branches the scenario suites don't reach: missing
 * taxonomy/parent/term lookups, the no-policy and Set-policy allow-list paths, the CAS refusals'
 * exact text, and each import's revision `previousState`. Every fake is typed against the real
 * port it stands in for.
 */

const NOW = "2026-07-15T00:00:00.000Z";

interface Harness {
  deps: WriteServiceDeps & ImportTaxonomyRequired["deps"] & ImportTermRequired["deps"] & DeleteTermRequired["deps"] & RenameTermRequired["deps"];
  taxonomies: Map<string, Taxonomy>;
  terms: Map<string, Term>;
  revisions: TaxonomyRevisionRow[];
  events: unknown[];
  lookups: string[];
}

function makeTaxonomy(id: string, hierarchical: boolean, version = 1): Taxonomy {
  return { id, name: `${id}-name`, hierarchical, status: "active", updatedAt: NOW, version };
}

function makeTerm(id: string, taxonomyId: string, parentId: string | null = null, version = 1): Term {
  return { id, taxonomyId, parentId, name: `${id}-name`, status: "active", updatedAt: NOW, version };
}

function harness(seed: { taxonomies?: Taxonomy[]; terms?: Term[]; policy?: ContentTypeTaxonomyPolicyPort } = {}): Harness {
  const taxonomies = new Map((seed.taxonomies ?? []).map((t) => [t.id, { ...t }]));
  const terms = new Map((seed.terms ?? []).map((t) => [t.id, { ...t }]));
  const revisions: TaxonomyRevisionRow[] = [];
  const events: unknown[] = [];
  const lookups: string[] = [];
  const deps: Harness["deps"] = {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => "minted-id" },
    transaction: async <T>({ fn }: { fn: () => Promise<T> }): Promise<T> => fn(),
    taxonomies: {
      async findById({ id }) {
        const row = taxonomies.get(id);
        return row ? { id: row.id, hierarchical: row.hierarchical } : null;
      },
      async findByIdFull({ id }) {
        const row = taxonomies.get(id);
        return row ? { ...row } : null;
      },
      async insert(row) { taxonomies.set(row.id, { ...row }); },
      async update(row) { taxonomies.set(row.id, { ...row }); },
    },
    terms: {
      async findById({ id }) {
        const row = terms.get(id);
        return row ? { id: row.id, taxonomyId: row.taxonomyId, name: row.name } : null;
      },
      async findByIdFull({ id }) {
        const row = terms.get(id);
        return row ? { ...row } : null;
      },
      async insert(row) { terms.set(row.id, { ...row }); },
      async update(row) { terms.set(row.id, { ...row }); },
      async delete({ id }) { terms.delete(id); },
      async countChildren({ parentId }) { return [...terms.values()].filter((t) => t.parentId === parentId).length; },
    },
    entryTerms: {
      async upsert() { return undefined; },
      async countByTerm() { return 0; },
    },
    revisions: { async insert(row) { revisions.push(row); } },
    stampWatermark: () => undefined,
    outbox: { async enqueue({ event }) { events.push(event); } },
    workspaceId: "ws-1",
    contentLookup: {
      async resolve({ contentType, contentId }) {
        lookups.push(`${contentType}:${contentId}`);
        return contentId === "missing" ? null : { workspaceId: "ws-1", kind: contentType };
      },
    },
    ...(seed.policy ? { contentTypeTaxonomyPolicy: seed.policy } : {}),
  };
  return { deps, taxonomies, terms, revisions, events, lookups };
}

describe("createTerm boundaries", () => {
  it("refuses a missing taxonomy with TaxonomyRecordNotFoundError naming it", async () => {
    const h = harness();
    await expect(createTerm({ deps: h.deps, principalId: "u-1", taxonomyId: "tax-x", name: "n" }))
      .rejects.toStrictEqual(new TaxonomyRecordNotFoundError({ message: "taxonomy 'tax-x' was not found" }));
    expect(h.terms.size).toBe(0);
  });

  it("refuses a parentId that resolves to no term with TermNotFoundError", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", true)] });
    await expect(createTerm({ deps: h.deps, principalId: "u-1", taxonomyId: "tax-1", name: "n" }, { parentId: "ghost" }))
      .rejects.toStrictEqual(new TermNotFoundError({ message: "parent term 'ghost' was not found" }));
    expect(h.terms.size).toBe(0);
  });
});

describe("importTaxonomy boundaries", () => {
  it("records the pre-import name/hierarchical as the revision's previousState on an update", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", false, 4)] });
    await importTaxonomy({ deps: h.deps, principalId: "u-1", id: "tax-1", name: "renamed", hierarchical: true, expectedVersion: 4 });
    expect(h.revisions).toEqual([{ taxonomyId: "tax-1", op: "import", previousState: { name: "tax-1-name", hierarchical: false }, actorId: "u-1", recordedAt: NOW }]);
  });

  it("records a null previousState on an import-as-create", async () => {
    const h = harness();
    await importTaxonomy({ deps: h.deps, principalId: "u-1", id: "tax-new", name: "n", hierarchical: false, expectedVersion: undefined });
    expect(h.revisions[0]?.previousState).toBeNull();
  });

  it("names the found version in a mismatch refusal", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", false, 4)] });
    await expect(importTaxonomy({ deps: h.deps, principalId: "u-1", id: "tax-1", name: "n", hierarchical: false, expectedVersion: 3 }))
      .rejects.toStrictEqual(new TaxonomyVersionConflictError({ message: "expected version 3 for taxonomy 'tax-1', found 4" }));
  });
});

describe("importTerm boundaries", () => {
  it("refuses a missing owning taxonomy with the exact message before any term lookup", async () => {
    const h = harness();
    await expect(importTerm({ deps: h.deps, principalId: "u-1", id: "t-1", taxonomyId: "tax-x", name: "n", expectedVersion: undefined }))
      .rejects.toStrictEqual(new TaxonomyRecordNotFoundError({ message: "taxonomy 'tax-x' was not found" }));
  });

  it("imports a new term under an existing same-taxonomy parent at version 1", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", true)], terms: [makeTerm("p", "tax-1")] });
    const term = await importTerm({ deps: h.deps, principalId: "u-1", id: "t-1", taxonomyId: "tax-1", name: "n", expectedVersion: undefined }, { parentId: "p" });
    expect(term).toEqual({ id: "t-1", taxonomyId: "tax-1", parentId: "p", name: "n", status: "active", updatedAt: NOW, version: 1 });
  });

  it("refuses a parentId that resolves to no term with TermNotFoundError", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", true)] });
    await expect(importTerm({ deps: h.deps, principalId: "u-1", id: "t-1", taxonomyId: "tax-1", name: "n", expectedVersion: undefined }, { parentId: "ghost" }))
      .rejects.toStrictEqual(new TermNotFoundError({ message: "parent term 'ghost' was not found" }));
    expect(h.terms.size).toBe(0);
  });

  it("refuses a parent from another taxonomy with ParentCrossTaxonomyError", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", true)], terms: [makeTerm("p", "tax-2")] });
    await expect(importTerm({ deps: h.deps, principalId: "u-1", id: "t-1", taxonomyId: "tax-1", name: "n", expectedVersion: undefined }, { parentId: "p" }))
      .rejects.toStrictEqual(new ParentCrossTaxonomyError({ message: "parent term 'p' belongs to taxonomy 'tax-2', not 'tax-1'" }));
  });

  it("records the pre-import name/parentId as the revision's previousState on an update", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", true)], terms: [makeTerm("p", "tax-1"), makeTerm("t-1", "tax-1", null, 2)] });
    await importTerm({ deps: h.deps, principalId: "u-1", id: "t-1", taxonomyId: "tax-1", name: "n", expectedVersion: 2 }, { parentId: "p" });
    expect(h.revisions).toEqual([{ taxonomyId: "tax-1", op: "import", previousState: { name: "t-1-name", parentId: null }, actorId: "u-1", recordedAt: NOW }]);
    expect(h.terms.get("t-1")?.parentId).toBe("p");
  });

  it("records a null previousState and emits taxonomy.term_imported on an import-as-create", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", false)] });
    await importTerm({ deps: h.deps, principalId: "u-1", id: "t-1", taxonomyId: "tax-1", name: "n", expectedVersion: undefined });
    expect(h.revisions[0]?.previousState).toBeNull();
    expect(h.events).toEqual([{ name: "taxonomy.term_imported", termId: "t-1", actorId: "u-1", occurredAt: NOW }]);
  });

  it("names the existing term in an already-exists refusal", async () => {
    const h = harness({ taxonomies: [makeTaxonomy("tax-1", false)], terms: [makeTerm("t-1", "tax-1")] });
    await expect(importTerm({ deps: h.deps, principalId: "u-1", id: "t-1", taxonomyId: "tax-1", name: "n", expectedVersion: undefined }))
      .rejects.toStrictEqual(new TaxonomyVersionConflictError({ message: "term 't-1' already exists, but no expectedVersion was supplied for import" }));
  });
});

describe("renameTerm boundaries", () => {
  it("fails closed with a plain Error when the transaction port is absent at runtime", async () => {
    const h = harness({ terms: [makeTerm("t-1", "tax-1")] });
    Reflect.deleteProperty(h.deps, "transaction");
    await expect(renameTerm({ deps: h.deps, principalId: "u-1", termId: "t-1", newName: "x" }))
      .rejects.toStrictEqual(new Error("term rename requires a transaction port"));
    expect(h.terms.get("t-1")?.name).toBe("t-1-name");
  });

  it("refuses a missing term with TermRecordNotFoundError naming it", async () => {
    const h = harness();
    await expect(renameTerm({ deps: h.deps, principalId: "u-1", termId: "ghost", newName: "x" }))
      .rejects.toStrictEqual(new TermRecordNotFoundError({ message: "term 'ghost' was not found" }));
  });
});

describe("deleteTerm boundaries", () => {
  it("refuses a missing term with TermRecordNotFoundError naming it", async () => {
    const h = harness();
    await expect(deleteTerm({ deps: h.deps, principalId: "u-1", termId: "ghost" }))
      .rejects.toStrictEqual(new TermRecordNotFoundError({ message: "term 'ghost' was not found" }));
  });
});

describe("assignTerms allow-list boundaries", () => {
  it("treats a non-post/page contentType as unresolvable when no policy is wired: no lookup, TaxonomyNotApplicableError", async () => {
    const h = harness({ terms: [makeTerm("t-1", "tax-1")] });
    await expect(assignTerms({ deps: h.deps, principalId: "u-1", contentType: "recipes", contentId: "e-1", termIds: ["t-1"] }))
      .rejects.toStrictEqual(new TaxonomyNotApplicableError({ message: "taxonomy 'tax-1' is not on the allow-list for content type 'recipes'" }));
    expect(h.lookups).toEqual([]);
  });

  it("admits a term whose taxonomy is in the policy's Set", async () => {
    const h = harness({ terms: [makeTerm("t-1", "tax-1")], policy: { taxonomiesFor: async () => new Set(["tax-1"]) } });
    await assignTerms({ deps: h.deps, principalId: "u-1", contentType: "recipes", contentId: "e-1", termIds: ["t-1"] });
    expect(h.lookups).toEqual(["recipes:e-1"]);
    expect(h.events).toHaveLength(1);
  });

  it("refuses a term whose taxonomy is not in the policy's Set", async () => {
    const h = harness({ terms: [makeTerm("t-1", "tax-2")], policy: { taxonomiesFor: async () => new Set(["tax-1"]) } });
    await expect(assignTerms({ deps: h.deps, principalId: "u-1", contentType: "recipes", contentId: "e-1", termIds: ["t-1"] }))
      .rejects.toStrictEqual(new TaxonomyNotApplicableError({ message: "taxonomy 'tax-2' is not on the allow-list for content type 'recipes'" }));
  });

  it("refuses missing post content with ContentRecordNotFoundError before any term lookup", async () => {
    const h = harness();
    await expect(assignTerms({ deps: h.deps, principalId: "u-1", contentType: "post", contentId: "missing", termIds: ["ghost"] }))
      .rejects.toStrictEqual(new ContentRecordNotFoundError({ message: "content 'post:missing' was not found" }));
  });

  it("refuses an unknown term with TermRecordNotFoundError naming it", async () => {
    const h = harness();
    await expect(assignTerms({ deps: h.deps, principalId: "u-1", contentType: "post", contentId: "p-1", termIds: ["ghost"] }))
      .rejects.toStrictEqual(new TermRecordNotFoundError({ message: "term 'ghost' was not found" }));
  });
});
