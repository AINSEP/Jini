import { Bar, BarChart as RechartsBarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_AXIS_PROPS, CHART_CURSOR, CHART_GRID_STROKE, CHART_PRIMARY_COLOR } from './chart-tokens.js';
import { chartTickFormatter, createChartConfig } from './chart-config.js';
import { ChartContainer, ChartTooltipContent } from './chart.js';

export interface BarChartProps {
  readonly data: readonly Record<string, unknown>[];
  readonly categoryKey: string;
  readonly valueKey: string;
  readonly color?: string;
}

export function BarChart({ data, categoryKey, valueKey, color = CHART_PRIMARY_COLOR }: BarChartProps) {
  const config = createChartConfig({ series: [{ key: valueKey, label: valueKey }] }, { color });
  const title = `${valueKey} by ${categoryKey}`;
  const description = `Bar chart with ${data.length} categories. Use arrow keys to explore values.`;
  return (
    <ChartContainer config={config} title={title} description={description}>
      <RechartsBarChart data={data as Record<string, unknown>[]} accessibilityLayer title={title} desc={description} margin={{ top: 16, right: 12, bottom: 8, left: 0 }} barCategoryGap="24%">
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} strokeOpacity={0.6} vertical={false} />
        {/* `interval={0}` always shows every category tick — an agent-authored chart usually has
            few categories, so recharts' default overlap-avoidance skip (which drops ticks based
            on measured text width) costs more legibility than it saves. */}
        <XAxis dataKey={categoryKey} interval={0} {...CHART_AXIS_PROPS} />
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
