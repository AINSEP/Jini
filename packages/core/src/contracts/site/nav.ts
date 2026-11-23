/**
 * @file The sidebar navigation model a host renders: grouped, ordered rows with route paths.
 *
 * Additive verbatim copy of `AdminNavGroup`/`AdminNavItem` (`manifest/rules.ts`) and their base
 * `AdminNavEntry` (`manifest/types.ts`) from `@jini-ai/admin/core`, so a host's own nav model can
 * name the shape without importing the admin shell. `@jini-ai/admin` keeps its identical
 * declarations, `buildNav` and its exports until the paired cutover.
 */

/** Sidebar presence. Optional on a panel — absence means routable but not listed. */
export interface AdminNavEntry {
  readonly label: string;
  /** Inner SVG markup for an 18x18 stroked icon (`viewBox="0 0 18 18"`, `stroke="currentColor"`),
   *  matching the convention already used across the reference implementation's `nav.ts`. Optional so a panel can be
   *  listed before anyone has drawn it an icon. */
  readonly icon?: string;
  /** Group heading. Panels sharing a value are rendered together; omitted means the ungrouped
   *  top row. */
  readonly group?: string;
  /** Ascending sort within a group. Ties fall back to registration order, which is stable. */
  readonly order?: number;
  /** Renders as a disabled row — announced but not yet built. */
  readonly soon?: boolean;
  /**
   * When `soon` is set, renders the row as a REAL link (not a disabled non-link) while still
   * showing the `soon` badge, so an operator can click through and preview the unfinished screen
   * instead of the row being inert. Ignored when `soon` is falsy — there is nothing to opt into on
   * a shipped row. Opt-in rather than a `soon` behavior change: the existing "disabled non-link"
   * shape stays the default for a panel author who has not deliberately decided the in-progress
   * screen is safe to preview.
   */
  readonly soonPreviewable?: boolean;
}

/** A sidebar group, ready to render. */
export interface AdminNavGroup {
  /** Group heading; absent for the ungrouped top row. */
  readonly label?: string;
  readonly items: readonly AdminNavItem[];
}

/** A sidebar row. `href` is a **route path** (`/settings`), never a URL — the shell applies the
 *  base. Conflating the two is what produced the reference implementation's
 *  `/admin/#/section/settings` URLs. */
export interface AdminNavItem extends AdminNavEntry {
  readonly id: string;
  readonly href: string;
}
