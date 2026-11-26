import type { RefObject, MutableRefObject } from "react";
import type { HeadlessThemeTier as ThemeTier } from "@jini-ai/core/contracts/headless/contracts";
import type { PageEditorPort } from "@jini-ai/core/contracts/site/content-editor-ports";
import type { QueryKey } from "@jini-ai/core/fetch";
import type { AdminPost } from "../../posts/api/posts-api.types.js";
import type { AdminPagePluginEmbed } from "../api/pages-api.types.js";
import type { ThemeCanvasPort } from "./theme-canvas-port.hooks.js";
import type { DevicePreviewDevice } from "../../shell/components/DevicePreview/DevicePreview.hooks.js";
import type { CanvasEmbedPlaceholderDescriptor, InteractiveHtmlEditorHandle, CanvasStyling, StandingDraftAutosaveInput, StandingDraftAutosaveSnapshot, StandingDraftStaleBasis, StandingDraftAutosaveController, DirtyGuard, DirtyGuardHostPort, SettlementGeneration } from "../../react/kit.js";
import type { RequestEditHtml } from "./use-editor-html-jump.hooks.js";
import type { SaveConflict as PageSaveConflict } from "../../shell/lib/version-conflict.js";
import type { useExternalEntryRefresh } from "../../shell/hooks/use-external-entry-refresh.hooks.js";
import type { EmbedMarkerReaders } from "../lib/embed-placeholder.js";
import type { PageEditorView, PageSavePlan } from "../page-editor-rules.js";

/**
 * @file Everything the Pages EDITOR does, so `PageEditor.tsx` is only markup.
 *
 * Same `use-<thing>.hooks.ts` convention as `use-pages.hooks.ts` beside it. Deliberately NOT shared
 * with `features/posts`' `usePostEditor`: a Post is a Tiptap document and a Page is a bespoke HTML
 * one, they are edited through different endpoints with different concurrency semantics, and the
 * only thing the two screens have in common is the header chrome.
 *
 * `port`/`navigate`/`t`/`locale` are injected — see `page-editor-port.hooks.ts` — rather than
 * reaching `lib/api`/`lib/router`/`page-editor-i18n`/`useAdminLocale()` directly, so a test can
 * describe load/save/delete outcomes against `createFakePageEditorPort` instead of stubbing global
 * `fetch`. `useWiredPageEditor` below is the zero-argument pair `PageEditor.tsx` actually mounts.
 * `useAdminLocale()` itself is called only inside `useWiredPageEditor` — its resolved `locale`
 * string is what gets injected, not the hook reference; see that function's own doc.
 */

export interface PageEditorDependencies extends EmbedMarkerReaders {
  port: PageEditorPort<AdminPost, AdminPagePluginEmbed, StandingDraftAutosaveInput, StandingDraftAutosaveSnapshot>;
  /** Separate from `port` because it reaches a different surface entirely — a theme's static asset
   *  files, not the JSON admin API. See `theme-canvas-port.hooks.ts`. */
  themeCanvasPort: ThemeCanvasPort;
  /** `options.replace` (readable-slugs S6a, 2026-09-23): the load effect below replace-navigates a
   *  URL that resolved by raw id to that same page's slug — same shape
   *  `use-widget-instance-editor.hooks.ts`'s own `navigate` dependency already documents. */
  navigate: (path: string, options?: { replace?: boolean }) => void;
  t: (required: { locale: string; key: string }) => string;
  locale: string;
  HOME_PAGE_HANDLE: string;
  PAGES_RESOURCE: string;
  pageAdminPath: (post: { id: string; slug: string }) => string;
  resolveCanvasTemplateChoice: (required: { templateChoice: string | null; bodyFormat: "doc" | "html" }) => string | null;
  /** Host's dev-build flag (e.g. a bundler's `DEV` constant) — gates dev-only instrumentation logs;
   *  injected so this package stays bundler-neutral. */
  isDevMode: boolean;
  writePage: (required: { port: PageEditorDependencies["port"]; pageId: string; plan: PageSavePlan; html: string }) => Promise<AdminPost>;
  PageBodyWriteError: new (required: { savedRow: AdminPost; reason: unknown }) => Error & { savedRow: AdminPost; reason: unknown };
  applySavedPage: (required: {
    updated: AdminPost; form: { templateChoice: string | null; html: string; nextStatus?: "draft" | "published" | undefined; basisVersion: number };
    canSaveHtml: boolean; setters: { setPage: (page: AdminPost) => void; setSlug: (value: string) => void; setStatus: (value: "draft" | "published") => void; setSavedTemplateChoice: (value: string | null) => void; setSavedHtml: (value: string) => void; setMessage: (value: string) => void };
    t: PageEditorDependencies["t"]; locale: string;
    pageUnchangedSaveMessage: (required: { t: PageEditorDependencies["t"]; locale: string; version: number }) => string;
    pageSaveSuccessMessage: (required: { t: PageEditorDependencies["t"]; locale: string; canSaveHtml: boolean }) => string;
  }) => void;
  applySaveFailure: (required: {
    e: unknown; attemptedStatus: "draft" | "published" | undefined; form: { templateChoice: string | null };
    setters: { setPage: (page: AdminPost) => void; setSlug: (value: string) => void; setStatus: (value: "draft" | "published") => void; setSavedTemplateChoice: (value: string | null) => void; setSaveConflict: (value: PageSaveConflict) => void; setError: (value: string) => void };
    t: PageEditorDependencies["t"]; locale: string; readVersionConflict: PageEditorDependencies["readVersionConflict"];
    isUnexpectedServerFailure: PageEditorDependencies["isUnexpectedServerFailure"];
    pagePartialSaveMessage: (required: { t: PageEditorDependencies["t"]; locale: string; reason: unknown }) => string;
  }) => void;
  readVersionConflict: (required: { error: unknown; attemptedStatus: "draft" | "published" | undefined }, optional?: Record<string, never>) => PageSaveConflict | null;
  isUnexpectedServerFailure: (required: { error: unknown }, optional?: Record<string, never>) => boolean;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  document: Pick<Document, "addEventListener" | "removeEventListener">;
  window: DirtyGuardHostPort;
  hooks: {
    useCachedLoader: <T>(required: { key: QueryKey; fetch: () => Promise<T> }, optional: { staleTime: number }) => { load: (optional?: { key: QueryKey; fetch: () => Promise<T> }) => Promise<T> };
    useInvalidate: () => (required: { key: QueryKey }) => void;
    useFetchMutation: (required: { run: (required: { input: () => Promise<unknown> }) => Promise<unknown> }, optional: { invalidates: readonly QueryKey[] }) => { mutate: (required: { input: () => Promise<unknown> }) => Promise<unknown> };
    useLocaleHook: () => string;
    useDevicePreviewDevice: () => { device: DevicePreviewDevice; setDevice: (value: DevicePreviewDevice) => void };
    usePreviewPaneWidth: () => { frameRef: (node: HTMLDivElement | null) => void; paneWidth: number };
    useDirtyGuard: <T>(required: { current: T; original: T | null }, optional: { host: DirtyGuardHostPort; translate: (key: string) => string }) => DirtyGuard;
    useSettlementGeneration: () => SettlementGeneration;
    useAgentScreenEntry: (required: { entry: { kind: "page" | "post"; id: string; title: string; slug: string; status: "draft" | "published" } | null }) => void;
    useExternalEntryRefresh: typeof useExternalEntryRefresh;
    useContentRefreshSubscription: (required: { resource: string; onRefresh: () => void }) => void;
    useStandingDraftAutosave: (required: { port: PageEditorDependencies["port"]; entryId: string | null; enabled: boolean; serverUpdatedAt?: string | undefined }) => StandingDraftAutosaveController;
    useWiredInteractiveEditorFlush: (required: { setHtml: (value: string) => void }) => { interactiveEditorRef: RefObject<InteractiveHtmlEditorHandle | null>; flushInteractiveEdits: () => Promise<string | undefined>; setHtmlFromCanvas: (value: string) => void };
    useWiredEditorHtmlJump: (required: { html: string; contentRevision: number; flush: () => Promise<string | undefined>; setView: (value: "html") => void; setDraftHtml: (value: string) => void; scrollTop: MutableRefObject<number> }, optional: { onError: (error?: Error) => void }) => { requestEditHtml: RequestEditHtml; htmlTextareaRef: (node: HTMLTextAreaElement | null) => void; consumeJumpFormatting: () => boolean };
    useThemeCanvasStyling: (required: { themeId: string | null; apiVersion: 2 | undefined; port: ThemeCanvasPort }, optional: { templateChoice: string | null }) => { status: "pending" } | { status: "ready"; styling: CanvasStyling };
  };
}

import { usePageEditorLoad } from "./page-editor-load.hooks.js";
import { usePageEditorWorkspace } from "./page-editor-workspace.hooks.js";
import { usePageEditorHydration } from "./page-editor-load.hooks.js";
import { usePageEditorHtmlWorkspace } from "./page-editor-workspace.hooks.js";
import { usePageEditorPreviewWorkspace } from "./page-editor-preview.hooks.js";
import { usePageEditorSave } from "./page-editor-actions.hooks.js";
import { usePageEditorActions } from "./page-editor-actions.hooks.js";
import { usePageEditorPreview } from "./page-editor-preview.hooks.js";
import { usePageEditorRecovery } from "./page-editor-recovery.hooks.js";
import { usePageEditorPreviewSubmit } from "./page-editor-preview.hooks.js";
import { usePageEditorRestore } from "./page-editor-recovery.hooks.js";
import { usePageEditorFlush } from "./page-editor-workspace.hooks.js";
import { pageEditorWorkspaceView } from "./page-editor-workspace.hooks.js";
import { pageEditorRecoveryView } from "./page-editor-recovery.hooks.js";
import type { Translate } from "@jini-ai/core/text";

export interface PageEditorController {
  /** `null` until the initial load settles. */
  page: AdminPost | null;
  error: string | null;
  message: string | null;
  title: string;
  setTitle: (value: string) => void;
  slug: string;
  setSlug: (value: string) => void;
  status: "draft" | "published";
  setStatus: (value: "draft" | "published") => void;
  /** Pages template picker (Task 4, 2026-08-11). Tri-state, but `null` and `""` now diverge
   *  (bare-page ruling, 2026-09-23, S6 — see `rules.ts`'s `pagePickerValue`): `null` is "never chosen",
   *  which renders through the theme's own page shell ("Theme default" in the picker); `""` is an
   *  explicit "No template", which renders bare — only this Page's own HTML, no theme styles, scripts,
   *  header or footer; or a real filename, which renders that template. */
  templateChoice: string | null;
  setTemplateChoice: (value: string | null) => void;
  /** The active theme's declared `templates` list (`theme.json`) — `[]` when the theme doesn't
   *  support templates, in which case the caller should not render the picker at all. The SAME field
   *  `usePostEditor`'s `availableTemplates` reads (unified 2026-08-11 — was a separate `pageTemplate`
   *  array before the `content` marker removed the reason Posts and Pages needed different lists). */
  availableTemplates: string[];
  /** The workspace's currently active theme id (`PresentationSettings.activeThemeId`) — feeds the
   *  Interactive tab's canvas stylesheet/token fetches and `TemplateSourceModal`'s fetch URL. `null`
   *  until the presentation-settings load settles. Mirrors `usePostEditor`'s identical field. */
  activeThemeId: string | null;
  /** The active theme's capability tier (looked up on `availableThemes` by `activeThemeId`) — gates
   *  whether "View Template" (`TemplateSourceModal`) attempts a fetch at all. `null` when the id has
   *  not loaded yet OR when it is absent from `availableThemes`. Mirrors `usePostEditor`'s identical
   *  field ("View Template" parity, 2026-09-24). */
  activeThemeTier: ThemeTier | null;
  /** The active theme's manifest `apiVersion` (`2`, or `undefined` for v1) — same
   *  `render/pages/`-vs-`pages/` fetch-URL decision `usePostEditor`'s identical field documents. */
  activeThemeApiVersion: 2 | undefined;
  /** Whether the "View Template" modal (`TemplateSourceModal`) is open — Pages' own instance of the
   *  affordance `usePostEditor`'s identical field has carried since 2026-08-10 (2026-09-24, "View
   *  Template" parity: Pages had a template picker but no way to inspect the chosen template's
   *  source, unlike Posts). Ephemeral view state; not persisted. */
  showTemplateModal: boolean;
  /** The template picker's "View Template" button — opens {@link showTemplateModal}. A no-op when
   *  nothing is chosen ({@link templateChoice} falsy); `PageEditor.tsx`'s own button additionally
   *  disables itself in that case, this is belt-and-suspenders against a direct call. */
  onViewTemplateClick: () => void;
  /** `TemplateSourceModal`'s own close action. */
  onCloseTemplateModal: () => void;
  /** The working copy of the page's HTML — what the preview renders and what Save persists. */
  html: string;
  setHtml: (value: string) => void;
  /**
   * HTML tab's local, display-only pretty-printed copy of `html` (moved here from `PageEditor.tsx`,
   * 2026-08-11 complexity-ceiling pass — see the reformat effect below for the full "why" this used
   * to carry in that component). Reformats only on the transition INTO the HTML tab (never mid-edit,
   * never on every keystroke) so the formatter can't fight the operator's cursor, and typing here
   * writes straight through to `setHtml` too, so this is purely a display concern layered on top of
   * `html` — it can never by itself affect `dirty`.
   */
  draftHtml: string;
  setDraftHtml: (value: string) => void;
  view: PageEditorView;
  setView: (value: PageEditorView) => void;
  device: DevicePreviewDevice;
  setDevice: (value: DevicePreviewDevice) => void;
  /**
   * Preview fullscreen (2026-09-16) — whether the Preview tab's own pane is expanded to fill
   * `.admin-main-col` (see `PageEditor.tsx`'s `.page-preview-expanded` wrapper). The Pages-side
   * twin of `PostEditorController.previewExpanded`; see that field's own doc for the full
   * lifetime/containment reasoning this deliberately copies rather than lifts to `App.tsx` or a
   * module-level bus — a route change unmounts `PageEditor`, which unmounts this hook, which
   * discards this for free. Never persisted.
   *
   * Deliberately independent of {@link device}: expanding does NOT override the operator's chosen
   * preview width. See `PagePreview`'s own doc for why widening the pane (not widening the page)
   * is what fullscreen means here.
   */
  previewExpanded: boolean;
  /** Flips {@link previewExpanded}. A separate action rather than a setter, matching `setView`'s
   *  own shape above — the caller never needs to set it to a specific value directly. */
  togglePreviewExpanded: () => void;
  /**
   * `PagePreview`'s own frame element and its live-measured width (moved here from `PagePreview`,
   * 2026-08-11 complexity-ceiling pass — see `usePreviewPaneWidth` (`components/DevicePreview`) for the full "why ResizeObserver
   * instead of a guessed constant" reasoning this used to carry in that component). `PageEditor.tsx`
   * passes both straight through as props; `PagePreview` attaches `frameRef` to the element it wants
   * measured (`<div ref={frameRef}>` — React accepts a callback ref directly, same call site a
   * `RefObject` would use) and reads `paneWidth` back to compute its scale. A CALLBACK ref, not a
   * `RefObject` — see `usePreviewPaneWidth` for why that distinction is load-bearing here.
   */
  frameRef: (node: HTMLDivElement | null) => void;
  paneWidth: number;
  saving: boolean;
  /** Bound page-editor translator for the markup surface. */
  t: Translate;
  /**
   * Bug A (2026-09-23 interactive-bugs plan, Slice A3) — the Interactive tab's placeholder-card
   * describer, built once here (see this hook's own `embedPlaceholderDescriber` local for why) and
   * handed to `@jini-ai/ui/html-editor`'s `InteractiveHtmlEditor` as `describeEmbedPlaceholder` by
   * `PageEditorPane`. Recognizes a `data-embed-config` marker and labels it from the shared
   * `the marker reader` target rule, instead of the id-only label Jini's own adapter produced.
   */
  embedPlaceholderDescriber: (el: Element) => CanvasEmbedPlaceholderDescriptor | undefined;
  onRequestEditHtml: RequestEditHtml;
  onInteractiveSourceError: (error: Error) => void;
  /**
   * Interactive flush (2026-09-23 plan) — `PageEditorPane` attaches this to
   * `<InteractiveHtmlEditor ref={...}>`. GrapesJS only syncs an open RTE session's text into its
   * component model when that session closes, never on every keystroke, so `save`,
   * `saveOverwritingConflict`, `setView`, and `setTemplateChoice` all flush through it (via
   * `flushInteractiveEdits`, `use-interactive-flush.hooks.ts`) before reading or changing `html` —
   * otherwise a still-open edit is silently lost. `null` until `<InteractiveHtmlEditor>` mounts (not
   * on the Interactive tab, or not yet rendered).
   */
  interactiveEditorRef: RefObject<InteractiveHtmlEditorHandle | null>;
  /** `<InteractiveHtmlEditor onChange>`: `setHtml` with the canvas's `&quot;`-encoded embed markers
   *  put back in their readable single-quoted form (`use-interactive-flush.hooks.ts`). */
  setHtmlFromCanvas: (value: string) => void;
  /**
   * Whether the working copy differs from what was last loaded or saved.
   *
   * Read by more than the Save button: this is the "in the middle of a task" signal the agent's
   * `pages.open_editor` capability is meant to gate navigation on, so that being pulled to another
   * page mid-edit asks first instead of discarding work.
   */
  dirty: boolean;
  /**
   * Template-preview fix (2026-08-11) — `dirty` MINUS the `templateChoice` comparison: whether
   * title/slug/status/body differ from what's saved. A page can be `dirty` (Save button lit) while
   * `contentDirty` is `false` — that's exactly "only the template picker moved" — which is what lets
   * `PagePreview` show a real template-applied render for the pending choice instead of falling all
   * the way back to the raw, unstyled body. See `ADS-memory/reports/implementation/
   * 2026-08-11-template-preview-render-bug.md` for the bug this fixes.
   */
  contentDirty: boolean;
  /**
   * The admin-only template-preview iframe's `src`, pre-built from `port.templatePreviewUrl` (a
   * synchronous URL builder, not a fetch) so `PageEditor.tsx` never imports `lib/api` just to call
   * it. `""` before `page` loads — never rendered that early, since `PageEditor.tsx` shows a loading
   * notice and mounts no preview until `page` is set, same "inert default before load" shape
   * `availableTemplates` already uses. Recomputed on every render off `page`/`templateChoice` — cheap
   * string building, not worth a `useMemo`.
   */
  templatePreviewUrl: string;
  /** DOM ref for the pending-html-preview's hidden `<form>` — owned here, not local to
   *  `PagePreview`, so the debounced auto-submit effect below can reach it. Same "hook owns the ref,
   *  view attaches it" shape `frameRef` above already uses, and the same shape
   *  `use-post-editor.hooks.ts`'s own `previewFormRef` uses for Posts — see that field's own doc for
   *  the "why here, not the view" reasoning this mirrors.
   *
   *  A CALLBACK ref, not a `RefObject` (2026-10-05 owner bug: a draft's preview went blank after a
   *  full-screen toggle). The form is a hidden POST into a named iframe, so a freshly mounted pair is
   *  an EMPTY `about:blank` frame until something submits into it. With a `RefObject` the debounced
   *  effect only re-armed on editor-state changes, so any remount that changed no state (the
   *  expand/collapse tree swap did exactly that) left the new iframe empty for good. Holding the node
   *  in state puts the form itself in the effect's dependency list: every mount re-submits. */
  previewFormRef: (node: HTMLFormElement | null) => void;
  /** Stable name shared by the hidden form's `target` and the iframe it submits into. `""` before
   *  `page` loads — `PagePreview` never renders that early. */
  previewFormTarget: string;
  /**
   * What the Interactive tab's GrapesJS canvas renders the page against — the active theme's own
   * stylesheet plus its design tokens, so a page is edited looking roughly the way it publishes
   * rather than as browser-default text on white. `pending` until the theme's token files settle;
   * `PageEditor.tsx` must not mount the editor before then, because `InteractiveHtmlEditor` reads
   * its canvas styling once at mount and never reacts to a later value. See
   * `use-theme-canvas-styling.hooks.ts`.
   */
  canvasStyling: { status: "pending" } | { status: "ready"; styling: CanvasStyling };
  save: (nextStatus?: "draft" | "published") => Promise<void>;
  /**
   * Non-null once the server has REFUSED an explicit Save/Publish because another operator's save
   * moved the row's `version` out from under this editor (2026-09-07). The caller renders it as a
   * banner offering the two things an operator can actually do — {@link saveOverwritingConflict} or
   * {@link dismissSaveConflict} — with the wording in `rules.ts`'s `pageVersionConflictMessage`.
   *
   * Distinct from {@link autosaveStaleBasis} below, which is the BACKGROUND autosave hitting the
   * same wall: this one is a save the operator pressed and watched fail.
   */
  saveConflict: PageSaveConflict | null;
  /** Re-reads the current row and re-runs the rejected save against it, replaying the original
   *  draft/publish intent. The only way past a {@link saveConflict}, and deliberately explicit: the
   *  plain Save button keeps failing until the operator chooses to replace the other version. */
  saveOverwritingConflict: () => Promise<void>;
  /** Hides the {@link saveConflict} banner without writing anything. */
  dismissSaveConflict: () => void;
  remove: () => Promise<void>;
  confirmingDelete: boolean;
  setConfirmingDelete: (value: boolean) => void;
  /** The Save button. With changes it saves; with none it opens the "Nothing changed. Save anyway?"
   *  warning (owner, 2026-10-10) — see `unchangedSaveHandlers`. Never disabled for "no changes". */
  onSave: () => void;
  /** The "Nothing changed. Save anyway?" warning is open. */
  confirmingUnchangedSave: boolean;
  /** The warning's "Save anyway": closes it and saves; the server skips the write if nothing differs. */
  onUnchangedSaveConfirm: () => void;
  onUnchangedSaveCancel: () => void;
  deleting: boolean;
  /** Call before an in-app navigation the operator triggered (the back link). `true` means it's
   *  safe to proceed. `beforeunload` is wired automatically by the same `useDirtyGuard` call this
   *  reads off — see `use-dirty-guard.hooks.ts`. Audit finding (2026-08-01): unlike `PostEditor`,
   *  this screen had NO unsaved-work guard of any kind until now — fixed alongside standing-draft
   *  autosave since both exist to protect the same at-risk work. */
  confirmLeave: () => boolean;
  /**
   * The back link's `onClick`. With no Interactive editor mounted this is exactly
   * {@link confirmLeave}: cancel means `preventDefault()`, otherwise the link's own navigation runs.
   * With one mounted, an edit still open in an RTE session is not in `html` yet, so `dirty` cannot
   * see it (GrapesJS syncs it only when the session closes). Then this always takes over the
   * navigation: it flushes the editor, asks if the flush produced unsaved HTML, and navigates to
   * the list itself only if the operator agrees.
   */
  onBackLinkClick: (event: { preventDefault: () => void }) => Promise<void>;
  /**
   * Standing-draft autosave (2026-09-06) — non-null once the mount-time recovery check finds a
   * draft parked from a previous session. Never auto-applied; `PageEditor.tsx` renders an explicit
   * "restore or discard" banner and calls {@link restoreRecoveredDraft}/{@link discardRecoveredDraft}
   * on the operator's own action.
   */
  recoverableDraft: StandingDraftAutosaveSnapshot | null;
  /** Applies the recovered draft into the working copy (title/slug/html) and dismisses the banner.
   *  Does NOT itself tell the server anything — the restored edit re-enters the normal autosave/Save
   *  flow from here, the same as any other in-progress edit. */
  restoreRecoveredDraft: () => void;
  /** Discards the recovered draft server-side and dismisses the banner, without applying it. */
  discardRecoveredDraft: () => Promise<void>;
  /**
   * Standing-draft autosave — non-null once the server has REFUSED a background write for this page
   * because another operator's save moved the row's `version` out from under this editor. Distinct
   * from {@link recoverableDraft}, which is work found parked from a previous session: this is the
   * session happening right now, and while it is set nothing the operator types is being persisted
   * anywhere the server can see.
   *
   * Surfaced so `PageEditor.tsx` can say so on screen. That is the whole point of passing it
   * through: `useStandingDraftAutosave` has recorded this since commit `a60e07e8`, and with no
   * editor consuming it the operator could type for an hour into a screen that looked completely
   * normal and be told nothing until they reloaded.
   *
   * Reporting it never costs the operator their text — the working copy (`title`/`slug`/`html`) is
   * not touched on this path, by this hook or by the shared one.
   */
  autosaveStaleBasis: StandingDraftStaleBasis | null;
  /**
   * Content refresh (2026-09-16) — non-null only while an assistant tool (`pages_write_html` /
   * `pages_write_region`) has written a newer version of this page AND the editor may have unsaved
   * edits the operator hasn't resolved yet (on the Interactive tab that is always assumed — see
   * `pageRefreshMayHaveUnsavedEdits`). `null` means either nothing changed, or the editor was clean
   * and already applied the change silently. See `use-external-entry-refresh.hooks.ts` for the
   * clean/dirty decision this is the dirty half of.
   */
  pendingExternalVersion: number | null;
  /** Discards the standing draft, re-reads the row, and applies it — the operator's explicit choice
   *  to throw away their unsaved edits in favor of the newer version. */
  loadExternalChange: () => Promise<void>;
  /** Hides {@link pendingExternalVersion}'s notice and silences further ones until this editor's own
   *  loaded basis version moves (a Save, Save anyway, or Load latest). */
  dismissExternalChange: () => void;
  /**
   * Bumped only when an EXTERNAL write is applied — silently, or through Load latest — never by this
   * editor's own save. The Interactive tab's remount key, so GrapesJS picks up an assistant-written
   * body without losing its canvas state on every own Save. On that tab only Load latest bumps it
   * (see `pageRefreshMayHaveUnsavedEdits`). See `PageEditorPane`'s `key={contentRevision}`.
   */
  contentRevision: number;
  /**
   * Per-tab scroll memory (2026-09-16, owner report: "when i click on HTML and Preview for the html
   * it goes back to the top. anyway not to lose position?"). `PageEditorPane` renders each surface as
   * its own root element keyed on `view` (`PageEditor.tsx`'s three-way branch), so React unmounts one
   * surface and mounts a fresh one on every tab switch — a brand-new `<textarea>`/`<iframe>` always
   * starts at `scrollTop`/`scrollY` `0`, independent of anything CSS or React state can fix on its
   * own. These three fields are that fix: the position is kept in a ref here (session-only, discarded
   * with the rest of this hook's state on navigating away — no persistence was asked for), restored
   * the instant the new DOM node mounts, and captured continuously while scrolling so the LAST
   * position before the node unmounts is always the one on file. HTML and Preview each get their own
   * ref, so switching tabs never mixes the two — syncing position BETWEEN tabs was explicitly not
   * wanted (owner, same report).
   *
   * `htmlTextareaRef` attaches to `PageEditorPane`'s `<textarea>` (`ref={htmlTextareaRef}`) and
   * restores its `scrollTop` the moment React commits the node; {@link onHtmlScroll} is wired to that
   * same textarea's native `onScroll` and keeps the ref current after that. A content refresh
   * (`contentRevision` bump) never unmounts this node — same tab, same element, `value` prop just
   * changes — so nothing here needs to re-restore for that case; the browser clamps `scrollTop` to the
   * new (possibly shorter) content on its own.
   */
  htmlTextareaRef: (node: HTMLTextAreaElement | null) => void;
  /** See {@link htmlTextareaRef}'s own doc. Wired to the HTML textarea's `onScroll`. */
  onHtmlScroll: (scrollTop: number) => void;
  /**
   * See {@link htmlTextareaRef}'s own doc — the Preview tab's counterpart. Wired to BOTH
   * `PagePreviewFrame` branches' `<iframe onLoad>`: the live-site iframe (`canShowLiveSite`) and the
   * template-preview iframe (the hidden-form POST target) each fire a fresh `load` on every mount AND
   * on every re-navigation (a content refresh re-submits the same iframe without unmounting it), which
   * is exactly the hook this needs — restoring and re-attaching a scroll listener on whichever `Window`
   * the iframe holds right now.
   *
   * The live-site iframe is cross-origin in dev (`siteUrl`'s own origin, `:3000` vs. the admin's
   * `:5173` — see `PagePreview`'s own doc). Reading or driving scroll on a foreign `Window` is a
   * browser security restriction this code cannot route around without the site itself cooperating
   * (out of scope — another agent owns the host backend), so that branch's position is NOT remembered.
   * Since 2026-10-05 the template-preview branch is in the same position: `PAGE_PREVIEW_IFRAME_SANDBOX`
   * dropped `allow-same-origin`, so every preview document has an opaque origin and this handler's
   * `try` swallows the `SecurityError` on both branches. Restoring it needs the preview document to
   * report its own scroll by `postMessage`. See this function's own implementation comment for the
   * try/catch this relies on.
   */
  onPreviewFrameLoad: (iframe: HTMLIFrameElement) => void;
}

export function usePageEditor({ routeSlug, deps }: { routeSlug: string; deps: PageEditorDependencies }, _optional = {}): PageEditorController {
  const loaded = usePageEditorLoad({ routeSlug, deps });
  const workspace = usePageEditorWorkspace(loaded);
  const hydrated = usePageEditorHydration(workspace);
  const htmlWorkspace = usePageEditorHtmlWorkspace(hydrated);
  const previewWorkspace = usePageEditorPreviewWorkspace(htmlWorkspace);
  const saveActions = usePageEditorSave(previewWorkspace);
  const actions = usePageEditorActions(saveActions);
  const preview = usePageEditorPreview(actions);
  const recovery = usePageEditorRecovery(preview);
  const scheduled = usePageEditorPreviewSubmit(recovery);
  const restored = usePageEditorRestore(scheduled);
  const flushed = usePageEditorFlush(restored);
  return { ...pageEditorWorkspaceView(flushed), ...pageEditorRecoveryView(flushed) };
}

/**
 * Binds the real `/api/.../pages` client, `lib/router`'s `navigate`, and `page-editor-i18n`'s `t` —
 * see `page-editor-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `PageEditor.tsx`
 * composes this and a test composes {@link usePageEditor} with `createFakePageEditorPort`.
 * `useAdminLocale()` is called here, not injected as a hook reference — its resolved `locale` value
 * is what `usePageEditor` actually consumes (every internal use supplies `{ locale, key }`), and there is no
 * precedent in this codebase for injecting a hook reference instead of the value it resolves to.
 */
export function bindPageEditorHooks({ hooks, deps }: { hooks: PageEditorDependencies["hooks"]; deps: Omit<PageEditorDependencies, "locale" | "hooks"> }, _optional = {}) {
  return {
    usePageEditor: function useBoundPageEditor({ routeSlug, deps: overrides }: { routeSlug: string; deps: Pick<PageEditorDependencies, "port" | "themeCanvasPort" | "navigate" | "t" | "locale"> }, _optional = {}): PageEditorController {
      return usePageEditor({ routeSlug, deps: { ...deps, ...overrides, hooks } });
    },
    useWiredPageEditor: function useWiredPageEditor({ routeSlug }: { routeSlug: string }, _optional = {}): PageEditorController {
      const locale = hooks.useLocaleHook();
      return usePageEditor({ routeSlug, deps: { ...deps, locale, hooks } });
    },
  };
}
