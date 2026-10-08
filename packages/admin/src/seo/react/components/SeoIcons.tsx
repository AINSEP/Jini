/** Shared attributes for a decorative line icon — copied deliberately from
 *  `deployment-visuals.tsx`'s own `LINE_ICON` so this tab row reads as the same family as the
 *  Deployment tab row it was modelled on (24px grid, 1.5 stroke, round joins). Local rather than
 *  imported across the feature boundary: `features/deployment/index.ts` is that feature's public
 *  surface and does not export it, and this app ships no shared icon module — the sidebar's glyphs
 *  in `App.tsx` and `SettingsUi.tsx`'s tab icons are both inline SVG for the same reason.
 *  `aria-hidden` on every one: each sits directly beside the text label that already says the same
 *  thing (`frontend-accessibility` — do not give an accessible name to decoration that duplicates
 *  adjacent visible text). */
const LINE_ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Site defaults — sliders, i.e. values that are set once and then apply to everything. */
export function SeoDefaultsIcon({ size = 16 }: { size?: number }, _optional: Record<string, never> = {}) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </svg>
  );
}

/** Sitemap — a node branching into children, i.e. the shape of the file this tab rebuilds. */
export function SeoSitemapIcon({ size = 16 }: { size?: number }, _optional: Record<string, never> = {}) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <rect x="3" y="17" width="6" height="4" rx="1" />
      <rect x="15" y="17" width="6" height="4" rx="1" />
      <path d="M12 7v4M6 17v-2h12v2M12 11v4" />
    </svg>
  );
}

/** Pages & posts — stacked documents, i.e. the collection this tab edits one at a time. */
export function SeoEntriesIcon({ size = 16 }: { size?: number }, _optional: Record<string, never> = {}) {
  return (
    <svg {...LINE_ICON} width={size} height={size}>
      <path d="M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h5M10 16h3" />
    </svg>
  );
}

