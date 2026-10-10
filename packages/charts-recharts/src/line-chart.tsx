import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_ACTIVE_DOT, CHART_AXIS_PROPS, CHART_GRID_STROKE, CHART_PRIMARY_COLOR } from './chart-tokens.js';
import { chartTickFormatter, createChartConfig } from './chart-config.js';
import { ChartContainer, ChartTooltipContent } from './chart.js';

export interface LineChartProps {
  readonly data: readonly Record<string, unknown>[];
  readonly categoryKey: string;
  readonly valueKey: string;
  readonly color?: string;
}

export function LineChart({ data, categoryKey, valueKey, color = CHART_PRIMARY_COLOR }: LineChartProps) {
  const gradientId = `jini-chart-area-${useId().replace(/:/g, '')}`;
  const config = createChartConfig({ series: [{ key: valueKey, label: valueKey }] }, { color });
  const title = `${valueKey} by ${categoryKey}`;
  const description = `Line chart with ${data.length} points. Use arrow keys to explore values.`;
  return (
    <ChartContainer config={config} title={title} description={description}>
      <ComposedChart data={data as Record<string, unknown>[]} accessibilityLayer title={title} desc={description} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={config[valueKey]!.color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={config[valueKey]!.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} strokeOpacity={0.6} vertical={false} />
        {/* Same reasoning as bar-chart.tsx: always show every category tick rather than recharts'
            default measured-overlap skip. */}
        <XAxis dataKey={categoryKey} interval={0} {...CHART_AXIS_PROPS} />
        <YAxis {...CHART_AXIS_PROPS} tickFormatter={chartTickFormatter} width={48} />
        {/* Recharts deduplicates by dataKey before rendering custom content. Preserve the two
            graphical items here so the decorative area cannot displace the line's tooltip. */}
        <Tooltip cursor={{ stroke: CHART_GRID_STROKE, strokeDasharray: '3 3' }} content={<ChartTooltipContent />} payloadUniqBy={(entry) => entry.graphicalItemId} isAnimationActive={false} />
        {/* Animation off by default — same reasoning as bar-chart.tsx's `Bar`. */}
        {/* The area is decorative: one tooltip entry and one active dot belong to the line. */}
        <Area type="monotone" dataKey={valueKey} stroke="none" fill={`url(#${gradientId})`} tooltipType="none" legendType="none" activeDot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey={valueKey} stroke={config[valueKey]!.color} strokeWidth={2.5} dot={false} activeDot={CHART_ACTIVE_DOT} isAnimationActive={false} />
      </ComposedChart>
    </ChartContainer>
  );
}
