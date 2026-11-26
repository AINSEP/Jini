import { useCallback } from "react";
import type { AdminPost } from "../../posts/api/posts-api.types.js";

import type { usePageEditorPreviewWorkspace } from "./page-editor-preview.hooks.js";
export function usePageEditorSave(input: ReturnType<typeof usePageEditorPreviewWorkspace>, _optional = {}) {
  const { deps, port, navigate, t, locale, write, setPage, setError, setMessage, title, slug, setSlug, status, setStatus, templateChoice, setSavedTemplateChoice, html, setSavedHtml, setSaving, setSaveSettlement, setSaveConflict, settlement, autosave } = input;
  const { pageAdminPath, writePage, applySavedPage, applySaveFailure, readVersionConflict, isUnexpectedServerFailure, buildPageSavePlan, buildPageAutosaveDraft, pagePartialSaveMessage, pageSaveSuccessMessage, pageUnchangedSaveMessage } = deps;

  /**
   * Persists the working copy against a specific basis row — the version-guarded core both
   * {@link save} and `saveOverwritingConflict` run through.
   *
   * `basis` is the row whose `version` this write claims AND whose `bodyFormat`/`bodyJson`
   * `buildPageSavePlan` reads. Threading it as a parameter rather than closing over `page` is what
   * lets the explicit-overwrite path re-run against a freshly re-read row without waiting for a
   * `setPage` to commit — the same shape `usePostEditor`'s `runSave(statusOverride, expectedVersion)`
   * uses, one step wider because a Page's save plan needs the whole row, not just its version.
   *
   * `htmlOverride` (Interactive flush, 2026-09-23 plan): the just-flushed HTML from
   * `flushInteractiveEdits`, when its caller has one. Threaded explicitly rather than read off the
   * `html` state closed over here — `save`/`saveOverwritingConflict` await the flush BEFORE calling
   * this, but this callback's own `html` closure was captured at render time and can still be one
   * render behind that state update, the same stale-closure trap `usePostEditor`'s equivalent avoids
   * by never needing an async step in between. Falls back to `html` when omitted (undefined — nothing
   * was flushed, or there was nothing to flush).
   *
   * @complexity Time O(1) plus one or two requests; space O(1).
   */
  const runSave = useCallback(
    async (nextStatus: "draft" | "published" | undefined, basis: AdminPost, htmlOverride?: string) => {
      // Claim this call's generation BEFORE the first `await` — see `useSettlementGeneration`'s own
      // doc for why a synchronous ref bump, not `useState`, is what makes two overlapping calls each
      // see the other's claim.
      const generation = settlement.next();
      const bodyHtml = htmlOverride ?? html;
      setSaving(true);
      setError(null);
      setMessage(null);
      setSaveConflict(null);
      // What to send each route, and whether `updatePageHtml` fires at all, is `buildPageSavePlan`'s
      // decision (`../rules.ts`) — see that function's own doc, and `pageAcceptsHtmlBody`'s, for the
      // full reasoning (moved there verbatim under the 2026-08-12 complexity-ceiling pass, widened
      // 2026-09-06 so a brand-new Page's hand-authored HTML is savable at all, and given the
      // optimistic-concurrency basis 2026-09-07).
      //
      // `updatePost` needs a round-tripped `bodyJson` for every Page still in doc format
      // when metadata is written, including one the subsequent HTML route will convert:
      // `features/post/post.ts`'s `updatePost` requires it to be a JSON object for any Page
      // not already in `html` format. It is meaningless for an html-format row (no Tiptap document
      // exists) so the server skips the check there, but a doc-format row's `bodyJson` IS its real
      // content. This editor has no way to EDIT that document, so round-tripping the loaded value
      // unchanged satisfies the requirement without touching it — the alternative (omitting it)
      // throws "bodyJson must be a JSON object" and leaves title/slug/status stuck un-editable for
      // every doc-format Page.
      const plan = buildPageSavePlan({ page: basis, form: { title, slug, status, templateChoice, html: bodyHtml } }, { nextStatus });
      try {
        const updated = await write.mutate({ input: () => writePage({ port, pageId: basis.id, plan, html: bodyHtml }) }) as AdminPost;
        // A newer save/publish claimed a later generation while this call was awaiting — that call
        // owns the outcome now, so this stale response must not paint over it (2026-09-05
        // stale-settlement sweep: "last-to-settle wins" rather than "last-clicked wins").
        if (!settlement.isCurrent({ generation })) return;
        applySavedPage({
          pageSaveSuccessMessage, pageUnchangedSaveMessage,
          updated,
          form: { templateChoice, html: bodyHtml, nextStatus, basisVersion: basis.version },
          canSaveHtml: plan.canSaveHtml,
          setters: { setPage, setSlug, setStatus, setSavedTemplateChoice, setSavedHtml, setMessage },
          t,
          locale,
        });
        // The real content just landed — any parked standing draft is now obsolete. Not awaited:
        // this is best-effort background bookkeeping (errors are already caught inside the hook),
        // not part of what "Save succeeded" means to the operator.
        void autosave.clearStandingDraft();
        // A successful rename retires the old slug; reloads and shared links must use the new one.
        if (updated.slug !== basis.slug) navigate(pageAdminPath(updated), { replace: true });
      } catch (e) {
        if (!settlement.isCurrent({ generation })) return;
        autosave.preserveFailedSave({ error: e, draft: buildPageAutosaveDraft({ page: basis, form: { title, slug, html: bodyHtml } }) });
        applySaveFailure({
          readVersionConflict, isUnexpectedServerFailure, pagePartialSaveMessage,
          e,
          attemptedStatus: nextStatus,
          form: { templateChoice },
          setters: { setPage, setSlug, setStatus, setSavedTemplateChoice, setSaveConflict, setError },
          t,
          locale,
        });
      } finally {
        // Same generation check as the two branches above: only the call that is still current
        // should flip the shared `saving` flag back off, or an older call's own settlement could
        // briefly re-enable Save/Publish while a newer call is still in flight.
        if (settlement.isCurrent({ generation })) {
          setSaving(false);
          setSaveSettlement(counter => counter + 1);
        }
      }
    },
    [html, title, slug, status, templateChoice, locale, port, navigate, t, settlement, autosave.clearStandingDraft, autosave.preserveFailedSave, buildPageSavePlan, buildPageAutosaveDraft, pagePartialSaveMessage, pageSaveSuccessMessage, pageUnchangedSaveMessage]
  );
  return { ...input, runSave };
}

export function usePageEditorActions(input: ReturnType<typeof usePageEditorSave>, _optional = {}) {
  const { port, navigate, t, locale, readPage, write, page, setPage, setError, setConfirmingDelete, setDeleting, saveConflict, setSaveConflict, flushInteractiveSafely, runSave } = input;

  /**
   * Persists the working copy against the version this editor loaded — see {@link runSave}.
   *
   * Save is only reachable once `page` has loaded — `PageEditor.tsx` shows a loading notice and
   * renders no Save/Publish button until then — but the guard keeps `page.id` sound without a
   * non-null assertion, and mirrors `usePostEditor`'s identical `remove` guard.
   */
  const save = useCallback(
    async (nextStatus?: "draft" | "published") => {
      if (!page) return;
      // Interactive flush (2026-09-23 plan) — closes any RTE session still open on the Interactive
      // tab so its pending edit is part of this save, not lost. See `runSave`'s `htmlOverride` doc for
      // why the result is threaded through explicitly rather than left to `runSave`'s own `html`
      // closure.
      const flushed = await flushInteractiveSafely();
      if (!flushed.ok) return;
      await runSave(nextStatus, page, flushed.html);
    },
    [page, runSave, flushInteractiveSafely]
  );

  /**
   * The operator's explicit overwrite after a conflict — see
   * {@link PageEditorController.saveOverwritingConflict}.
   *
   * Re-reads the row purely for its current `version` and body format: the response's title/slug/
   * body are deliberately NOT applied to the working copy, because doing so is exactly the "your
   * typed work disappeared" outcome this whole path exists to avoid. `attemptedStatus` replays the
   * ORIGINAL intent, so a rejected Publish retries as a publish rather than quietly downgrading to
   * a draft. Mirrors `usePostEditor`'s `saveOverwritingConflict` verbatim.
   */
  const saveOverwritingConflict = useCallback(async () => {
    if (!page) return;
    const attemptedStatus = saveConflict?.attemptedStatus;
    const fresh = await readPage(page.id).then(({ post }) => post, () => null);
    if (!fresh) {
      setError(t({ locale, key: "could not re-read the current version — your changes are still here, try again" }));
      return;
    }
    setPage(fresh);
    // Interactive flush (2026-09-23 plan) — same reasoning as `save`'s own call.
    const flushed = await flushInteractiveSafely();
    if (!flushed.ok) return;
    await runSave(attemptedStatus, fresh, flushed.html);
  }, [page, port, runSave, saveConflict, t, locale, flushInteractiveSafely]);

  /** Hides the conflict banner without saving — see
   *  {@link PageEditorController.dismissSaveConflict}. */
  const dismissSaveConflict = useCallback(() => setSaveConflict(null), []);

  const remove = useCallback(async () => {
    if (!page) return;
    setDeleting(true);
    setError(null);
    try {
      await write.mutate({ input: () => port.deletePage({ id: page.id }) }) as Awaited<ReturnType<typeof port.deletePage>>;
      navigate("/pages");
    } catch (e) {
      setError(e instanceof Error ? e.message : t({ locale, key: "failed to delete page" }));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }, [page, locale, port, navigate, t]);
  return { ...input, save, saveOverwritingConflict, dismissSaveConflict, remove };
}
