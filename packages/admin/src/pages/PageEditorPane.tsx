import { useEffect } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { HeadlessThemeTier as ThemeTier } from "@jini-ai/core/contracts/headless/contracts";
import type { PageEditorProps } from "./PageEditor.js";
import type { PageEditorController } from "./hooks/use-page-editor.hooks.js";
import { DEVICE_PREVIEW_WIDTHS } from "../shell/components/DevicePreview/DevicePreview.hooks.js";
import { isProtectedEmbedElement } from "./lib/embed-placeholder.js";
import { PagePreview } from "./PageEditorPreview.js";

/**
 * The "View Template" modal's mount gate — mirrors `PostEditor.tsx`'s identical
 * `PostEditorTemplateModalGate` (see that function's own doc for the full "why conditionally
 * mounted, why re-check here" reasoning, which applies unchanged: `PreviewModalShell` has no `open`
 * prop to toggle, and `templateChoice`/`activeThemeId` are re-checked so this can never render with
 * an empty/`null` URL segment even if state changes out from under an already-open modal).
 */
export function PageEditorTemplateModalGate({ kit, show, templateChoice, activeThemeId, activeThemeTier, activeThemeApiVersion, onClose, confirmLeave, t }: { kit: PageEditorProps["kit"];
  show: boolean;
  templateChoice: string | null;
  activeThemeId: string | null;
  activeThemeTier: ThemeTier | null;
  activeThemeApiVersion: 2 | undefined;
  onClose: () => void;
  confirmLeave: () => boolean;
  t: Translate;
}, _optional = {}) {
  const { TemplateSourceModal } = kit;
  if (!show || !templateChoice || !activeThemeId) return null;
  return (
    <TemplateSourceModal
      themeId={activeThemeId}
      themeTier={activeThemeTier}
      themeApiVersion={activeThemeApiVersion}
      templateFilename={templateChoice}
      onClose={onClose}
      confirmLeave={confirmLeave}
      t={t}
      editAgentHandleId="page-template-edit"
    />
  );
}
/** Per-tab scroll memory — see `PageEditorController.htmlTextareaRef`'s own doc. */
/** Per-tab scroll memory, Preview half — see `PageEditorController.onPreviewFrameLoad`'s own doc.
   *  Threaded straight through to `PagePreview` below; this dispatcher does not call it itself. */
/** The loaded row's current version — see `PagePreviewFrame`'s own doc for why the live-site src
   *  is cache-busted with it. */
/** Content refresh (2026-09-16) — `usePageEditor`'s `contentRevision`, keyed onto the Interactive
   *  surface below so an assistant write the operator loads (Load latest, while on this tab) remounts
   *  GrapesJS with the new body, the same way switching tabs already does. */
/** Pre-built by `usePageEditor` — see `PagePreview`'s own doc, branch 2. */
/** Threaded straight through to `PagePreview` (embed inspection); this dispatcher does not use it. */
/** Preview fullscreen (2026-09-16) — `usePageEditor`'s `previewExpanded` / `togglePreviewExpanded`.
   *  Only the `preview` surface below reads them: the fab is part of the preview, not of this
   *  dispatcher, so switching to HTML/Interactive takes it out of the DOM entirely (and the hook's
   *  own effect collapses the state at the same time). */
/** Bug A / interactive-bugs plan Slice A3 — see `PageEditorController.embedPlaceholderDescriber`'s
   *  own doc. Passed straight through to the `interactive` surface below. */
/** Interactive flush (2026-09-23 plan) — see `PageEditorController.interactiveEditorRef`'s own
   *  doc. Attached to the `interactive` surface's `<InteractiveHtmlEditor>` below. */
/** See `PageEditorController.setHtmlFromCanvas`. The `interactive` surface's `onChange`. */

/**
 * The editor's main pane — one of four surfaces, chosen by {@link pageEditorSurface}.
 *
 * Extracted from `PageEditor` in the 2026-09-06 complexity-ceiling pass. This was a chain of nested
 * ternaries inline in that component's JSX, worth 6 of its 10 cognitive-complexity points against a
 * ceiling of 9 (plus two `sonarjs/no-nested-conditional` warnings). The DECISION did not move here —
 * it moved to `rules.ts`, where it is pure and directly testable, per this feature's own "everything
 * that computes a value rather than rendering one" rule; what is left below is markup dispatch and
 * nothing else, one early return per surface, scored in its own scope.
 *
 * The Interactive tab remounts with fresh `html` on every tab switch — see `InteractiveHtmlEditor`'s
 * own file header for why it reads `html` once at mount rather than reacting to later prop changes.
 * `canvasStyling` is read once at mount for that same reason, which is why `interactive-pending` is
 * its own surface rather than a skipped loading flash: mounting an unstyled canvas could never pick
 * the theme up afterwards. The wait is normally invisible — `preview` is this screen's default tab,
 * so the theme's token files have already loaded by the time anyone clicks Interactive.
 *
 * `embedPlaceholderDescriber` (Bug A / interactive-bugs plan Slice A3) is the same mount-once
 * contract: `usePageEditor` rebuilds it whenever the bound translator changes, but
 * `InteractiveHtmlEditor` only reads `describeEmbedPlaceholder` at construction, so a later identity
 * change (a locale switch mid-session) takes effect on the NEXT Interactive-tab mount, not live.
 *
 * `interactiveEditorRef` (Interactive flush, 2026-09-23 plan) is attached to `<InteractiveHtmlEditor>`
 * below so `usePageEditor`'s `flushInteractiveEdits` can close an open RTE session and sync its edit
 * before a save, publish, tab switch, or template change — see `PageEditorController
 * .interactiveEditorRef`'s own doc.
 */
export function PageEditorPane(props: Pick<PageEditorController, "view" | "canvasStyling" | "html" | "setHtml" | "draftHtml" | "setDraftHtml" | "htmlTextareaRef" | "onHtmlScroll" | "onPreviewFrameLoad" | "device" | "slug" | "contentRevision" | "status" | "dirty" | "contentDirty" | "templatePreviewUrl" | "previewFormRef" | "previewFormTarget" | "frameRef" | "paneWidth" | "previewExpanded" | "t" | "embedPlaceholderDescriber" | "onRequestEditHtml" | "onInteractiveSourceError" | "interactiveEditorRef" | "setHtmlFromCanvas"> & {
  kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"]; useThemePreviewFrameHook: PageEditorProps["hooks"]["useThemePreviewFrameHook"];
  version: number; bodyJson?: Record<string, unknown> | undefined; onTogglePreviewExpanded: () => void;
  previewEmbeds: { pageId: string; templateChoice: string | null; usePreviewEmbedIds: PageEditorProps["hooks"]["usePreviewEmbedIds"] };
}, _optional = {}) {
  const { kit, deps, view, canvasStyling, t } = props;
  const { InteractiveHtmlEditor } = kit;
  const { pageEditorSurface } = deps;
  const surface = pageEditorSurface({ view, canvasStyling });
  // Bug B, Slice B3 (dev-only instrumentation, pages-redo plan): logs which surface this pane renders,
  // keyed on `surface.kind` alone — not the whole `surface` object, which carries a fresh `styling`
  // reference every render — so this fires once per actual surface change, not once per render (this
  // component also re-renders on every `draftHtml` keystroke while `view === "html"`). Removed once
  // Bug B is closed; not covered by a test for that reason (logging only, no behavior to assert).
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug("[page-editor] interactive", { phase: `surface:${surface.kind}`, ms: Math.round(performance.now()) });
    }
  }, [surface.kind]);
  if (surface.kind === "preview") {
    return <PageEditorPreviewPane {...props} />;
  }
  if (surface.kind === "html") {
    return <PageEditorHtmlPane {...props} />;
  }
  if (surface.kind === "interactive-pending") {
    return <div className="notice">{t("Loading the theme's styles…")}</div>;
  }
  return <PageEditorInteractivePane {...props} surface={surface} InteractiveHtmlEditor={InteractiveHtmlEditor} />;
}

function PageEditorPreviewPane({ kit, deps, useThemePreviewFrameHook, html, bodyJson, onPreviewFrameLoad, device, slug, version, status, dirty, contentDirty, templatePreviewUrl, previewEmbeds, previewFormRef, previewFormTarget, frameRef, paneWidth, previewExpanded, onTogglePreviewExpanded, t }: Pick<Parameters<typeof PageEditorPane>[0], "kit" | "deps" | "useThemePreviewFrameHook" | "html" | "bodyJson" | "onPreviewFrameLoad" | "device" | "slug" | "version" | "status" | "dirty" | "contentDirty" | "templatePreviewUrl" | "previewEmbeds" | "previewFormRef" | "previewFormTarget" | "frameRef" | "paneWidth" | "previewExpanded" | "onTogglePreviewExpanded" | "t">, _optional = {}) {
  return (
    <PagePreview
        hooks={{ useThemePreviewFrameHook, usePreviewEmbedIds: previewEmbeds.usePreviewEmbedIds }}
        kit={{ DevicePreviewFrame: kit.DevicePreviewFrame }} deps={{ videoLink: deps.videoLink }}
        html={html}
        bodyJson={bodyJson}
        width={DEVICE_PREVIEW_WIDTHS[device]}
        slug={slug}
        version={version}
        status={status}
        dirty={dirty}
        contentDirty={contentDirty}
        templatePreviewUrl={templatePreviewUrl}
        previewFormRef={previewFormRef}
        previewFormTarget={previewFormTarget}
        frameRef={frameRef}
        paneWidth={paneWidth}
        expanded={previewExpanded}
        onToggleExpanded={onTogglePreviewExpanded}
        onFrameLoad={onPreviewFrameLoad}
        pageId={previewEmbeds.pageId} templateChoice={previewEmbeds.templateChoice}
        t={t}
      />
  );
}

function PageEditorHtmlPane({ setHtml, draftHtml, setDraftHtml, htmlTextareaRef, onHtmlScroll, t }: Pick<Parameters<typeof PageEditorPane>[0], "setHtml" | "draftHtml" | "setDraftHtml" | "htmlTextareaRef" | "onHtmlScroll" | "t">, _optional = {}) {
  return (
    <textarea
        ref={htmlTextareaRef}
        className="page-html-source"
        value={draftHtml}
        onChange={(e) => {
          // Raw pass-through, same as before this tab had any formatting — an edit made on top of
          // the pretty-printed baseline becomes the new working copy verbatim, not reformatted
          // again mid-keystroke (which would fight the operator's cursor position).
          setDraftHtml(e.target.value);
          setHtml(e.target.value);
        }}
        onScroll={(e) => onHtmlScroll(e.currentTarget.scrollTop)}
        spellCheck={false}
        aria-label={t("Page HTML")}
        placeholder={t("This page has no HTML yet. Ask the assistant to build it, or write some here.")}
        {...agentHandle({ handle: "page-html-source" }, { role: "field", label: "This page's raw HTML source" })}
      />
  );
}

function PageEditorInteractivePane({ html, contentRevision, t, embedPlaceholderDescriber, onRequestEditHtml, onInteractiveSourceError, interactiveEditorRef, setHtmlFromCanvas, surface, InteractiveHtmlEditor }: Pick<Parameters<typeof PageEditorPane>[0], "html" | "contentRevision" | "t" | "embedPlaceholderDescriber" | "onRequestEditHtml" | "onInteractiveSourceError" | "interactiveEditorRef" | "setHtmlFromCanvas"> & { surface: { kind: "interactive"; styling: import("../react/kit.js").CanvasStyling } } & { InteractiveHtmlEditor: PageEditorProps["kit"]["InteractiveHtmlEditor"] }, _optional = {}) {
  return (
    <InteractiveHtmlEditor
      key={contentRevision}
      ref={interactiveEditorRef}
      html={html}
      onChange={setHtmlFromCanvas}
      canvasStyling={surface.styling}
      isProtectedElement={isProtectedEmbedElement}
      describeEmbedPlaceholder={embedPlaceholderDescriber}
      onRequestEditHtml={onRequestEditHtml}
      onSerializationError={onInteractiveSourceError}
      translate={t}
    />
  );
}

export function PageEditorPaneSection({ editor, page, hooks, kit, deps }: { editor: PageEditorController; page: NonNullable<PageEditorController["page"]>; hooks: PageEditorProps["hooks"]; kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"] }, _optional = {}) {
  const { slug, status, templateChoice, html, setHtml, draftHtml, setDraftHtml, htmlTextareaRef, onHtmlScroll, onPreviewFrameLoad, view, device, previewExpanded, togglePreviewExpanded, frameRef, paneWidth, dirty, contentDirty, templatePreviewUrl, previewFormRef, previewFormTarget, canvasStyling, contentRevision, t, embedPlaceholderDescriber, onRequestEditHtml, onInteractiveSourceError, interactiveEditorRef, setHtmlFromCanvas } = editor;
  const { useThemePreviewFrameHook, usePreviewEmbedIds } = hooks;
  return (
    <PageEditorPane kit={kit} deps={deps}
        useThemePreviewFrameHook={useThemePreviewFrameHook}
        view={view}
        canvasStyling={canvasStyling}
        bodyJson={page.bodyFormat === "doc" ? page.bodyJson : undefined}
        html={html}
        setHtml={setHtml}
        draftHtml={draftHtml}
        setDraftHtml={setDraftHtml}
        htmlTextareaRef={htmlTextareaRef}
        onHtmlScroll={onHtmlScroll}
        onPreviewFrameLoad={onPreviewFrameLoad}
        device={device}
        slug={slug}
        version={page.version}
        contentRevision={contentRevision}
        status={status}
        dirty={dirty}
        contentDirty={contentDirty}
        templatePreviewUrl={templatePreviewUrl}
        previewEmbeds={{ pageId: page.id, templateChoice, usePreviewEmbedIds }}
        previewFormRef={previewFormRef} previewFormTarget={previewFormTarget}
        frameRef={frameRef} paneWidth={paneWidth}
        previewExpanded={previewExpanded} onTogglePreviewExpanded={togglePreviewExpanded}
        t={t}
        embedPlaceholderDescriber={embedPlaceholderDescriber}
        onRequestEditHtml={onRequestEditHtml}
        onInteractiveSourceError={onInteractiveSourceError}
        interactiveEditorRef={interactiveEditorRef}
        setHtmlFromCanvas={setHtmlFromCanvas}
      />
  );
}

export function PageEditorTemplateModal({ editor, kit }: { editor: PageEditorController; kit: PageEditorProps["kit"]; }, _optional = {}) {
  const { templateChoice, activeThemeId, activeThemeTier, activeThemeApiVersion, showTemplateModal, onCloseTemplateModal, confirmLeave, t } = editor;
  return (
    <PageEditorTemplateModalGate kit={kit}
        show={showTemplateModal}
        templateChoice={templateChoice}
        activeThemeId={activeThemeId}
        activeThemeTier={activeThemeTier}
        activeThemeApiVersion={activeThemeApiVersion}
        onClose={onCloseTemplateModal}
        confirmLeave={confirmLeave}
        t={t}
      />
  );
}
