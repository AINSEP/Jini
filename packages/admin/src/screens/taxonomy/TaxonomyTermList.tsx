import type { AdminTaxonomy, AdminTaxonomyWithTerms, AdminTerm } from "./api/taxonomy-api.types.js";
import type { JSX, KeyboardEvent } from "react";
import { TaxonomyRowMenu } from "./TaxonomyRowMenu.js";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { termDepth, type DeleteBlockedState } from "./rules.js";
import type { NewTermFormController } from "./hooks/use-new-term-form.hooks.js";
import type { TaxonomyScreenHooks, TaxonomyScreenParts, Translate } from "./taxonomy-screen-parts.js";

/**
 * @file The Categories & Tags screen's taxonomy list (`Taxonomy.tsx` mounts it): one card per
 * taxonomy with its term rows, row menus, blocked-delete notices and collapsed add-term form.
 */

/** Code-health pass (2026-10-20): this and the three other local components' props used to carry a
 *  `use…Hook` field that nothing could pass. They now receive their hook through the screen's
 *  required {@link TaxonomyScreenHooks}, which the host binds once at the `<Taxonomy>` call site. */
export interface NewTermFormProps {
  taxonomy: AdminTaxonomyWithTerms;
  onCreated: () => void;
  /** This group's own distinct handle base — computed once, across every rendered group, by
   *  `namespaceList` (via `buildAgentListHandles`) and passed down; a `Set`-based uniqueness
   *  search only works when it runs once over the whole list, not once per `NewTermForm` instance. */
  agentBase: string;
  /** Translator closure — see `Taxonomy()`'s own `t`. */
  t: Translate;
  useNewTermFormHook: TaxonomyScreenHooks["useNewTermFormHook"];
}

function NewTermForm(props: NewTermFormProps): JSX.Element {
  const { taxonomy, onCreated, agentBase: base, t } = props;
  const form = props.useNewTermFormHook({ taxonomy, onCreated });

  // Collapsed resting state — see this hook's own comment for why every group's form now starts
  // closed instead of permanently open. `.btn-ghost` (not `.btn-secondary`): this trigger sits
  // inline in the group's own flow, not in a `.page-actions` header slot, so it reads as a quiet
  // "add a row" affordance rather than a page-level action.
  if (!form.open) {
    return (
      <button
        type="button"
        className="jini-btn-ghost jini-taxonomy-add-term-trigger"
        onClick={() => form.setOpen(true)}
        {...agentHandle({ handle: `${base}-open` }, {
          role: "button",
          label: `Open the "add term" form for the "${taxonomy.taxonomy.name}" taxonomy`,
        })}
      >
        {t("+ Add term")}
      </button>
    );
  }

  return <NewTermFormFields taxonomy={taxonomy} base={base} t={t} form={form} />;
}

/** The open new-term form — split out of `NewTermForm`, which keeps the hook and the collapsed trigger. */
function NewTermFormFields({ taxonomy, base, t, form }: {
  taxonomy: AdminTaxonomyWithTerms;
  base: string;
  t: Translate;
  form: NewTermFormController;
}): JSX.Element {
  const { setOpen, name, setName, parentId, setParentId, error, saving, submit } = form;
  return (
    <form className="jini-notice jini-taxonomy-new-term-form" onSubmit={submit}>
      <label htmlFor={`new-term-name-${taxonomy.taxonomy.id}`}>
        {t("New term in {name}").replace("{name}", () => taxonomy.taxonomy.name)}
      </label>
      <span className="jini-editor-actions">
        <input
          id={`new-term-name-${taxonomy.taxonomy.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Term name")}
          autoFocus
          {...agentHandle({ handle: `${base}-name` }, { role: "field", label: "The new term's name" })}
        />
        {taxonomy.taxonomy.hierarchical ? (
          <select
        aria-label={t("Parent term")}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            {...agentHandle({ handle: `${base}-parent` }, {
              role: "field",
              label: "The new term's parent term, or top level — set with page.select_option, not click",
            })}
          >
            <option value="">{t("(top level)")}</option>
            {taxonomy.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
        ) : null}
        {/* Secondary — repeated once per taxonomy group, not this page's one headline create
            ("Create taxonomy" above owns that). */}
        <button
          type="submit"
          className="jini-btn-secondary"
          disabled={saving}
          {...agentHandle({ handle: `${base}-submit` }, { role: "button", label: "Add this term to the taxonomy" })}
        >
          {saving ? t("Saving…") : t("Add term")}
        </button>
        <button
          type="button"
          className="jini-btn-ghost"
          onClick={() => setOpen(false)}
          disabled={saving}
          {...agentHandle({ handle: `${base}-cancel` }, { role: "button", label: "Close this form without adding a term" })}
        >
          {t("Cancel")}
        </button>
      </span>
      {error ? (
        <span className="jini-save-error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}

/** The five `useTaxonomy` fields the list needs to offer the delete actions and show a blocked reason. */
export interface TaxonomyDeleteState {
  copyHtmlEmbed: (required: { taxonomy: AdminTaxonomy }) => Promise<void>;
  requestDeleteTerm: (term: AdminTerm | null) => void;
  deleteTermBlocked: { termId: string; state: DeleteBlockedState } | null;
  requestDeleteTaxonomy: (taxonomy: AdminTaxonomy | null) => void;
  deleteTaxonomyBlocked: { taxonomyId: string; state: DeleteBlockedState } | null;
}

/** What one taxonomy group and its term rows read from the list. */
export interface TaxonomyListContext {
  selectedTermId: string | null;
  setSelectedTermId: (id: string) => void;
  load: () => void;
  deleteState: TaxonomyDeleteState;
  menuPortalContainer: HTMLElement | null;
  t: Translate;
  parts: TaxonomyScreenParts;
}

/** Extracted so both branches above (two-column with a detail panel, or full-width alone) render
 *  the exact same list markup — see the `selected ? … : …` comment for why there are two branches
 *  at all. `jini-taxonomy-namespace-group`/`jini-taxonomy-term-list` are additive classes (see the
 *  host stylesheet's own comment on that block) that converge this list's padding and type on the
 *  reference idiom without touching the shared `.settings-*` base rules, kept as originally defined
 *  for the since-deleted `settings-raw/Settings.tsx`.
 *
 * `deleteState` (web-design pass, 2026-08-05): bundles the five `useTaxonomy` fields this list needs
 * to offer "Delete taxonomy"/"Delete term" and show a blocked-delete reason — passed as one object
 * rather than five more positional params now that this function's signature already has four.
 * (Code-health pass, 2026-10-20: the whole argument list is now that one required object, and
 * `Taxonomy` calls this once and places the same result in whichever branch renders.)
 *
 * The `buildAgentListHandles`/`Map` calls below are not `useMemo`d: this is a plain helper, not a
 * component (it is called conditionally from the `selected ? … : …` branch in `Taxonomy`'s render),
 * so it has no hook access to begin with. Each call is O(n) over one operator's own taxonomies/terms
 * (see `buildAgentListHandles`'s own `@complexity` doc) — cheap enough next to the list render it
 * feeds that hoisting the computation up into `Taxonomy` to memoize it was not judged worth the
 * added indirection. */
export function namespaceList({ taxonomies, ...context }: TaxonomyListContext & { taxonomies: AdminTaxonomyWithTerms[] }): JSX.Element {
  // Computed once, across every group, so two taxonomies whose names slugify identically still get
  // distinct handles — see `NewTermForm`'s own `agentBase` doc for why this cannot be derived
  // independently inside each group's own `NewTermForm` instance.
  const newTermFormBases = buildAgentListHandles({ prefix: "taxonomy-new-term", ids: taxonomies.map((group) => group.taxonomy.id) });
  // Same id list as `newTermFormBases` above, so a taxonomy's "Delete taxonomy" menu handle and its
  // "+ Add term" form handle share the same id-derived slug (e.g. `taxonomy-new-term-tax-a-open` /
  // `taxonomy-menu-tax-a`) — an agent reading `page.find_elements` can tell they belong to the same
  // group without cross-referencing anything else. `RowMenu`'s `agentHandle` prop only reached this
  // package this session; before that, this menu (and the per-term one below) published no handle at
  // all and its trigger/items were invisible to `page.find_elements` regardless of what this file did.
  const taxonomyMenuHandles = buildAgentListHandles({ prefix: "taxonomy-menu", ids: taxonomies.map((group) => group.taxonomy.id) });
  // Term ids are globally unique across every taxonomy, not scoped per group — same reasoning
  // `TermPicker` documents for its own flat `term-picker-term` list.
  const termHandles = buildAgentListHandles({ prefix: "taxonomy-term", ids: taxonomies.flatMap((group) => group.terms.map((term) => term.id)) }
  );
  let termHandleIndex = 0;

  return (
    <div className="jini-settings-namespace-list">
      {taxonomies.map((group, groupIndex) => {
        // Consumed in rendered (group, then term) order, matching how `termHandles` was
        // built above via the identical `flatMap` order.
        const groupTermHandles = termHandles.slice(termHandleIndex, termHandleIndex + group.terms.length);
        termHandleIndex += group.terms.length;
        return (
          <TaxonomyGroup
            key={group.taxonomy.id}
            group={group}
            menuHandle={handleAt({ list: taxonomyMenuHandles, index: groupIndex })}
            newTermFormBase={handleAt({ list: newTermFormBases, index: groupIndex })}
            termHandles={groupTermHandles}
            context={context}
          />
        );
      })}
    </div>
  );
}

/** One taxonomy's card: its header, its blocked-delete notices, its term rows and its add-term form. */
function TaxonomyGroup({ group, menuHandle, newTermFormBase, termHandles, context }: {
  group: AdminTaxonomyWithTerms;
  menuHandle: string;
  newTermFormBase: string;
  termHandles: string[];
  context: TaxonomyListContext;
}): JSX.Element {
  const { deleteState, t } = context;
  const byId = new Map(group.terms.map((term) => [term.id, term]));
  return (
    <section className="jini-settings-namespace-group jini-taxonomy-namespace-group">
      <TaxonomyGroupHeader group={group} menuHandle={menuHandle} context={context} />
      {deleteState.deleteTaxonomyBlocked?.taxonomyId === group.taxonomy.id ? (
        <p className="jini-notice jini-notice-error" role="alert">
          {t("Can't delete")} &quot;{group.taxonomy.name}&quot;: {deleteState.deleteTaxonomyBlocked.state.message}
        </p>
      ) : null}
      {group.terms.length === 0 ? (
        <p className="jini-muted-cell">{t("No terms yet.")}</p>
      ) : (
        /* `<ul>` carries native list semantics on its own — no explicit `role="list"` needed
           (it was redundant even before the row fix below). Left off entirely now rather than
           kept: an explicit `list` role formally expects `listitem`-family children, and each
           row below is now `role="button"` (see that comment), so an explicit `role="list"`
           here would assert a parent/child relationship that no longer holds. */
        <ul className="jini-settings-row-list jini-taxonomy-term-list">
          {group.terms.map((term, index) => (
            <TaxonomyTermRow key={term.id} group={group} term={term} byId={byId} termHandle={handleAt({ list: termHandles, index })} context={context} />
          ))}
        </ul>
      )}
      {deleteState.deleteTermBlocked && byId.has(deleteState.deleteTermBlocked.termId) ? (
        <p className="jini-notice jini-notice-error" role="alert">
          {t("Can't delete")} &quot;{byId.get(deleteState.deleteTermBlocked.termId)?.name}&quot;:{" "}
          {deleteState.deleteTermBlocked.state.message}
        </p>
      ) : null}
      <NewTermForm taxonomy={group} onCreated={context.load} agentBase={newTermFormBase} t={t} useNewTermFormHook={context.parts.useNewTermFormHook} />
    </section>
  );
}

/** A group's name, its "Copy HTML embed" button and its "Delete taxonomy" row menu. */
function TaxonomyGroupHeader({ group, menuHandle, context }: {
  group: AdminTaxonomyWithTerms;
  menuHandle: string;
  context: TaxonomyListContext;
}): JSX.Element {
  const { deleteState, menuPortalContainer, t } = context;
  return (
    <div className="jini-taxonomy-namespace-group-header">
      <h2>{group.taxonomy.name}</h2>
      <div className="jini-page-actions">
      <button type="button" className="jini-btn-secondary" onClick={() => deleteState.copyHtmlEmbed({ taxonomy: group.taxonomy })}>{t("Copy HTML embed")}</button>
      <TaxonomyRowMenu useTaxonomyRowMenuHook={context.parts.useTaxonomyRowMenuHook}
        portalContainer={menuPortalContainer}
        triggerLabel={t('Actions for taxonomy "{name}"').replace("{name}", () => group.taxonomy.name)}
        agentHandle={menuHandle}
        items={[
          {
            key: "delete",
            label: t("Delete taxonomy"),
            destructive: true,
            onSelect: () => deleteState.requestDeleteTaxonomy(group.taxonomy),
          },
        ]}
      />
      </div>
    </div>
  );
}

/**
 * A term row's indent depth and the parent name its accessible name announces.
 * @param required - The row's group, term and the group's id-to-term map.
 * @returns `depth` (0 on a flat taxonomy) and `parentName` (only on a hierarchical one).
 */
function termRowPlacement({ group, term, byId }: { group: AdminTaxonomyWithTerms; term: AdminTerm; byId: Map<string, AdminTerm> }): {
  depth: number;
  parentName: string | undefined;
} {
  const depth = group.taxonomy.hierarchical ? termDepth({ term, byId }) : 0;
  // Gated on `hierarchical` for the same reason `depth` is: a term's `parentId` can
  // still be set on a taxonomy that has since been switched to flat (or seeded with
  // one before hierarchical mode existed), and this row renders with zero
  // indentation either way. Without this gate the `aria-label` below announced a
  // "subcategory of" relationship a screen-reader user could not corroborate from
  // the (unindented) visual layout — an accessibility mismatch between the two
  // channels describing the same row.
  const parentName =
    group.taxonomy.hierarchical && term.parentId ? byId.get(term.parentId)?.name : undefined;
  return { depth, parentName };
}

/** One term's row: select on click/Enter/Space, its status pill and its "Delete term" row menu. */
function TaxonomyTermRow({ group, term, byId, termHandle, context }: {
  group: AdminTaxonomyWithTerms;
  term: AdminTerm;
  byId: Map<string, AdminTerm>;
  termHandle: string;
  context: TaxonomyListContext;
}): JSX.Element {
  const { selectedTermId, setSelectedTermId, deleteState, menuPortalContainer, t, parts } = context;
  const { StatusLabel } = parts;
  const { depth, parentName } = termRowPlacement({ group, term, byId });
  const isSelected = selectedTermId === term.id;
  return (
    <li
      // `role="button"` (audit finding, not "listitem"): this row is independently
      // focusable (`tabIndex={0}`) and Enter/Space-activatable below — the exact
      // keyboard contract WAI-ARIA defines for a button, not a passive list member.
      // `aria-selected` used to sit here too, but `aria-selected` is only defined for
      // `option`/`row`/`gridcell`/`tab`/`treeitem`-family roles — on `listitem` (and
      // still on `button`) it is simply dropped by the accessible-name/state
      // computation, so no screen reader or accessibility-tree consumer ever saw this
      // row's selected state (verified: `getAllByRole("listitem", { selected: true })`
      // throws `"aria-selected" is not supported on role "listitem"` — the existing
      // test only ever asserted the raw attribute string, not the computed state).
      // `aria-current` is the correct fit instead — a global state, valid on `button`,
      // meaning "the current item in a set" — and needs no matching `listbox`/`option`
      // composite-widget conversion, which would additionally imply a roving-tabindex
      // keyboard model this row does not (and, given every row is independently
      // tabbable today, should not) implement.
      role="button"
      className={`jini-settings-row${isSelected ? " is-selected" : ""}`}
      style={depth > 0 ? { marginLeft: `${depth * 1.1}rem` } : undefined}
      // Explicit now in EVERY case, not only the `parentName` branch: making this
      // row a real `role="button"` (above) means its name-from-content computation
      // now matters, and it was garbled — concatenating the term-name span and the
      // adjacent status span with no separator (verified live: "Selected Termactive"
      // for a term named "Selected Term" with status "active"). An explicit
      // `aria-label` is the fix either way, so the `parentName` case no longer needs
      // to be the only one that sets it.
      aria-label={parentName ? `${term.name}, subcategory of ${parentName}` : term.name}
      onClick={() => setSelectedTermId(term.id)}
      onKeyDown={(e) => selectOnActivationKey({ event: e, select: () => setSelectedTermId(term.id) })}
      tabIndex={0}
      aria-current={isSelected ? "true" : undefined}
    >
      {/* The handle sits on this `<span>`, not the `<li>` it lives inside: the `<li>`
          also contains the RowMenu trigger button below as a descendant, and
          `controlOf`'s wrapper-descent (`element-handles.ts` in `@jini-ai/agentic`)
          would adopt that unrelated, unpublished button as "the control" for any
          handle placed on an ancestor that contains it — silently turning
          `page.click` on this row into "open the row menu" instead of "select this
          term". A plain `<span>` has no such descendant, so `page.click`'s
          `.click()` call on it bubbles a real click event up to the `<li>`'s own
          `onClick`, exactly as a user's click would. */}
      <span
        className="jini-settings-row-key"
        {...agentHandle({ handle: termHandle }, {
          role: "button",
          label: "Select this term to view and edit its details",
        })}
      >
        {term.name}
      </span>
      <span className={`jini-status jini-status-${term.status}`}><StatusLabel value={term.status} /></span>
      {/* Stops the click before it reaches the `<li>`'s own `onClick` above — without
          this, opening the row menu (or picking an item in it) would ALSO select the
          row and pop the detail panel open behind the menu, since this trigger sits
          inside a listitem that is itself a click target. No other screen in this app
          combines a `RowMenu` with a click-to-select row, so there was no existing
          precedent to follow here. */}
      <span onClick={(e) => e.stopPropagation()}>
        <TaxonomyRowMenu useTaxonomyRowMenuHook={parts.useTaxonomyRowMenuHook}
          portalContainer={menuPortalContainer}
          triggerLabel={t('Actions for term "{name}"').replace("{name}", () => term.name)}
          agentHandle={`${termHandle}-menu`}
          items={[
            {
              key: "delete",
              label: t("Delete term"),
              destructive: true,
              onSelect: () => deleteState.requestDeleteTerm(term),
            },
          ]}
        />
      </span>
    </li>
  );
}

/**
 * A term row's keyboard select: Enter or Space on the row itself (not on its row-menu trigger).
 * @param required - The key event and the row's select action.
 */
function selectOnActivationKey({ event, select }: { event: KeyboardEvent<HTMLLIElement>; select: () => void }): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    select();
  }
}

/**
 * One row's entry of a handle list built over the same rows; a gap would be a bug, so it throws.
 * @param required - The handle list and the row's index in it.
 * @returns That row's handle.
 */
function handleAt({ list, index }: { list: readonly string[]; index: number }): string {
  const handle = list[index];
  if (handle === undefined) throw new Error(`taxonomy list row ${index} has no agent handle`);
  return handle;
}
