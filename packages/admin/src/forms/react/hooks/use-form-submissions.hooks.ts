import type { AdminFormsPort } from "../../../core/ports/forms.js";
import { submissionView } from "../../models.js";
import { useFormsPorts } from "./FormsPorts.hooks.js";
import { useController } from "../../../core/react/use-controller.js";
import { createFormSubmissionsController, initialFormSubmissionsState, type FormSubmissionsState } from "../../controllers/form-submissions.controller.js";
import { useCallback, useEffect, useRef } from "react";
import type { AdminFormSubmission } from "../../models.js";
import { describeApiError as describeCoreApiError } from "../../../core/transport/errors.js";
const describeApiError = (e: unknown, fallback: string) => describeCoreApiError({ e, fallback });
import { useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import { useSettlementGeneration } from "@jini-ai/ui/panel-kit";
import { KEYS } from "../../rules.js";

/**
 * @file `FormSubmissions`'s own state and paginated load, so the submissions list in
 * `FormEditor.tsx` is only markup.
 *
 * Moved from the host — same cursor-append load shape, same error strings. `load` keeps its original
 * `(cursor?: string) => void` signature rather than being split into separate "load"/"loadMore"
 * functions, so both call sites (`load(nextCursor)` for "Load more", `load()` after a submission
 * delete) carry over unchanged.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port` is injected — see `core/ports/forms.ts` (shared with `use-form-submission-
 * detail.hooks.ts`, since both read/write the same submissions list for a form) — rather than
 * importing `lib/api` directly, so a test can describe list outcomes against
 * `the memory adapter` instead of stubbing global `fetch`. `useWiredFormSubmissions`
 * below is the zero-argument pair `FormEditor.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the FIRST page is one `useFetchQuery` keyed on
 * `KEYS.submissionsList(formId)` — a query cannot commit a response belonging to a prior key, which
 * eliminates the load race an external audit flagged at this file's old line 56 (a plain
 * `.then()`/`.catch()` effect with no cancellation guard) for that page. Subsequent "Load more"
 * pages are NOT folded into that same query: `@jini-ai/ui/fetch-query`'s `QueryKey` doc binds one
 * hook to one FIXED key, and a cursor-appended page list is exactly the "moving-target key" shape
 * that doc's own Skip precedent (`useSettingsContainer`, see this migration's dispatch brief) warns
 * against faking — so accumulated pages live in the section controller, fetched directly through `port`
 * (bypassing the cache, since an appended page is not a cacheable "the current state of X", it's an
 * accumulating view built by this one screen). `pageSettlement` (`useSettlementGeneration`) guards
 * that accumulation against the SAME class of race the base query gets for free: a `loadMore` in
 * flight when `formId` changes, or when a first-page refetch (e.g. a delete's invalidate) resets
 * the list, must not append its page once it resolves — see `resetMorePages` below, which mints a
 * fresh generation on every reset so any older in-flight page fetch is superseded. A synchronous
 * `loadingMoreRef` lock, checked before minting a generation, covers the other half: two `loadMore`
 * calls issued in the SAME tick (a double click) must send only one request
 * (2026-09-20, `plan-content2.md` #3/#5/S2).
 *
 * The audit's second, more serious finding at this file — `selectedId` surviving a `formId` change
 * untouched, so a delete could fire against a submission id belonging to the PREVIOUS form while its
 * stale rows were still on screen — is fixed by the identity-reset effect below, which clears both
 * `selectedId` and the accumulated "more" pages whenever `formId` changes.
 */

export interface FormSubmissionsController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  submissions: AdminFormSubmission[] | null;
  nextCursor: string | null;
  error: string | null;
  /** The submission `FormSubmissions` is showing `FormSubmissionDetail` for — `null` shows the
   *  plain list. */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Re-fetches. Passing a cursor appends to `submissions`; omitting it replaces the list from the
   *  start (used after a submission is deleted, so the list reflects the removal). */
  load: (cursor?: string) => void;
  /** True while a "Load more" page fetch is in flight — drives the button's `disabled` and
   *  "Loading…" label in `FormEditor.tsx`. */
  loadingMore: boolean;
}

export function useFormSubmissions(props: { formId: string; port: AdminFormsPort }, _optional = {}): FormSubmissionsController {
  const { port } = props;
  const invalidate = useInvalidate();
  const firstPage = useFetchQuery({
    key: KEYS.submissionsList(props.formId),
    fetch: () => port.listFormSubmissions({ formId: props.formId }, {}).then(page => ({ data: page.items.map(submission => submissionView({ submission })), nextCursor: page.nextCursor })),
  });

  const { controller: stateController, snapshot: stateSnapshot } = useController({ create: () => createFormSubmissionsController({}), dependencies: [] });
  const state = stateSnapshot ?? initialFormSubmissionsState({});
  const morePages = state.morePages;
  const setMorePages = (value: FormSubmissionsStateValue<"morePages">) => stateController?.update({ key: "morePages", value });
  const moreCursor = state.moreCursor;
  const setMoreCursor = (value: FormSubmissionsStateValue<"moreCursor">) => stateController?.update({ key: "moreCursor", value });
  const moreError = state.moreError;
  const setMoreError = (value: FormSubmissionsStateValue<"moreError">) => stateController?.update({ key: "moreError", value });
  const selectedId = state.selectedId;
  const setSelectedId = (value: FormSubmissionsStateValue<"selectedId">) => stateController?.update({ key: "selectedId", value });
  const loadingMore = state.loadingMore;
  const setLoadingMore = (value: FormSubmissionsStateValue<"loadingMore">) => stateController?.update({ key: "loadingMore", value });

  // The "latest call wins" guard for accumulated pages — see the file header. `loadingMoreRef` is
  // the synchronous half (blocks a same-tick double `loadMore`); `pageSettlement` is the async half
  // (a superseded fetch's response must not land once a reset or a form switch has moved on).
  const loadingMoreRef = useRef(false);
  const pageSettlement = useSettlementGeneration();

  // Supersedes any in-flight "Load more" fetch and clears the accumulated pages/cursor/error back
  // to "just the first page" — called wherever the previous code did a bare `setMorePages([])`, so
  // there is one reset path instead of three ad hoc ones.
  const resetMorePages = useCallback(() => {
    pageSettlement.next();
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMorePages([]);
    setMoreError(null);
  }, [pageSettlement, stateController]);

  // One effect, not two: the identity reset below fixes the audit's data-loss finding at this
  // file — `selectedId` used to survive a `formId` change untouched, so a delete could fire
  // against a submission id belonging to the PREVIOUS form while its stale rows were still on
  // screen. `resetMorePages()` drops accumulated "more" pages, which belong to the previous form's
  // cursor walk, and supersedes any of that form's `loadMore` still in flight.
  useEffect(() => {
    setSelectedId(null);
    resetMorePages();
    setMoreCursor(null);
  }, [props.formId, resetMorePages]);

  // S2 fix: a refetched first page (e.g. S5's delete invalidating the list) must drop the "more"
  // pages it used to leave stale — they are always a continuation of the CURRENT first page, not
  // whichever first page was on screen when they were fetched. `resetMorePages()` also supersedes
  // any `loadMore` already in flight when the refetch lands, so its page can't append afterward.
  useEffect(() => {
    resetMorePages();
    setMoreCursor(firstPage.data?.nextCursor ?? null);
  }, [firstPage.data, resetMorePages]);

  async function loadMore(cursor: string) {
    if (loadingMoreRef.current) return; // #3: a same-tick double click sends only one request
    loadingMoreRef.current = true;
    const generation = pageSettlement.next();
    setLoadingMore(true);
    setMoreError(null); // #5: a retry clears the previous failure
    try {
      const r = await port.listFormSubmissions({ formId: props.formId }, { cursor });
      if (!pageSettlement.isCurrent({ generation })) return; // superseded by a reset or a form switch
      setMorePages((prev) => [...prev, ...r.items.map(submission => submissionView({ submission }))]);
      setMoreCursor(r.nextCursor);
    } catch (e) {
      if (!pageSettlement.isCurrent({ generation })) return;
      setMoreError(e instanceof Error ? e.message : "failed to load submissions");
    } finally {
      // A superseded call's lock was already released by `resetMorePages`; only the still-current
      // call releases it here.
      if (pageSettlement.isCurrent({ generation })) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  /** Passing a cursor appends via `loadMore`; omitting it re-reads the first page from scratch
   *  (used after a submission delete, so the list reflects the removal) and drops accumulated pages,
   *  matching the pre-migration `load()`'s own "no cursor replaces everything" behavior. */
  function load(cursor?: string) {
    if (cursor) {
      void loadMore(cursor);
      return;
    }
    resetMorePages();
    invalidate({ key: KEYS.submissionsList(props.formId) });
  }

  const submissions = firstPage.data ? [...firstPage.data.data, ...morePages] : null;
  const error = moreError ?? (firstPage.error ? describeApiError(firstPage.error, "failed to load submissions") : null);

  return { submissions, nextCursor: moreCursor, error, selectedId, setSelectedId, load, loadingMore };
}

/**
 * Binds the real `/api/.../forms/:id/submissions` client — see
 * `adapters/http.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormEditor.tsx`
 * composes this and a test composes {@link useFormSubmissions} with
 * `the memory adapter`.
 */
type FormSubmissionsStateValue<K extends keyof FormSubmissionsState> = FormSubmissionsState[K] | ((current: FormSubmissionsState[K]) => FormSubmissionsState[K]);

export function useWiredFormSubmissions(props: { formId: string }, _optional = {}): FormSubmissionsController {
  const { formsApi } = useFormsPorts();
  return useFormSubmissions({ ...props, port: formsApi });
}
