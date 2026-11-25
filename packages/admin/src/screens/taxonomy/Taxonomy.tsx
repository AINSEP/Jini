import type { AdminTaxonomy, AdminTerm } from "./api/taxonomy-api.types.js";
import { useState, type JSX, type ReactNode } from "react";
import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { TaxonomyController } from "./hooks/use-taxonomy.hooks.js";
import type { TaxonomyScreenHooks, TaxonomyScreenParts, Translate } from "./taxonomy-screen-parts.js";
import { namespaceList } from "./TaxonomyTermList.js";
import { TermDetailPanel } from "./TermDetailPanel.js";

/**
 * @file Categories & Tags screen (design-spec.md §2, ADR-044) — the `/admin/taxonomy` route.
 * Markup only.
 *
 * State and API calls live in one hook per component: `hooks/use-new-term-form.hooks.ts`,
 * `hooks/use-new-taxonomy-form.hooks.ts`, `hooks/use-merge-term-section.hooks.ts`,
 * `hooks/use-term-detail-panel.hooks.ts`, `hooks/use-taxonomy.hooks.ts` (the top-level screen).
 * `termDepth`, `otherMergeTargets`, and `findSelectedTerm` (used inside `use-taxonomy.hooks.ts`)
 * live in `rules.ts`. Every hook is a REQUIRED prop of {@link Taxonomy}: the host binds each one to
 * its live port, locale and kit, and also passes its status-label component and publish button.
 *
 * Structural reference, CORRECTED (web-design pass, 2026-08-05): the original comment here named
 * `Settings.tsx`'s two-pane namespace-list + detail-panel layout as the structural reference. That
 * was wrong on inspection — `panels.tsx` routes `/admin/settings` to `SettingsUi.tsx` (the
 * dialog-shell port), not to `Settings.tsx`, which was `features/settings-raw`'s SPEC-007 raw
 * namespace/key ledger inspector, a debug tool for engineers to browse `content.db` layer-by-layer
 * (since deleted — `/settings` was judged to cover the same rows on its own).
 * This screen DOES still borrow that debug tool's `.settings-body`/`.settings-row`/
 * `.settings-namespace-*` classes (true, unlike the old comment's framing of them as a deliberate
 * parity choice) — and that borrowing is exactly why the owner flagged this screen as looking worse
 * than `Posts.tsx`/`Media.tsx`/`Menus.tsx`: `.settings-body`'s grid permanently reserves a detail
 * column even with no term selected (a dead void `Posts.tsx`'s full-width `DataTable` never has),
 * `.settings-namespace-group`'s padding is tighter than `.card`'s, and `.settings-row-key`/
 * `.settings-detail-panel h2` render term/taxonomy names in `--font-mono` — correct for the ledger's
 * `namespace.key` strings, wrong for ordinary content names. Fixed below with three additive,
 * taxonomy-scoped overrides in `styles.css` (`jini-taxonomy-namespace-group`/`jini-taxonomy-term-list`/
 * `jini-taxonomy-term-detail`) plus one JSX change (the detail column only renders once a term is
 * selected) — the base `.settings-*` rules in `styles.css` are left untouched, since the
 * now-deleted ledger tool's own two-pane layout and monospace keys were correct for what IT showed,
 * and this screen is now their only consumer.
 *
 * Scope note (disclosed): list/create-taxonomy/create-term/rename-term/assign-terms/merge-term are
 * backed by real routes; merge-term (ADR-044, SPEC-018 C-207) is wired to the real
 * `core/gated-mutations`-backed ceremony (Session 5-6 backend gap closure). Reparent and Deprecate
 * — named in design-spec.md §2.3/§2.4 — still have no route (`renameTerm`'s own route only accepts
 * `newName`, no `parentId`; no deprecate-term route was wired). Rather than render dead buttons for
 * those two, this screen omits them entirely.
 *
 * Also disclosed: the production `Term` type (`@jini-ai/cms`'s `taxonomy/write-service.ts`) has no `slug`
 * field — design-spec.md §2.3 assumed one; this screen does not render a slug control.
 *
 * `NewTaxonomyForm` wires the previously-unused `api.createTaxonomy` — a plain
 * name + hierarchical-toggle form above the taxonomy list, reusing `NewTermForm`'s shape.
 *
 * Web-design pass (2026-08-05): both create forms used to render permanently open, which is why
 * this screen read as heavier/different from every sibling list screen (`Media.tsx`,
 * `@jini-ai/admin/comments/react`, `Menus.tsx`, `Integrations.tsx`) — those default to a compact list with the
 * create form collapsed behind a `.page-actions` header button (`Integrations.tsx`'s `formOpen`
 * idiom, reused verbatim here) or a small inline trigger. `NewTaxonomyForm` now follows that same
 * toggle idiom via `useTaxonomy`'s `formOpen`; each group's `NewTermForm` gets its own collapsed
 * trigger via `useNewTermForm`'s `open` (see that hook's own comment) since a taxonomy group has no
 * header slot to put a page-level toggle in. No new classes were introduced — this reuses
 * `.page-actions`/`.btn-secondary`/`.btn-ghost` exactly as `Integrations.tsx` does.
 *
 * Delete term/taxonomy (web-design pass, 2026-08-05): the owner's other complaint — dummy
 * categories/tags created to test creation, with no way to remove them — closes here through the
 * generic single-item Trash route. Both use the same
 * `RowMenu`("Delete …") → `ConfirmDialog` idiom `Media.tsx`/`@jini-ai/admin/comments/react`/`Menus.tsx` already use
 * for their own destructive actions — no new interaction pattern introduced. State (the pending
 * row, the busy flag, and the *blocked* outcome) lives in `useTaxonomy`; see that hook's own comment
 * for why a 409 refusal is a distinct state from a hard failure. `deleteTermBlocked`/
 * `deleteTaxonomyBlocked` render as a scoped `.notice.error` inside the specific group whose term or
 * taxonomy was refused, naming the remedy (`rules.ts`'s `describeDeleteBlocked`) — never a silent
 * disabled control.
 */

export interface TaxonomyProps extends TaxonomyScreenParts {
  /** The screen's top-level state hook — the host's bound `useTaxonomy` (or a test double). */
  useTaxonomyHook: () => TaxonomyController;
  /** The host's "publish this section" control, placed first in the page header's actions. */
  publishButton: ReactNode;
}

export interface NewTaxonomyFormProps {
  onCreated: () => void;
  /** Translator closure — see `Taxonomy()`'s own `t`. */
  t: Translate;
  useNewTaxonomyFormHook: TaxonomyScreenHooks["useNewTaxonomyFormHook"];
}

/** New-taxonomy form (REQ-02) — name + hierarchical toggle, calling `api.createTaxonomy`. Mirrors
 * `NewTermForm`'s local-state/submit/error shape. */
function NewTaxonomyForm(props: NewTaxonomyFormProps): JSX.Element {
  const { onCreated, t } = props;
  const { name, setName, hierarchical, setHierarchical, error, saving, submit } = props.useNewTaxonomyFormHook({ onCreated });

  return (
    <form className="jini-notice jini-taxonomy-new-term-form" onSubmit={submit}>
      <label htmlFor="new-taxonomy-name">{t("New taxonomy")}</label>
      <span className="jini-editor-actions">
        <input
          id="new-taxonomy-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("e.g. Category")}
          {...agentHandle({ handle: "taxonomy-new-name" }, { role: "field", label: "The new taxonomy's name" })}
        />
        <label>
          <input
            type="checkbox"
            checked={hierarchical}
            onChange={(e) => setHierarchical(e.target.checked)}
            {...agentHandle({ handle: "taxonomy-new-hierarchical" }, {
              role: "checkbox",
              label: "Whether this taxonomy's terms can be nested under a parent term",
            })}
          />
          {t("Hierarchical")}
        </label>
        {/* The one page-level primary — the entry point for the whole feature. Everything below
            (per-group "Add term", the merge wizard's "Plan"/"Confirm") is scoped and repeated
            rather than a single headline action, so those stay secondary; see their own comments. */}
        <button
          type="submit"
          disabled={saving}
          {...agentHandle({ handle: "taxonomy-new-submit" }, { role: "button", label: "Create this taxonomy" })}
        >
          {saving ? t("Saving…") : t("Create taxonomy")}
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

interface TaxonomyPageHeaderProps {
  formOpen: boolean;
  setFormOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  publishButton: ReactNode;
  t: Translate;
}

/** The page title plus the "New taxonomy"/"Cancel" toggle button — extracted from `Taxonomy`
 *  verbatim, same reason `Users.tsx`'s `UsersPageHeader` split off its own `formOpen` ternaries:
 *  `Taxonomy` was still 13/10 (cyclomatic over the ceiling) with them inline. */
function TaxonomyPageHeader({ formOpen, setFormOpen, publishButton, t }: TaxonomyPageHeaderProps): JSX.Element {
  return (
    <div
      className="jini-page-header"
      {...agentHandle({ handle: "taxonomy-header" }, {
        role: "region",
        label: "Categories & Tags header — page title and the New taxonomy button",
      })}
    >
      <div className="jini-page-header-text">
        <p className="jini-page-kicker">{t("Content")}</p>
        <h1 className="jini-page-title">{t("Categories & Tags")}</h1>
        <p className="jini-page-description">
          {t("Organize content with taxonomies and terms — categories, tags, and any custom hierarchy you define.")}
        </p>
      </div>
      {/* Same `formOpen` toggle idiom as `Integrations.tsx`'s "Add webhook" button — see
          `useTaxonomy`'s own comment for why this replaced the old always-open form. */}
      <div className="jini-page-actions">
        {publishButton}
        <button
          className={formOpen ? "jini-btn-secondary" : undefined}
          onClick={() => setFormOpen((v) => !v)}
          {...agentHandle({ handle: "taxonomy-new-toggle" }, {
            role: "button",
            label: "Open or close the new-taxonomy form",
          })}
        >
          {formOpen ? t("Cancel") : t("New taxonomy")}
        </button>
      </div>
    </div>
  );
}

interface TermDeleteDialogProps {
  pendingDeleteTerm: AdminTerm | null;
  deleteTermBusy: boolean;
  confirmDeleteTerm: () => Promise<void>;
  requestDeleteTerm: (term: AdminTerm | null) => void;
  t: Translate;
}

/** The term-delete confirm dialog — extracted from `Taxonomy` verbatim. */
function TermDeleteDialog({ pendingDeleteTerm, deleteTermBusy, confirmDeleteTerm, requestDeleteTerm, t }: TermDeleteDialogProps): JSX.Element {
  return (
    <ConfirmDialog
      open={pendingDeleteTerm !== null}
      agentHandle="taxonomy-delete-term"
      title={t("Move to trash?")}
      body={
        pendingDeleteTerm ? (
          <p>{t('Move "{name}" to trash?').replace("{name}", () => pendingDeleteTerm.name)}</p>
        ) : null
      }
      confirmLabel={t("Move to trash")}
      destructive
      pending={deleteTermBusy}
      onConfirm={confirmDeleteTerm}
      onCancel={() => requestDeleteTerm(null)}
    />
  );
}

interface TaxonomyDeleteDialogProps {
  pendingDeleteTaxonomy: AdminTaxonomy | null;
  deleteTaxonomyBusy: boolean;
  confirmDeleteTaxonomy: () => Promise<void>;
  requestDeleteTaxonomy: (taxonomy: AdminTaxonomy | null) => void;
  t: Translate;
}

/** The taxonomy-delete confirm dialog — extracted from `Taxonomy` verbatim. */
function TaxonomyDeleteDialog({
  pendingDeleteTaxonomy,
  deleteTaxonomyBusy,
  confirmDeleteTaxonomy,
  requestDeleteTaxonomy,
  t,
}: TaxonomyDeleteDialogProps): JSX.Element {
  return (
    <ConfirmDialog
      open={pendingDeleteTaxonomy !== null}
      agentHandle="taxonomy-delete-taxonomy"
      title={t("Move to trash?")}
      body={
        pendingDeleteTaxonomy ? (
          <p>
            {t('Move "{name}" and its terms to trash?').replace(
              "{name}",
              () => pendingDeleteTaxonomy.name,
            )}
          </p>
        ) : null
      }
      confirmLabel={t("Move to trash")}
      destructive
      pending={deleteTaxonomyBusy}
      onConfirm={confirmDeleteTaxonomy}
      onCancel={() => requestDeleteTaxonomy(null)}
    />
  );
}

interface TaxonomyNoticesProps {
  copyFeedback: string | null;
  error: string | null;
  /** No taxonomy exists yet — show the shared empty card. */
  empty: boolean;
  t: Translate;
}

/** The copy-feedback status line, the error banner and the empty card, in that order — extracted
 *  from `Taxonomy` verbatim (it was 11/10 cyclomatic with them inline). */
function TaxonomyNotices({ copyFeedback, error, empty, t }: TaxonomyNoticesProps): JSX.Element {
  return (
    <>
      {copyFeedback ? <p role="status">{copyFeedback}</p> : null}
      {error ? <div className="jini-notice jini-notice-error">{error}</div> : null}

      {empty ? (
        <div className="jini-card">
          <div className="jini-empty-state" role="status">{t("No taxonomies yet")}</div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The Categories & Tags screen. Every hook is required: the host binds each to its live port,
 * locale and kit, and passes its status label and publish button.
 * @example <Taxonomy useTaxonomyHook={useWiredTaxonomy} useNewTermFormHook={useWiredNewTermForm} … StatusLabel={ServerLabel} publishButton={<PublishButton />} />
 */
export function Taxonomy(props: TaxonomyProps): JSX.Element {
  const { publishButton, ...parts } = props;
  // Place popups outside the row scroller but inside the bridge's page scope.
  // A callback ref supplies the mounted container before any menu can open.
  const [menuPortalContainer, setMenuPortalContainer] = useState<HTMLDivElement | null>(null);
  const controller = props.useTaxonomyHook();
  const { copyFeedback, taxonomies, error, selectedTermId, setSelectedTermId, selected, load, formOpen, setFormOpen, t } = controller;
  const deleteState = {
    copyHtmlEmbed: controller.copyHtmlEmbed,
    requestDeleteTerm: controller.requestDeleteTerm,
    deleteTermBlocked: controller.deleteTermBlocked,
    requestDeleteTaxonomy: controller.requestDeleteTaxonomy,
    deleteTaxonomyBlocked: controller.deleteTaxonomyBlocked,
  };

  if (error && !taxonomies) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!taxonomies) return <div className="jini-notice">{t("Loading taxonomies…")}</div>;
  const list = namespaceList({ taxonomies, selectedTermId, setSelectedTermId, load, deleteState, menuPortalContainer, t, parts });

  return (
    <div className="jini-page" ref={setMenuPortalContainer}>
      <TaxonomyPageHeader formOpen={formOpen} setFormOpen={setFormOpen} publishButton={publishButton} t={t} />
      <TaxonomyNotices copyFeedback={copyFeedback} error={error} empty={taxonomies.length === 0} t={t} />

      {formOpen ? (
        <NewTaxonomyForm
          onCreated={() => {
            load();
            setFormOpen(false);
          }}
          t={t}
          useNewTaxonomyFormHook={parts.useNewTaxonomyFormHook}
        />
      ) : null}

      {/* Web-design pass (2026-08-05): `.settings-body` is the raw ledger's permanent two-column
          grid (`minmax(16rem,1.1fr) minmax(20rem,1.4fr)`) — reserving that second column even with
          no `selected` term left a large dead void on this screen (the concrete defect the owner
          was seeing). Only wrapping in `.settings-body` once a term IS selected means the list
          renders full-width the rest of the time, matching every reference page's full-width
          content instead of a permanently-split master/detail pane. See this file's own header
          comment for the fuller diagnosis. */}
      {selected ? (
        <div className="jini-settings-body">
          {list}
          <TermDetailPanel
            taxonomy={selected.taxonomy}
            term={selected.term}
            onRenamed={load}
            onMerged={() => {
              setSelectedTermId(null);
              load();
            }}
            t={t}
            parts={parts}
          />
        </div>
      ) : (
        list
      )}

      <TaxonomyDialogs controller={controller} />
    </div>
  );
}

/** The two delete confirm dialogs, fed straight from the screen's controller. */
function TaxonomyDialogs({ controller }: { controller: TaxonomyController }): JSX.Element {
  const { t } = controller;
  return (
    <>
      <TermDeleteDialog
        pendingDeleteTerm={controller.pendingDeleteTerm}
        deleteTermBusy={controller.deleteTermBusy}
        confirmDeleteTerm={controller.confirmDeleteTerm}
        requestDeleteTerm={controller.requestDeleteTerm}
        t={t}
      />
      <TaxonomyDeleteDialog
        pendingDeleteTaxonomy={controller.pendingDeleteTaxonomy}
        deleteTaxonomyBusy={controller.deleteTaxonomyBusy}
        confirmDeleteTaxonomy={controller.confirmDeleteTaxonomy}
        requestDeleteTaxonomy={controller.requestDeleteTaxonomy}
        t={t}
      />
    </>
  );
}

