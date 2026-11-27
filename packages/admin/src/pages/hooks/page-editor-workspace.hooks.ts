import { useCallback, useRef, useState } from "react";
import type { HeadlessThemeTier as ThemeTier } from "@jini-ai/core/contracts/headless/contracts";
import type { AdminPost } from "../../posts/api/posts-api.types.js";
import type { SaveConflict as PageSaveConflict } from "../../shell/lib/version-conflict.js";
import type { PageEditorView } from "../page-editor-rules.js";
import type { PageEditorDependencies } from "./use-page-editor.hooks.js";
import type { usePageEditorLoad } from "./page-editor-load.hooks.js";
import type { usePageEditorHydration } from "./page-editor-load.hooks.js";
import { applyLoadedPage } from "./page-editor-load.hooks.js";
import type { usePageEditorRestore } from "./page-editor-recovery.hooks.js";

// The editor-leaf provenance notes below were restored verbatim from blocks that sat inside
// `usePageEditor`; they describe bindings this hook makes (`createEmbedPlaceholderDescriber`, `prettifyHtml`).
/**
 * @file Bug A (2026-09-23 interactive-bugs plan, Slice A2): the admin's own half of the Interactive
 * tab's placeholder card. Ports every case from Jini's
 * `packages/admin/src/react/__tests__/components/InteractiveHtmlEditor.test.tsx`
 * (`describeEmbedPlaceholder`/`isProtectedEmbedElement`) so behavior that already shipped keeps
 * working, then adds the slug/typeKey/post-previews cases that Jini's adapter cannot answer because
 * it never imports the server's marker-target rule. Built on `the marker reader`'s
 * `parseEmbedMarkerConfig`/`embedMarkerTarget` (Slice A1) instead of a third copy of either rule.
 * Now: the describer and that test are `@jini-ai/admin/pages/lib/embed-placeholder`'s; this hook
 * binds `@jini-ai/cms/widgets/markers`' readers into it.
 */

/**
 * @file Bug A (2026-09-23 interactive-bugs plan, Slice A2): the host-specific adapter
 * `PageEditor.tsx` (Slice A3) hands to `@jini-ai/ui/html-editor`'s generic `InteractiveHtmlEditor` as
 * `isProtectedElement`/`describeEmbedPlaceholder` — the same two-function shape Jini's own
 * `InteractiveHtmlEditor.tsx` adapter used to supply from inside the Jini package. Moving it here lets
 * this describer read `@jini-ai/cms/widgets/markers`'s `parseEmbedMarkerConfig`/`embedMarkerTarget` (Slice A1)
 * directly instead of Jini's adapter carrying its own second copy of "which key names the target" —
 * see the root-cause report (`ADS-memory/.local-artifacts/pages-redo-2026-09-23/interactive-bugs-plan.md`,
 * Bug A) for why that second copy is exactly what produced "Placeholder — Widget / no id set" for a
 * marker addressed by `slug`.
 * Now: the adapter moved into `@jini-ai/admin/pages/lib/embed-placeholder`; this hook injects
 * `@jini-ai/cms/widgets/markers`' readers into its `createEmbedPlaceholderDescriber`.
 */

/**
 * @file A small, dependency-free HTML pretty-printer for the Pages editor's "HTML" tab.
 *
 * The owner reported the HTML view had "regressed" from a formatted tree back to a wall of text.
 * Checked first (`git log`/repo-wide grep for `prettier`/`js-beautify`/`html-format`/`CodeMirror`,
 * across both the host and Jini): no HTML formatter has EVER existed anywhere in this codebase — the
 * only precedent is `packages/ui/src/features/html-editor/css.ts`'s `prettifyCss` in the Jini repo,
 * which formats the CSS half of GrapesJS's export and explicitly argues for a small hand-rolled
 * tokenizer over a real parser or a bundled `prettier` build for exactly this reason: the added
 * weight isn't warranted for a formatting-only pass, and no such dependency exists in either
 * `package.json` in this repo already. This function is that same argument applied to HTML instead
 * of CSS, built fresh in the host (not Jini) since the Pages screen is host-only. So the report the
 * owner is remembering is not this codebase — build it anyway, since the request stands regardless.
 *
 * **Why the "wall of text" happens now specifically**: `development/scripts/
 * convert-legacy-doc-pages-to-html.ts` converted several Pages from Tiptap `doc` JSON to raw HTML
 * earlier the same session, and the renderer that produced that HTML emits zero inter-element
 * whitespace (`</h2><h2 id="...">`, `<p>...</p><p>...</p>`, directly concatenated). Hand-authored
 * page bodies with their own existing line breaks were never touched by this gap; only the
 * machine-generated ones show it.
 *
 * **The save-corruption risk, and how this function is constrained to avoid it**: `PageEditor.tsx`
 * wires this into a live, editable textarea, not a read-only viewer, so the formatted text an
 * operator sees IS what can end up saved once they start typing (see that file's own comment on the
 * `draftHtml`/`prevViewRef` wiring for the "view alone never dirties the page" half of that
 * decision). Whitespace injected purely for readability must therefore never change what a visitor
 * sees when the result is saved. This function is deliberately narrow to guarantee that:
 *
 * - It ONLY inserts a newline+indent at a boundary between two tags that were textually adjacent in
 *   the source (zero existing characters between them) AND are both members of {@link BLOCK_ELEMENTS}
 *   — ordinary block-level HTML tags (`div`, `p`, `h1`-`h6`, `li`, …). A whitespace-only text node
 *   between two such elements is not rendered by any browser (block/flex/grid layout all discard
 *   it), so this specific class of insertion is provably invisible once rendered, independent of
 *   which theme or CSS is applied — UNLESS a stylesheet overrides one of those tags to
 *   `display: inline` (rare for a structural tag; disclosed as a residual risk, not fixed here).
 * - It NEVER touches a text run, an inline element's boundary, or the inside of `<pre>`, `<script>`,
 *   `<style>`, or `<textarea>` (see {@link RAW_TEXT_ELEMENTS}) — those are copied through byte for
 *   byte. This is why `<p>The host is a content platform <strong>vibecoded</strong> alongside…</p>`
 *   comes out exactly as authored: nothing inside a paragraph's mixed text/inline content is ever a
 *   zero-gap tag-to-tag boundary, so the rule never fires there.
 * - Existing whitespace between two tags (hand-authored formatting) is left completely alone — the
 *   rule only fires on a literal zero-character gap, so already-readable markup is a no-op through
 *   this function.
 *
 * @complexity O(n) two passes over the input length (tokenize, then print) — no backtracking, no
 * recursive descent, no DOM construction.
 */

// Now: `prettifyHtml` moved to `@jini-ai/admin/pages/lib/prettify-html`; this hook is where the
// editor binds it.

/** `contentDirty`'s own computation, named out of `usePageEditor`'s body purely to keep that
 *  hook's own cyclomatic complexity under the gate — every `&&`/`||` in a boolean expression is
 *  its own branch. Same title/slug/status/body comparison, same behavior.
 *  See `PageEditorController.contentDirty`'s own doc for what this decides.
 *
 *  The body arm asks `pageAcceptsHtmlBody` rather than testing `bodyFormat` itself, so this agrees
 *  with `save` by construction: HTML typed into a brand-new (`doc`-format, empty-document) Page IS
 *  savable, and therefore has to count as dirty — otherwise the Save button never shows its pending
 *  dot, `useDirtyGuard` lets a navigate-away discard the work without asking, and the standing-draft
 *  autosave below never fires at all. */
export function computeContentDirty({ page, draft, pageAcceptsHtmlBody }: { page: AdminPost | null; pageAcceptsHtmlBody: PageEditorDependencies["pageAcceptsHtmlBody"]; draft: { title: string; slug: string; status: "draft" | "published"; html: string; savedHtml: string } }, _options = {}
): boolean {
  if (page === null) return false;
  const metaDirty = draft.title !== page.title || draft.slug !== page.slug || draft.status !== page.status;
  return metaDirty || (pageAcceptsHtmlBody({ page, html: draft.html }) && draft.html !== draft.savedHtml);
}

/** Before load, the canvas retains the same safe document-format fallback. */
function pageBodyFormat({ page }: { page: AdminPost | null }, _options = {}) {
  return page?.bodyFormat ?? "doc";
}

export function usePageEditorWorkspace(input: ReturnType<typeof usePageEditorLoad>, _optional = {}) {
  const { deps, port } = input;
  const { useDevicePreviewDevice, useSettlementGeneration, useStandingDraftAutosave, useWiredInteractiveEditorFlush } = deps.hooks;

  const [page, setPage] = useState<AdminPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  // Pages template picker (Task 4, 2026-08-11) — `savedTemplateChoice` is `templateChoice`'s own
  // baseline for the manual dirty comparison below, same "captured on load/save" shape `savedHtml`
  // already uses for `html`.
  const [templateChoice, setTemplateChoice] = useState<string | null>(null);
  const [savedTemplateChoice, setSavedTemplateChoice] = useState<string | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
  // The active theme, captured off the same presentation-settings load the picker already does — the
  // Interactive tab's canvas needs both to find that theme's stylesheet and token files. `null`
  // until then, which `useThemeCanvasStyling` reads as "keep waiting", never as "no theme".
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [activeThemeApiVersion, setActiveThemeApiVersion] = useState<2 | undefined>(undefined);
  // "View Template" parity with `usePostEditor` (2026-09-24) — same `activeThemeTier` shape, same
  // load-effect source (the presentation-settings response).
  const [activeThemeTier, setActiveThemeTier] = useState<ThemeTier | null>(null);
  // View Template (2026-09-24, Pages' own instance of `usePostEditor`'s identical state) — whether
  // the read-only `TemplateSourceModal` is open.
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [html, setHtml] = useState("");
  const [savedHtml, setSavedHtml] = useState("");
  const [view, setView] = useState<PageEditorView>("preview");
  // Interactive flush (2026-09-23 plan) — see `PageEditorController.interactiveEditorRef`'s own doc.
  const { interactiveEditorRef, flushInteractiveEdits, setHtmlFromCanvas } = useWiredInteractiveEditorFlush({ setHtml });
  const { device, setDevice } = useDevicePreviewDevice();
  // Preview fullscreen (2026-09-16) — see `PageEditorController.previewExpanded`'s own doc for why
  // this lives here instead of `App.tsx` or a bus. `false` by default: opening a Page must never
  // itself land on the expanded surface, even though `view` DOES default to "preview" here (unlike
  // Posts, which open on "edit").
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSettlement, setSaveSettlement] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The "Nothing changed. Save anyway?" warning (owner, 2026-10-10) — see `unchangedSaveHandlers`.
  const [confirmingUnchangedSave, setConfirmingUnchangedSave] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // A save the server refused because this editor's basis version had already been superseded
  // (2026-09-07). Distinct from `error`: `error` means "try again", this means "trying again
  // replaces somebody else's page" — see `applySaveFailure`.
  const [saveConflict, setSaveConflict] = useState<PageSaveConflict | null>(null);
  // Stale-settlement guard for `save()` (2026-09-05 sweep, extracted into `useSettlementGeneration`
  // 2026-09-06) — `saving` (state) already disables both the Save and Publish buttons, but that
  // alone cannot stop an overlapping second call (a same-tick double-invocation, or any caller
  // reaching `save()` directly rather than through those buttons) from applying a now-stale
  // response after a more-recent call already settled: whichever `port.updatePost()` call settled
  // last would win, regardless of which one was issued last. Mirrors `use-post-editor.hooks.ts`'s
  // own `settlement` (commit `42c6a534`), the reference this pattern was modelled on.
  const settlement = useSettlementGeneration();

  // Standing-draft autosave (2026-09-06) — see `use-standing-draft-autosave.hooks.ts`'s own header
  // for the ordering guarantee `clearStandingDraft` relies on. `entryId`/`enabled` both key off
  // `page` rather than `routeSlug`: the recovery check needs the row's REAL id (routeSlug can be a
  // stale/legacy bookmark), and must not run at all before the id is known.
  const autosave = useStandingDraftAutosave({ port, entryId: page?.id ?? null, enabled: page !== null, serverUpdatedAt: page?.updatedAt });
  return { ...input, page, setPage, error, setError, message, setMessage, title, setTitle, slug, setSlug, status, setStatus, templateChoice, setTemplateChoice, savedTemplateChoice, setSavedTemplateChoice, availableTemplates, setAvailableTemplates, activeThemeId, setActiveThemeId, activeThemeApiVersion, setActiveThemeApiVersion, activeThemeTier, setActiveThemeTier, showTemplateModal, setShowTemplateModal, html, setHtml, savedHtml, setSavedHtml, view, setView, interactiveEditorRef, flushInteractiveEdits, setHtmlFromCanvas, device, setDevice, previewExpanded, setPreviewExpanded, saving, setSaving, saveSettlement, setSaveSettlement, confirmingDelete, setConfirmingDelete, confirmingUnchangedSave, setConfirmingUnchangedSave, deleting, setDeleting, saveConflict, setSaveConflict, settlement, autosave };
}

export function usePageEditorHtmlWorkspace(input: ReturnType<typeof usePageEditorHydration>, _optional = {}) {
  const { deps, boundT, setPage, setError, setTitle, setSlug, setStatus, setTemplateChoice, setSavedTemplateChoice, html, setHtml, savedHtml, setSavedHtml, setView, flushInteractiveEdits, setSaveConflict } = input;
  const { useWiredEditorHtmlJump } = deps.hooks;
  const { prettifyHtml, pageEditableHtml } = deps;

  // HTML tab pretty-printing (owner-reported regression, 2026-08-11 — verified nothing formatted this
  // view before either; see `lib/prettify-html.ts`'s file header). `draftHtml` is a LOCAL, display-only
  // copy of `html`: merely switching to the HTML tab reformats and shows it here, but never calls
  // `setHtml` itself, so `dirty` (computed above from `html !== savedHtml`) stays exactly what it was
  // before the operator looked at this tab — a display concern must never by itself mark the page as
  // having unsaved changes. `PageEditor.tsx`'s textarea writes straight through to BOTH `draftHtml` and
  // the real `setHtml` on every keystroke, unchanged from how the textarea always worked, so the only
  // way the prettified whitespace becomes part of the saved page is if the operator actually edits on
  // top of it. `prevViewRef` is what makes this fire only on the TRANSITION into the HTML tab, never on
  // every render while already on it — reformatting mid-edit would fight the operator's cursor position.
  const [draftHtml, setDraftHtml] = useState(() => prettifyHtml({ html }));

  // Per-tab scroll memory (2026-09-16) — see `PageEditorController.htmlTextareaRef`'s own doc for the
  // full "why a ref, why here" reasoning. A `useRef`, not `useState`: a scroll position changing must
  // never itself trigger a re-render, only be there the next time the tab mounts.
  const htmlScrollTopRef = useRef(0);
  const onHtmlScroll = useCallback((scrollTop: number) => {
    htmlScrollTopRef.current = scrollTop;
  }, []);

  // Content refresh (2026-09-16) — bumped only when an assistant write is applied (silently, or via
  // Load latest; never by this editor's own save), so the Interactive tab can remount and pick up the new body without
  // losing GrapesJS's canvas state on every own Save (a `page.version` key would do that too, since
  // an own save bumps it exactly the same way). See `PageEditorController.contentRevision`.
  const [contentRevision, setContentRevision] = useState(0);
  const onInteractiveSourceError = useCallback((_error?: Error) => {
    setError(boundT("Can't edit this source visually. Use HTML."));
  }, [boundT]);
  // The edit the unchanged-Save preflight just flushed. Its `save()` runs from the same render, whose
  // `html` predates that flush, and the second flush has nothing new, so it hands this over once.
  const preflushedHtmlRef = useRef<string | undefined>(undefined);
  const flushInteractiveSafely = useCallback(async () => {
    const preflushed = preflushedHtmlRef.current;
    preflushedHtmlRef.current = undefined;
    try { return { ok: true as const, html: (await flushInteractiveEdits()) ?? preflushed }; }
    catch { onInteractiveSourceError(); return { ok: false as const }; }
  }, [flushInteractiveEdits, onInteractiveSourceError]);
  // Save with no visible change still checks an open Interactive text session first — see
  // `unchangedSaveHandlers`' `flushPendingEdits`.
  const flushPendingEdits = useCallback(async () => {
    const flushed = await flushInteractiveSafely();
    if (!flushed.ok) return "failed" as const;
    if (flushed.html === undefined || flushed.html === savedHtml) return "unchanged" as const;
    preflushedHtmlRef.current = flushed.html;
    return "changed" as const;
  }, [flushInteractiveSafely, savedHtml]);
  const { requestEditHtml: onRequestEditHtml, htmlTextareaRef, consumeJumpFormatting } = useWiredEditorHtmlJump({
    html, contentRevision, flush: flushInteractiveEdits, setView, setDraftHtml, scrollTop: htmlScrollTopRef,
  }, { onError: onInteractiveSourceError });

  /**
   * The shared refresh hook's `applyLatest` — replaces the working copy AND the saved baseline with
   * an externally-written row, the CLEAN-editor half of `use-external-entry-refresh.hooks.ts`'s
   * decision (the dirty half surfaces `pendingExternalVersion` instead and touches nothing here).
   * Reuses {@link applyLoadedPage} so this seeds the exact same fields the mount effect does, then
   * layers on the two things unique to a live re-apply: the HTML tab's `draftHtml` (only re-seeded
   * on tab-switch otherwise — see that effect's own doc) and clearing any stale `saveConflict`,
   * since the version it was raised against is no longer the one loaded.
   *
   * All setters passed in are `useState` setters — referentially stable across renders — so this can
   * safely close over them with an empty dependency array.
   */
  const applyExternalPage = useCallback((fresh: AdminPost) => {
    applyLoadedPage({ post: fresh, setters: { setPage, setTitle, setSlug, setStatus, setTemplateChoice, setSavedTemplateChoice, setHtml, setSavedHtml }, pageEditableHtml });
    setDraftHtml(prettifyHtml({ html: pageEditableHtml(fresh) }));
    setSaveConflict(null);
    // Bug B, Slice B3 (dev-only instrumentation, pages-redo plan): this bump remounts the Interactive
    // surface (`PageEditorPane`'s `key={contentRevision}`) with no loading state of its own — logged so
    // a future "renders wrong"/"flashes" report can be tied back to an external write instead of
    // guessed at. Removed once Bug B is closed; not covered by a test for that reason (logging only).
    if (deps.isDevMode) {
      console.debug("[page-editor] interactive", { phase: "contentRevision:increment", ms: Math.round(performance.now()) });
    }
    setContentRevision((n) => n + 1);
  }, [deps.isDevMode, prettifyHtml, pageEditableHtml]);
  return { ...input, draftHtml, setDraftHtml, htmlScrollTopRef, onHtmlScroll, contentRevision, setContentRevision, onInteractiveSourceError, flushInteractiveSafely, flushPendingEdits, onRequestEditHtml, htmlTextareaRef, consumeJumpFormatting, applyExternalPage };
}

export function usePageEditorFlush(input: ReturnType<typeof usePageEditorRestore>, _optional = {}) {
  const { deps, port, themeCanvasPort, page, templateChoice, setTemplateChoice, activeThemeId, activeThemeApiVersion, setView, interactiveEditorRef, flushInteractiveSafely } = input;
  const { useThemeCanvasStyling } = deps.hooks;
  const { resolveCanvasTemplateChoice } = deps;

  // Interactive flush (2026-09-23 plan) — "flush, then set" wrappers around the raw `setView`/
  // `setTemplateChoice` state setters (declared above, at `useState`). Leaving Interactive without
  // flushing first is exactly the same edit-loss bug a save without flushing is: switching tabs or
  // templates remounts/restyles the canvas, and GrapesJS never got the chance to sync a still-open
  // RTE session first. `PageEditorController` exposes THESE, not the raw setters, so every caller
  // (`PageEditor.tsx`'s tab bar and template picker) gets the flush for free; the raw setters stay
  // internal (`applyLoadedPage`'s callers below still use them directly — loading a row is not an
  // edit to flush anything against).
  //
  // `interactiveEditorRef.current` is checked SYNCHRONOUSLY first: with nothing mounted (not on the
  // Interactive tab, or the tab never visited this session — the overwhelmingly common case for
  // every OTHER tab's own setView/setTemplateChoice call), there is nothing to flush, so this applies
  // immediately rather than forcing every caller through an async microtask for no reason.
  const setViewAfterFlush = useCallback(
    (next: PageEditorView) => {
      if (!interactiveEditorRef.current) {
        setView(next);
        return;
      }
      void flushInteractiveSafely().then(result => {
        // HTML remains available on an integrity failure, showing the last intact working copy.
        if (result.ok || next === "html") setView(next);
      });
    },
    [flushInteractiveSafely]
  );
  const setTemplateChoiceAfterFlush = useCallback(
    (next: string | null) => {
      if (!interactiveEditorRef.current) {
        setTemplateChoice(next);
        return;
      }
      void flushInteractiveSafely().then(result => { if (result.ok) setTemplateChoice(next); });
    },
    [flushInteractiveSafely]
  );

  // See `templatePreviewUrl`'s own doc on `PageEditorController` for why this is a plain per-render
  // expression rather than state or a `useMemo`.
  const templatePreviewUrl = page ? port.templatePreviewUrl({ id: page.id, templateChoice }) : "";

  // `templateChoice` (not `savedTemplateChoice`): the Interactive canvas must mirror the template the
  // operator is CURRENTLY looking at in the picker, the same one `templatePreviewUrl` above resolves —
  // switching templates should restyle the canvas immediately, without a save round-trip. The 4th
  // argument is what supplies the canvas its content wrapper: the theme template's own ancestor chain
  // around the `{"type":"content"}` marker (`<main><article class="post-detail wrap">` in `basic`'s
  // `posts-default.html`, `blog-post.html` before the 2026-09-03 posts-*/pages-* rename). Without it
  // the canvas renders the page body naked at full bleed while the published page centres it in a
  // 720px column — same CSS, same tokens, no container.
  //
  // Run through `resolveCanvasTemplateChoice` rather than passed straight through: only a `null`
  // (never-chosen) `html`-format Page is the case a `static`-tier theme's real render mirrors through
  // its own page shell (`pages-default.html`, or legacy `page-shell.html`) — see that function's own
  // doc. Since the bare-page ruling (2026-09-23, S6), `""` is a DIFFERENT case — an explicit "No
  // template" that renders with no wrapper at all — and `resolveCanvasTemplateChoice` no longer routes
  // it into the shell; `useThemeCanvasStyling` short-circuits it to `NO_CANVAS_STYLING` instead.
  // `page?.bodyFormat ?? "doc"` is the same "nothing risky before load" default `templatePreviewUrl`
  // above and `contentDirty` below already use for a not-yet-loaded page.
  const canvasStyling = useThemeCanvasStyling(
    { themeId: activeThemeId, apiVersion: activeThemeApiVersion, port: themeCanvasPort },
    { templateChoice: resolveCanvasTemplateChoice({ templateChoice, bodyFormat: pageBodyFormat({ page }) }) },
  );
  return { ...input, setViewAfterFlush, setTemplateChoiceAfterFlush, templatePreviewUrl, canvasStyling };
}

export function pageEditorWorkspaceView(input: ReturnType<typeof usePageEditorFlush>, _optional = {}) {
  const { boundT, embedPlaceholderDescriber, page, error, message, title, setTitle, slug, setSlug, status, setStatus, templateChoice, availableTemplates, activeThemeId, activeThemeApiVersion, activeThemeTier, showTemplateModal, setShowTemplateModal, html, setHtml, view, interactiveEditorRef, setHtmlFromCanvas, device, setDevice, previewExpanded, saving, draftHtml, setDraftHtml, onHtmlScroll, onInteractiveSourceError, onRequestEditHtml, htmlTextareaRef, togglePreviewExpanded, frameRef, paneWidth, onPreviewFrameLoad, setViewAfterFlush, setTemplateChoiceAfterFlush } = input;
  return {
    page,
    error,
    message,
    title,
    setTitle,
    slug,
    setSlug,
    status,
    setStatus,
    templateChoice,
    setTemplateChoice: setTemplateChoiceAfterFlush,
    availableTemplates,
    activeThemeId,
    activeThemeTier,
    activeThemeApiVersion,
    showTemplateModal,
    // Thin wiring closures, same "one-line handler named and moved out of JSX" shape
    // `usePostEditorUi`'s identical pair documents — kept inline here rather than a separate
    // `use-page-editor-ui.hooks.ts` since Pages has only these two UI-only handlers today, not the
    // half-dozen `usePostEditorUi` composes.
    onViewTemplateClick: () => setShowTemplateModal(true),
    onCloseTemplateModal: () => setShowTemplateModal(false),
    html,
    setHtml,
    draftHtml,
    setDraftHtml,
    htmlTextareaRef,
    onHtmlScroll,
    onPreviewFrameLoad,
    view,
    setView: setViewAfterFlush,
    device,
    setDevice,
    previewExpanded,
    togglePreviewExpanded,
    frameRef,
    paneWidth,
    saving,
    t: boundT,
    embedPlaceholderDescriber,
    onRequestEditHtml,
    onInteractiveSourceError,
    interactiveEditorRef,
    setHtmlFromCanvas
  };
}
