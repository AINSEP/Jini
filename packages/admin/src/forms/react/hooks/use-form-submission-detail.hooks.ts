import type { AdminFormsPort } from "../../../core/ports/forms.js";
import { submissionView } from "../../models.js";
import type { FormsTrashPort } from "../../ports.js";
import { useFormsPorts, useFormsOptions } from "./FormsPorts.hooks.js";
import { useController } from "../../../core/react/use-controller.js";
import { createFormSubmissionDetailController, initialFormSubmissionDetailState, type FormSubmissionDetailState } from "../../controllers/form-submission-detail.controller.js";
import type { AdminFormSubmission } from "../../models.js";
import { describeApiError as describeCoreApiError } from "../../../core/transport/errors.js";
const describeApiError = (e: unknown, fallback: string) => describeCoreApiError({ e, fallback });
import { useFetchMutation, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import { KEYS, describeTrashError } from "../../rules.js";

/**
 * @file `FormSubmissionDetail`'s own state and delete action, so the detail view in
 * `FormEditor.tsx` is only markup.
 *
 * Permanent delete now confirms through a modal (S5 fix, 2026-09-20), not an inline two-click
 * button: the old `confirming`/`handleDelete` shape flipped a click's own label to "Confirm
 * delete", so a real double-click deleted the submission outright with no way to back out — the
 * same bug widgets' `trashOrPurge` had before its own `pendingPurge`/`ConfirmDialog` fix. This
 * hook now mirrors that shape one-for-one: `requestDelete` only opens the dialog (no network),
 * `cancelDelete` closes it with no request, and `confirmDelete` runs the mutation.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port` is injected — see `core/ports/forms.ts` (shared with `use-form-
 * submissions.hooks.ts`, since both read/write the same submissions list for a form) — rather than
 * importing `lib/api` directly, so a test can describe load/delete outcomes against
 * `the memory adapter` instead of stubbing global `fetch`.
 * `useWiredFormSubmissionDetail` below is the zero-argument pair `FormEditor.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the load is one `useFetchQuery` keyed on
 * `KEYS.submissionDetail(formId, submissionId)` — a query cannot commit a response belonging to a
 * prior key, which eliminates the load race an external audit flagged at this file's old line 48
 * (a plain `.then()`/`.catch()` effect with no cancellation guard) by construction. `confirmDelete`
 * is a `useFetchMutation` that `invalidates: [KEYS.submissionsList(formId)]`, so the sibling list
 * (`use-form-submissions.hooks.ts`) refreshes on its own — `props.onDeleted()` now only needs to
 * clear the caller's `selectedId` (a UI-navigation concern this hook can't own), not also trigger a
 * reload, so `FormEditor.tsx`'s `onDeleted` callback drops its own `load()` call.
 */

export interface FormSubmissionDetailController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  submission: AdminFormSubmission | null;
  error: string | null;
  /** True while the "Delete permanently?" confirm dialog should be open — opened by
   *  {@link FormSubmissionDetailController.requestDelete}, closed by
   *  {@link FormSubmissionDetailController.cancelDelete} or once
   *  {@link FormSubmissionDetailController.confirmDelete} settles. */
  confirmOpen: boolean;
  deleting: boolean;
  /** Opens the confirm dialog. No network call — a click alone can never delete. */
  requestDelete: () => void;
  /** Closes the confirm dialog with no request. */
  cancelDelete: () => void;
  /** Runs the delete. On success, calls `props.onDeleted()`. Closes the dialog in `finally`
   *  either way, so a failed delete doesn't leave the operator stuck behind it — the failure is
   *  still visible via `error` below. */
  confirmDelete: () => Promise<void>;
}

export function useFormSubmissionDetail(
  props: {
    port: AdminFormsPort;
    trash: FormsTrashPort;
    formId: string;
    submissionId: string;
    onDeleted: () => void;
    /** Bound translator — see `use-forms-list.hooks.ts`'s own header for why this arrives via
     *  injection rather than this hook calling `useAdminLocale()` itself. Optional (defaults to
     *  identity) so existing callers/tests that don't pass one keep seeing the raw English copy. */
    t?: (key: string) => string;
  },
  _optional: Record<string, never> = {}
): FormSubmissionDetailController {
  const { port, trash } = props;
  const t = props.t ?? ((key: string) => key);
  const { controller: stateController, snapshot: stateSnapshot } = useController({ create: () => createFormSubmissionDetailController({}), dependencies: [] });
  const state = stateSnapshot ?? initialFormSubmissionDetailState({});
  const confirmOpen = state.confirmOpen;
  const setConfirmOpen = (value: FormSubmissionDetailStateValue<"confirmOpen">) => stateController?.update({ key: "confirmOpen", value });
  const invalidate = useInvalidate();

  const list = useFetchQuery({
    key: KEYS.submissionDetail(props.formId, props.submissionId),
    fetch: () => port.getFormSubmission({ formId: props.formId, submissionId: props.submissionId }).then(submission => ({ data: submissionView({ submission }) })),
  });

  const deleteMutation = useFetchMutation({
    run: ({ input: _ }: { input: undefined }) => trash.trash({ type: "form_submission", id: props.submissionId }),
  }, {
    invalidates: [KEYS.submissionsList(props.formId)],
  });

  function requestDelete() {
    setConfirmOpen(true);
  }

  function cancelDelete() {
    setConfirmOpen(false);
  }

  /** T7a (2026-09-21): the confirmation mutation moves the submission to Trash through the generic
   *  `POST /trash/items` endpoint — see `adapters/http.ts`'s own doc. A 404
   *  (`describeTrashError`'s `alreadyGone`) means the submission is already gone: from
   *  the operator's point of view that's the same outcome as a successful delete, so this still calls
   *  `onDeleted()` and invalidates the list directly — `deleteMutation`'s own `invalidates` only fires
   *  on success, and a failed mutation would otherwise leave the sibling list showing a row that's
   *  already gone. */
  async function confirmDelete() {
    try {
      await deleteMutation.mutate({ input: undefined });
      props.onDeleted();
    } catch (e) {
      if (describeTrashError({ error: e instanceof Error ? e : null, fallback: "delete failed", versionChangedMessage: t("This item changed since you loaded it. Reload and try again.") }).alreadyGone) {
        invalidate({ key: KEYS.submissionsList(props.formId) });
        props.onDeleted();
      }
      // otherwise: already surfaced through deleteMutation.error -> error below
    } finally {
      setConfirmOpen(false);
    }
  }

  const submission = list.data?.data ?? null;
  // The delete's own failure outranks a background load-refresh failure — flat `if`s rather than a
  // nested ternary, per `@jini-ai/ui/fetch-query`'s `resolveFetchQueryStatus` doc on why the two carry
  // a different complexity-gate weight for the same branch count.
  let error: string | null = null;
  if (deleteMutation.error) {
    error = describeTrashError({ error: deleteMutation.error, fallback: "delete failed", versionChangedMessage: t("This item changed since you loaded it. Reload and try again.") }).message;
  } else if (list.error) {
    error = describeApiError(list.error, "failed to load submission");
  }

  return {
    submission,
    error,
    confirmOpen,
    deleting: deleteMutation.status === "pending",
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}

/**
 * Binds the real `/api/.../forms/:id/submissions` client — see
 * `adapters/http.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormEditor.tsx`
 * composes this and a test composes {@link useFormSubmissionDetail} with
 * `the memory adapter`.
 */
type FormSubmissionDetailStateValue<K extends keyof FormSubmissionDetailState> = FormSubmissionDetailState[K] | ((current: FormSubmissionDetailState[K]) => FormSubmissionDetailState[K]);

export function useWiredFormSubmissionDetail(props: { formId: string; submissionId: string; onDeleted: () => void }, _optional = {}): FormSubmissionDetailController {
  const { formsApi, formsTrash } = useFormsPorts();
  const { t } = useFormsOptions();
  return useFormSubmissionDetail({ ...props, port: formsApi, trash: formsTrash, t });
}
