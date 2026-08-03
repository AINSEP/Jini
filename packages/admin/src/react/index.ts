/**
 * @file `@jini-ai/admin/react` — the React layer. The admin-shaped chrome the shell and its panels
 * are built from.
 *
 * ## What belongs here
 *
 * Components and hooks that are genuinely *about an admin surface*. Anything that decides *policy* —
 * which panels exist, what a route means, who may see a section — lives in `/core` and is passed in
 * as data. `Sidebar` is the worked example: it renders an `AdminNavGroup[]` produced by `/core`'s
 * `buildNav`, and has no nav list of its own.
 *
 * ## What deliberately does NOT belong here
 *
 * Domain-blind chrome. `ConfirmButton`, `ConfirmDialog`, `DataTable` and `RowMenu` used to live here
 * and no longer do: none of them knew anything about admin panels, so they were generic UI wearing
 * this package's name. They are `@jini-ai/ui` exports now, imported from there by hosts that want
 * them. What is left is the part that could not move — `Sidebar` reads `/core`'s panel-derived nav
 * model and route helpers, so it is admin-shaped by construction rather than by accident.
 *
 * `useSidebarRail` stays with it. The hook itself is generic (a persisted boolean with cross-tab
 * sync), but it is `Sidebar`'s own persistence mechanism and has no other consumer, and relocating
 * it alone would make this package depend on `@jini-ai/ui` — and so on that package's whole
 * dependency tree — just to render its own sidebar. A `/core`-only host would pay for that too.
 *
 * ## Styling contract
 *
 * **Every component here is unstyled.** They emit stable class names (`.cms-nav`, `.cms-item`,
 * `.cms-section`, `.cms-group`, `.cms-foot`, `.cms-tooltip-portal`, …) and ship no CSS whatsoever.
 * The host owns the stylesheet. Inline styles appear only where a value must be measured at
 * runtime — the portal coordinates in `Sidebar`'s rail tooltip.
 *
 * ## Runtime
 *
 * `browser` — `react-dom`'s `createPortal` into `document.body`, `localStorage`, and `window`
 * listeners. Declared as such in `jini.entries`. React and react-dom are optional peers of this
 * package, so a host importing only `/core`, `/browser`, or `/server` never installs them.
 */

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
