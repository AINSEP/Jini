import type { ComponentType, KeyboardEventHandler, ComponentProps } from "react";
import type { Translate } from "@jini-ai/core/text";
import type { PageEditorController } from "./hooks/use-page-editor.hooks.js";
import type { PageEditorView } from "./page-editor-rules.js";
import type { PreviewEmbeds } from "./PageEditorPreview.js";
import type { TermPickerProps } from "../screens/taxonomy/TermPicker.js";
import type { IconProps, HtmlEditorProps, CanvasStyling } from "../react/kit.js";
import type { ConfirmDialogProps } from "../react/components/ConfirmDialog/ConfirmDialog.js";
import type { DevicePreviewFrame } from "../shell/components/DevicePreview/DevicePreviewFrame.js";
import type { DevicePreviewToggle } from "../shell/components/DevicePreview/DevicePreviewToggle.js";
import type { ViewTemplateButtonProps } from "../shell/components/TemplateSource/ViewTemplateButton.js";
import { agentHandle } from "@jini-ai/core/agent-handles";

/**
 * @file The Pages editor — markup only. State lives in `hooks/use-page-editor.hooks.ts`.
 *
 * **There is no Tiptap here, and there never will be.** A Page is a bespoke HTML document; the
 * editing surfaces are the rendered preview, the raw HTML behind it, and — the "Interactive" tab —
 * a GrapesJS-backed visual surface for clicking into rendered text and editing it in place
 * (`@jini-ai/ui/html-editor`'s generic `InteractiveHtmlEditor`, mounted directly here since
 * 2026-09-23 with this feature's own `isProtectedEmbedElement`/`embedPlaceholderDescriber` supplied
 * below — Bug A / interactive-bugs plan Slice A3 — rather than through `@jini-ai/admin/react`'s
 * host-specific adapter, which could not describe a marker addressed by `slug`/`typeKey`). GrapesJS
 * does not contradict the "no Tiptap"
 * invariant: it edits and exports raw HTML directly, `html`/`setHtml` above stay the single source
 * of truth, and there is no parallel structured-document format the way Tiptap's `bodyJson` would
 * be — text editing and basic formatting only this pass, not Gutenberg-style block manipulation.
 * Posts keep Tiptap in `features/posts/PostEditor.tsx`, which this screen replaces for `kind:
 * "page"` entries — that screen was previously reached for Pages too, differing only by a
 * `kindLabel === "page"` ternary on its heading while still mounting the Tiptap toolbar over a
 * document Tiptap would silently mangle.
 *
 * The chat that drives generation is NOT in this component. It is the workspace assistant dock,
 * which `App.tsx` renders outside the route switch and ADR-049 pins to never unmount — so it is the
 * same conversation whether the operator is on the Pages list or in here, and an agent can navigate
 * between them mid-turn without losing the thread. Building a second chat pane into this screen
 * would fork that conversation for no gain.
 */
export interface PageEditorProps {
  /** The page's slug, as it appears in the URL. Also accepts a legacy id — see `usePageEditor`. */
  slug: string;
  hooks: {
    usePageEditorHook: (required: { routeSlug: string }, optional?: Record<string, never>) => PageEditorController;
    useTabBarKeyboardHook: (required: { tabs: readonly { id: string; label: string }[]; activeId: string; onChange: (id: string) => void }) => { onKeyDown: KeyboardEventHandler<HTMLDivElement> };
    useThemePreviewFrameHook: PreviewEmbeds["hooks"]["useThemePreviewFrameHook"];
    usePreviewEmbedIds: PreviewEmbeds["hooks"]["usePreviewEmbedIds"];
    useWiredTermPicker: TermPickerProps["useTermPickerHook"];
    useTermListReveal: TermPickerProps["useTermListRevealHook"];
  };
  kit: {
    Icon: ComponentType<IconProps>;
    ConfirmDialog: ComponentType<ConfirmDialogProps>;
    InteractiveHtmlEditor: ComponentType<HtmlEditorProps>;
    DevicePreviewFrame: ComponentType<ComponentProps<typeof DevicePreviewFrame>>;
    DevicePreviewToggle: ComponentType<ComponentProps<typeof DevicePreviewToggle>>;
    ViewTemplateButton: ComponentType<ViewTemplateButtonProps>;
    WiredThemePreviewReloadButton: ComponentType<Record<string, never>>;
    TermPicker: ComponentType<TermPickerProps>;
    SuggestInput: TermPickerProps["SuggestInput"];
    TemplateSourceModal: ComponentType<{
      themeId: string; themeTier: PageEditorController["activeThemeTier"]; themeApiVersion: 2 | undefined;
      templateFilename: string; onClose: () => void; confirmLeave: () => boolean; t: Translate; editAgentHandleId: string;
    }>;
    PageExternalChangeBanner: ComponentType<{
      onLoadLatest: () => void; onKeepEdits: () => void; t: Translate;
      agentHandle: typeof agentHandle; copy: PageEditorProps["deps"]["pageExternalChangeBindings"]["copy"];
    }>;
  };
  deps: {
    siteUrl: (required: { path: string }) => string;
    pagePublicPath: (required: { slug: string }) => string;
    pagePickerValue: (required: { templateChoice: string | null; availableTemplates: string[] }) => string;
    resolveTabBarTabIndex: (required: { tabs: readonly { id: string; label: string }[]; activeId: string; tab: { id: string; label: string } }) => number;
    standingDraftRecoveryMessage: (required: { draft: NonNullable<PageEditorController["recoverableDraft"]>; serverUpdatedAt: string; t: Translate }) => string;
    pageExternalChangeBindings: { agentHandle: typeof agentHandle; copy: { messageKey: string; regionAgentLabel: string; loadLatestAgentLabel: string; keepEditsAgentLabel: string } };
    pageEditorSurface: (required: { view: PageEditorView; canvasStyling: PageEditorController["canvasStyling"] }) => { kind: "preview" } | { kind: "html" } | { kind: "interactive-pending" } | { kind: "interactive"; styling: CanvasStyling };
    videoLink: (required: { id: string }) => string;
  };
}

import { PageEditorHeaderSection } from "./PageEditorChrome.js";
import { PageEditorNoticesSection } from "./PageEditorNotices.js";
import { PageEditorToolbarEnd } from "./PageEditorChrome.js";
import { PageEditorActionsSection } from "./PageEditorChrome.js";
import { PageEditorPaneSection } from "./PageEditorPane.js";
import { PageEditorTemplateModal } from "./PageEditorPane.js";
import { VIEW_TABS } from "./PageEditorChrome.js";

export function PageEditor({ slug: routeSlug, hooks, kit, deps }: PageEditorProps, _optional = {}) {
  const { usePageEditorHook, useTabBarKeyboardHook } = hooks;
  const editor = usePageEditorHook({ routeSlug });
  const { page, error, t, view, setView } = editor;
  // Above the early returns below: `use*` has to be called unconditionally for the rules-of-hooks
  // lint even though this one holds no state of its own.
  const { onKeyDown: onViewTabsKeyDown } = useTabBarKeyboardHook({ tabs: VIEW_TABS, activeId: view, onChange: (id) => setView(id as PageEditorView) });
  if (error && !page) return <div className="notice error">{error}</div>;
  if (!page) return <div className="notice">{t("Loading editor…")}</div>;
  return (
    <div className="page content-editor-page">
      <PageEditorHeaderSection editor={editor} page={page} kit={kit} deps={deps} />
      <PageEditorNoticesSection editor={editor} page={page} kit={kit} deps={deps} />
      <PageEditorToolbar editor={editor} page={page} kit={kit} deps={deps} onViewTabsKeyDown={onViewTabsKeyDown} />
      {/* Directly under the toolbar, not in the header — see `PageEditorActions`' own doc. */}
      <PageEditorActionsSection editor={editor} />
      <PageEditorPaneSection editor={editor} page={page} hooks={hooks} kit={kit} deps={deps} />
      {/* Categories & Tags — the same box the post and collection-entry editors mount; it saves on
          its own button, separately from the page's Save/Publish. */}
      <PageEditorTerms page={page} hooks={hooks} kit={kit} />
      {/* Save with nothing changed (owner, 2026-10-10): a warning, not a disabled button — same as
          Edit post. "Save anyway" still sends the content; the server writes nothing if it's identical. */}
      <PageEditorUnchangedConfirm editor={editor} kit={kit} />
      <PageEditorDeleteConfirm editor={editor} kit={kit} />
      {/* See `PageEditorTemplateModalGate`'s own doc for why this is conditionally mounted rather
          than always-mounted-with-`open`. */}
      <PageEditorTemplateModal editor={editor} kit={kit} />
    </div>
  );
}

export function bindPageEditor({ hooks, kit, deps }: Omit<PageEditorProps, "slug">, _optional = {}) {
  return function BoundPageEditor({ slug, usePageEditorHook = hooks.usePageEditorHook, useTabBarKeyboardHook = hooks.useTabBarKeyboardHook,
    useThemePreviewFrameHook = hooks.useThemePreviewFrameHook, usePreviewEmbedIds = hooks.usePreviewEmbedIds }: {
    slug: string; usePageEditorHook?: PageEditorProps["hooks"]["usePageEditorHook"]; useTabBarKeyboardHook?: PageEditorProps["hooks"]["useTabBarKeyboardHook"];
    useThemePreviewFrameHook?: PageEditorProps["hooks"]["useThemePreviewFrameHook"]; usePreviewEmbedIds?: PageEditorProps["hooks"]["usePreviewEmbedIds"];
  }, _optional = {}) {
    return <PageEditor slug={slug} kit={kit} deps={deps} hooks={{ ...hooks, usePageEditorHook, useTabBarKeyboardHook, useThemePreviewFrameHook, usePreviewEmbedIds }} />;
  };
}

function PageEditorTerms({ page, hooks, kit }: { page: NonNullable<PageEditorController["page"]>; hooks: PageEditorProps["hooks"]; kit: PageEditorProps["kit"]; }, _optional = {}) {
  const { useWiredTermPicker, useTermListReveal } = hooks;
  const { TermPicker, SuggestInput } = kit;
  return (
    <TermPicker contentType={page.kind} contentId={page.id} useTermPickerHook={useWiredTermPicker} useTermListRevealHook={useTermListReveal} SuggestInput={SuggestInput} />
  );
}

function PageEditorUnchangedConfirm({ editor, kit }: { editor: PageEditorController; kit: PageEditorProps["kit"]; }, _optional = {}) {
  const { saving, confirmingUnchangedSave, onUnchangedSaveConfirm, onUnchangedSaveCancel, t } = editor;
  const { ConfirmDialog } = kit;
  return (
    <ConfirmDialog
        open={confirmingUnchangedSave}
        agentHandle="page-save-unchanged-confirm"
        title={t("Nothing changed")}
        body={<p>{t("Nothing has changed since the last save. Save anyway?")}</p>}
        confirmLabel={t("Save anyway")}
        pending={saving}
        onConfirm={onUnchangedSaveConfirm}
        onCancel={onUnchangedSaveCancel}
      />
  );
}

function PageEditorDeleteConfirm({ editor, kit }: { editor: PageEditorController; kit: PageEditorProps["kit"]; }, _optional = {}) {
  const { title, remove, confirmingDelete, setConfirmingDelete, deleting, t } = editor;
  const { ConfirmDialog } = kit;
  return (
    <ConfirmDialog
        open={confirmingDelete}
        agentHandle="page-delete-confirm"
        title={t("Move to trash?")}
        body={<p>{t("Move")} &quot;{title}&quot; {t("to trash? It will disappear from the site and from this list.")}</p>}
        confirmLabel={t("Move to trash")}
        destructive
        pending={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmingDelete(false)}
      />
  );
}

function PageEditorToolbar({ editor, page, kit, deps, onViewTabsKeyDown }: { editor: PageEditorController; page: NonNullable<PageEditorController["page"]>; kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"]; onViewTabsKeyDown: import("react").KeyboardEventHandler<HTMLDivElement> }, _optional = {}) {
  const { templateChoice, setTemplateChoice, availableTemplates, onViewTemplateClick, view, device, setDevice, t } = editor;
  const { DevicePreviewToggle } = kit;
  return (
    <div className="page-editor-toolbar">
        {/* Device icons + width sit right next to the view tabs (owner, 2026-10-10, same as Edit
            post); reload, template eye and template select stay on the right. */}
        <div className="content-editor-toolbar-start">
          <PageEditorViewTabs editor={editor} deps={deps} onViewTabsKeyDown={onViewTabsKeyDown} />
          {view === "preview" ? (
            <DevicePreviewToggle device={device} setDevice={setDevice} t={t} handlePrefix="page-preview-width" />
          ) : null}
        </div>
        {/* Reload and the template picker share the toolbar's right-hand side — see
            `PageEditorToolbarEnd`'s own doc for the layout history and the template-picker's rules. */}
        <PageEditorToolbarEnd kit={kit} deps={deps}
          view={view}
          bodyFormat={page.bodyFormat}
          availableTemplates={availableTemplates}
          templateChoice={templateChoice}
          setTemplateChoice={setTemplateChoice}
          onViewTemplateClick={onViewTemplateClick}
          t={t}
        />
      </div>
  );
}

function PageEditorViewTabs({ editor, deps, onViewTabsKeyDown }: { editor: PageEditorController; deps: PageEditorProps["deps"]; onViewTabsKeyDown: KeyboardEventHandler<HTMLDivElement> }, _optional = {}) {
  const { view, setView, t } = editor;
  const { resolveTabBarTabIndex } = deps;
  return (
    <div className="segmented" role="tablist" aria-label={t("Editor view")} onKeyDown={onViewTabsKeyDown}>
            {VIEW_TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={view === entry.key}
                className={view === entry.key ? "is-active" : undefined}
                tabIndex={resolveTabBarTabIndex({ tabs: VIEW_TABS, activeId: view, tab: entry })}
                onClick={() => setView(entry.key)}
                {...agentHandle({ handle: `page-view-${entry.key}` }, { role: "button", label: `Switch to the ${entry.label} view` })}
              >
                {t(entry.label)}
              </button>
            ))}
          </div>
  );
}
