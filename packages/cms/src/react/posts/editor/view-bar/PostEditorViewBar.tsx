import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { ComponentType, KeyboardEventHandler } from "react";

/* Edit/Preview toolbar (2026-08-11, owner: "Let's have a preview button... a tab that shows
    either tiptap so they can edit, or how it looks when it's rendered" + "Keeping the template
    chooser on the right... that's how the others work"). Deliberately the SAME structure as
    the Pages editor's `.page-editor-toolbar` (`features/pages/PageEditor.tsx`) — tabs left,
    `.page-editor-toolbar-end` right — reusing its classes directly (`styles/pages.css`) rather
    than parallel Post-only ones: those classes already have a second consumer beyond Pages
    (`ThemeExplore.tsx`), so this is a third, not a fork. The template picker moved into
    `.page-editor-toolbar-end` verbatim from the old `.editor-slug-row` below it — only its
    MARKUP location changed; where its options/value come from is untouched (a concurrent
    agent owns that wiring). */
export function PostEditorViewBar({
  view,
  setView,
  onViewTabsKeyDown,
  device,
  setDevice,
  bodyFormat,
  availableTemplates,
  templateChoice,
  setTemplateChoice,
  onViewTemplateClick,
  t,
  DevicePreviewToggle, viewTabs, resolveTabBarTabIndex, PostEditorToolbarEnd,
}: {
  DevicePreviewToggle: ComponentType<{ device: "desktop" | "tablet" | "mobile"; setDevice(value: "desktop" | "tablet" | "mobile"): void; t: Translate; handlePrefix: string }>;
  viewTabs: readonly { key: "edit" | "preview"; label: string; handle: string; agentLabel: string }[];
  resolveTabBarTabIndex(required: { tabs: readonly { key: "edit" | "preview"; label: string; handle: string; agentLabel: string }[]; activeId: "edit" | "preview"; tab: { key: "edit" | "preview"; label: string; handle: string; agentLabel: string } }): number;
  PostEditorToolbarEnd: ComponentType<{ view: "edit" | "preview"; bodyFormat: "doc" | "html" | undefined; availableTemplates: string[]; templateChoice: string | null; setTemplateChoice(value: string): void; onViewTemplateClick(): void; t: Translate }>;
  view: "edit" | "preview";
  setView: (view: "edit" | "preview") => void;
  onViewTabsKeyDown: KeyboardEventHandler<HTMLDivElement>;
  device: "desktop" | "tablet" | "mobile";
  setDevice: (value: "desktop" | "tablet" | "mobile") => void;
  bodyFormat: "doc" | "html" | undefined;
  availableTemplates: string[];
  templateChoice: string | null;
  setTemplateChoice: (templateChoice: string) => void;
  onViewTemplateClick: () => void;
  t: Translate;
}) {
  return (
    <div className="page-editor-toolbar">
      <div className="content-editor-toolbar-start">
        <div className="segmented" role="tablist" aria-label={t("Editor view")} onKeyDown={onViewTabsKeyDown}>
          {viewTabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={view === entry.key}
              className={view === entry.key ? "is-active" : undefined}
              tabIndex={resolveTabBarTabIndex({ tabs: viewTabs, activeId: view, tab: entry })}
              onClick={() => setView(entry.key)}
              {...agentHandle({ handle: entry.handle }, { role: "button", label: entry.agentLabel })}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
        {view === "preview" ? (
          <DevicePreviewToggle device={device} setDevice={setDevice} t={t} handlePrefix="post-preview-width" />
        ) : null}
      </div>
      {/* Preview fullscreen, Level 1 (2026-09-15) — no expand toggle lives in this toolbar. It was
          here until `a380c716` and is now ONE control floating on the preview itself
          (`.post-preview-fab`, `PostPreview` below), rendered in the same place both collapsed and
          expanded so the way out is always visible: the expanded surface is a `position: absolute;
          inset: 0` panel that would cover anything in this toolbar anyway. */}
      {/* Template picker (Post-template-picker feature, 2026-08-10) — see `PostEditorToolbarEnd`'s
          own doc for the full eligibility/ordering/empty-theme rules this extracts. */}
      <PostEditorToolbarEnd
        view={view}
        bodyFormat={bodyFormat}
        availableTemplates={availableTemplates}
        templateChoice={templateChoice}
        setTemplateChoice={setTemplateChoice}
        onViewTemplateClick={onViewTemplateClick}
        t={t}
      />
    </div>
  );
}
