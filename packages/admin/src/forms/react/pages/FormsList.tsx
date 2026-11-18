import { DataTable } from '../../../react/components/DataTable.js';
import { useWiredFormsList } from '../hooks/use-forms-list.hooks.js';
import { useFormsListView } from '../hooks/forms-view.hooks.js';
import { FormsListDeleteDialog, FormsListHeader, formsListColumns } from '../components/FormsListParts.js';
/**
 * @file Forms list screen (SPEC-010 ui.spec.md §2.1/§3.1) — the `/admin/forms` route.
 * Mirrors `Menus.tsx`/`Posts.tsx`'s fetch/loading/error/table convention. Layout now follows the
 * Posts/Media page-primitive pass (`.page`/`.page-header`/`.card`/`.table-scroll`/`.empty-state`,
 * see `styles.css`) instead of the bare `.editor-header` this screen used before — see
 * `FormEditor.tsx`'s file comment for the fuller rationale (both screens were audited together).
 *
 * Row actions: `Posts.tsx`/`Pages.tsx`'s `RowMenu` pattern, INCLUDING a Delete item (T7a,
 * 2026-09-21) — `api.ts`'s generic `trash` route (`POST /trash/items`, `type: "form"`) now covers
 * forms, so there is a server capability to wire. Reached through `RowMenu`'s "Delete" ->
 * `ConfirmDialog` ("Move to trash?") -> `useFormsList`'s `removeForm`, the same three-step gate
 * `Posts.tsx`/`Pages.tsx` already use for their own row deletes; see `use-forms-list.hooks.ts`'s own
 * doc for why a click alone can never delete. What ALSO exists (unchanged by this pass) is
 * `api.updateForm`'s `status` patch, the exact call `FormEditor.tsx`'s own Disable/Enable button
 * already makes — surfaced here too so an operator doesn't have to open the editor just to toggle
 * it. That action stays un-confirmed: `FormEditor.tsx` treats it as reversible either direction (no
 * confirm step there either), so this list doesn't invent a heavier gate the editor itself doesn't
 * have. `.btn-warning`'s tone applies only going active -> disabled, same asymmetry as
 * `FormEditor.tsx`'s "Re-enabling is the safe direction" comment.
 *
 * ## Markup only
 *
 * State, the load effect, and the `api.*` calls live in `hooks/use-forms-list.hooks.ts`. That hook
 * was written during the hooks extraction but never wired — this component kept a byte-identical
 * inline copy of the same logic, so the hook was dead code and this screen was never actually
 * markup-only. Wired here; the duplicate is gone. The two copies had NOT drifted, so this is a
 * pure de-duplication with no behaviour change.
 */
export interface FormsListProps {
  /**
   * Dependency injection seam for tests — see `RedirectsProps.useRedirectsHook` for the
   * convention. Defaulted to the real hook, so `panels.tsx` passes nothing.
   */
  useFormsListHook?: typeof useWiredFormsList;
  /** Same seam for the view-model hook that builds the table rows. */
  useFormsListViewHook?: typeof useFormsListView;
}

export function FormsList({ useFormsListHook = useWiredFormsList, useFormsListViewHook = useFormsListView }: FormsListProps = {}, _optional: Record<string, never> = {}) {
  const { forms, formatFormDates, error, rowSavingId, toggleStatus, pendingDelete, setPendingDelete, removeForm, t } = useFormsListHook();

  const { rows, cancelDelete, headerActions } = useFormsListViewHook({ forms, t, formatFormDates, toggleStatus, setPendingDelete });

  if (error && !forms) return <div className="notice error">{error}</div>;
  if (!forms) return <div className="notice">{t("Loading forms…")}</div>;

  // Form ids are stable and unique, so they disambiguate one row's edit link from another's —
  // same reasoning as every other list on this workstream. Each row's "Actions" menu (Edit/Disable/
  // Enable via `RowMenu`) shares this same per-row base (`${form.rowHandle}-menu`) now that
  // `RowMenu` (`@jini-ai/admin/react`) accepts an `agentHandle` prop — before this session it
  // published none, so its trigger and dropdown items were invisible to `page.find_elements`
  // regardless of what this file did. The Disable/Enable action also stays reachable another way:
  // `FormEditor.tsx`'s own status toggle (`form-editor-status-toggle`) does the identical
  // `api.updateForm({ status })` call.
  return (
    <div className="page">
      <FormsListHeader headerActions={headerActions} t={t} />
      {error ? <div className="notice error">{error}</div> : null}
      <DataTable<(typeof rows)[number]>
        rows={rows}
        rowKey={(form) => form.id}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t("No forms yet.")}</p>
              <p className="page-description">{t("Create your first form to start collecting submissions.")}</p>
            </div>
          </div>
        }
        columns={formsListColumns({ t })}
      />
      <FormsListDeleteDialog pendingDelete={pendingDelete} rowSavingId={rowSavingId} removeForm={removeForm} cancelDelete={cancelDelete} t={t} />
    </div>
  );
}

export default FormsList;
