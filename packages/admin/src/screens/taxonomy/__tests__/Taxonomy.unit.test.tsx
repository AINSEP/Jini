// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AdminApiError } from "@jini-ai/core/admin-runtime";
import { act, cleanup, render, screen, waitFor, within } from "../../../__tests__/fetch-query-support.js";
import { useFetchMutation, useFetchQuery, useInvalidate } from "../../../react/kit.js";
import { TermPicker, type TermPickerSuggestInputProps } from "../TermPicker.js";
import { useTermListReveal } from "../hooks/use-term-list-reveal.hooks.js";
import { useTermPicker } from "../hooks/use-term-picker.hooks.js";
import { createFakeTermPickerPort } from "../hooks/term-picker-dependencies.hooks.js";
import { useTaxonomyHtmlEmbed } from "../hooks/use-taxonomy-html-embed.hooks.js";
import { Taxonomy, type TaxonomyProps } from "../Taxonomy.js";
import { useTaxonomyRowMenu } from "../TaxonomyRowMenu.hooks.js";
import type { AdminTaxonomyWithTerms, AdminTerm } from "../api/taxonomy-api.types.js";
import { createFakeTaxonomyPort } from "../hooks/taxonomy-dependencies.hooks.js";
import { createFakeMergeTermSectionPort } from "../hooks/merge-term-section-dependencies.hooks.js";
import { createFakeNewTaxonomyFormPort } from "../hooks/new-taxonomy-form-dependencies.hooks.js";
import { createFakeNewTermFormPort } from "../hooks/new-term-form-dependencies.hooks.js";
import { useTaxonomy } from "../hooks/use-taxonomy.hooks.js";
import { useMergeTermSection } from "../hooks/use-merge-term-section.hooks.js";
import { useNewTaxonomyForm } from "../hooks/use-new-taxonomy-form.hooks.js";
import { useNewTermForm } from "../hooks/use-new-term-form.hooks.js";
import { useTermDetailPanel } from "../hooks/use-term-detail-panel.hooks.js";
import type { TaxonomyHostKit } from "../taxonomy-host-kit.js";

const t = (key: string) => key;
const locale = "en";
const date = "2026-08-01T00:00:00.000Z";
const term = (id: string, name: string, parentId: string | null = null): AdminTerm => ({ id, name, taxonomyId: "topics", parentId, version: 2, status: "active", updatedAt: date });
const taxonomy = (id: string, name: string, hierarchical: boolean, terms: AdminTerm[] = []): AdminTaxonomyWithTerms =>
  ({ taxonomy: { id, name, hierarchical, updatedAt: date, version: 1, status: "active" }, terms });

function seeded() {
  return [
    taxonomy("topics", "Topics", true, [term("nature", "Nature"), term("birds", "Birds", "nature"), term("weather", "Weather")]),
    taxonomy("formats", "Formats", false),
  ];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function setup(initial = seeded()) {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const kit: TaxonomyHostKit = {
    isApiError: (e): e is AdminApiError => e instanceof AdminApiError,
    describeApiError: ({ e, fallback }) => e instanceof AdminApiError ? e.message : fallback,
    translate: ({ key }) => key,
    failures: { getGeneration: () => 0, isClipboardRefusal: () => false, publishLocalFailure: vi.fn() },
    useContentRefreshSubscription: () => {},
    useTaxonomyHtmlEmbed: input => useTaxonomyHtmlEmbed(input, { clipboard: { writeText } }),
    useFetchMutation, useFetchQuery, useInvalidate,
  };
  const port = createFakeTaxonomyPort({
    blockedError: ({ count }) => new AdminApiError({ message: "Term has children", status: 409 }, { code: "TERM_HAS_CHILDREN", body: { count } }),
  }, { groups: initial, onTrashTermBlocked: id => {
    const count = initial.flatMap(g => g.terms).filter(child => child.parentId === id).length;
    return count ? { count } : undefined;
  } });
  const newTaxonomies = createFakeNewTaxonomyFormPort();
  const newTerms = createFakeNewTermFormPort();
  const merge = createFakeMergeTermSectionPort({ overlappingContentCount: 2 });

  const props: TaxonomyProps = {
    publishButton: <button type="button">Publish categories</button>,
    StatusLabel: ({ value }) => <span>{`Status: ${value}`}</span>,
    useTaxonomyHook: () => useTaxonomy({ port, locale, t, kit }),
    useTaxonomyRowMenuHook: useTaxonomyRowMenu,
    useNewTaxonomyFormHook: options => useNewTaxonomyForm({ options, kit, locale, port: {
      createTaxonomy: async (input) => {
        const result = await newTaxonomies.createTaxonomy(input);
        port.groups.push({ taxonomy: result.taxonomy, terms: [] });
        return result;
      },
    } }),
    useNewTermFormHook: options => useNewTermForm({ options, kit, locale, port: {
      createTerm: async (target, callOptions) => {
        const result = await newTerms.createTerm(target, callOptions);
        const group = port.groups.find(g => g.taxonomy.id === target.taxonomyId);
        if (!group) throw new Error(`Unexpected taxonomy: ${target.taxonomyId}`);
        group.terms = [...group.terms, result.term];
        return result;
      },
    } }),
    useMergeTermSectionHook: options => useMergeTermSection({ options, port: merge, locale, kit }),
    useTermDetailPanelHook: options => useTermDetailPanel({ options, port, locale, kit }),
  };
  return { props, port, writeText, newTaxonomies, newTerms, merge, kit };
}

function group(name: string) {
  const section = screen.getByRole("heading", { name }).closest("section");
  if (!section) throw new Error(`Taxonomy card not found: ${name}`);
  return within(section);
}

afterEach(cleanup);

it("distinguishes a held first load, a load refusal and an empty ready list", async () => {
  const first = setup([]);
  let reject: ((error: Error) => void) | null = null;
  const list = vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; }));
  first.port.listTaxonomies = list;
  const view = render(<Taxonomy {...first.props} />);
  expect(screen.getByText("Loading taxonomies…")).toBeVisible();
  expect(screen.queryByRole("button", { name: "New taxonomy" })).toBeNull();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await act(async () => { reject?.(new AdminApiError({ message: "Catalog unavailable", status: 503 })); });
  expect(await screen.findByText("Catalog unavailable")).toBeVisible();
  expect(screen.queryByText("No taxonomies yet")).toBeNull();
  view.unmount();

  render(<Taxonomy {...setup([]).props} />);
  expect(await screen.findByText("No taxonomies yet")).toHaveAttribute("role", "status");
  expect(screen.getByRole("button", { name: "Publish categories" })).toBeVisible();
  expect(screen.getByRole("button", { name: "New taxonomy" })).toBeVisible();
});

it("validates new taxonomies and associates a new term with the parent selected in its own group", async () => {
  const user = userEvent.setup();
  const h = setup();
  render(<Taxonomy {...h.props} />);
  await screen.findByRole("heading", { name: "Topics" });
  await user.click(screen.getByRole("button", { name: "New taxonomy" }));
  await user.click(screen.getByRole("button", { name: "Create taxonomy" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Name is required.");
  expect(h.newTaxonomies.created).toEqual([]);
  await user.type(screen.getByRole("textbox", { name: "New taxonomy" }), "  Regions  ");
  await user.click(screen.getByRole("checkbox", { name: "Hierarchical" }));
  await user.click(screen.getByRole("button", { name: "Create taxonomy" }));
  expect(await screen.findByRole("heading", { name: "Regions" })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "New taxonomy" })).toBeNull();
  expect(h.newTaxonomies.created).toEqual([{ name: "Regions", hierarchical: true }]);

  const formats = group("Formats");
  expect(formats.getByText("No terms yet.")).toBeVisible();
  await user.click(formats.getByRole("button", { name: "+ Add term" }));
  expect(formats.queryByRole("combobox", { name: "Parent term" })).toBeNull();
  await user.click(formats.getByRole("button", { name: "Cancel" }));
  expect(formats.queryByRole("textbox")).toBeNull();

  const topics = group("Topics");
  await user.click(topics.getByRole("button", { name: "+ Add term" }));
  await user.click(topics.getByRole("button", { name: "Add term" }));
  expect(await topics.findByRole("alert")).toHaveTextContent("Name is required.");
  await user.type(topics.getByRole("textbox", { name: "New term in Topics" }), "  Sparrows  ");
  await user.selectOptions(topics.getByRole("combobox", { name: "Parent term" }), topics.getByRole("option", { name: "Birds" }));
  await user.click(topics.getByRole("button", { name: "Add term" }));
  expect(await topics.findByRole("button", { name: "Sparrows, subcategory of Birds" })).toBeVisible();
  expect(formats.queryByRole("button", { name: /Sparrows/ })).toBeNull();
  expect(h.newTerms.created).toEqual([{ taxonomyId: "topics", name: "Sparrows", parentId: "birds" }]);
});

it("keeps row menus independent of selection and scopes a blocked Trash response to its term", async () => {
  const user = userEvent.setup();
  const h = setup();
  const trash = vi.fn(h.port.trashTerm);
  h.port.trashTerm = trash;
  render(<Taxonomy {...h.props} />);
  await screen.findByRole("heading", { name: "Topics" });
  const topics = group("Topics");
  await user.click(topics.getByRole("button", { name: "Copy HTML embed" }));
  expect(h.writeText.mock.calls).toEqual([[`<div data-embed-config='{"type":"taxonomy","id":"Topics","mode":"html"}'></div>`]]);
  expect(await screen.findByText("Copied!")).toHaveAttribute("role", "status");
  const nature = topics.getByRole("button", { name: "Nature" });
  const menu = within(nature).getByRole("button", { name: 'Actions for term "Nature"' });
  await user.click(menu);
  expect(nature).not.toHaveAttribute("aria-current");
  await user.click(await screen.findByRole("menuitem", { name: "Delete term" }));
  const confirm = within(screen.getByRole("dialog", { name: "Move to trash?" }));
  expect(confirm.getByText('Move "Nature" to trash?')).toBeVisible();
  expect(trash).not.toHaveBeenCalled();
  await user.click(confirm.getByRole("button", { name: "Move to trash" }));
  expect(await topics.findByRole("alert")).toHaveTextContent('Can\'t delete "Nature": This term has 1 sub-term.');
  expect(group("Formats").queryByRole("alert")).toBeNull();
  expect(topics.getByRole("button", { name: "Birds, subcategory of Nature" })).toBeVisible();
  expect(trash.mock.calls).toEqual([[{ id: "nature" }]]);
});

it("navigates the detail with keyboard and clears it only after the selected taxonomy is confirmed for Trash", async () => {
  const user = userEvent.setup();
  const h = setup();
  const trash = vi.fn(h.port.trashTaxonomy);
  h.port.trashTaxonomy = trash;
  render(<Taxonomy {...h.props} />);
  const birds = await screen.findByRole("button", { name: "Birds, subcategory of Nature" });
  birds.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Birds" })).toBeVisible();
  // Selecting switches Taxonomy to its detail layout, which renders a fresh term list; read the row there.
  expect(screen.getByRole("button", { name: "Birds, subcategory of Nature" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("textbox", { name: "Rename" })).toHaveValue("Birds");
  expect(screen.queryByRole("option", { name: "Birds" })).toBeNull();

  async function confirmTopics() {
    await user.click(screen.getByRole("button", { name: 'Actions for taxonomy "Topics"' }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete taxonomy" }));
    return within(screen.getByRole("dialog", { name: "Move to trash?" }));
  }
  const first = await confirmTopics();
  expect(first.getByText('Move "Topics" and its terms to trash?')).toBeVisible();
  await user.click(first.getByRole("button", { name: "Cancel" }));
  expect(trash).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Birds" })).toBeVisible();
  const second = await confirmTopics();
  await user.click(second.getByRole("button", { name: "Move to trash" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Topics" })).toBeNull());
  expect(screen.queryByRole("heading", { name: "Birds" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Formats" })).toBeVisible();
  expect(trash.mock.calls).toEqual([[{ id: "topics" }]]);
});

it("renames the selected term and performs the three-step merge using the shown plan and token", async () => {
  const user = userEvent.setup();
  const h = setup();
  const plan = deferred<Awaited<ReturnType<typeof h.merge.planMergeTerm>>>();
  const start = vi.fn<typeof h.merge.planMergeTerm>().mockImplementation(() => plan.promise);
  const approval = deferred<Awaited<ReturnType<typeof h.merge.confirmMergeTerm>>>();
  const confirmedWrite = deferred<void>();
  const confirm = vi.fn<typeof h.merge.confirmMergeTerm>().mockImplementation(() => approval.promise);
  const execute = vi.fn<typeof h.merge.executeMergeTerm>(async ({ fromTermId, intoTermId, confirmationToken }) => {
    if (fromTermId !== "birds" || intoTermId !== "weather" || confirmationToken !== "grant-99") throw new Error("Invalid plan");
    await confirmedWrite.promise;
    await h.port.trashTerm({ id: fromTermId });
    return { mergedCount: 1 };
  });
  h.merge.planMergeTerm = start;
  h.merge.confirmMergeTerm = confirm;
  h.merge.executeMergeTerm = execute;
  render(<Taxonomy {...h.props} />);
  await user.click(await screen.findByRole("button", { name: "Birds, subcategory of Nature" }));
  const rename = screen.getByRole("textbox", { name: "Rename" });
  await user.clear(rename);
  await user.type(rename, "  Avian  ");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("heading", { name: "Avian" })).toBeVisible();
  expect(await screen.findByRole("button", { name: "Avian, subcategory of Nature" })).toBeVisible();

  expect(screen.getByRole("button", { name: "Plan merge" })).toBeDisabled();
  await user.selectOptions(screen.getByRole("combobox", { name: "Merge into" }), screen.getByRole("option", { name: "Weather" }));
  await user.click(screen.getByRole("button", { name: "Plan merge" }));
  expect(screen.getByRole("button", { name: "Planning…" })).toBeDisabled();
  expect(start.mock.calls).toEqual([[{ fromTermId: "birds", intoTermId: "weather" }]]);
  expect(execute).not.toHaveBeenCalled();
  await act(async () => plan.resolve({ planId: "plan-44", planHash: "hash-11", details: { fromTermId: "birds", intoTermId: "weather", overlapLossDisclosed: true, overlappingContentCount: 2 } }));
  expect(await screen.findByText(/This will move 2 overlapping content assignment/)).toHaveTextContent("Avian away.");
  await user.click(screen.getByRole("button", { name: "Confirm merge" }));
  expect(confirm.mock.calls).toEqual([[{ fromTermId: "birds", planId: "plan-44", planHash: "hash-11" }]]);
  expect(execute).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
  await act(async () => approval.resolve({ confirmationToken: "grant-99" }));
  await user.click(await screen.findByRole("button", { name: "Execute merge" }));
  expect(screen.getByRole("button", { name: "Merging…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Avian, subcategory of Nature" })).toBeVisible();
  await act(async () => confirmedWrite.resolve());
  await waitFor(() => expect(screen.queryByRole("button", { name: "Avian, subcategory of Nature" })).toBeNull());
  expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
  expect(screen.getByRole("button", { name: "Weather" })).toBeVisible();
  expect(execute.mock.calls).toEqual([[{ fromTermId: "birds", intoTermId: "weather", confirmationToken: "grant-99" }]]);
});

function SuggestInput({ value, onValueChange, onKeyDown, disabled, suggestions, onPick, ...props }: TermPickerSuggestInputProps) {
  return <>
    <input aria-label={props["aria-label"]} value={value} onChange={event => onValueChange(event.target.value)} onKeyDown={onKeyDown} disabled={disabled} />
    {suggestions.map(name => <button key={name} type="button" onClick={() => onPick(name)}>{`Suggest ${name}`}</button>)}
  </>;
}

it("keeps assigned terms in a filtered picker and saves the exact selection through the entry port", async () => {
  const user = userEvent.setup();
  const h = setup();
  const tags = taxonomy("topics", "Topics", false, [
    term("prior", "Already tagged"),
    ...Array.from({ length: 102 }, (_, i) => term(`topic-${i}`, `Topic ${i}`)),
    term("harbor", "Harbor special"),
  ]);
  const port = createFakeTermPickerPort({ taxonomies: [tags], assigned: ["prior"] });
  const target = { contentType: "page", contentId: "entry-91" };
  render(<TermPicker {...target} useTermPickerHook={input => useTermPicker({ target: input, port, kit: h.kit, locale })}
    useTermListRevealHook={useTermListReveal} SuggestInput={SuggestInput} />);
  const tax = within(await screen.findByRole("group", { name: "Topics" }));
  const saved = await tax.findByRole("checkbox", { name: "Already tagged", checked: true });
  expect(tax.queryByRole("checkbox", { name: "Harbor special" })).toBeNull();
  await user.click(tax.getByRole("button", { name: "See more" }));
  expect(tax.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  expect(tax.getByRole("checkbox", { name: "Topic 50" })).toBeVisible();
  await user.type(tax.getByRole("searchbox", { name: "Search terms" }), " HARBOR ");
  expect(tax.queryByRole("checkbox", { name: "Topic 50" })).toBeNull();
  expect(saved).toBeChecked();
  await user.click(tax.getByRole("checkbox", { name: "Harbor special" }));
  await user.click(saved);
  expect(port.calls).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Save categories & tags" }));
  expect(await screen.findByText("Categories & tags saved.")).toBeVisible();
  await expect(port.assignedTerms(target)).resolves.toEqual({ termIds: ["harbor"] });
  expect(port.calls).toEqual([
    { ...target, kind: "assign", termIds: ["harbor"] },
    { ...target, kind: "unassign", termIds: ["prior"] },
  ]);
  expect(tax.getByRole("checkbox", { name: "Harbor special", checked: true })).toBeVisible();
});

it("selects an existing suggestion without creating a duplicate and keeps Enter inside the picker", async () => {
  const user = userEvent.setup();
  const h = setup();
  const taxonomies = [taxonomy("topics", "Topics", false, [term("birds", "Birds"), term("trees", "Trees")])];
  const port = createFakeTermPickerPort({ taxonomies });
  const submit = vi.fn();
  render(<form onSubmit={event => { event.preventDefault(); submit(); }}>
    <TermPicker contentType="page" contentId="entry-17" useTermPickerHook={input => useTermPicker({ target: input, port, kit: h.kit, locale })}
      useTermListRevealHook={useTermListReveal} SuggestInput={SuggestInput} />
    <button type="submit">Submit editor</button>
  </form>);
  const group = within(await screen.findByRole("group", { name: "Topics" }));
  const input = await group.findByRole("textbox", { name: "Term name" });
  await user.type(input, "Bird");
  await user.click(group.getByRole("button", { name: "Suggest Birds" }));
  expect(group.getByRole("checkbox", { name: "Birds", checked: true })).toBeVisible();
  expect(input).toHaveValue("");
  await user.type(input, "Trees{Enter}");
  expect(group.getByRole("checkbox", { name: "Trees", checked: true })).toBeVisible();
  expect(port.created).toEqual([]);
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save categories & tags" }));
  expect(await screen.findByText("Categories & tags saved.")).toBeVisible();
  await expect(port.assignedTerms({ contentType: "page", contentId: "entry-17" })).resolves.toEqual({ termIds: ["birds", "trees"] });
});
