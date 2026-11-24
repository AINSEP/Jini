import { Icon } from "../../react/kit.js";

/** The shared line-icon attributes (`shell/components/line-icon.ts`), restated here as
 *  `seo/react/components/SeoIcons.tsx` does: a `screens/*` subpath may not reach into the shell's
 *  browser subpaths (guard SI-domain), and these seven attributes are the whole contract. */
const LINE_ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** The one shared path this file draws inside its own `<svg>` (the kit `Icon` renders a whole glyph,
 *  not a path), copied from `@jini-ai/ui`'s `ICON_PATH_DATA`: this package cannot depend on the UI
 *  library, and the kit carries components, not artwork data. */
const ICON_PATH_DATA = { "document-outline-compact": "M6.5 3.5h7.6l3.9 3.9v13.1H6.5z" } as const;
/**
 * @file The Agent Plugins screen's icon adapters. Exact repeated shapes use Jini UI's icon
 * owner; unique artwork stays here. Importing a glyph from a sibling feature would couple
 * this screen to another agent's actively edited file, so reuse goes through the platform.
 *
 * Two families here, and they follow opposite accessibility rules:
 *
 *   - Tab and per-plugin icons are `aria-hidden`: each sits directly beside the label that already
 *     says the same thing, so announcing it again is noise, not information.
 *   - Control icons (eye, trash) are `aria-hidden` too, but their BUTTONS carry a real `aria-label`
 *     naming the plugin — an icon-only control with no visible text has no accessible name of its
 *     own. See `AgentPluginRow`'s own call sites.
 */

// Line-icon attributes: components/line-icon.ts.


export interface IconProps {
  size?: number;
}

/* ------------------------------------------------------------------ tab icons */

/** Installed — a package with a check: bytes that are here and catalogued. */
export function InstalledIcon({ size = 16 }: IconProps) {
  return (
    <Icon name="package-check" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/** Marketplace — a shopfront awning over an open door. Deliberately not a shopping cart: nothing
 *  here can be bought or added to anything yet, and a cart would promise a transaction. */
export function MarketplaceIcon({ size = 16 }: IconProps) {
  return (
    <Icon name="storefront" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/** Add a plugin — an arrow rising out of a tray: a package the operator brings in themselves. */
export function UploadIcon({ size = 16 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M12 15.5V4.5" />
      <path d="M7.5 9 12 4.5 16.5 9" />
      <path d="M4 14.5v4a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-4" />
    </svg>
  );
}

/* --------------------------------------------------------- per-plugin glyphs */

/** Compliance / privacy / security — a shield with a check. */
export function ShieldCheckIcon({ size = 18 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M12 3.2 19 5.9v5.6c0 4.2-2.8 7.4-7 9.3-4.2-1.9-7-5.1-7-9.3V5.9z" />
      <path d="M8.9 11.8 11.3 14.3 15.4 9.9" />
    </svg>
  );
}

/** Deploy / hosting / release — a rocket leaving. */
export function RocketIcon({ size = 18 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M13.6 3.4c3.4-.6 6.4 2.4 5.8 5.8-.5 2.9-2.4 5.2-4.6 7l-3.4 2.7-4.9-4.9 2.7-3.4c1.8-2.2 4.1-4.1 7-4.6z" />
      <circle cx="14.6" cy="8.9" r="1.6" />
      <path d="M8.5 15.5 5 19M4.6 14.2 3.2 20.3l6.1-1.4" />
    </svg>
  );
}

/** Design / UI / UX — a painter's palette. */
export function PaletteIcon({ size = 18 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 2-.9 2-1.9s-.7-1.9-.7-2.7c0-.9.7-1.6 1.6-1.6h1.6a4 4 0 0 0 4-4c0-3.7-3.8-6.8-8.5-6.8z" />
      <circle cx="8.4" cy="10.2" r="1.1" />
      <circle cx="12" cy="7.6" r="1.1" />
      <circle cx="15.6" cy="10.2" r="1.1" />
    </svg>
  );
}

/** MCP servers / integrations / connectors — a plug. */
export function PlugIcon({ size = 18 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M9 3.5v4M15 3.5v4" />
      <path d="M6.5 7.5h11v3.2a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16.2v4.3" />
    </svg>
  );
}

/** Docs / content / writing — a page with lines. */
export function DocumentIcon({ size = 18 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d={ICON_PATH_DATA["document-outline-compact"]} />
      <path d="M14 3.5v4h4" />
      <path d="M9.3 12.2h5.4M9.3 15.6h5.4" />
    </svg>
  );
}

/** The fallback glyph for a plugin whose vocabulary matches no family — a plain package. Generic on
 *  purpose: an invented themed glyph for an unrecognized package would assert a category the host has
 *  no evidence for. */
export function PackageIcon({ size = 18 }: IconProps) {
  return (
    <Icon name="package-outline" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/* ------------------------------------------------------------ control icons */

/** Open the read-only package inspector. */
export function EyeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M2.8 12c2.6-4.1 5.7-6.2 9.2-6.2s6.6 2.1 9.2 6.2c-2.6 4.1-5.7 6.2-9.2 6.2S5.4 16.1 2.8 12z" />
      <circle cx="12" cy="12" r="2.9" />
    </svg>
  );
}

/** Padlock: a linked agent plugin is switched on the Plugins page — see `AgentPluginLinkedLock`. */
export function LockIcon({ size = 16 }: IconProps) {
  return (
    <svg {...LINE_ICON} width={size} height={size} strokeWidth={1.8}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2" />
    </svg>
  );
}

/** Uninstall. Rendered only in a disabled control on this screen — see `AgentPluginRow`. */
export function TrashIcon({ size = 16 }: IconProps) {
  return (
    <Icon name="trash-compact" size={size} focusable={undefined} {...LINE_ICON} />
  );
}

/** The row's own expand/collapse indicator. Rotated by CSS on the expanded row rather than swapped
 *  for a second glyph, so the transition is one continuous motion. */
export function ChevronIcon({ size = 14 }: IconProps) {
  return (
    <Icon name="chevron-right-wide" size={size} focusable={undefined} {...LINE_ICON} className="jini-agent-plugin-chevron-glyph" />
  );
}

/** One glyph per {@link AgentPluginGlyphKind}, so the row renders a lookup rather than a chain of
 *  conditionals. Kinds come from `rules.ts`'s `agentPluginGlyphKind()`. */
export const AGENT_PLUGIN_GLYPHS = {
  compliance: ShieldCheckIcon,
  deploy: RocketIcon,
  design: PaletteIcon,
  integration: PlugIcon,
  content: DocumentIcon,
  package: PackageIcon,
} as const;

export type AgentPluginGlyphKind = keyof typeof AGENT_PLUGIN_GLYPHS;
