import type { AdminFormsPort } from "../../../core/ports/forms.js";
import { formView } from "../../models.js";
import type { FormsTrashPort, FormsEventsPort } from "../../ports.js";
import { useFormsPorts, useFormsOptions } from "./FormsPorts.hooks.js";
import { useController } from "../../../core/react/use-controller.js";
import { createFormsListController, initialFormsListState, type FormsListState } from "../../controllers/forms-list.controller.js";
import { useCallback, useEffect, useMemo } from "react";
import type { AdminFormDefinition } from "../../models.js";
import { useFetchMutation, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import { KEYS, describeTrashError, formDatesLines, formsListError, newestUpdatedForms, type FormDateLine } from "../../rules.js";

/**
 * @file Everything the Forms LIST does, so `FormsList.tsx` is only markup.
 *
 * Moved from the host — same state, same order, same effect, same error strings. Naming follows
 * `hooks/use-settings-slice.hooks.ts` and `hooks/use-dirty-guard.hooks.ts`: `use-<thing>.hooks.ts`.
 * Feature-local because nothing outside `features/forms` needs it; promote to `src/hooks/` only
 * when a second feature actually does.
 *
 * `port` is injected — see `core/ports/forms.ts` (shared with `use-form-editor.hooks.ts`, since
 * both read/write the same `AdminFormDefinition` resource) — rather than importing `lib/api`
 * directly, so a test can describe list/write outcomes against `the memory adapter` instead of
 * stubbing global `fetch`. `useWiredFormsList` below is the zero-argument pair `FormsList.tsx`
 * actually mounts.
 *
 * `t` (standing i18n rule — a component with a hook gets a BOUND `t` from that hook, not its own
 * `useAdminLocale()`/dictionary import, same shape `use-post-editor.hooks.ts` established for this
 * conversion): injected alongside `port` rather than `FormsList.tsx` importing `useAdminLocale`
 * and `FORMS_DICT` itself. Pre-bound to `(key: string) => string` so a test can inject
 * `t: (k) => k` and every assertion stays stable against copy changes. `useAdminLocale()` and
 * `FORMS_DICT` are called/read only inside {@link useWiredFormsList}.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `toggleStatus` is one `useFetchMutation` that
 * `invalidates: [KEYS.list]` — same idiom `use-taxonomy.hooks.ts`'s deletes use, so this list stays
 * in sync with a status change made from `FormEditor.tsx` too (a `KEYS.list`-invalidating write
 * elsewhere in the app, not just this screen's own toggle). This DOES cost one extra background GET
 * per toggle that the pre-migration `setForms((prev) => prev.map(...))` optimistic patch avoided —
 * a deliberate trade for cross-screen consistency (`@jini-ai/ui/fetch-query`'s own header names
 * this exact "two screens showing the same resource silently drift apart" bug as the reason the
 * library exists at all); `FormsList.unit.test.tsx`'s old "only one GET" assertion is updated
 * accordingly, not preserved. `rowSavingId` lives in the section controller rather than reading off the
 * mutation directly — one shared `useFetchMutation` object has no per-call "which row" of its own,
 * the exact case this migration's own dispatch brief calls out as the intended `useState` out.
 *
 * the scoped formsEvents subscription (staleness-bug generalization pass, see that hook's own header):
 * `forms_create_definition`/`forms_update_definition`/`forms_set_definition_status`
 * (`apps/website/src/features/forms/agent-tools.ts`) are agent-callable, so this list re-invalidates
 * `KEYS.list` on an out-of-band content-refresh notification the same way `use-taxonomy.hooks.ts`
 * does for its own resource.
 */

export interface FormsListController {
  forms: AdminFormDefinition[] | null;
  /** The "Created / Updated" cell's one or two lines — see `rules.ts`'s `formDatesLines`. */
  formatFormDates: (form: AdminFormDefinition) => FormDateLine[];
  error: string | null;
  /** In-flight row action (status toggle, or the confirmed delete) — one at a time, same
   *  `rowSavingId` convention `Posts.tsx`/`Pages.tsx` use for their own row actions. Shared between
   *  {@link FormsListController.toggleStatus} and {@link FormsListController.removeForm} so a
   *  Disable click and a Delete confirm on two different rows can never race each other. */
  rowSavingId: string | null;
  /** No-op while a previous call is still in flight (`rowSavingId` set) — see this function's own
   *  comment; the caller never has to guard against a double toggle itself. */
  toggleStatus: (form: AdminFormDefinition) => Promise<void>;
  /** The form a `RowMenu` "Delete" selection is asking to confirm; `null` when the `ConfirmDialog`
   *  is closed. `FormsList.tsx` drives the dialog's `open` prop from this. */
  pendingDelete: AdminFormDefinition | null;
  setPendingDelete: (form: AdminFormDefinition | null) => void;
  /** Runs the trash move for {@link FormsListController.pendingDelete}. No-op with no
   *  `pendingDelete` (Cancel never reaches the port) or while another row action is already
   *  in-flight (`rowSavingId` set) — see this function's own comment. */
  removeForm: () => Promise<void>;
  /** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `FormsList.tsx` calling `useAdminLocale()`/`FORMS_DICT` directly. */
  t: (key: string) => string;
}

export function useFormsList(
  deps: { port: AdminFormsPort; trash: FormsTrashPort; t: (key: string) => string; events?: FormsEventsPort },
  { locale = "en" }: { locale?: string } = {},
): FormsListController {
  const { port, trash, t, events } = deps;
  const list = useFetchQuery({ key: KEYS.list, fetch: () => port.listFormDefinitions({}).then(data => ({ data: data.map(form => formView({ form })) })) });
  const invalidate = useInvalidate();
  // Stable identity — see `use-media.hooks.ts`'s identical `invalidateList` for why an inline arrow
  // here would resubscribe the scoped formsEvents subscription on every render for no benefit.
  const invalidateList = useCallback(() => invalidate({ key: KEYS.list }), [invalidate]);
  useEffect(() => events?.subscribe({ onRefresh: invalidateList }), [events, invalidateList]);
  const { controller: stateController, snapshot: stateSnapshot } = useController({ create: () => createFormsListController({}), dependencies: [] });
  const state = stateSnapshot ?? initialFormsListState({});
  const rowSavingId = state.rowSavingId;
  const setRowSavingId = (value: FormsListStateValue<"rowSavingId">) => stateController?.update({ key: "rowSavingId", value });

  const toggleMutation = useFetchMutation({
    run: ({ input: form }: { input: AdminFormDefinition }) =>
      port.updateFormDefinition({ id: form.id }, { status: form.status === "active" ? "disabled" : "active" }),
  }, {
    invalidates: [KEYS.list],
  });

  // The form a `RowMenu` "Delete" selection is asking to confirm — `null` when the `ConfirmDialog`
  // is closed. `ConfirmDialog` stays mounted unconditionally in `FormsList.tsx`; this is what drives
  // its `open` prop — same shape `use-posts.hooks.ts`'s `pendingDelete` uses for its own row delete.
  const pendingDelete = state.pendingDelete;
  const setPendingDelete = (value: FormsListStateValue<"pendingDelete">) => stateController?.update({ key: "pendingDelete", value });

  const deleteMutation = useFetchMutation({
    run: ({ input: form }: { input: AdminFormDefinition }) => trash.trash({ type: "form", id: form.id }),
  }, {
    invalidates: [KEYS.list],
  });

  // In-flight guard lives here, not in `FormsList.tsx`'s `onToggleStatus` closure — `RowMenu` has no
  // per-item `disabled`, so this is what stops a second toggle firing while the first is still
  // saving. Same shape `use-redirects.hooks.ts`'s own `onToggleStatus` uses for its identical
  // `if (saving) return;` guard (that hook's own comment on why: `disabled={saving}` on the old
  // inline buttons moved into each handler once `RowMenu` replaced them). Shared `rowSavingId` with
  // `removeForm` below (T7a) — only clears THIS row's own lock in `finally`, so a Delete confirm on
  // a DIFFERENT row that lands while this toggle is still in flight doesn't get its own lock wiped,
  // same guard `use-posts.hooks.ts`'s `togglePostPublish`/`removePost` pair documents.
  async function toggleStatus(form: AdminFormDefinition) {
    if (rowSavingId) return;
    setRowSavingId(form.id);
    try {
      await toggleMutation.mutate({ input: form });
    } catch {
      // already surfaced through toggleMutation.error -> error below
    } finally {
      setRowSavingId((cur) => (cur === form.id ? null : cur));
    }
  }

  /** Moves `pendingDelete` to the Trash via `formsTrash.trash` — reached only through the
   *  `ConfirmDialog`'s Confirm button, never the `RowMenu` selection itself (that only opens the
   *  dialog via `setPendingDelete`), so a click alone can never delete. A 404 (`describeTrashError`'s
   *  `alreadyGone`) means the row is already gone: a quiet list refresh instead of an error banner
   *  blaming the operator for something that already happened — see that function's own doc. Every
   *  other outcome closes the dialog and leaves the failure (if any) for `error` below to surface. */
  async function removeForm() {
    if (!pendingDelete) return;
    if (rowSavingId) return;
    const form = pendingDelete;
    setRowSavingId(form.id);
    try {
      await deleteMutation.mutate({ input: form });
      setPendingDelete(null);
    } catch (e) {
      if (describeTrashError({ error: e instanceof Error ? e : null, fallback: t("failed to delete form"), versionChangedMessage: t("This item changed since you loaded it. Reload and try again.") }).alreadyGone) {
        invalidateList();
      }
      setPendingDelete(null);
    } finally {
      setRowSavingId((cur) => (cur === form.id ? null : cur));
    }
  }

  const forms = useMemo(() => list.data ? newestUpdatedForms({ forms: list.data.data }) : null, [list.data]);
  const formatFormDates = (form: AdminFormDefinition) => formDatesLines({ form, locale, t });
  const error = formsListError({
    toggleError: toggleMutation.error,
    deleteError: deleteMutation.error,
    listError: list.error,
    hasForms: forms !== null,
    deleteFallback: t("failed to delete form"),
    statusUpdateFallback: t("failed to update form status"),
    loadFormsFallback: t("failed to load forms"),
    versionChangedMessage: t("This item changed since you loaded it. Reload and try again."),
  });

  return { forms, formatFormDates, error, rowSavingId, toggleStatus, pendingDelete, setPendingDelete, removeForm, t };
}

/**
 * Binds the real `/api/.../forms` client and a `FORMS_DICT`-bound translator — see
 * `adapters/http.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormsList.tsx`
 * composes this and a test composes {@link useFormsList} with `the memory adapter` and a fake
 * `t`.
 */
type FormsListStateValue<K extends keyof FormsListState> = FormsListState[K] | ((current: FormsListState[K]) => FormsListState[K]);

export function useWiredFormsList(_required: Record<string, never> = {}, _optional = {}): FormsListController {
  const { formsApi, formsTrash, formsEvents } = useFormsPorts();
  const { t, locale } = useFormsOptions();
  return useFormsList({ port: formsApi, trash: formsTrash, ...(formsEvents === undefined ? {} : { events: formsEvents }), t }, { locale });
}
