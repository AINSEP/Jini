import type { ComponentType } from "react";

import type { DevicePreviewDevice } from "./DevicePreview/DevicePreview.hooks.js";

/**
 * @file Icons for the device-width preview toggle (`DevicePreview/DevicePreviewToggle.tsx`, shared by
 * the Pages, Posts and Themes editors over `DEVICE_PREVIEW_WIDTHS` — see that constant's doc). The toggle used to show the translated word
 * itself ("Desktop"/"Tablet"/"Mobile") as the button's visible text; the word is now icon-only
 * chrome — an `aria-label`/`title` carried by the caller from the same `t(entry.label)` call this
 * file has no opinion on — and these three glyphs are what replace it (2026-09-22 owner ask, device
 * icons over words).
 *
 * `@jini-ai/ui`'s own `Icon`/`IconName` set (`node_modules/@jini-ai/ui/dist/icon-name.d.ts`) has a
 * `smartphone` glyph but no laptop or tablet, and mixing one shared-library icon with two
 * hand-drawn ones would give the three buttons visibly different stroke weights and corner
 * rounding. All three are inline SVG here instead, sized and stroked identically (16px,
 * `stroke="currentColor"`, 1.5 stroke width) so the segmented control reads as one glyph set — the
 * same Lucide-derived convention `ThemeExplore.tsx`'s own fullscreen-trigger icon already uses
 * (`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`).
 */

/** Shared attributes every device icon below renders with — one definition so the three glyphs
 *  can't drift out of visual sync with each other. */
const ICON_SVG_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

/** Widescreen panel over a wide base line — the desktop/laptop option. */
function LaptopPreviewIcon() {
  return (
    <svg {...ICON_SVG_PROPS}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M2 19h20" />
    </svg>
  );
}

/** A wide vertical panel with a home-button line — the tablet option, deliberately wider than
 *  {@link SmartphonePreviewIcon} so the two stay visually distinct at 16px. */
function TabletPreviewIcon() {
  return (
    <svg {...ICON_SVG_PROPS}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

/** A narrow vertical panel with a home-button line — the mobile option. */
function SmartphonePreviewIcon() {
  return (
    <svg {...ICON_SVG_PROPS}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

/**
 * Looks up the icon component for a preview device by {@link DevicePreviewDevice} key, so the
 * toggle renders `<Icon />` off its own `DEVICE_PREVIEW_OPTIONS.map` instead of carrying
 * its own `key === "desktop" ? ... : ...` branch.
 *
 * @complexity O(1) — fixed three-entry lookup table.
 */
export const DEVICE_PREVIEW_ICONS: Readonly<Record<DevicePreviewDevice, ComponentType>> = {
  desktop: LaptopPreviewIcon,
  tablet: TabletPreviewIcon,
  mobile: SmartphonePreviewIcon,
};
