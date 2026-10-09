import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BarChart } from '../bar-chart.js';

const data = [
  { month: 'Jan', revenue: 100 },
  { month: 'Feb', revenue: 150 },
];

describe('recharts BarChart', () => {
  // recharts' ResponsiveContainer measures its parent via getBoundingClientRect before it draws
  // any children — jsdom reports 0x0 for every element by default, so without this stub the
  // chart mounts but renders an empty SVG. See vitest.setup.ts's ResizeObserver shim doc.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a real recharts bar per data row', () => {
    const { container } = render(<BarChart data={data} categoryKey="month" valueKey="revenue" />);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
  });

  it('renders the category axis ticks from categoryKey', () => {
    // Scoped to the real tick-value elements, not a document-wide text query — recharts also
    // renders an invisible `#recharts_measurement_span` with the same text (used to size ticks),
    // which a document-wide `getByText` would ambiguously match too.
    const { container } = render(<BarChart data={data} categoryKey="month" valueKey="revenue" />);
    const ticks = Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).map(
      (el) => el.textContent,
    );
    expect(ticks).toEqual(['Jan', 'Feb']);
  });

  // Demo V3 2026-10-05: bars filled with bare `--jini-primary`, which a host that never maps it
  // (Tovu's admin) resolves to Jini's near-black default. Charts read the host's chart tokens first;
  // a host that sets none gets Jini's own orange default palette, never near-black (owner, 2026-10-05).
  it('fills bars from the host chart token, falling back to the default palette token', () => {
    const { container } = render(<BarChart data={data} categoryKey="month" valueKey="revenue" />);
    const bar = container.querySelector('.recharts-bar-rectangle path.recharts-rectangle');
    expect(bar).toHaveAttribute('fill', 'var(--jini-chart-1, var(--jini-chart-default-1))');
  });

  it('draws the grid and axis ticks from chart tokens, not recharts grey literals', () => {
    const { container } = render(<BarChart data={data} categoryKey="month" valueKey="revenue" />);
    expect(container.querySelector('.recharts-cartesian-grid-horizontal line')).toHaveAttribute('stroke', 'var(--jini-chart-grid, var(--jini-border))');
    expect(container.querySelector('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveAttribute('fill', 'var(--jini-chart-axis, var(--jini-muted))');
  });

  it('applies a custom color to the bars', () => {
    const { container } = render(<BarChart data={data} categoryKey="month" valueKey="revenue" color="#ff0000" />);
    const bar = container.querySelector('.recharts-bar-rectangle path.recharts-rectangle');
    expect(bar).toHaveAttribute('fill', '#ff0000');
  });

  it('draws rounded, comfortably sized bars with light horizontal grid and no axis chrome', () => {
    const { container } = render(<BarChart data={data} categoryKey="month" valueKey="revenue" />);
    const bar = container.querySelector('.recharts-bar-rectangle path.recharts-rectangle');
    // Recharts 3 omits array radii from SVG attributes; the two upper corner arcs carry them.
    expect(bar?.getAttribute('d')?.match(/A 6,6/g)).toHaveLength(2);
    expect(bar).toHaveAttribute('width', '40');
    expect(container.querySelectorAll('.recharts-cartesian-axis-line, .recharts-cartesian-axis-tick-line, .recharts-cartesian-grid-vertical line')).toHaveLength(0);
    expect(container.querySelector('.recharts-cartesian-grid-horizontal line')).toHaveAttribute('stroke-opacity', '0.6');
    expect(container.querySelector('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveAttribute('font-size', '12');
  });

  it('names the chart and shows the shared tooltip through Recharts keyboard navigation', async () => {
    render(<BarChart data={data} categoryKey="month" valueKey="revenue" />);
    expect(screen.getByRole('figure', { name: 'revenue by month' })).toHaveAccessibleDescription('Bar chart with 2 categories. Use arrow keys to explore values.');
    const chart = screen.getByRole('application');
    expect(chart).toHaveAttribute('tabindex', '0');
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    // Recharts schedules keyboard navigation on requestAnimationFrame.
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('150')).toBeInTheDocument());
    expect(within(screen.getByRole('tooltip')).getByText('revenue')).toBeInTheDocument();
  });

  it('formats large numeric ticks without changing the data', () => {
    const { container } = render(<BarChart data={[{ month: 'Jan', revenue: 12000 }]} categoryKey="month" valueKey="revenue" />);
    expect(container.querySelector('.recharts-yAxis-tick-labels')).toHaveTextContent('12K');
    expect(container.querySelector('.jini-chart-legend')).toHaveTextContent('revenue');
  });
});
