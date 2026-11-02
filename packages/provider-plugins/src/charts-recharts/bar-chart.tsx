import { Bar, BarChart as RechartsBarChart, CartesianGrid, Text, Tooltip, XAxis, YAxis, type XAxisTickContentProps } from 'recharts';
import { CHART_AXIS_PROPS, CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID_STROKE, CHART_PRIMARY_COLOR } from './chart-tokens.js';
import { chartTickFormatter, createChartConfig, wholeNumberTicks } from './chart-config.js';
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
 * Binds each " · " separator to the word before it with a no-break space (Recharts breaks lines only
 * on ordinary whitespace), so a narrow band never draws "·" alone on a line. Reported 2026-11-01
 * (Tovu 47b4199e0): at 180px "Pages · Published" wrapped as "Pages / · / Publ…". Tovu's bundle
 * patch bound it to the next word instead, which lengthens the second line and re-truncates
 * "Published" at the ~300px dock width; binding backwards keeps every label that fit before.
 */
function keepSeparatorsAttached(label: string): string {
  return label.replace(/[ \t]+·/g, '\u00a0·');
}

/**
 * Category label sized to its own band: wraps onto up to three lines and ends in "…" (Recharts' own
 * `Text` measuring), so long labels never overlap. When bands are narrower than
 * `MIN_TICK_WIDTH`, every `step`-th label is drawn across `step` bands, always keeping the
 * first and last. The full text stays in the tick's `<title>` and the bar tooltip.
 * Measured in the dock (2026-10-31): at a ~300px chart each 4-bar band gave the label 52px and two
 * lines, so "Pages · Published" became "Pages · / Publish…". The label now gets the band less
 * 4px and three lines (Tovu bd018de69).
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
      <Text {...{ x, y, className, textAnchor, verticalAnchor }} {...CHART_AXIS_TICK} width={band * step - 4} maxLines={3}>{keepSeparatorsAttached(label)}</Text>
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
            drew a 24-month series' labels on top of each other (2026-10-12). Three-line labels
            need the 58px axis. */}
        <XAxis dataKey={categoryKey} interval={0} height={58} {...CHART_AXIS_PROPS} tick={CategoryTick} />
        <YAxis {...CHART_AXIS_PROPS} tickFormatter={chartTickFormatter} width={48} {...wholeNumberTicks({ data, valueKey })} />
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
