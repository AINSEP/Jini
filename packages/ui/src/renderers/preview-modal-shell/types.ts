/**
 * Plain types for the preview-modal shell — a full-screen overlay chrome
 * (tabs, sidebar, fullscreen toggle, split-button primary action) around
 * arbitrary preview content. No React import: React-specific prop shapes
 * (anything carrying a `ReactNode`, e.g. the per-view `custom` stage or the
 * sidebar's `content`) live in `react/components/PreviewModalShell.tsx`
 * instead — see the React-layout policy note in `../source-map.md`.
 *
 * Origin: `apps/web/src/components/PreviewModal.tsx`. See
 * `../source-map.md`'s `preview-modal-shell` classification section for the
 * full generic-vs-OD-specific breakdown.
 */

/** One item in a split-button primary action's secondary-options menu. */
export interface PreviewModalPrimaryActionMenuItem {
  label: string;
  description?: string | undefined;
  onClick: () => void;
  testId?: string | undefined;
}

/**
 * Accent CTA rendered before the sidebar/close controls. When `menu` is
 * present the button becomes a split button: the main face still runs
 * `onClick`, a caret toggle opens the secondary-options menu.
 */
export interface PreviewModalPrimaryAction {
  label: string;
  onClick: () => void;
  busy?: boolean | undefined;
  busyLabel?: string | undefined;
  disabled?: boolean | undefined;
  testId?: string | undefined;
  menu?: PreviewModalPrimaryActionMenuItem[] | undefined;
}

/**
 * Shown in the content stage in place of the loading/error/rendered states
 * when a view genuinely has nothing to preview (generalized from the
 * origin's closed `'skill' | 'plugin' | 'template'` noun vocabulary — see
 * `../source-map.md`). The caller owns the copy; the shell just displays it.
 */
export interface PreviewModalUnavailable {
  message: string;
}

/** The stage's fit-to-width sizing, recomputed as the stage measures/resizes. */
export interface PreviewModalScalerStyle {
  width: number | '100%';
  height: number | '100%';
  transform: string;
}

export type PreviewModalContentStatus = 'custom' | 'unavailable' | 'error' | 'loading' | 'ready';
