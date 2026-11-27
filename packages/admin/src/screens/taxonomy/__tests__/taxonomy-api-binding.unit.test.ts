import { describe, expect, it, vi } from "vitest";

import { createTaxonomyApi, type TaxonomyRequestFn } from "../api/taxonomy-api.js";
import { createFakeMergeTermSectionPort, createMergeTermSectionPort } from "../hooks/merge-term-section-dependencies.hooks.js";
import { createFakeNewTaxonomyFormPort, createNewTaxonomyFormPort } from "../hooks/new-taxonomy-form-dependencies.hooks.js";
import { createFakeNewTermFormPort, createNewTermFormPort } from "../hooks/new-term-form-dependencies.hooks.js";
import { createFakeTermPickerPort, createTermPickerPort } from "../hooks/term-picker-dependencies.hooks.js";

import { createFakeTaxonomyPort, createTaxonomyPort } from "../hooks/taxonomy-dependencies.hooks.js";
import type { AdminTaxonomyWithTerms } from "../api/taxonomy-api.types.js";

/** @file Pins the taxonomy API client and its live ports to the host-injected `request`/`me`. */

function recordingRequest(response: unknown = {}): { request: TaxonomyRequestFn; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const request = (async (...args: unknown[]) => {
    calls.push(args);
    return response;
  }) as TaxonomyRequestFn;
  return { request, calls };
}

describe("createTaxonomyApi", () => {
  it("sends every call through the injected request with the route's path, method and body", async () => {
    const { request, calls } = recordingRequest();
    const api = createTaxonomyApi({ request });
    await api.listTaxonomies();
    await api.createTerm({ taxonomyId: "a/b", name: "Tag" }, { parentId: "p1" });
    await api.executeMergeTerm({ fromTermId: "t 1", intoTermId: "t2", confirmationToken: "tok" });
    await api.assignedTerms({ contentType: "post", contentId: "x&y" });
    expect(calls).toEqual([
      [{ path: "/taxonomy" }],
      [{ path: "/taxonomy/a%2Fb/terms" }, { init: { method: "POST", body: JSON.stringify({ name: "Tag", parentId: "p1" }) } }],
      [{ path: "/taxonomy/terms/t%201/merge/execute" }, { init: { method: "POST", body: JSON.stringify({ intoTermId: "t2", confirmationToken: "tok" }) } }],
      [{ path: "/taxonomy/assigned-terms?contentType=post&contentId=x%26y" }],
    ]);
  });
});

describe("taxonomy live ports", () => {
  it("delegate to the injected api client and the host's me", async () => {
    const { request, calls } = recordingRequest({ ok: true });
    const api = createTaxonomyApi({ request });
    const me = vi.fn(async () => ({ permissions: [] }) as never);
    const picker = createTermPickerPort({ api, me });
    await picker.me();
    await picker.createTerm({ taxonomyId: "tx", name: "N" });
    await picker.unassignTerms({ contentType: "post", contentId: "c", termIds: ["t"] });
    await createMergeTermSectionPort({ api }).planMergeTerm({ fromTermId: "f", intoTermId: "i" });
    await createNewTaxonomyFormPort({ api }).createTaxonomy({ name: "Topics", hierarchical: true });
    await createNewTermFormPort({ api }).createTerm({ taxonomyId: "tx", name: "N2" });
    expect(me).toHaveBeenCalledTimes(1);
    expect(calls.map(([required]) => (required as { path: string }).path)).toEqual([
      "/taxonomy/tx/terms",
      "/taxonomy/unassign-terms",
      "/taxonomy/terms/f/merge/plan",
      "/taxonomy",
      "/taxonomy/tx/terms",
    ]);
  });
});

it("threads rename, confirm and assign inputs through the host request without changing targets", async () => {
  const { request, calls } = recordingRequest({ ok: true });
  const api = createTaxonomyApi({ request });
  const trash = vi.fn(async (_input: { type: "term" | "taxonomy"; id: string }) => ({ ok: true as const, version: 7 }));
  const taxonomy = createTaxonomyPort({ api, trash: { trash } });
  const merge = createMergeTermSectionPort({ api });
  const picker = createTermPickerPort({ api, me: async () => ({ effectivePermissions: ["*"] }) });
  const assignment = { contentId: "p&id", contentType: "collection/post", termIds: ["t 1", "t/2"] };
  await taxonomy.listTaxonomies();
  await taxonomy.renameTerm({ termId: "t/2", newName: "New name" });
  await picker.listTaxonomies();
  await picker.assignedTerms(assignment);
  await picker.assignTerms(assignment);
  await merge.confirmMergeTerm({ fromTermId: "t/2", planId: "plan-a", planHash: "hash-b" });
  await merge.executeMergeTerm({ fromTermId: "t/2", intoTermId: "t 1", confirmationToken: "confirmed" });
  await expect(taxonomy.trashTerm({ id: "t/2" })).resolves.toEqual({ ok: true, version: 7 });
  await expect(taxonomy.trashTaxonomy({ id: "tx-x" })).resolves.toEqual({ ok: true, version: 7 });
  expect(trash.mock.calls).toEqual([[{ type: "term", id: "t/2" }], [{ type: "taxonomy", id: "tx-x" }]]);
  expect(calls).toEqual([
    [{ path: "/taxonomy" }],
    [{ path: "/taxonomy/terms/t%2F2" }, { init: { method: "PUT", body: '{"newName":"New name"}' } }],
    [{ path: "/taxonomy" }],
    [{ path: "/taxonomy/assigned-terms?contentType=collection%2Fpost&contentId=p%26id" }],
    [{ path: "/taxonomy/assign-terms" }, { init: { method: "POST", body: '{"contentId":"p&id","contentType":"collection/post","termIds":["t 1","t/2"]}' } }],
    [{ path: "/taxonomy/terms/t%2F2/merge/confirm" }, { init: { method: "POST", body: '{"planId":"plan-a","planHash":"hash-b"}' } }],
    [{ path: "/taxonomy/terms/t%2F2/merge/execute" }, { init: { method: "POST", body: '{"intoTermId":"t 1","confirmationToken":"confirmed"}' } }],
  ]);
});

it("gives created taxonomies and nested terms distinct IDs and records only successful creates", async () => {
  const taxonomies = createFakeNewTaxonomyFormPort();
  await expect(taxonomies.createTaxonomy({ name: "Topics", hierarchical: true })).resolves.toEqual({
    taxonomy: { id: "fake-1", name: "Topics", hierarchical: true, status: "active", version: 1, updatedAt: "1970-01-01T00:00:00.000Z" },
  });
  await expect(taxonomies.createTaxonomy({ name: "Formats", hierarchical: false })).resolves.toMatchObject({ taxonomy: { id: "fake-2", name: "Formats", hierarchical: false } });
  expect(taxonomies.created).toEqual([{ name: "Topics", hierarchical: true }, { name: "Formats", hierarchical: false }]);
  const deniedTaxonomy = createFakeNewTaxonomyFormPort({ createError: "Name taken" });
  await expect(deniedTaxonomy.createTaxonomy({ name: "Topics", hierarchical: true })).rejects.toThrow("Name taken");
  expect(deniedTaxonomy.created).toEqual([]);

  const terms = createFakeNewTermFormPort();
  await expect(terms.createTerm({ taxonomyId: "topics", name: "Design" })).resolves.toEqual({
    term: { id: "fake-1", taxonomyId: "topics", parentId: null, name: "Design", status: "active", version: 1, updatedAt: "1970-01-01T00:00:00.000Z" },
  });
  await expect(terms.createTerm({ taxonomyId: "topics", name: "Color" }, { parentId: "fake-1" })).resolves.toMatchObject({
    term: { id: "fake-2", taxonomyId: "topics", parentId: "fake-1", name: "Color" },
  });
  expect(terms.created).toEqual([{ taxonomyId: "topics", name: "Design", parentId: undefined }, { taxonomyId: "topics", name: "Color", parentId: "fake-1" }]);
  const deniedTerm = createFakeNewTermFormPort({ createError: "Parent absent" });
  await expect(deniedTerm.createTerm({ taxonomyId: "topics", name: "Color" }, { parentId: "missing" })).rejects.toThrow("Parent absent");
  expect(deniedTerm.created).toEqual([]);
});

it("returns distinct plan receipts with overlap details and can fail each merge stage independently", async () => {
  const port = createFakeMergeTermSectionPort({ overlappingContentCount: 3 });
  const target = { fromTermId: "alpha", intoTermId: "beta" };
  await expect(port.planMergeTerm(target)).resolves.toEqual({
    planId: "fake-plan-1", planHash: "fake-hash-1", details: { ...target, overlapLossDisclosed: true, overlappingContentCount: 3 },
  });
  await expect(port.planMergeTerm({ fromTermId: "beta", intoTermId: "alpha" })).resolves.toMatchObject({
    planId: "fake-plan-2", planHash: "fake-hash-2", details: { fromTermId: "beta", intoTermId: "alpha" },
  });
  const confirm = { fromTermId: "alpha", planId: "fake-plan-1", planHash: "fake-hash-1" };
  const execute = { ...target, confirmationToken: "fake-confirmation-token" };
  await expect(port.confirmMergeTerm(confirm)).resolves.toEqual({ confirmationToken: "fake-confirmation-token" });
  await expect(port.executeMergeTerm(execute)).resolves.toEqual({ mergedCount: 1 });
  await expect(createFakeMergeTermSectionPort().planMergeTerm(target)).resolves.toMatchObject({ details: { overlappingContentCount: 0 } });
  await expect(createFakeMergeTermSectionPort({ planError: "Cannot plan" }).planMergeTerm(target)).rejects.toThrow("Cannot plan");
  await expect(createFakeMergeTermSectionPort({ confirmError: "Plan expired" }).confirmMergeTerm(confirm)).rejects.toThrow("Plan expired");
  await expect(createFakeMergeTermSectionPort({ executeError: "Grant spent" }).executeMergeTerm(execute)).rejects.toThrow("Grant spent");
});

const date = "2026-08-01T00:00:00.000Z";
function group(id: string, termNames: string[]): AdminTaxonomyWithTerms {
  return {
    taxonomy: { id, name: id, hierarchical: false, status: "active", updatedAt: date, version: 1 },
    terms: termNames.map(name => ({ id: name, name, taxonomyId: id, parentId: null, status: "active", updatedAt: date, version: 1 })),
  };
}

it("reads back only the requested taxonomy changes and preserves a term when Trash reports children", async () => {
  const port = createFakeTaxonomyPort({
    blockedError: ({ count }) => new Error(`Blocked: ${count} children`),
  }, { groups: [group("Topics", ["Parent", "Leaf"]), group("Formats", ["Essay"])], onTrashTermBlocked: id => id === "Parent" ? { count: 2 } : undefined });
  await expect(port.trashTerm({ id: "Parent" })).rejects.toThrow("Blocked: 2 children");
  await expect(port.renameTerm({ termId: "Leaf", newName: "Branch" })).resolves.toMatchObject({ term: { id: "Leaf", name: "Branch" } });
  const renamed = await port.listTaxonomies();
  expect(renamed.items.flatMap(({ terms }) => terms.map(term => [term.id, term.name]))).toEqual([["Parent", "Parent"], ["Leaf", "Branch"], ["Essay", "Essay"]]);
  await expect(port.trashTerm({ id: "Leaf" })).resolves.toEqual({ ok: true, version: null });
  await expect(port.trashTaxonomy({ id: "Formats" })).resolves.toEqual({ ok: true, version: null });
  const remaining = await port.listTaxonomies();
  expect(remaining.items.map(({ taxonomy, terms }) => [taxonomy.id, terms.map(term => term.id)])).toEqual([["Topics", ["Parent"]]]);
  await expect(port.trashTerm({ id: "Leaf" })).rejects.toThrow("fake taxonomy port: unknown term Leaf");
  await expect(port.trashTaxonomy({ id: "Formats" })).rejects.toThrow("fake taxonomy port: unknown taxonomy Formats");
  await expect(port.renameTerm({ termId: "Essay", newName: "Feature" })).rejects.toThrow("fake taxonomy port: unknown term Essay");
});

it("reads additive picker writes back in sorted order and preserves assignments when saving fails", async () => {
  const taxonomies = [group("Topics", ["a", "b", "c", "z"])];
  const target = { contentType: "entry", contentId: "news-17" };
  const port = createFakeTermPickerPort({ taxonomies, assigned: ["z", "a"], permissions: ["taxonomy:read"] });
  await expect(port.listTaxonomies()).resolves.toEqual({ items: taxonomies });
  await expect(port.me()).resolves.toEqual({ effectivePermissions: ["taxonomy:read"] });
  await port.assignTerms({ ...target, termIds: ["c", "b", "a"] });
  await expect(port.assignedTerms(target)).resolves.toEqual({ termIds: ["a", "b", "c", "z"] });
  await port.unassignTerms({ ...target, termIds: ["c", "z", "missing"] });
  await expect(port.assignedTerms(target)).resolves.toEqual({ termIds: ["a", "b"] });
  await expect(port.createTerm({ taxonomyId: "Topics", name: "Nested" }, { parentId: "b" })).resolves.toMatchObject({
    term: { id: "fake-1", name: "Nested", parentId: "b", taxonomyId: "Topics" },
  });
  expect(port.calls).toEqual([
    { ...target, kind: "assign", termIds: ["c", "b", "a"] },
    { ...target, kind: "unassign", termIds: ["c", "z", "missing"] },
  ]);

  const denied = createFakeTermPickerPort({ assigned: ["z"], saveError: new Error("Read-only"), createError: "Create refused" });
  await expect(denied.assignTerms({ ...target, termIds: ["a"] })).rejects.toThrow("Read-only");
  await expect(denied.unassignTerms({ ...target, termIds: ["z"] })).rejects.toThrow("Read-only");
  await expect(denied.createTerm({ taxonomyId: "Topics", name: "Nested" })).rejects.toThrow("Create refused");
  await expect(denied.assignedTerms(target)).resolves.toEqual({ termIds: ["z"] });
  expect(denied.created).toEqual([]);

  const unavailable = createFakeTermPickerPort({ loadError: new Error("Assignments offline"), taxonomiesError: new Error("Taxonomies offline") });
  await expect(unavailable.assignedTerms(target)).rejects.toThrow("Assignments offline");
  await expect(unavailable.listTaxonomies()).rejects.toThrow("Taxonomies offline");
  await expect(unavailable.me()).resolves.toEqual({ effectivePermissions: ["*"] });
  await expect(createFakeTermPickerPort().listTaxonomies()).resolves.toEqual({ items: [] });
});
