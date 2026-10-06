import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID_STROKE, CHART_PRIMARY_COLOR, CHART_TOOLTIP_CONTENT_STYLE, CHART_TOOLTIP_TEXT_STYLE } from './chart-tokens.js';

export interface BarChartProps {
  readonly data: readonly Record<string, unknown>[];
  readonly categoryKey: string;
  readonly valueKey: string;
  readonly color?: string;
}

export function BarChart({ data, categoryKey, valueKey, color = CHART_PRIMARY_COLOR }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
        {/* `interval={0}` always shows every category tick — an agent-authored chart usually has
            few categories, so recharts' default overlap-avoidance skip (which drops ticks based
            on measured text width) costs more legibility than it saves. */}
        <XAxis dataKey={categoryKey} interval={0} tick={CHART_AXIS_TICK} stroke={CHART_GRID_STROKE} tickLine={false} />
        <YAxis tick={CHART_AXIS_TICK} stroke={CHART_GRID_STROKE} tickLine={false} axisLine={false} />
        <Tooltip cursor={CHART_CURSOR} contentStyle={CHART_TOOLTIP_CONTENT_STYLE} labelStyle={CHART_TOOLTIP_TEXT_STYLE} itemStyle={CHART_TOOLTIP_TEXT_STYLE} />
        {/* Animation depends on a `requestAnimationFrame`-driven transition (`react-smooth`); an
            agent-driven surface can redraw a chart on every message, where a re-animate-from-zero
            each time reads as flicker rather than motion, so it's off by default. Rounded data
            end, square at the baseline; capped width so a 2-bar chart is not two slabs. */}
        <Bar dataKey={valueKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={64} isAnimationActive={false} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
