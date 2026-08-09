/**
 * @file `@jini-ai/admin/react` — the React layer. Presentational primitives the admin shell and its
 * panels are built from.
 *
 * ## What belongs here
 *
 * Components and hooks that are genuinely reusable across hosts. Anything that decides *policy* —
 * which panels exist, what a route means, who may see a section — lives in `/core` and is passed in
 * as data. `Sidebar` is the worked example: it renders an `AdminNavGroup[]` produced by `/core`'s
 * `buildNav`, and has no nav list of its own.
 *
 * ## Styling contract
 *
 * **Every component here is unstyled**, with one narrow exception. Most emit stable class names
 * (`.cms-nav`, `.row-menu-*`, `.confirm-dialog`, `.btn-danger`, `.btn-warning`, `.btn-secondary`,
 * `.visually-hidden`) and ship no CSS whatsoever — the host owns the stylesheet. Inline styles
 * appear only where a value must be measured at runtime — portal coordinates in `Sidebar`'s rail
 * tooltip and `RowMenu`'s popup. `InteractiveHtmlEditor` is the exception: it (transitively, via
 * `@jini-ai/ui/html-editor`, which this file's own `InteractiveHtmlEditor` composes with a
 * Tovu-specific embed-protection predicate) imports GrapesJS's own vendor stylesheet, because it
 * wraps a third-party editor whose chrome does not render without it — see that primitive's file
 * header for why this isn't authored styling the exception undoes.
 *
 * A few behaviors documented in these files assume the host defines a matching rule (for instance
 * that `.visually-hidden` is `position: absolute`, so `ConfirmButton`'s live region does not
 * consume layout). Those assumptions are called out where they are load-bearing.
 *
 * ## Runtime
 *
 * `browser` — `react-dom`'s `createPortal` into `document.body`, `localStorage`, and `window`
 * listeners. Declared as such in `jini.entries`. React and react-dom are optional peers of this
 * package, so a host importing only `/core`, `/browser`, or `/server` never installs them.
 */

// Shared vocabulary. Lives outside any one component so taking `RowMenu` alone does not imply a
// dependency on `ConfirmDialog` — see `types.ts`.
export { resolveTone, toneClassName } from './types.js';
export type { ConfirmTone } from './types.js';

export { ConfirmButton } from './components/ConfirmButton/ConfirmButton.js';
export type { ConfirmButtonProps } from './components/ConfirmButton/ConfirmButton.js';

export { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog.js';
export type { ConfirmDialogProps } from './components/ConfirmDialog/ConfirmDialog.js';

// The list table. Deliberately has no sorting, pagination or row selection — see its file header
// for the corpus evidence behind each omission.
export { DataTable } from './components/DataTable.js';
export type { DataTableColumn, DataTableProps } from './components/DataTable.js';

// Visual click-into-text editing surface for a bespoke HTML document, built on GrapesJS. See its
// own file header for the styling-contract exception it carries (vendor CSS import) and the
// embed-placeholder protection it owns.
export { InteractiveHtmlEditor } from './components/InteractiveHtmlEditor/InteractiveHtmlEditor.js';
export type { InteractiveHtmlEditorProps } from './components/InteractiveHtmlEditor/InteractiveHtmlEditor.js';

export { RowMenu } from './components/RowMenu/RowMenu.js';
export type { RowMenuItem, RowMenuProps } from './components/RowMenu/RowMenu.js';

// Compound: `Sidebar.MobileHeader`, `.Nav`, `.Footer`, `.RailToggle` hang off the root. `useSidebar`
// is exported so a host's own control (a log-out button, a workspace switcher) can read the rail
// state and opt into rail tooltips rather than losing that behavior by not being ours.
export { Sidebar, useSidebar } from './components/Sidebar.js';
export type {
  RailTooltipHandlers,
  SidebarContextValue,
  SidebarFooterProps,
  SidebarMobileHeaderProps,
  SidebarNavProps,
  SidebarProps,
  SidebarRailToggleProps,
} from './components/Sidebar.js';

export { DEFAULT_SIDEBAR_RAIL_STORAGE_KEY, useSidebarRail } from './hooks/use-sidebar-rail.js';
export type { SidebarRail } from './hooks/use-sidebar-rail.js';
export { DEFAULT_NAV_SECTIONS_STORAGE_KEY, useNavSections } from './hooks/use-nav-sections.js';
export type { NavSections, NavSectionState } from './hooks/use-nav-sections.js';
