import { CartesianGrid, Line, LineChart as RechartsLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface LineChartProps {
  readonly data: readonly Record<string, unknown>[];
  readonly categoryKey: string;
  readonly valueKey: string;
  readonly color?: string;
}

export function LineChart({ data, categoryKey, valueKey, color = '#2563eb' }: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsLineChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" />
        {/* Same reasoning as bar-chart.tsx: always show every category tick rather than recharts'
            default measured-overlap skip. */}
        <XAxis dataKey={categoryKey} interval={0} />
        <YAxis />
        <Tooltip />
        {/* Animation off by default — same reasoning as bar-chart.tsx's `Bar`. */}
        <Line type="monotone" dataKey={valueKey} stroke={color} isAnimationActive={false} />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
