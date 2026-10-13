import { Bar, BarChart as RechartsBarChart, CartesianGrid, Text, Tooltip, XAxis, YAxis, type XAxisTickContentProps } from 'recharts';
import { CHART_AXIS_PROPS, CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID_STROKE, CHART_PRIMARY_COLOR } from './chart-tokens.js';
import { chartTickFormatter, createChartConfig } from './chart-config.js';
import { ChartContainer, ChartTooltipContent } from './chart.js';

export interface BarChartProps {
  readonly data: readonly Record<string, unknown>[];
  readonly categoryKey: string;
  readonly valueKey: string;
  readonly color?: string;
  readonly label?: string;
  readonly title?: string;
  readonly description?: string;
}

/** Narrowest slot a category label gets before neighbouring labels are skipped. */
const MIN_TICK_WIDTH = 40;

/**
 * Category label sized to its own band: wraps onto two lines and ends in "…" (Recharts' own
 * `Text` measuring), so long labels never overlap. When bands are narrower than
 * `MIN_TICK_WIDTH`, every `step`-th label is drawn across `step` bands, always keeping the
 * first and last. The full text stays in the tick's `<title>` and the bar tooltip.
 * @complexity O(label length · log label length) per tick (Recharts' ellipsis search).
 */
function CategoryTick({ x, y, width, index, visibleTicksCount, payload, className, textAnchor, verticalAnchor }: XAxisTickContentProps) {
  const band = Number(width) / Math.max(1, visibleTicksCount);
  const step = Math.ceil(MIN_TICK_WIDTH / band);
  const last = visibleTicksCount - 1;
  if (index !== last && (index % step !== 0 || last - index < step)) return null;
  const label = String(payload.value);
  return (
    <g>
      <title>{label}</title>
      <Text {...{ x, y, className, textAnchor, verticalAnchor }} {...CHART_AXIS_TICK} width={band * step - 8} maxLines={2}>{label}</Text>
    </g>
  );
}

export function BarChart({ data, categoryKey, valueKey, color = CHART_PRIMARY_COLOR, label = valueKey, title = `${valueKey} by ${categoryKey}`, description = `Bar chart with ${data.length} categories. Use arrow keys to explore values.` }: BarChartProps) {
  const config = createChartConfig({ series: [{ key: valueKey, label }] }, { color });
  return (
    <ChartContainer config={config} title={title} description={description}>
      <RechartsBarChart data={data as Record<string, unknown>[]} accessibilityLayer title={title} desc={description} margin={{ top: 16, right: 12, bottom: 8, left: 0 }} barCategoryGap="24%">
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} strokeOpacity={0.6} vertical={false} />
        {/* Every tick reaches `CategoryTick`, which fits each label to its band. `preserveStartEnd`
            kept only the first of five long labels in the dock (2026-10-13); a bare `interval={0}`
            drew a 24-month series' labels on top of each other (2026-10-12). Two-line labels
            need the taller axis. */}
        <XAxis dataKey={categoryKey} interval={0} height={44} {...CHART_AXIS_PROPS} tick={CategoryTick} />
        <YAxis {...CHART_AXIS_PROPS} tickFormatter={chartTickFormatter} width={48} />
        <Tooltip cursor={CHART_CURSOR} content={<ChartTooltipContent />} isAnimationActive={false} />
        {/* Animation depends on a `requestAnimationFrame`-driven transition (`react-smooth`); an
            agent-driven surface can redraw a chart on every message, where a re-animate-from-zero
            each time reads as flicker rather than motion, so it's off by default. Rounded data
            end, square at the baseline; capped width so a 2-bar chart is not two slabs. */}
        <Bar dataKey={valueKey} fill={config[valueKey]!.color} radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive={false} />
      </RechartsBarChart>
    </ChartContainer>
  );
}
