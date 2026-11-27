// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { useFetchMutation, useFetchQuery, useInvalidate } from "../../../react/kit.js";
import type { AdminTaxonomyWithTerms, AdminTerm } from "../api/taxonomy-api.types.js";
import { createFakeTaxonomyPort } from "../hooks/taxonomy-dependencies.hooks.js";
import { useTaxonomy } from "../hooks/use-taxonomy.hooks.js";
import { useTaxonomyHtmlEmbed } from "../hooks/use-taxonomy-html-embed.hooks.js";
import type { TaxonomyApiErrorLike, TaxonomyHostKit } from "../taxonomy-host-kit.js";

/**
 * @file The "Delete term" / "Delete taxonomy" confirm flows of `useTaxonomy` over the in-memory
 * taxonomy port and the real fetch kit: success, the 409 blocked refusal, the 404 already-gone
 * quiet refresh and a hard failure, plus which selection each outcome clears.
 */

class FakeApiError extends Error implements TaxonomyApiErrorLike {
  constructor(readonly status: number, readonly code: string, readonly body?: Record<string, unknown>) {
    super(`api ${status} ${code}`);
  }
}

const term = (id: string, taxonomyId: string): AdminTerm => ({ id, taxonomyId, parentId: null, name: `Term ${id}`, status: "active", updatedAt: "2026-11-01", version: 1 });
const group = (id: string, termIds: string[]): AdminTaxonomyWithTerms => ({
  taxonomy: { id, name: `Tax ${id}`, hierarchical: true, status: "active", updatedAt: "2026-11-01", version: 1 },
  terms: termIds.map((termId) => term(termId, id)),
});

function setup(options: { blocked?: string[]; override?: Partial<ReturnType<typeof createFakeTaxonomyPort>> } = {}) {
  const fake = createFakeTaxonomyPort(
    { blockedError: ({ count }) => new FakeApiError(409, "TERM_HAS_CHILDREN", { count }) },
    { groups: [group("cats", ["c1", "c2"]), group("tags", ["g1"])], onTrashTermBlocked: (id) => (options.blocked?.includes(id) ? { count: 3 } : undefined) },
  );
  const port = { ...fake, listTaxonomies: vi.fn(fake.listTaxonomies), trashTerm: vi.fn(fake.trashTerm), trashTaxonomy: vi.fn(fake.trashTaxonomy), ...options.override };
  const kit: TaxonomyHostKit = {
    isApiError: (e: unknown): e is TaxonomyApiErrorLike => e instanceof FakeApiError,
    describeApiError: ({ e, fallback }) => `${(e as Error).message}|${fallback}`,
    translate: ({ key }) => `tr(${key})`,
    failures: { getGeneration: () => 0, isClipboardRefusal: () => false, publishLocalFailure: vi.fn() },
    useContentRefreshSubscription: () => {}, useTaxonomyHtmlEmbed, useFetchQuery, useFetchMutation, useInvalidate,
  };
  const hook = renderHook(() => useTaxonomy({ port, locale: "en", t: (k) => k, kit }));
  return { port, ...hook };
}
type Hook = ReturnType<typeof setup>;

async function loaded(options?: Parameters<typeof setup>[0]) {
  const hook = setup(options);
  await waitFor(() => expect(hook.result.current.taxonomies).toHaveLength(2));
  return hook;
}
const termIds = (hook: Hook) => (hook.result.current.taxonomies ?? []).flatMap((g) => g.terms.map((t) => t.id));
const pick = (hook: Hook, id: string) => {
  const found = (hook.result.current.taxonomies ?? []).flatMap((g) => g.terms).find((t) => t.id === id);
  if (!found) throw new Error(`term ${id} not listed`);
  return found;
};

describe("useTaxonomy delete term", () => {
  it("does nothing when confirmed with no term pending", async () => {
    const hook = await loaded();
    await act(async () => { await hook.result.current.confirmDeleteTerm(); await hook.result.current.confirmDeleteTaxonomy(); });
    expect(hook.port.trashTerm).not.toHaveBeenCalled();
    expect(hook.port.trashTaxonomy).not.toHaveBeenCalled();
  });

  it("trashes the pending term, drops it from the list and clears the selection it owned", async () => {
    const hook = await loaded();
    act(() => { hook.result.current.setSelectedTermId("c1"); hook.result.current.requestDeleteTerm(pick(hook, "c1")); });
    expect(hook.result.current.pendingDeleteTerm?.id).toBe("c1");
    await act(async () => { await hook.result.current.confirmDeleteTerm(); });
    expect(hook.port.trashTerm).toHaveBeenCalledWith({ id: "c1" });
    await waitFor(() => expect(termIds(hook)).toEqual(["c2", "g1"]));
    expect(hook.result.current.pendingDeleteTerm).toBeNull();
    expect(hook.result.current.selectedTermId).toBeNull();
  });

  it("keeps another term's selection when a different term is deleted", async () => {
    const hook = await loaded();
    act(() => { hook.result.current.setSelectedTermId("g1"); hook.result.current.requestDeleteTerm(pick(hook, "c2")); });
    await act(async () => { await hook.result.current.confirmDeleteTerm(); });
    await waitFor(() => expect(termIds(hook)).toEqual(["c1", "g1"]));
    expect(hook.result.current.selectedTermId).toBe("g1");
  });

  it("records a blocked refusal for the term, shows no error banner, and clears it on the next request", async () => {
    const hook = await loaded({ blocked: ["c1"] });
    act(() => { hook.result.current.setSelectedTermId("c1"); hook.result.current.requestDeleteTerm(pick(hook, "c1")); });
    await act(async () => { await hook.result.current.confirmDeleteTerm(); });
    expect(hook.result.current.deleteTermBlocked).toEqual({
      termId: "c1", state: { code: "TERM_HAS_CHILDREN", count: 3, message: "This term has 3 sub-terms. Move them under another parent or delete them first." },
    });
    expect(hook.result.current.pendingDeleteTerm).toBeNull();
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.selectedTermId).toBe("c1");
    act(() => hook.result.current.requestDeleteTerm(null));
    expect(hook.result.current.deleteTermBlocked).toBeNull();
  });

  it("treats a 404 as already gone: clears the selection and re-reads the list", async () => {
    const hook = await loaded({ override: { trashTerm: vi.fn(async () => { throw new FakeApiError(404, "NOT_FOUND"); }) } });
    const reads = hook.port.listTaxonomies.mock.calls.length;
    act(() => { hook.result.current.setSelectedTermId("c1"); hook.result.current.requestDeleteTerm(pick(hook, "c1")); });
    await act(async () => { await hook.result.current.confirmDeleteTerm(); });
    expect(hook.result.current.selectedTermId).toBeNull();
    await waitFor(() => expect(hook.port.listTaxonomies.mock.calls.length).toBeGreaterThan(reads));
    expect(hook.result.current.error).toBeNull();
  });

  it("surfaces a hard failure through the error banner and keeps the selection", async () => {
    const hook = await loaded({ override: { trashTerm: vi.fn(async () => { throw new Error("server down"); }) } });
    act(() => { hook.result.current.setSelectedTermId("c1"); hook.result.current.requestDeleteTerm(pick(hook, "c1")); });
    await act(async () => { await hook.result.current.confirmDeleteTerm(); });
    await waitFor(() => expect(hook.result.current.error).toBe("server down|tr(Failed to delete term)"));
    expect(hook.result.current.selectedTermId).toBe("c1");
    expect(hook.result.current.deleteTermBlocked).toBeNull();
  });
});

describe("useTaxonomy delete taxonomy", () => {
  it("trashes the taxonomy and clears a selected term that belonged to it", async () => {
    const hook = await loaded();
    const cats = hook.result.current.taxonomies?.[0]?.taxonomy ?? null;
    act(() => { hook.result.current.setSelectedTermId("c2"); hook.result.current.requestDeleteTaxonomy(cats); });
    expect(hook.result.current.pendingDeleteTaxonomy?.id).toBe("cats");
    await act(async () => { await hook.result.current.confirmDeleteTaxonomy(); });
    expect(hook.port.trashTaxonomy).toHaveBeenCalledWith({ id: "cats" });
    await waitFor(() => expect(termIds(hook)).toEqual(["g1"]));
    expect(hook.result.current.selectedTermId).toBeNull();
    expect(hook.result.current.pendingDeleteTaxonomy).toBeNull();
  });

  it("keeps a selection from another taxonomy, and treats a 404 as already gone", async () => {
    const hook = await loaded({ override: { trashTaxonomy: vi.fn(async () => { throw new FakeApiError(404, "NOT_FOUND"); }) } });
    const tags = hook.result.current.taxonomies?.[1]?.taxonomy ?? null;
    act(() => { hook.result.current.setSelectedTermId("c1"); hook.result.current.requestDeleteTaxonomy(tags); });
    await act(async () => { await hook.result.current.confirmDeleteTaxonomy(); });
    expect(hook.result.current.selectedTermId).toBe("c1");
    expect(hook.result.current.deleteTaxonomyBlocked).toBeNull();
    expect(hook.result.current.error).toBeNull();
  });

  it("records a 409 children refusal against the taxonomy", async () => {
    const hook = await loaded({ override: { trashTaxonomy: vi.fn(async () => { throw new FakeApiError(409, "TERM_HAS_CHILDREN", { count: 1 }); }) } });
    act(() => hook.result.current.requestDeleteTaxonomy(hook.result.current.taxonomies?.[1]?.taxonomy ?? null));
    await act(async () => { await hook.result.current.confirmDeleteTaxonomy(); });
    expect(hook.result.current.deleteTaxonomyBlocked).toEqual({
      taxonomyId: "tags", state: { code: "TERM_HAS_CHILDREN", count: 1, message: "This term has 1 sub-term. Move them under another parent or delete them first." },
    });
    act(() => hook.result.current.requestDeleteTaxonomy(null));
    expect(hook.result.current.deleteTaxonomyBlocked).toBeNull();
  });
});
