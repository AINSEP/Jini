// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import type { AdminTaxonomyWithTerms, AdminTerm } from "../api/taxonomy-api.types.js";
import { useTermPicker } from "../hooks/use-term-picker.hooks.js";
import type { TermPickerPort } from "../hooks/term-picker-port.hooks.js";
import { useTaxonomyHtmlEmbed } from "../hooks/use-taxonomy-html-embed.hooks.js";
import { TAXONOMY_MANAGE_PERMISSION } from "../rules.js";
import type { TaxonomyApiErrorLike, TaxonomyHostKit } from "../taxonomy-host-kit.js";
import { useFetchMutation, useFetchQuery, useInvalidate } from "../../../react/kit.js";

/**
 * @file `useTermPicker` (the Categories & Tags box) over a stateful in-memory port and the real fetch
 * kit: assignments, the save diff, create-on-add with name reuse, and the add-input visibility rules.
 */

const term = (id: string, taxonomyId: string, name: string): AdminTerm => ({ id, taxonomyId, parentId: null, name, status: "active", updatedAt: "2026-11-01", version: 1 });
const group = (id: string, hierarchical: boolean, terms: AdminTerm[]): AdminTaxonomyWithTerms => ({
  taxonomy: { id, name: `Tax ${id}`, hierarchical, status: "active", updatedAt: "2026-11-01", version: 1 }, terms,
});

function memoryPort(options: { groups?: AdminTaxonomyWithTerms[]; assigned?: string[]; permissions?: string[] } = {}) {
  const groups = options.groups ?? [group("cats", true, [term("c1", "cats", "News")]), group("tags", false, [term("g1", "tags", "Ideas")])];
  let assigned = new Set(options.assigned ?? ["c1"]);
  let next = 0;
  const port = {
    listTaxonomies: vi.fn(async () => ({ items: groups.map((g) => ({ ...g, terms: [...g.terms] })) })),
    assignedTerms: vi.fn(async () => ({ termIds: [...assigned] })),
    assignTerms: vi.fn(async ({ termIds }: { termIds: string[] }) => { assigned = new Set([...assigned, ...termIds]); }),
    unassignTerms: vi.fn(async ({ termIds }: { termIds: string[] }) => { assigned = new Set([...assigned].filter((id) => !termIds.includes(id))); }),
    me: vi.fn(async () => ({ effectivePermissions: options.permissions ?? [TAXONOMY_MANAGE_PERMISSION] })),
    createTerm: vi.fn(async ({ taxonomyId, name }: { taxonomyId: string; name: string }) => {
      const created = term(`new-${++next}`, taxonomyId, name);
      groups.find((g) => g.taxonomy.id === taxonomyId)?.terms.push(created);
      return { term: created };
    }),
  };
  return port;
}

const kit: TaxonomyHostKit = {
  isApiError: (_e: unknown): _e is TaxonomyApiErrorLike => false,
  describeApiError: ({ e, fallback }) => `${(e as Error).message}|${fallback}`,
  translate: ({ key }) => `tr(${key})`,
  failures: { getGeneration: () => 0, isClipboardRefusal: () => false, publishLocalFailure: vi.fn() },
  useContentRefreshSubscription: () => {}, useTaxonomyHtmlEmbed, useFetchQuery, useFetchMutation, useInvalidate,
};

async function loaded(options?: Parameters<typeof memoryPort>[0], contentId = "p1") {
  const port = memoryPort(options);
  const hook = renderHook((props: { contentId: string }) => useTermPicker({ target: { contentType: "post", contentId: props.contentId }, port: port as unknown as TermPickerPort, locale: "en", kit }),
    { initialProps: { contentId } });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(hook.result.current.taxonomies).toHaveLength((options?.groups ?? [1, 2]).length));
  return { port, ...hook };
}
const sel = (hook: Awaited<ReturnType<typeof loaded>>) => [...hook.result.current.selected].sort();
const key = (k: string, isComposing = false) => ({ key: k, nativeEvent: { isComposing }, preventDefault: vi.fn() });

describe("useTermPicker selection and save", () => {
  it("saves exactly the ticked and unticked difference, then reports it saved", async () => {
    const hook = await loaded();
    expect(sel(hook)).toEqual(["c1"]);
    expect(hook.result.current.subject).toBe("post");
    await act(async () => { await hook.result.current.save(); });
    expect(hook.port.assignTerms).not.toHaveBeenCalled();

    act(() => { hook.result.current.toggle("c1"); hook.result.current.toggle("g1"); });
    expect(sel(hook)).toEqual(["g1"]);
    expect(hook.result.current.dirty).toBe(true);
    await act(async () => { await hook.result.current.save(); });
    expect(hook.port.assignTerms).toHaveBeenCalledWith({ contentType: "post", contentId: "p1", termIds: ["g1"] });
    expect(hook.port.unassignTerms).toHaveBeenCalledWith({ contentType: "post", contentId: "p1", termIds: ["c1"] });
    expect(hook.result.current.message).toBe("tr(Categories & tags saved.)");
    await waitFor(() => expect(hook.port.assignedTerms).toHaveBeenCalledTimes(2));
  });

  it("shows the save error and no saved message when the save is rejected", async () => {
    const hook = await loaded();
    hook.port.assignTerms.mockRejectedValueOnce(new Error("denied"));
    act(() => hook.result.current.toggle("g1"));
    await act(async () => { await hook.result.current.save(); });
    expect(hook.result.current.message).toBeNull();
    await waitFor(() => expect(hook.result.current.error).toBe("denied|tr(Failed to save categories & tags)"));
  });

  it("drops an unsaved draft when the edited content changes", async () => {
    const hook = await loaded();
    act(() => hook.result.current.toggle("g1"));
    hook.rerender({ contentId: "p2" });
    await waitFor(() => expect(hook.result.current.dirty).toBe(false));
  });

  it("hides itself when the site has no taxonomies, and reports a load failure", async () => {
    const hidden = await loaded({ groups: [] });
    expect(hidden.result.current.hidden).toBe(true);
    const port = memoryPort();
    port.assignedTerms.mockRejectedValue(new Error("offline"));
    const failing = renderHook(() => useTermPicker({ target: { contentType: "page", contentId: "x" }, port: port as unknown as TermPickerPort, locale: "en", kit }));
    await waitFor(() => expect(failing.result.current.error).toBe("offline|tr(Failed to load categories & tags)"));
  });
});

describe("useTermPicker add flow", () => {
  it("offers no add input or trigger without the manage permission", async () => {
    const hook = await loaded({ permissions: [] });
    expect(hook.result.current.canCreate).toBe(false);
    expect(hook.result.current.showAddInput("tags")).toBe(false);
    expect(hook.result.current.showAddTrigger("tags")).toBe(false);
  });

  it("shows a flat taxonomy's input at once and a populated hierarchical one only after opening it", async () => {
    const hook = await loaded();
    await waitFor(() => expect(hook.result.current.canCreate).toBe(true));
    expect(hook.result.current.showAddInput("tags")).toBe(true);
    expect(hook.result.current.showAddInput("cats")).toBe(false);
    expect(hook.result.current.showAddTrigger("cats")).toBe(true);
    expect(hook.result.current.showAddInput("nope")).toBe(false);
    act(() => hook.result.current.setAddOpen("cats", true));
    expect(hook.result.current.showAddInput("cats")).toBe(true);
    act(() => hook.result.current.onNewTermKeyDown("cats", key("Escape")));
    expect(hook.result.current.showAddInput("cats")).toBe(false);
  });

  it("adds comma-separated names to a flat taxonomy on ',', reusing an existing term and creating the new one", async () => {
    const hook = await loaded();
    await waitFor(() => expect(hook.result.current.canCreate).toBe(true));
    act(() => hook.result.current.setNewTermName("tags", "ideas, Fresh"));
    const composing = key(",", true);
    act(() => hook.result.current.onNewTermKeyDown("tags", composing));
    const other = key("a");
    act(() => hook.result.current.onNewTermKeyDown("tags", other));
    expect(composing.preventDefault).not.toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
    const comma = key(",");
    await act(async () => { hook.result.current.onNewTermKeyDown("tags", comma); });
    expect(comma.preventDefault).toHaveBeenCalledOnce();
    await waitFor(() => expect(sel(hook)).toEqual(["c1", "g1", "new-1"]));
    expect(hook.port.createTerm).toHaveBeenCalledTimes(1);
    expect(hook.port.createTerm).toHaveBeenCalledWith({ taxonomyId: "tags", name: "Fresh" });
    expect(hook.result.current.newTermName("tags")).toBe("");
  });

  it("keeps the typed name, ticks what was resolved and shows the create error when a create fails", async () => {
    const hook = await loaded();
    await waitFor(() => expect(hook.result.current.canCreate).toBe(true));
    hook.port.createTerm.mockRejectedValueOnce(new Error("taken"));
    act(() => hook.result.current.setNewTermName("tags", "Ideas, Broken"));
    await act(async () => { await hook.result.current.addTerm("tags"); });
    expect(sel(hook)).toEqual(["c1", "g1"]);
    expect(hook.result.current.newTermName("tags")).toBe("Ideas, Broken");
    expect(hook.result.current.createError("tags")).toBe("taken|tr(Failed to create term)");
    expect(hook.result.current.createError("cats")).toBeNull();
    act(() => hook.result.current.setNewTermName("tags", "Ideas"));
    expect(hook.result.current.createError("tags")).toBeNull();
  });

  it("ticks a picked suggestion that names an existing term, and only fills the input for a new name", async () => {
    const hook = await loaded();
    expect(hook.result.current.suggestions("tags")).toEqual(["Ideas"]);
    expect(hook.result.current.suggestions("cats")).toEqual([]);
    act(() => hook.result.current.pickSuggestion("tags", "Brand new"));
    expect(hook.result.current.newTermName("tags")).toBe("Brand new");
    act(() => hook.result.current.pickSuggestion("tags", "Ideas"));
    expect(sel(hook)).toEqual(["c1", "g1"]);
    expect(hook.result.current.newTermName("tags")).toBe("");
    await act(async () => { await hook.result.current.addTerm("tags"); await hook.result.current.addTerm("nope"); });
    expect(hook.port.createTerm).not.toHaveBeenCalled();
  });
});
