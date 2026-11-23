import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { unchangedSaveHandlers } from "../../shell/lib/unchanged-save-warning.js";

/**
 * @file The post/page editor's UI-interaction layer — every onClick/onChange handler `PostEditor.tsx`
 * wires to a button or control, split out of that component per the owner's explicit direction
 * (2026-08-20, `PostEditor.tsx` complexity-ceiling pass): a hook that owns the presentational/
 * interaction concerns, consumed by {@link usePostEditor} (`use-post-editor.hooks.ts`) alongside the
 * data/state it wraps, so `PostEditor.tsx` reads a bound handler off the controller instead of
 * building an inline arrow function in JSX.
 *
 * This is explicitly NOT a complexity-ceiling fix on its own — the inline arrows it replaces
 * (`() => save({}, { statusOverride: "published" })`, `() => setConfirmingDelete(true)`, …) were already their own
 * separately-scored functions at near-zero complexity, not contributors to `PostEditor`'s own
 * cyc/cog score. `PostEditor`'s actual complexity comes entirely from JSX conditional rendering
 * directly in its own function body (ternaries/`&&` chains), which top-level render-function
 * extraction fixes instead — see `PostEditorToolbarEnd`/`PostEditorSlugCollisionWarning`/
 * `PostEditorBody`/`PostEditorTemplateModal` in `PostEditor.tsx`. This hook is the owner's requested
 * architecture (interaction concerns get their own seam), reported separately from that fix.
 *
 * Deliberately limited to handlers with no existing test coverage asserting a raw setter's own call
 * identity (`ctrl.setConfirmingDelete`/`ctrl.setShowTemplateModal`/`ctrl.save`/`ctrl.remove` are
 * asserted nowhere directly) — `setStatus`/`setTemplateChoice`/`setView`/`setOverridesThemePage`
 * stay wired directly from `PostEditor.tsx`'s extracted render functions, since
 * `PostEditor.unit.test.tsx`'s DI-seam suite (`postController`) asserts three of those by mock
 * identity (`ctrl.setView`/`ctrl.setOverridesThemePage`) and rerouting them through this hook would
 * require the test fixture to re-derive the exact same wiring a second time for no behavioral gain.
 */
export interface PostEditorUiDependencies {
  save: (input: Record<string, never>, options?: { statusOverride?: "draft" | "published" }) => Promise<void>;
  setConfirmingDelete: (open: boolean) => void;
  setShowTemplateModal: (open: boolean) => void;
  /** Whether the editor thinks anything changed since the last load/save. */
  dirty: boolean;
  setConfirmingUnchangedSave: (open: boolean) => void;
}

export interface PostEditorUiController {
  /** `PostEditorHeader`'s Publish button — saves and sets status to `"published"` in one action. */
  onPublish: () => void;
  /** The Save button. With changes it saves; with none it opens the "Nothing changed. Save anyway?"
   *  warning instead (owner, 2026-10-10): the button is never disabled, in case a real change wasn't
   *  picked up, and the server decides whether anything actually differs. */
  onSave: () => void;
  /** The warning's "Save anyway": closes it and saves; the server skips the write if nothing differs. */
  onUnchangedSaveConfirm: () => void;
  onUnchangedSaveCancel: () => void;
  /** `PostEditorHeader`'s Delete button — opens the `ConfirmDialog`, doesn't delete anything yet. */
  onDeleteClick: () => void;
  /** `ConfirmDialog`'s cancel action for the delete confirmation. */
  onDeleteCancel: () => void;
  /** The template picker's "View Template" button — opens the read-only `TemplateSourceModal`. */
  onViewTemplateClick: () => void;
  /** `TemplateSourceModal`'s own close action. */
  onCloseTemplateModal: () => void;
}

/**
 * Builds every bound interaction handler `PostEditor.tsx` needs from the raw `save`/state-setter
 * primitives {@link usePostEditor} already owns — a thin wiring layer, not new logic: each handler is
 * exactly the one-line closure that used to sit inline in `PostEditor.tsx`'s JSX, just given a name
 * and a home outside the component's own render body.
 *
 * @complexity Time/space: O(1) — six closures, no branching, no iteration.
 */
export function usePostEditorUi(deps: PostEditorUiDependencies): PostEditorUiController {
  const { save, setConfirmingDelete, setShowTemplateModal, dirty, setConfirmingUnchangedSave } = deps;
  return {
    // The publish and save actions keep the same unawaited-Promise shape `PostEditor.tsx`'s
    // inline arrows already had (`save`'s own errors are caught and surfaced via `setError` inside
    // `usePostEditor`, so nothing here needs to observe the returned promise).
    onPublish: () => save({}, { statusOverride: "published" }),
    // Save / "Nothing changed. Save anyway?" — shared with the Pages editor.
    ...unchangedSaveHandlers({ dirty, save: () => save({}), setConfirmingUnchangedSave }),
    onDeleteClick: () => setConfirmingDelete(true),
    onDeleteCancel: () => setConfirmingDelete(false),
    onViewTemplateClick: () => setShowTemplateModal(true),
    onCloseTemplateModal: () => setShowTemplateModal(false),
  };
}

/** The gear modal's tabs (owner, 2026-10-10): the byline and the publish time. The featured-image
 *  tab was dropped 2026-10-11; the cover slot above the title edits that field. */
export type PostSettingsTab = "author" | "publish";

export interface PostSettingsDialogController {
  open: boolean;
  tab: PostSettingsTab;
  setTab: (tab: PostSettingsTab) => void;
  openDialog: () => void;
  closeDialog: () => void;
}

/**
 * Open/closed state and active tab for the post settings modal (the gear beside Save/Delete). The
 * tab survives a close so reopening lands where the operator left off.
 *
 * @complexity O(1).
 */
export function usePostSettingsDialog(): PostSettingsDialogController {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PostSettingsTab>("author");
  return { open, tab, setTab, openDialog: () => setOpen(true), closeDialog: () => setOpen(false) };
}

/** How many controls the phone toolbar's top row can promote: B, I, U, Link, H2, • List, in that order. */
export const TOOLBAR_PRIMARY_RANKS = 6;

/** Attributes for a promotable toolbar control: its rank, plus `data-tb="primary"` while it fits. */
export interface ToolbarSlotProps {
  "data-tb-rank": number;
  "data-tb": "primary" | undefined;
}

export interface ToolbarOverflowController {
  open: boolean;
  toggle: () => void;
  /** Callback ref for the `.editor-toolbar` element the fit is measured against. */
  toolbarRef: (element: HTMLElement | null) => void;
  /** Spread onto the control of the given rank (0 = most important). */
  slot: (input: { rank: number }, options?: Record<string, never>) => ToolbarSlotProps;
}

/**
 * How many ranked controls fit in one row beside "More", dropping from the end first.
 * `widths` is in rank order; every item, More included, is separated by one `gap`.
 *
 * @complexity O(n) in the number of ranked controls.
 */
export function primaryControlsThatFit(
  { available, widths, moreWidth, gap }: { available: number; widths: readonly number[]; moreWidth: number; gap: number },
): number {
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    if (used + gap + width > available) break;
    used += gap + width;
    count += 1;
  }
  return count;
}

/** Sub-pixel slack so rounding never pushes "More" onto a second row. */
const FIT_SLACK_PX = 1;

/**
 * Measures the toolbar and returns how many ranked controls fit, reusing the last seen width for a
 * control hidden in the overflow (display:none reports 0). `null` when "More" is hidden, i.e. the
 * pane is wider than the phone breakpoint and every control already shows.
 */
function measurePrimaryFit({ toolbar, widthCache }: { toolbar: HTMLElement; widthCache: number[] }, _options: Record<string, never> = {}): number | null {
  const more = toolbar.querySelector<HTMLElement>("[data-toolbar-more]");
  if (!more || more.offsetWidth === 0) return null;
  toolbar.querySelectorAll<HTMLElement>("[data-tb-rank]").forEach((control) => {
    if (control.offsetWidth > 0) widthCache[Number(control.dataset.tbRank)] = control.offsetWidth;
  });
  const style = getComputedStyle(toolbar);
  const available = toolbar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - FIT_SLACK_PX;
  const widths = Array.from({ length: TOOLBAR_PRIMARY_RANKS }, (_, rank) => widthCache[rank] ?? 0);
  return primaryControlsThatFit({ available, widths, moreWidth: more.offsetWidth, gap: parseFloat(style.columnGap) || 0 });
}

/**
 * The formatting toolbar's phone overflow: whether "More" is expanded, and which ranked controls
 * stay on the single top row. Only phone-width CSS reads either (`styles.css`,
 * `.editor-toolbar[data-more-open]` / `[data-tb="primary"]`); wider panes show every control.
 * Owner 2026-10-15: at ~280px the six fixed primaries filled the row and "More" wrapped under them,
 * so the row is now measured (ResizeObserver on the toolbar and each ranked control) and the
 * lowest-ranked controls move into More until the row, More included, fits.
 *
 * @complexity O(n) per resize notification, n = ranked controls.
 */
export function useToolbarOverflow(): ToolbarOverflowController {
  const [open, setOpen] = useState(false);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState(TOOLBAR_PRIMARY_RANKS);
  const widthCache = useRef<number[]>([]);

  const remeasure = useCallback(() => {
    if (!toolbar) return;
    setShown(measurePrimaryFit({ toolbar: toolbar, widthCache: widthCache.current }) ?? TOOLBAR_PRIMARY_RANKS);
  }, [toolbar]);

  useEffect(() => {
    if (!toolbar || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(remeasure);
    observer.observe(toolbar);
    toolbar.querySelectorAll("[data-toolbar-more], [data-tb-rank]").forEach((control) => observer.observe(control));
    return () => observer.disconnect();
  }, [toolbar, remeasure]);

  // A control that just became visible is measured now, so a stale cached width can't keep it.
  useLayoutEffect(remeasure, [remeasure, shown, open]);

  return {
    open,
    toggle: () => setOpen((current) => !current),
    toolbarRef: setToolbar,
    slot: ({ rank }, _options = {}) => ({ "data-tb-rank": rank, "data-tb": rank < shown ? "primary" : undefined }),
  };
}

/**
 * Escape in an iframe stays in its own document. Rebind after each preview navigation.
 * @complexity O(1) — listeners belong to a single preview frame.
 */
export function usePostPreviewIframeEscape({ expanded, onCollapse }: { expanded: boolean; onCollapse: () => void }, _options: Record<string, never> = {}): (node: HTMLIFrameElement | null) => void {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (!iframe || !expanded) return undefined;
    let frameDocument: Document | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCollapse();
    };
    const bind = () => {
      frameDocument?.removeEventListener("keydown", onKeyDown);
      // Opaque-origin previews (`PAGE_PREVIEW_IFRAME_SANDBOX` has no `allow-same-origin`) and cross-origin
      // dev previews cannot expose their document; the visible exit control remains available.
      frameDocument = iframe.contentDocument;
      frameDocument?.addEventListener("keydown", onKeyDown);
    };
    bind();
    iframe.addEventListener("load", bind);
    return () => {
      iframe.removeEventListener("load", bind);
      frameDocument?.removeEventListener("keydown", onKeyDown);
    };
  }, [iframe, expanded, onCollapse]);
  return setIframe;
}
