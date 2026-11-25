import type { ComponentType } from "react";

import type { DeploymentCapability } from "./rules.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The Deployment panel's own small presentational pieces — four inline icons and the
 * capability list they sit above. No hooks, no fetch, no data of its own.
 *
 * Icons are inline SVG at `currentColor` rather than an icon dependency: this app ships no icon
 * component library to `features/` (the sidebar's own glyphs are inline SVG in `App.tsx`, and
 * `SettingsUi.tsx`'s tab icons are inline SVG too), so following that is reuse, not reinvention.
 * All four are `aria-hidden` — every one of them sits next to text that already says the same
 * thing, and an icon that duplicates its own label is noise to a screen reader
 * (`frontend-accessibility`: "do not add `aria-label` to elements that already have visible text").
 * The one exception is {@link CapabilityMark}, whose ✓/✗ carries meaning the row's label does NOT
 * repeat, so it gets a real accessible name.
 *
 * Sizes are `1em`-relative where the icon sits inline with text, so they track the type scale
 * instead of pinning a px size that drifts when the surrounding text changes
 * (`kole-jain-uiux-concepts`: "size icons to match the related text line height").
 */

// Line-icon attributes: components/line-icon.ts.

/** Overview — a small dashboard grid, i.e. a summary of several facts at a glance. Added for the
 *  Deployment tab row's own icon set (owner request) — the four tabs beside it already had a glyph
 *  each; this is Overview's. */
export function OverviewIcon({ size = 20, lineIcon }: { size?: number; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true } }) {
  return (
    <svg {...lineIcon} width={size} height={size}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** Static Site — a document, i.e. files on disk with no machine behind them. */
export function StaticSiteIcon({ size = 20, lineIcon }: { size?: number; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true } }) {
  return (
    <svg {...lineIcon} width={size} height={size}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

/** Full Site — stacked server racks, i.e. a machine that stays running. */
export function FullSiteIcon({ size = 20, lineIcon }: { size?: number; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true } }) {
  return (
    <svg {...lineIcon} width={size} height={size}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

/** History — a clock with no hands set to a real time, for a tab that has nothing to show yet. */
export function HistoryIcon({ size = 20, lineIcon }: { size?: number; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true } }) {
  return (
    <svg {...lineIcon} width={size} height={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Dockerfile — a stack of layers, the shape of an image build. */
export function LayersIcon({ size = 20, lineIcon }: { size?: number; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true } }) {
  return (
    <svg {...lineIcon} width={size} height={size}>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

/**
 * The checkmark inside a completed step's marker (`StaticSiteTab.tsx`'s `CredentialStepDone`) — the
 * same check-glyph path {@link CapabilityMark} uses for "Supported", reused here rather than
 * redrawn, so the two ✓ marks on this tab (a capability that survives the export, a credential
 * that's connected) read as the same symbol meaning the same thing. Always `aria-hidden`: the
 * summary text next to it already states "connected" in words — this glyph is reinforcement on a
 * step marker that already has its own accessible summary, not the only place the fact lives (a
 * genuine second appearance, not this icon file's usual "every icon sits next to text that already
 * says the same thing" rule stretched to cover something new).
 */
export function StepDoneIcon({ size = 12, lineIcon, Icon }: { size?: number; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true }; Icon: ComponentType<{ name: "check-long" | "chevron-down"; size: number; focusable: undefined; viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true | "true" }> }) {
  return (
    <Icon name="check-long" size={size} focusable={undefined} {...lineIcon} stroke="currentColor" strokeWidth={2.5} aria-hidden="true" />
  );
}

/**
 * The disclosure chevron on a collapsed `<summary>` (`StaticSiteTab.tsx`'s `CredentialStepDone`),
 * rotated 180° by CSS when its `<details>` is open.
 *
 * Exists because that summary had NO expand affordance at all (owner-reported, 2026-08-15): the row
 * was clickable and its stylesheet had deliberately stripped the browser's native triangle
 * (`list-style: none` plus the `::-webkit-details-marker` reset), on the reasoning that "the row's
 * own hover/focus are signifier enough". They are not — a reader with a rotated access token had no
 * way to discover the row could be opened to replace it. This is that missing signifier, restored
 * on purpose rather than by putting the native triangle back: the stripped triangle would sit at
 * the START of the row, competing with the step marker for "which glyph means what", which is the
 * problem the reset was avoiding. This one sits at the END, beside a visible text label that says
 * what opening does.
 *
 * `aria-hidden` like every other icon here, and for the usual reason: `<summary>` already exposes
 * its own expanded/collapsed state to a screen reader, and the label beside this glyph already says
 * the rest in words.
 */
export function DisclosureChevron({ size = 14, lineIcon, Icon }: { size?: number; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true }; Icon: ComponentType<{ name: "check-long" | "chevron-down"; size: number; focusable: undefined; viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true | "true" }> }) {
  return (
    <Icon name="chevron-down" size={size} focusable={undefined} {...lineIcon} />
  );
}

/**
 * The ✓ or ✗ beside a capability row.
 *
 * Two distinct SHAPES, not one shape in two colors — a check and a cross are told apart with no
 * color perception at all, which is the requirement (`frontend-accessibility`: "color is not the
 * only means of conveying information"). The color on top is reinforcement. The `<title>` gives
 * the mark a real accessible name because, unlike every other icon in this file, it states
 * something its neighbouring label does not: the label is "Checkout", the mark is what says whether
 * you get it.
 */
export function CapabilityMark({ supported, t, lineIcon }: { supported: boolean; t: Translate; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true } }) {
  const label = supported ? t("Supported") : t("Not supported");
  return (
    <span className={`deployment-caps-mark ${supported ? "deployment-caps-yes" : "deployment-caps-no"}`}>
      <svg {...lineIcon} aria-hidden={undefined} role="img" width="1em" height="1em" strokeWidth={2.25}>
        <title>{label}</title>
        {supported ? <path d="m5 13 4.5 4.5L19 6.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
      </svg>
    </span>
  );
}

/**
 * The "what works on this path" list — the same four rows rendered on both Overview path cards and
 * again on the Static Site tab, so the reader meets one fact in one shape rather than a comparison
 * on one screen and a prose restatement on another (`self-made-web-designer-core-skills`' visual
 * rhyming). Rows come from `rules.ts`'s {@link DeploymentCapability} table; nothing here decides
 * what is or is not supported.
 */
export function CapabilityList({ rows, t, lineIcon }: { rows: readonly DeploymentCapability[]; t: Translate; lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true } }) {
  return (
    <ul className="deployment-caps">
      {rows.map((row) => (
        <li key={row.id} className={row.supported ? undefined : "is-off"}>
          <CapabilityMark supported={row.supported} t={t} lineIcon={lineIcon} />
          <span>{t(row.labelKey)}</span>
        </li>
      ))}
    </ul>
  );
}
