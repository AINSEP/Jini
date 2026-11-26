import { useCallback } from "react";
import type { AdminPost } from "../../posts/api/posts-api.types.js";

import type { usePageEditorPreview } from "./page-editor-preview.hooks.js";
import type { usePageEditorPreviewSubmit } from "./page-editor-preview.hooks.js";
import type { usePageEditorFlush } from "./page-editor-workspace.hooks.js";
export function usePageEditorRecovery(input: ReturnType<typeof usePageEditorPreview>, _optional = {}) {
  const { routeSlug, deps, navigate, t, locale, readPage, page, setError, title, slug, status, templateChoice, savedTemplateChoice, html, savedHtml, view, interactiveEditorRef, saving, saveSettlement, autosave, flushInteractiveSafely, applyExternalPage, dirty } = input;
  const { useDirtyGuard, useSettlementGeneration, useExternalEntryRefresh, useContentRefreshSubscription } = deps.hooks;
  const { PAGES_RESOURCE, window, pageDirtyGuardBaseline, pageRefreshMayHaveUnsavedEdits } = deps;

  // Content refresh (2026-09-16) — see `use-external-entry-refresh.hooks.ts`'s file header for the
  // clean/dirty/saving decision this wraps, and `PAGES_RESOURCE`'s own doc (`rules.ts`) for the bug
  // this closes: `pages_write_html`/`pages_write_region` are agent-callable, and this editor never
  // re-read its row after one fired. `loaded`/`isDirty`/`isSaving` are read through the hook's own
  // ref on every check, so listing `dirty`/`saving`/`page` in a dependency array here is unnecessary.
  // `isDirty` is wider than `dirty` on the Interactive tab — see `pageRefreshMayHaveUnsavedEdits`.
  const externalRefresh = useExternalEntryRefresh<AdminPost>({
    routeIdentity: routeSlug,
    saveSettlement,
    loaded: page,
    fetchLatest: ({ id }, _options = {}) => readPage(id).then(({ post }) => post),
    isDirty: () => pageRefreshMayHaveUnsavedEdits({ dirty, view }),
    isSaving: () => saving,
    applyLatest: applyExternalPage,
    discardStandingDraft: autosave.clearStandingDraft,
    supersedeStandingDraftBasis: autosave.supersedeBasis,
    onLoadLatestFailed: () => setError(t({ locale, key: "could not re-read the current version — your changes are still here, try again" })),
    // Its own counter instance, separate from `settlement` above (see the Jini hook's header).
    useSettlementGeneration,
  });
  useContentRefreshSubscription({ resource: PAGES_RESOURCE, onRefresh: externalRefresh.checkForExternalChange });

  // Unsaved-work guard (2026-09-06, alongside standing-draft autosave — audit finding: this screen
  // had none at all, unlike `usePostEditor`'s own `useDirtyGuard` call). Same five-field comparison
  // `dirty` above already makes (title/slug/status/body/templateChoice), just handed to the guard
  // instead of computed inline, so `confirmLeave`/the automatic `beforeunload` listener agree with
  // what the Save button itself considers dirty.
  const { confirmLeave } = useDirtyGuard(
    {
      current: { title, slug, status, html, templateChoice },
      original: pageDirtyGuardBaseline({ page, savedHtml, savedTemplateChoice }),
    },
    { host: window, translate: (key) => key },
  );

  const onBackLinkClick = useCallback(
    async (event: { preventDefault: () => void }) => {
      if (!interactiveEditorRef.current) {
        if (!confirmLeave()) event.preventDefault();
        return;
      }
      event.preventDefault();
      const flushed = await flushInteractiveSafely();
      if (!flushed.ok) return;
      if (confirmLeave({}, { unsavedBeyondTracked: flushed.html !== undefined && flushed.html !== savedHtml })) navigate("/pages");
    },
    [confirmLeave, flushInteractiveSafely, savedHtml, navigate]
  );
  return { ...input, externalRefresh, confirmLeave, onBackLinkClick };
}

export function usePageEditorRestore(input: ReturnType<typeof usePageEditorPreviewSubmit>, _optional = {}) {
  const { deps, t, locale, setError, setTitle, setSlug, setHtml, autosave, setDraftHtml, setContentRevision } = input;
  const { prettifyHtml } = deps;

  const restoreRecoveredDraft = useCallback(() => {
    const draft = autosave.recoverableDraft;
    if (!draft) return;
    setTitle(draft.title);
    setSlug(draft.slug);
    if (draft.bodyFormat === "html" && draft.bodyHtml !== undefined) {
      setHtml(draft.bodyHtml);
      // Same two re-seeds `applyExternalPage` makes: the HTML tab shows `draftHtml`, not `html`, and
      // the Interactive canvas reads `html` only at mount. Without them, restoring on either tab
      // left the old body on screen and the next edit wrote it back over the restored draft.
      setDraftHtml(prettifyHtml({ html: draft.bodyHtml }));
      setContentRevision((n) => n + 1);
    }
    autosave.dismissRecoverable();
  }, [autosave.recoverableDraft, autosave.dismissRecoverable, prettifyHtml]);

  const discardRecoveredDraft = useCallback(async () => {
    // keepOnFailure: the banner stays until the server confirms, so a failed discard is retryable.
    const { discarded } = await autosave.clearStandingDraft({}, { keepOnFailure: true });
    if (!discarded) setError(t({ locale, key: "Could not discard the recovered draft. It is still saved and the banner is still here, so you can try Discard again or Restore it." }));
  }, [autosave.clearStandingDraft, t, locale]);
  return { ...input, restoreRecoveredDraft, discardRecoveredDraft };
}

export function pageEditorRecoveryView(input: ReturnType<typeof usePageEditorFlush>, _optional = {}) {
  const { unchangedSaveHandlers } = input.deps;
  const { confirmingDelete, setConfirmingDelete, confirmingUnchangedSave, setConfirmingUnchangedSave, deleting, saveConflict, autosave, contentRevision, flushPendingEdits, save, saveOverwritingConflict, dismissSaveConflict, remove, previewFormRef, previewFormTarget, contentDirty, dirty, externalRefresh, confirmLeave, onBackLinkClick, restoreRecoveredDraft, discardRecoveredDraft, templatePreviewUrl, canvasStyling } = input;
  return {
    // HTML changes only count when they're actually savable (see `save()`'s `canSaveHtml`) — for a
    // doc-format Page, `html` never reflects real persisted content, so comparing it to `savedHtml`
    // would report edits as dirty (or, worse, as clean) independent of anything actually saveable.
    //
    // Split into `contentDirty` (title/slug/status/body) plus the `templateChoice` comparison, rather
    // than one combined expression, so `PagePreview` can tell "only the template picker moved" apart
    // from "the operator actually edited something" — see `contentDirty`'s own doc on
    // `PageEditorController` for why that distinction exists.
    contentDirty,
    dirty,
    templatePreviewUrl,
    previewFormRef,
    previewFormTarget,
    canvasStyling,
    save,
    saveConflict,
    saveOverwritingConflict,
    dismissSaveConflict,
    remove,
    confirmingDelete,
    setConfirmingDelete,
    confirmingUnchangedSave,
    ...unchangedSaveHandlers({ dirty, save: () => save(), setConfirmingUnchangedSave }, { flushPendingEdits }),
    deleting,
    confirmLeave,
    onBackLinkClick,
    recoverableDraft: autosave.recoverableDraft,
    restoreRecoveredDraft,
    discardRecoveredDraft,
    autosaveStaleBasis: autosave.staleBasis,
    pendingExternalVersion: externalRefresh.pendingExternalVersion,
    loadExternalChange: externalRefresh.loadExternalChange,
    dismissExternalChange: externalRefresh.dismissExternalChange,
    contentRevision
  };
}
