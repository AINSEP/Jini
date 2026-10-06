import { Cell, Pie, PieChart as RechartsPieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_PRIMARY_COLOR, CHART_SERIES_COLORS, CHART_TOOLTIP_CONTENT_STYLE, CHART_TOOLTIP_TEXT_STYLE } from './chart-tokens.js';

export interface PieDatum {
  readonly name: string;
  readonly value: number;
}

export interface PieChartProps {
  readonly data: readonly PieDatum[];
  readonly color?: string;
}

export function PieChart({ data, color }: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsPieChart>
        <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} labelStyle={CHART_TOOLTIP_TEXT_STYLE} itemStyle={CHART_TOOLTIP_TEXT_STYLE} />
        {/* Animation off by default — same reasoning as bar-chart.tsx's `Bar`. */}
        <Pie data={data as PieDatum[]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label isAnimationActive={false}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={color ?? CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] ?? CHART_PRIMARY_COLOR} />
          ))}
        </Pie>
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}
