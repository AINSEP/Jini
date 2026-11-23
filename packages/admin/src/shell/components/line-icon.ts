/**
 * Shared attributes for a decorative line icon: the same 24px grid, 1.5 stroke and round joins as the
 * sidebar's own glyph set and Jini's `seo/react/components/SeoIcons.tsx`, so every icon row and tab
 * row in this admin reads as one family rather than a borrowed set.
 * `aria-hidden`: each icon sits directly beside a text label, or inside a button or link, that
 * already carries the accessible name, so the glyph is decoration.
 * Lives in `components/` (the admin's shared layer) so features share it without importing across a
 * feature boundary. Icon artwork stays in each feature's own visuals file.
 */
export const LINE_ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;
