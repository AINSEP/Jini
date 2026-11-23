// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TermPicker, type TermPickerSuggestInputProps } from "../TermPicker.js";
import { useTermListReveal, type TermListReveal } from "../hooks/use-term-list-reveal.hooks.js";
import type { TermPickerController } from "../hooks/use-term-picker.hooks.js";
import type { AdminTaxonomyWithTerms } from "../api/taxonomy-api.types.js";

/**
 * @file `TermPicker`'s split markup: the hidden guard, each sub-component's `jini-term-picker*`
 * class, the add controls and the injected fold hook. The host's DOM suite covers the full flows.
 */

function taxonomy(id: string, name: string): AdminTaxonomyWithTerms["taxonomy"] {
  return { id, name, hierarchical: false, status: "active", updatedAt: "2026-08-01T00:00:00.000Z", version: 1 };
}
function term(id: string, name: string): AdminTaxonomyWithTerms["terms"][number] {
  return { id, taxonomyId: "tax1", parentId: null, name, status: "active", updatedAt: "2026-08-01T00:00:00.000Z", version: 1 };
}

const GENRE: AdminTaxonomyWithTerms = { taxonomy: taxonomy("tax1", "Genre"), terms: [term("t1", "Fiction"), term("t2", "Poetry")] };
const EMPTY: AdminTaxonomyWithTerms = { taxonomy: taxonomy("tax2", "Mood"), terms: [] };

function controller(overrides: Partial<TermPickerController> = {}): TermPickerController {
  return {
    taxonomies: [GENRE, EMPTY], hidden: false, subject: "post", selected: new Set(["t2"]), toggle: vi.fn(),
    loading: false, dirty: true, saving: false, message: "Saved.", error: null, save: vi.fn(async () => {}),
    t: (key) => key, canCreate: true, showAddInput: (id) => id === "tax1", showAddTrigger: (id) => id === "tax2",
    setAddOpen: vi.fn(), newTermName: () => "Dra", setNewTermName: vi.fn(), onNewTermKeyDown: vi.fn(),
    addTerm: vi.fn(async () => {}), pickSuggestion: vi.fn(), creating: () => false,
    createError: (id) => (id === "tax2" ? "Name taken." : null), suggestions: () => ["Drama"],
    ...overrides,
  };
}

/** A plain input standing in for the host's suggestion widget — the picker only wires its props. */
function FakeSuggestInput(props: TermPickerSuggestInputProps) {
  return <input aria-label={props["aria-label"]} value={props.value} disabled={props.disabled} onChange={(e) => props.onValueChange(e.target.value)} />;
}

function renderPicker(ctrl: TermPickerController, useReveal: typeof useTermListReveal = useTermListReveal) {
  const useHook = vi.fn(() => ctrl);
  const view = render(<TermPicker contentType="post" contentId="p1" useTermPickerHook={useHook} useTermListRevealHook={useReveal} SuggestInput={FakeSuggestInput} />);
  return { ...view, useHook };
}

describe("TermPicker", () => {
  it("renders nothing while the hook says hidden, and asks the hook for the tagged content", () => {
    const { container, useHook } = renderPicker(controller({ hidden: true }));
    expect(container.innerHTML).toBe("");
    expect(useHook).toHaveBeenCalledWith({ contentType: "post", contentId: "p1" });
  });

  it("emits the jini-term-picker frame, one group per taxonomy and the actions row", () => {
    const { container } = renderPicker(controller());
    expect(container.querySelector("section")?.className).toBe("card jini-term-picker");
    expect(container.querySelector(".jini-term-picker-groups")?.children).toHaveLength(2);
    expect(container.querySelectorAll("fieldset.jini-term-picker-group > div.jini-term-picker-body")).toHaveLength(2);
    expect(container.querySelector(".jini-term-picker-terms")?.textContent).toContain("Fiction");
    expect(container.querySelector(".editor-actions.jini-term-picker-actions .save-ok")?.textContent).toBe("Saved.");
    expect(screen.getByText("No terms yet.").className).toBe("field-hint");
    expect(screen.getByRole("alert").textContent).toBe("Name taken.");
  });

  it("wires the add trigger and the add box to their own row", () => {
    const ctrl = controller();
    const { container } = renderPicker(ctrl);
    fireEvent.click(screen.getByRole("button", { name: "+ Add term" }));
    expect(ctrl.setAddOpen).toHaveBeenCalledWith("tax2", true);
    expect(container.querySelector(".btn-ghost.jini-term-picker-add-trigger")).not.toBeNull();
    expect(container.querySelector(".jini-term-picker-add input")?.getAttribute("aria-label")).toBe("Term name");
    fireEvent.click(screen.getByRole("button", { name: "Add term" }));
    expect(ctrl.addTerm).toHaveBeenCalledWith("tax1");
    expect(container.querySelector('[data-agent-element="term-picker-open-new-term-tax2"]')).not.toBeNull();
    expect(container.querySelector('[data-agent-element="term-picker-add-term-tax1"]')).not.toBeNull();
  });

  it("reads each row's fold state from the injected reveal hook", () => {
    const toggleExpanded = vi.fn();
    const useReveal = vi.fn((): TermListReveal => ({
      shown: [term("t1", "Fiction")], searchable: true, canToggle: true, expanded: false,
      query: "", setQuery: vi.fn(), toggleExpanded,
    } as unknown as TermListReveal));
    const { container } = renderPicker(controller(), useReveal);
    expect(useReveal).toHaveBeenCalledWith({ terms: GENRE.terms, selected: new Set(["t2"]), loading: false });
    expect(container.querySelector("input.jini-term-picker-search")).not.toBeNull();
    expect(screen.queryByText("Poetry")).toBeNull();
    fireEvent.click(container.querySelector("button.link-button.jini-term-picker-more") as HTMLElement);
    expect(toggleExpanded).toHaveBeenCalled();
  });
});
