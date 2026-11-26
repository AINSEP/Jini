import { useCallback, useEffect, useRef, useState } from "react";
import type { PageEditorDependencies } from "./use-page-editor.hooks.js";

import { prettifyHtml } from "../lib/prettify-html.js";

import { buildPageAutosaveDraft, pagePreviewFormTarget } from "../page-editor-rules.js";
import type { usePageEditorHtmlWorkspace } from "./page-editor-workspace.hooks.js";
import type { usePageEditorActions } from "./page-editor-actions.hooks.js";
import { computeContentDirty } from "./page-editor-workspace.hooks.js";
import type { usePageEditorRecovery } from "./page-editor-recovery.hooks.js";
/**
 * Pending-html preview's debounced auto-submit (2026-09-09) — Pages' own version of
 * `use-post-editor.hooks.ts`'s `schedulePendingContentPreviewSubmit` (same file, same "hook owns
 * the effect, not the view" reasoning that function's own doc explains). A form submit is a full
 * iframe navigation, so firing one per keystroke would thrash the iframe; trailing-only, 500ms.
 * `clearTimeout` on cleanup is the complete cancellation, same as that function's.
 *
 * No `=== null`/`bodyJson`-shaped guard is needed here unlike the Posts version: `html` is a plain
 * string, always defined once `page` has loaded — the only state `PagePreview` ever mounts in (see
 * `PageEditor.tsx`'s own `if (!page) return <div className="notice">...` guard) — so `active` and
 * whether a form is mounted at all (2026-10-05, see `PageEditorController.previewFormRef`) decide
 * whether to schedule.
 *
 * @complexity Time/space: O(1) — one timer, no data copying.
 */
function schedulePendingHtmlPreviewSubmit(input: { active: boolean; form: HTMLFormElement | null; deps: Pick<PageEditorDependencies, "setTimeout" | "clearTimeout"> }): () => void {
  const { form } = input;
  const { setTimeout, clearTimeout } = input.deps;
  if (!input.active || form === null) return () => {};
  const timer = setTimeout(() => {
    form.submit();
  }, 500);
  return () => clearTimeout(timer);
}

/**
 * `routeSlug` names what the URL actually carries: the page's slug for an ordinary page, as read
 * from the route (see `panels.tsx`'s `/:slug` pattern), `home` for the root page, or the id of a
 * page whose real slug is `home` (`pageAdminPath`, `rules.ts`). The alias maps to `/` for reads;
 * all other handles pass through unchanged. An id also works as a legacy
 * id-based bookmark too: the server-side lookup this feeds (`getAdminPostByIdOrSlug`) tries the
 * slug FIRST and falls back to an exact id match, so an old id-based bookmark still resolves —
 * corrected 2026-09-03, this comment previously stated the two checks in the opposite order. Every
 * write below uses `page.id` (the real id from the loaded record), never `routeSlug` directly — the
 * slug in the URL can go stale if the page is renamed elsewhere, but the id it resolved to at load
 * time cannot.
 *
 * `port`/`navigate`/`t` are destructured out of `deps` once, rather than threaded as `deps.port`
 * everywhere below — they are stable references in production (`useWiredPageEditor` always passes
 * the same module-level singletons; only `locale` actually varies across renders), so `useCallback`
 * dependency arrays can name them directly without an unstable-identity hazard, matching
 * `Jini redirects/SOURCE-RATIONALE.md`'s "confirmed safe to leave port unmemoized" precedent.
 */
/** Where an old id/slug bookmark should land: the root page on its alias, any other page (except a
 *  real `home` page, which keeps its id) on its canonical slug. `null` when already canonical. */
/** Whether the editor shows exactly the live page: published, nothing dirty, same template. */
function isPublishedUnchanged({ status, contentDirty, templateChoice, savedTemplateChoice }: {
  status: string; contentDirty: boolean; templateChoice: string | null; savedTemplateChoice: string | null;
}): boolean {
  return status === "published" && !contentDirty && templateChoice === savedTemplateChoice;
}

export function usePageEditorPreviewWorkspace(input: ReturnType<typeof usePageEditorHtmlWorkspace>, _optional = {}) {
  const { deps, html, view, previewExpanded, setPreviewExpanded, setDraftHtml, consumeJumpFormatting } = input;
  const { usePreviewPaneWidth } = deps.hooks;
  const { document } = deps;

  const prevViewRef = useRef(view);
  useEffect(() => {
    // A jump into the HTML view keeps the caller's own formatting; any other entry prettifies.
    if (view === "html" && prevViewRef.current !== "html" && !consumeJumpFormatting()) setDraftHtml(prettifyHtml({ html }));
    prevViewRef.current = view;
  }, [view, html, consumeJumpFormatting]);

  // Leaving the Preview tab collapses (2026-09-16) — the expanded surface only ever shows the
  // preview, so any other view being selected means the operator is done with it. Returning to
  // Preview later therefore always starts collapsed rather than resuming a state they did not ask
  // for this time. Mirrors `use-post-editor.hooks.ts`'s identical effect.
  useEffect(() => {
    if (view !== "preview") setPreviewExpanded(false);
  }, [view]);

  // Escape collapses (2026-09-16) — a raw `document.addEventListener`, not a synthetic React
  // handler, for the reasons `use-post-editor.hooks.ts`'s twin records: nothing here needs to
  // intercept a keystroke the editor itself is using, and a real listener is what a test can
  // dispatch a genuine `KeyboardEvent` against. Deliberately no `preventDefault()`/
  // `stopPropagation()` — nothing on this surface traps focus, and swallowing the event only risks
  // this repo's documented jsdom/React-delegation false-RED trap. The `.page-preview-fab` rendered
  // inside the expanded surface is the exit that always works; this is a convenience on top of it,
  // gated on `previewExpanded` so no listener is registered at all while collapsed.
  useEffect(() => {
    if (!previewExpanded) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [previewExpanded]);

  function togglePreviewExpanded(): void { setPreviewExpanded((on) => !on); }

  // `PagePreview`'s frame element and its live-measured width — see `usePreviewPaneWidth`'s own doc
  // for why this is a callback ref keyed off the node (the late-mount bug it fixed was found here).
  const { frameRef, paneWidth } = usePreviewPaneWidth();
  return { ...input, prevViewRef, togglePreviewExpanded, frameRef, paneWidth };
}

export function usePageEditorPreview(input: ReturnType<typeof usePageEditorActions>, _optional = {}) {
  const { deps, page, title, slug, status, templateChoice, savedTemplateChoice, html, savedHtml } = input;
  const { useAgentScreenEntry } = deps.hooks;

  // Pending-html preview (2026-09-09) — see `PageEditorController.previewFormRef`'s own doc. The
  // hidden form's DOM node; `PagePreview` attaches it via `ref`. `previewFormTarget` is `""` before
  // `page` loads for the same reason `templatePreviewUrl` below is — `PagePreview` never renders
  // that early.
  // Node in state, not a `RefObject` — see `PageEditorController.previewFormRef`'s own doc.
  const [previewForm, previewFormRef] = useState<HTMLFormElement | null>(null);
  const previewFormTarget = pagePreviewFormTarget({ page });

  // Per-tab scroll memory, Preview half — see `PageEditorController.onPreviewFrameLoad`'s own doc.
  const previewScrollYRef = useRef(0);
  const onPreviewFrameLoad = useCallback((iframe: HTMLIFrameElement) => {
    try {
      // Cross-origin (the live-site branch): reading `.scrollY` or calling `.scrollTo()` on a foreign
      // `Window` throws a `SecurityError` — caught below, so that branch's position is simply never
      // remembered rather than crashing the load handler. The template-preview branch is opaque-origin
      // too since 2026-10-05 (`PAGE_PREVIEW_IFRAME_SANDBOX` has no `allow-same-origin`).
      const win = iframe.contentWindow;
      if (!win) return;
      win.scrollTo(0, previewScrollYRef.current);
      win.addEventListener("scroll", () => {
        previewScrollYRef.current = win.scrollY;
      });
    } catch {
      // See this function's own doc on `PageEditorController` — cross-origin, nothing to do here.
    }
  }, []);

  // Tells the assistant which page "this page" is (`lib/agent-screen-context.ts`) — the saved row,
  // so the id/slug it is given are ones its tools can actually look up.
  useAgentScreenEntry({ entry: page === null ? null : { kind: page.kind, id: page.id, title: page.title, slug: page.slug, status: page.status } });

  // Template-preview fix (2026-08-11) — see `contentDirty`'s doc on `PageEditorController`.
  const contentDirty = computeContentDirty({ page, draft: { title, slug, status, html, savedHtml } });
  // The Save button's own "is there anything unsaved" signal — split out to a named variable (was
  // previously inlined at the return statement) so `useExternalEntryRefresh`'s `isDirty` below reads
  // the SAME value `dirty` reports, rather than a second copy of this expression that could drift.
  const dirty = contentDirty || templateChoice !== savedTemplateChoice;
  return { ...input, previewForm, previewFormRef, previewFormTarget, previewScrollYRef, onPreviewFrameLoad, contentDirty, dirty };
}

export function usePageEditorPreviewSubmit(input: ReturnType<typeof usePageEditorRecovery>, _optional = {}) {
  const { deps, page, title, slug, status, templateChoice, savedTemplateChoice, html, view, autosave, contentRevision, previewForm, contentDirty } = input;

  // Standing-draft autosave scheduling — fires a debounced write whenever the working copy actually
  // differs from what's saved. Deliberately does NOT clear the draft when `contentDirty` goes back
  // to `false` on its own (e.g. the operator edits back to the original value): only a real
  // Save/Publish or an explicit Discard ever clears a parked draft (see `save`'s own
  // `clearStandingDraft` call, and `discardRecoveredDraft` below) — auto-clearing here on a merely
  // quiet moment is not one of those two things.
  useEffect(() => {
    if (!page || !contentDirty) return;
    autosave.scheduleAutosave(buildPageAutosaveDraft({ page, form: { title, slug, html } }));
  }, [page, contentDirty, title, slug, html, autosave.scheduleAutosave]);

  const previewMatchesLive = isPublishedUnchanged({ status, contentDirty, templateChoice, savedTemplateChoice });
  // Pending-html preview's debounced auto-submit (2026-09-09) — see `PageEditorController
  // .previewFormRef`'s own doc. `active` mirrors the negation of `PagePreview`'s own
  // `canShowLiveSite` (see that function's doc): true whenever the operator isn't looking at the
  // live site, regardless of
  // `status` or `contentDirty` — a draft, or a published-but-dirty Page, both need their pending
  // `html` POSTed into the preview iframe the same way. Computed inline here (not read off a
  // `dirty`/`canShowLiveSite` controller field) because none exists — `PagePreview` recomputes the
  // identical condition itself from `status`/`dirty`, the same duplication
  // `use-post-editor.hooks.ts`'s own `canShowPendingContentPreview` already accepts between the hook
  // and its view for the same reason (cheap, O(1), and keeps the controller's own field surface
  // unchanged).
  useEffect(
    () =>
      schedulePendingHtmlPreviewSubmit({
        active: view === "preview" && page !== null && !previewMatchesLive,
        form: previewForm,
        deps,
      }),
    // `page?.id`, not `page` — same reasoning `use-post-editor.hooks.ts`'s identical effect gives:
    // a `setPage(updated)` after a successful save (a new object reference, same id) must not by
    // itself restart the debounce timer. `contentRevision` IS added (2026-09-16): a clean editor's
    // silent external apply changes `html`/`title`/etc. without ever changing `view`/`status`/
    // `templateChoice`, so without this the pending preview would sit on the pre-write body until
    // some unrelated field also happened to change.
    // `previewForm` (2026-10-05): a newly mounted form + iframe pair is empty until submitted into,
    // so a remount alone must re-arm — see `PageEditorController.previewFormRef`'s own doc.
    [view, page?.id, status, contentDirty, templateChoice, savedTemplateChoice, html, contentRevision, previewForm]
  );
  return { ...input, previewMatchesLive };
}
