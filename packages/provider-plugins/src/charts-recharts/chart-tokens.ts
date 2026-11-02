/**
 * @module chart-tokens
 *
 * The CSS variables every recharts provider paints with — the host's theme owns the colors.
 *
 * Why `--jini-chart-*` with fallbacks rather than bare `--jini-primary`: a host that styles its own
 * chrome and never maps Jini's base tokens (an adopting admin shell) got Jini's near-black default bars, in
 * dark mode too ("the color is ugly", demo V3, 2026-10-05). A host sets `--jini-chart-1`..`-6`,
 * `--jini-chart-grid`, `--jini-chart-axis`, `--jini-chart-cursor`, `--jini-chart-surface` and
 * `--jini-chart-text` in its own CSS; a host that sets none keeps the base-token look for the
 * neutral tokens.
 *
 * Series colors fall back to Jini's default palette (`--jini-chart-default-1`..`-6`, warm orange
 * first, light + dark, in `styles/variables.css`), not to `--jini-primary` and the status tokens:
 * "Claude orange should be the default color" (owner, 2026-10-05). The values live in CSS, never
 * here, so a host's theme stays the single owner of color.
 */

/** Categorical series colors in fixed order; larger datasets repeat the palette with named legends. */
export const CHART_SERIES_COLORS = [
  'var(--jini-chart-1, var(--jini-chart-default-1))',
  'var(--jini-chart-2, var(--jini-chart-default-2))',
  'var(--jini-chart-3, var(--jini-chart-default-3))',
  'var(--jini-chart-4, var(--jini-chart-default-4))',
  'var(--jini-chart-5, var(--jini-chart-default-5))',
  'var(--jini-chart-6, var(--jini-chart-default-6))',
] as const;

/** The single-series color (bar fill, line stroke). */
export const CHART_PRIMARY_COLOR = CHART_SERIES_COLORS[0];

/** Grid lines and axis lines: recessive. */
export const CHART_GRID_STROKE = 'var(--jini-chart-grid, var(--jini-border))';

/** Axis tick label props: muted ink, never the series color. */
export const CHART_AXIS_TICK = { fill: 'var(--jini-chart-axis, var(--jini-muted))', fontSize: 12 } as const;

/** Shared axis chrome; category visibility and numeric formatting remain separate concerns. */
export const CHART_AXIS_PROPS = { tick: CHART_AXIS_TICK, tickLine: false, axisLine: false, tickMargin: 10 } as const;

/** Hover points use the same series ink, with a surface halo in either color scheme. */
export const CHART_ACTIVE_DOT = { r: 5, stroke: 'var(--jini-chart-surface, var(--jini-bg))', strokeWidth: 2 } as const;

/** The hover band behind a hovered bar (recharts' default is an opaque grey block). */
export const CHART_CURSOR = { fill: 'var(--jini-chart-cursor, var(--jini-accent-soft))' } as const;
