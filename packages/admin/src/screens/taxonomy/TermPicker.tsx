import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { useId, type ComponentType, type JSX, type KeyboardEvent } from "react";
import type { AdminTaxonomyWithTerms } from "./api/taxonomy-api.types.js";
import type { TermPickerController, TermPickerTarget } from "./hooks/use-term-picker.hooks.js";
import type { useTermListReveal } from "./hooks/use-term-list-reveal.hooks.js";

/** Keep the add-term guard shared by the row's loading, pending and blank-name states. */
function termCreationDisabled({ loading, picker, id }: { loading: boolean; picker: TermPickerController; id: string }): boolean {
  return loading || picker.creating(id) || !picker.newTermName(id).trim();
}

/** The term picker's state hook: the host binds `useTermPicker` to its live port, locale and kit. */
export type UseTermPickerHook = (target: TermPickerTarget) => TermPickerController;

/** The props the picker hands the host's suggestion input (its own list, not a native `<datalist>`). */
export interface TermPickerSuggestInputProps {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: readonly string[];
  onPick: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  "aria-label": string;
  disabled: boolean;
  agentHandle: string;
  agentLabel: string;
}

/** Props of {@link TermPicker}: the content it tags, the two injected view hooks and the suggestion input. */
export interface TermPickerProps {
  /** `post`, `page`, or a collection's content-type key. */
  contentType: string;
  contentId: string;
  /** The picker's state hook — the host passes its wired `useTermPicker` binding (or a test double). */
  useTermPickerHook: UseTermPickerHook;
  /** One row's fold/search state — the host passes `useTermListReveal` (or a test double). */
  useTermListRevealHook: typeof useTermListReveal;
  /** The host's free-text input with its own suggestion list (e.g. its admin widgets' `SuggestInput`). */
  SuggestInput: ComponentType<TermPickerSuggestInputProps>;
}

/** One taxonomy row's agent handles. */
interface TermPickerRowHandles {
  addInput: string;
  addTrigger: string;
  addButton: string;
  more: string;
  search: string;
}

/** The agent handles of one picker render, keyed by term id (terms) or taxonomy row (the rest). */
interface TermPickerHandles {
  term: (termId: string) => string;
  row: (groupIndex: number) => TermPickerRowHandles;
}

type TaxonomyRow = AdminTaxonomyWithTerms["taxonomy"];
type TermRows = AdminTaxonomyWithTerms["terms"];

/**
 * @file The Categories & Tags box the post, page and collection-entry editors mount (design-spec.md
 * §1.6) — markup only. The boxes start ticked for the terms the content holds, and Save makes it hold
 * exactly the ticked ones; state, loads and the save live in `hooks/use-term-picker.hooks.ts`.
 *
 * Each row also takes a typed name — ticks the matching term or creates it — when the admin may
 * create terms (see the hook's header).
 *
 * A long row folds: it shows a few terms (ticked first) with a "See more" that reveals up to 100,
 * plus a search box past 100 — see `TermChecklist` below (owner, 2026-10-22).
 *
 * Mount it only for content that exists (a saved post/page/entry has an id to tag).
 *
 * Classes are `jini-term-picker*` plus the `jini-*` twins of the shared design classes
 * (`jini-card`/`jini-field-*`/`jini-btn-*`/`jini-save-*`); the host styles them.
 * @example <TermPicker contentType="post" contentId={id} useTermPickerHook={useWiredTermPicker} useTermListRevealHook={useTermListReveal} />
 */
export function TermPicker(props: TermPickerProps): JSX.Element | null {
  const { contentType, contentId, useTermListRevealHook, SuggestInput } = props;
  const picker = props.useTermPickerHook({ contentType, contentId });
  const { taxonomies, hidden, loading, t } = picker;

  if (hidden) return null;

  const handles = buildTermPickerHandles({ taxonomies });

  return (
    <section className="jini-card jini-term-picker">
      <h3 className="jini-card-title">{t("Categories & Tags")}</h3>
      <p className="jini-card-lead">
        {loading ? t("Loading categories & tags…") : t("Tick the categories and tags that apply, then save.")}
      </p>
      {/* One row per taxonomy: its name on the left, its terms on the right. The `<fieldset>` is
          kept for the group's accessible name (its `<legend>`); the host stylesheet's `.jini-term-picker-group`
          strips its browser border and floats the legend so it sits in the row like any label. */}
      <div className="jini-term-picker-groups">
        {taxonomies.map(({ taxonomy, terms }, groupIndex) => (
          <TermPickerGroup
            key={taxonomy.id}
            taxonomy={taxonomy}
            terms={terms}
            groupIndex={groupIndex}
            picker={picker}
            handles={handles}
            useTermListRevealHook={useTermListRevealHook}
            SuggestInput={SuggestInput}
          />
        ))}
      </div>
      <TermPickerActions picker={picker} />
    </section>
  );
}

/**
 * Every agent handle one render needs.
 * @param required - The taxonomies on screen, with their terms.
 * @returns Per-term and per-row handles.
 */
function buildTermPickerHandles({ taxonomies }: { taxonomies: readonly AdminTaxonomyWithTerms[] }): TermPickerHandles {
  // Term ids are database row ids — globally unique across every taxonomy, not just within one —
  // so one flat handle list across all taxonomies is correct.
  // Keyed by id, not render position: a row shows only some of its terms ("See more"), and a
  // term's handle must not change with what else is on screen.
  const termIds = taxonomies.flatMap(({ terms }) => terms.map((term) => term.id));
  const termHandles = buildAgentListHandles({ prefix: "term-picker-term", ids: termIds });
  const termHandleById = new Map(termIds.map((termId, index) => [termId, termHandles[index]]));
  const taxonomyIds = taxonomies.map(({ taxonomy }) => taxonomy.id);
  const rowHandles = zipRowHandles({
    addInput: buildAgentListHandles({ prefix: "term-picker-new-term", ids: taxonomyIds }),
    addTrigger: buildAgentListHandles({ prefix: "term-picker-open-new-term", ids: taxonomyIds }),
    addButton: buildAgentListHandles({ prefix: "term-picker-add-term", ids: taxonomyIds }),
    more: buildAgentListHandles({ prefix: "term-picker-more", ids: taxonomyIds }),
    search: buildAgentListHandles({ prefix: "term-picker-search", ids: taxonomyIds }),
  });
  return {
    term: (termId) => {
      const handle = termHandleById.get(termId);
      if (handle === undefined) throw new Error(`taxonomy term ${termId} has no picker handle`);
      return handle;
    },
    row: (groupIndex) => {
      const handles = rowHandles[groupIndex];
      if (handles === undefined) throw new Error(`taxonomy row ${groupIndex} has no picker handles`);
      return handles;
    },
  };
}

/**
 * Turns the per-kind handle lists (one entry per taxonomy, same order) into one record per row.
 * @param lists - Each handle kind's list, all as long as the taxonomy list.
 * @returns One {@link TermPickerRowHandles} per taxonomy.
 */
function zipRowHandles(lists: { [K in keyof TermPickerRowHandles]: string[] }): TermPickerRowHandles[] {
  return lists.addInput.map((_handle, index) => ({
    addInput: handleAt({ list: lists.addInput, index }),
    addTrigger: handleAt({ list: lists.addTrigger, index }),
    addButton: handleAt({ list: lists.addButton, index }),
    more: handleAt({ list: lists.more, index }),
    search: handleAt({ list: lists.search, index }),
  }));
}

/** One row's entry of a handle list; every list is as long as the taxonomy list, so a gap is a bug. */
function handleAt({ list, index }: { list: readonly string[]; index: number }): string {
  const handle = list[index];
  if (handle === undefined) throw new Error(`taxonomy row ${index} has no picker handle`);
  return handle;
}

/** Props shared by a taxonomy row's add controls. */
interface TermPickerRowProps {
  taxonomy: TaxonomyRow;
  picker: TermPickerController;
  handles: TermPickerRowHandles;
}

/** One taxonomy row: its legend, its checklist, its add controls and its create error. */
function TermPickerGroup({ taxonomy, terms, groupIndex, picker, handles, useTermListRevealHook, SuggestInput }: {
  taxonomy: TaxonomyRow;
  terms: TermRows;
  groupIndex: number;
  picker: TermPickerController;
  handles: TermPickerHandles;
  useTermListRevealHook: typeof useTermListReveal;
  SuggestInput: ComponentType<TermPickerSuggestInputProps>;
}): JSX.Element {
  const id = taxonomy.id;
  const showInput = picker.showAddInput(id);
  const createError = picker.createError(id);
  const rowHandles = handles.row(groupIndex);
  return (
    <fieldset className="jini-term-picker-group">
      <legend className="jini-field-label">{taxonomy.name}</legend>
      <div className="jini-term-picker-body">
        {terms.length === 0 && !showInput ? <p className="jini-field-hint">{picker.t("No terms yet.")}</p> : null}
        {terms.length > 0 ? (
          <TermChecklist
            taxonomy={taxonomy}
            terms={terms}
            picker={picker}
            handles={{ term: handles.term, more: rowHandles.more, search: rowHandles.search }}
            useTermListRevealHook={useTermListRevealHook}
          />
        ) : null}
        {picker.showAddTrigger(id) ? <TermPickerAddTrigger taxonomy={taxonomy} picker={picker} handles={rowHandles} /> : null}
        {showInput ? <TermPickerAddInput taxonomy={taxonomy} picker={picker} handles={rowHandles} SuggestInput={SuggestInput} /> : null}
        {createError ? (
          <span className="jini-save-error" role="alert">
            {createError}
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}

/** A category row's "+ Add term", which opens the add box. */
function TermPickerAddTrigger({ taxonomy, picker, handles }: TermPickerRowProps): JSX.Element {
  return (
    <button
      type="button"
      className="jini-btn-ghost jini-term-picker-add-trigger"
      onClick={() => picker.setAddOpen(taxonomy.id, true)}
      {...agentHandle({ handle: handles.addTrigger }, {
        role: "button",
        label: `Open the box for adding a new "${taxonomy.name}" term to this ${picker.subject}`,
      })}
    >
      {picker.t("+ Add term")}
    </button>
  );
}

/** A row's typed-name box and its "Add term" button. */
function TermPickerAddInput({ taxonomy, picker, handles, SuggestInput }: TermPickerRowProps & {
  SuggestInput: ComponentType<TermPickerSuggestInputProps>;
}): JSX.Element {
  const id = taxonomy.id;
  const { loading, subject, t } = picker;
  return (
    // Not a `<form>`: the box can sit inside an editor's own form; the hook's key
    // handler stops Enter from submitting it.
    <span className="jini-term-picker-add">
      {/* Our own suggestion list, not a native `<datalist>`: Chrome on macOS draws that
          as a dark bubble and adds a large ▼ to the box, unstyleable (owner,
          2026-10-10: "why does the dropdown look so funny?"). Picking a suggestion
          ticks that term right away. */}
      <SuggestInput
        aria-label={t("Term name")}
        placeholder={t("Type a name, then press Enter")}
        value={picker.newTermName(id)}
        suggestions={picker.suggestions(id)}
        onPick={(name) => picker.pickSuggestion(id, name)}
        disabled={loading}
        onValueChange={(value) => picker.setNewTermName(id, value)}
        onKeyDown={(e) => picker.onNewTermKeyDown(id, e)}
        agentHandle={handles.addInput}
        agentLabel={`A "${taxonomy.name}" term name to tag this ${subject} with — an existing one is ticked, a new one is created then ticked; press Enter`}
      />
      <button
        type="button"
        className="jini-btn-secondary"
        onClick={() => void picker.addTerm(id)}
        disabled={termCreationDisabled({ loading, picker, id })}
        {...agentHandle({ handle: handles.addButton }, {
          role: "button",
          label: `Tick the typed "${taxonomy.name}" term, creating it if it does not exist yet`,
        })}
      >
        {picker.creating(id) ? t("Saving…") : t("Add term")}
      </button>
    </span>
  );
}

/** The box's Save button and its saved/failed status. */
function TermPickerActions({ picker }: { picker: TermPickerController }): JSX.Element {
  const { subject, dirty, saving, message, error, save, t } = picker;
  return (
    // `jini-term-picker-actions` is a spacing-only hook layered on `.editor-actions`, same pattern
    // as `FormEditor.tsx`'s `.form-actions`: `.editor-actions` sets direction/gap/alignment but
    // deliberately no outer margin, and this row follows the taxonomy rows with nothing else
    // separating them. Scoped here rather than added to `.editor-actions` itself, which is
    // shared with screens where a blanket top margin would be wrong.
    <span className="jini-editor-actions jini-term-picker-actions">
      <button
        type="button"
        className="jini-btn-primary"
        onClick={save}
        disabled={saving || !dirty}
        {...agentHandle({ handle: "term-picker-save" }, {
          role: "button",
          label: `Save this ${subject}'s categories and tags as checked above`,
        })}
      >
        {saving ? t("Saving…") : t("Save categories & tags")}
      </button>
      {message ? <span className="jini-save-ok">{message}</span> : null}
      {error ? <span className="jini-save-error">{error}</span> : null}
    </span>
  );
}

/**
 * One taxonomy row's checkboxes. Shows the first few, with ticked terms first; "See more" reveals
 * up to 100 and "Show less" folds them back; past 100 a search box finds any term (owner,
 * 2026-10-22: "looking at all this up front is a lot"). What shows is `rules.ts`'s `termListView`.
 */
function TermChecklist(props: {
  taxonomy: TaxonomyRow;
  terms: TermRows;
  picker: TermPickerController;
  handles: { term: (termId: string) => string; more: string; search: string };
  useTermListRevealHook: typeof useTermListReveal;
}): JSX.Element {
  const { taxonomy, terms, picker, handles } = props;
  const { selected, toggle, loading, subject, t } = picker;
  const reveal = props.useTermListRevealHook({ terms, selected, loading });
  const listId = useId();
  return (
    <>
      {reveal.searchable ? (
        <input
          type="search"
          className="jini-term-picker-search"
          aria-label={t("Search terms")}
          aria-controls={listId}
          placeholder={t("Search terms")}
          autoComplete="off"
          value={reveal.query}
          onChange={(event) => reveal.setQuery(event.target.value)}
          {...agentHandle({ handle: handles.search }, {
            role: "field",
            label: `Filter the "${taxonomy.name}" terms shown for this ${subject} by name`,
          })}
        />
      ) : null}
      <div id={listId} className="jini-term-picker-terms">
        {reveal.shown.map((term) => (
          <label key={term.id} className="jini-form-checkbox-field">
            <input
              type="checkbox"
              checked={selected.has(term.id)}
              disabled={loading}
              onChange={() => toggle(term.id)}
              {...agentHandle({ handle: handles.term(term.id) }, {
                role: "checkbox",
                label: `Tag this ${subject} with the "${taxonomy.name}" term "${term.name}"`,
              })}
            />
            {term.name}
          </label>
        ))}
      </div>
      {reveal.canToggle ? (
        <button
          type="button"
          className="jini-link-button jini-term-picker-more"
          aria-expanded={reveal.expanded}
          aria-controls={listId}
          onClick={reveal.toggleExpanded}
          {...agentHandle({ handle: handles.more }, {
            role: "button",
            label: `Show more or fewer of the "${taxonomy.name}" terms`,
          })}
        >
          {reveal.expanded ? t("Show less") : t("See more")}
        </button>
      ) : null}
    </>
  );
}
