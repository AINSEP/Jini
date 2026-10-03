import { Cell, Pie, PieChart as RechartsPieChart, ResponsiveContainer, Tooltip } from 'recharts';

export interface PieDatum {
  readonly name: string;
  readonly value: number;
}

const DEFAULT_COLORS = ['var(--jini-primary)', 'var(--jini-success)', 'var(--jini-warning)', 'var(--jini-danger)', 'var(--jini-muted)', 'var(--jini-text)'];

export interface PieChartProps {
  readonly data: readonly PieDatum[];
  readonly color?: string;
}

export function PieChart({ data, color }: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsPieChart>
        <Tooltip />
        {/* Animation off by default — same reasoning as bar-chart.tsx's `Bar`. */}
        <Pie data={data as PieDatum[]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label isAnimationActive={false}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length] ?? 'var(--jini-primary)'} />
          ))}
        </Pie>
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}
