import { CartesianGrid, Line, LineChart as RechartsLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_PRIMARY_COLOR, CHART_TOOLTIP_CONTENT_STYLE, CHART_TOOLTIP_TEXT_STYLE } from './chart-tokens.js';

export interface LineChartProps {
  readonly data: readonly Record<string, unknown>[];
  readonly categoryKey: string;
  readonly valueKey: string;
  readonly color?: string;
}

export function LineChart({ data, categoryKey, valueKey, color = CHART_PRIMARY_COLOR }: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsLineChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
        {/* Same reasoning as bar-chart.tsx: always show every category tick rather than recharts'
            default measured-overlap skip. */}
        <XAxis dataKey={categoryKey} interval={0} tick={CHART_AXIS_TICK} stroke={CHART_GRID_STROKE} tickLine={false} />
        <YAxis tick={CHART_AXIS_TICK} stroke={CHART_GRID_STROKE} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ stroke: CHART_GRID_STROKE }} contentStyle={CHART_TOOLTIP_CONTENT_STYLE} labelStyle={CHART_TOOLTIP_TEXT_STYLE} itemStyle={CHART_TOOLTIP_TEXT_STYLE} />
        {/* Animation off by default — same reasoning as bar-chart.tsx's `Bar`. */}
        <Line type="monotone" dataKey={valueKey} stroke={color} strokeWidth={2} isAnimationActive={false} />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
