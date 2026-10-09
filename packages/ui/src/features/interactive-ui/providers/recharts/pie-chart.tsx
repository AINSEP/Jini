import { Cell, Pie, PieChart as RechartsPieChart, Tooltip } from 'recharts';
import { createChartConfig, formatChartValue } from './chart-config.js';
import { ChartContainer, ChartTooltipContent } from './chart.js';

export interface PieDatum {
  readonly name: string;
  readonly value: number;
}

export interface PieChartProps {
  readonly data: readonly PieDatum[];
  readonly color?: string;
}

export function PieChart({ data, color }: PieChartProps) {
  const slices = data.map((entry, index) => ({ ...entry, _jiniChartKey: `slice-${index}` }));
  const config = createChartConfig({ series: slices.map((entry) => ({ key: entry._jiniChartKey, label: entry.name, value: entry.value })) }, { color });
  const total = data.reduce((sum, entry) => sum + entry.value, 0);
  const description = `Donut chart with ${data.length} categories. Total: ${formatChartValue({ value: total })}. Values are listed in the legend.`;
  return (
    <ChartContainer config={config} title="Distribution" description={description}>
      <RechartsPieChart accessibilityLayer title="Distribution" desc={description} margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
        <Tooltip content={<ChartTooltipContent />} isAnimationActive={false} />
        {/* Animation off by default — same reasoning as bar-chart.tsx's `Bar`. */}
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="55%" outerRadius="78%" paddingAngle={3} cornerRadius={5} stroke="none" label={false} labelLine={false} isAnimationActive={false}>
          {slices.map((entry) => (
            <Cell key={entry._jiniChartKey} fill={config[entry._jiniChartKey]!.color} />
          ))}
        </Pie>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="jini-chart-total" aria-hidden="true">
          <tspan x="50%" dy="-0.2em">{formatChartValue({ value: total }, { notation: 'compact' })}</tspan>
          <tspan x="50%" dy="1.8em" className="jini-chart-total-label">Total</tspan>
        </text>
      </RechartsPieChart>
    </ChartContainer>
  );
}
