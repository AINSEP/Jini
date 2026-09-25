import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface BarChartProps {
  readonly data: readonly Record<string, unknown>[];
  readonly categoryKey: string;
  readonly valueKey: string;
  readonly color?: string;
}

export function BarChart({ data, categoryKey, valueKey, color = '#2563eb' }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart data={data as Record<string, unknown>[]}>
        <CartesianGrid strokeDasharray="3 3" />
        {/* `interval={0}` always shows every category tick — an agent-authored chart usually has
            few categories, so recharts' default overlap-avoidance skip (which drops ticks based
            on measured text width) costs more legibility than it saves. */}
        <XAxis dataKey={categoryKey} interval={0} />
        <YAxis />
        <Tooltip />
        {/* Animation depends on a `requestAnimationFrame`-driven transition (`react-smooth`); an
            agent-driven surface can redraw a chart on every message, where a re-animate-from-zero
            each time reads as flicker rather than motion, so it's off by default. */}
        <Bar dataKey={valueKey} fill={color} isAnimationActive={false} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
