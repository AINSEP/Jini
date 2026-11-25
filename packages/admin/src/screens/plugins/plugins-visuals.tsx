import { Icon } from "../../react/kit.js";
/**
 * @file The Plugins screen's icon adapters. Exact repeated shapes come from
 * the kit's icon owner, so this screen never imports another feature's actively edited file.
 * Unique feature artwork stays local; shared geometry keeps dimensions and accessibility at
 * each call site. The previous independent sets avoided the same cross-feature coupling.
 *
 * One glyph family here, not several: `AdminPlugin` carries no keywords/skills vocabulary the way
 * `AdminAgentPlugin` does for `agentPluginGlyphKind()`'s tiered classification, so every row uses
 * the same generic package glyph rather than a guessed category with no evidence behind it.
 */

/** The shared line-icon attributes (`shell/components/line-icon.ts`), restated as `agent-plugins-visuals.tsx`
 *  does: a `screens/*` subpath may not reach into the shell's browser subpaths (guard SI-domain). */
const LINE_ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export interface IconProps {
  size?: number;
}

/* ------------------------------------------------------------------ tab icons */

/** Installed — a package with a check: what this workspace has actually turned on. */
export function InstalledTabIcon({ size = 16 }: IconProps) {
  return (
    <Icon name="package-check" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/** Downloaded — a tray receiving a package: what's on disk for this workspace, regardless of
 *  whether it's turned on. Deliberately a different pictogram from Installed's check-mark package
 *  — the two tabs answer different questions and should not share a glyph that implies they don't. */
export function DownloadedTabIcon({ size = 16 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M12 3.5v10.2M8.2 10.1l3.8 3.8 3.8-3.8" />
      <path d="M4 15.5v3.2a1.3 1.3 0 0 0 1.3 1.3h13.4A1.3 1.3 0 0 0 20 18.7v-3.2" />
    </svg>
  );
}

/** Marketplace — a shopfront awning over an open door. Deliberately not a shopping cart: nothing
 *  here can be bought or added to anything yet, and a cart would promise a transaction. Same
 *  pictogram concept as `agent-plugins-visuals.tsx`'s own `MarketplaceIcon` (both marketplaces are
 *  equally not-yet-real); the exact shared shape is owned by the kit's icon. */
export function MarketplaceTabIcon({ size = 16 }: IconProps) {
  return (
    <Icon name="storefront" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/* --------------------------------------------------------------- per-row glyph */

/** The one glyph every row uses — see this file's header for why there is no per-plugin
 *  classification here. A plain package, generic on purpose. */
export function PluginPackageIcon({ size = 18 }: IconProps) {
  return (
    <Icon name="package-outline" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/* ------------------------------------------------------------ control icons */

/** Remove. Live for a `"site"` plugin (Downloaded tab), honestly disabled for a `"built-in"` one —
 *  see `PluginRow`'s own call site. */
export function PluginTrashIcon({ size = 16 }: IconProps) {
  return (
    <Icon name="trash-compact" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/** The row's own expand/collapse indicator. Rotated by CSS on the expanded row rather than swapped
 *  for a second glyph, so the transition is one continuous motion. */
export function PluginChevronIcon({ size = 14 }: IconProps) {
  return (
    <Icon name="chevron-right-wide" size={size} focusable={undefined} {...LINE_ICON} className="jini-plugin-chevron-glyph" />
  );
}
