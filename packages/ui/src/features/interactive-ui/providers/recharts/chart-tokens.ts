/**
 * @module chart-tokens
 *
 * The CSS variables every recharts provider paints with — the host's theme owns the colors.
 *
 * Why `--jini-chart-*` with fallbacks rather than bare `--jini-primary`: a host that styles its own
 * chrome and never maps Jini's base tokens (Tovu's admin) got Jini's near-black default bars, in
 * dark mode too ("the color is ugly", demo V3, 2026-10-05). A host sets `--jini-chart-1`..`-6`,
 * `--jini-chart-grid`, `--jini-chart-axis`, `--jini-chart-cursor`, `--jini-chart-surface` and
 * `--jini-chart-text` in its own CSS; a host that sets none keeps the base-token look.
 */

/** Categorical series colors in fixed order (assign by position, never cycle past the end silently). */
export const CHART_SERIES_COLORS = [
  'var(--jini-chart-1, var(--jini-primary))',
  'var(--jini-chart-2, var(--jini-success))',
  'var(--jini-chart-3, var(--jini-warning))',
  'var(--jini-chart-4, var(--jini-danger))',
  'var(--jini-chart-5, var(--jini-muted))',
  'var(--jini-chart-6, var(--jini-text))',
] as const;

/** The single-series color (bar fill, line stroke). */
export const CHART_PRIMARY_COLOR = CHART_SERIES_COLORS[0];

/** Grid lines and axis lines: recessive. */
export const CHART_GRID_STROKE = 'var(--jini-chart-grid, var(--jini-border))';

/** Axis tick label props: muted ink, never the series color. */
export const CHART_AXIS_TICK = { fill: 'var(--jini-chart-axis, var(--jini-muted))' } as const;

/** The hover band behind a hovered bar (recharts' default is an opaque grey block). */
export const CHART_CURSOR = { fill: 'var(--jini-chart-cursor, var(--jini-accent-soft))' } as const;

/** Tooltip box: theme surface and ink, so it does not stay a white box in dark mode. */
export const CHART_TOOLTIP_CONTENT_STYLE = {
  background: 'var(--jini-chart-surface, var(--jini-bg))',
  border: `1px solid ${CHART_GRID_STROKE}`,
  borderRadius: 'var(--jini-radius-sm)',
  color: 'var(--jini-chart-text, var(--jini-text))',
} as const;

/** Tooltip label and value ink: text tokens, never the series color (recharts' item default). */
export const CHART_TOOLTIP_TEXT_STYLE = { color: 'var(--jini-chart-text, var(--jini-text))' } as const;
