import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Bar, BarChart, Cell, Pie, PieChart, Tooltip, XAxis } from 'recharts';
import { ChartContainer, ChartLegendContent, ChartTooltipContent } from '../chart.js';

describe('shared chart presentation with real Recharts', () => {
  beforeEach(() => {
    // The browser-layout seam, not a Recharts module mock: ResponsiveContainer still measures.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 600, height: 300, top: 0, left: 0, bottom: 300, right: 600, x: 0, y: 0, toJSON: () => {},
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses config labels and colors in the real tooltip and legend', () => {
    render(
      <ChartContainer config={{ revenue: { label: 'Revenue', color: 'var(--jini-chart-4)' } }} title="Revenue by month" description="Two months of revenue.">
        <BarChart data={[{ month: 'January', revenue: 1234.567, _jiniChartKey: 'unrelated-row-metadata' }]} accessibilityLayer>
          <XAxis dataKey="month" />
          <Bar dataKey="revenue" fill="var(--jini-chart-4)" isAnimationActive={false} />
          <Tooltip active defaultIndex={0} content={<ChartTooltipContent />} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>,
    );
    const figure = screen.getByRole('figure', { name: 'Revenue by month' });
    expect(figure).toHaveAccessibleDescription('Two months of revenue.');
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveAttribute('aria-live', 'polite');
    expect(tooltip).toHaveAttribute('aria-atomic', 'true');
    expect(within(tooltip).getByText('January')).toHaveClass('jini-chart-tooltip-label');
    expect(within(tooltip).getByText('Revenue')).toHaveClass('jini-chart-tooltip-name');
    expect(within(tooltip).getByText('1,234.567')).toHaveClass('jini-chart-tooltip-value');
    expect(tooltip.querySelector('.jini-chart-swatch')).toHaveStyle({ backgroundColor: 'var(--jini-chart-4)' });
    const legend = screen.getByRole('list', { name: 'Chart legend' });
    expect(within(legend).getByText('Revenue')).toBeInTheDocument();
    expect(legend.querySelector('.jini-chart-swatch')).toHaveStyle({ backgroundColor: 'var(--jini-chart-4)' });
  });

  it('ties a pie tooltip to the selected slice even when display names repeat', () => {
    render(
      <ChartContainer config={{
        'slice-0': { label: 'Repeated', color: 'var(--jini-chart-1)', value: 10 },
        'slice-1': { label: 'Repeated', color: 'var(--jini-chart-2)', value: 20 },
      }} title="Distribution" description="Two categories.">
        <PieChart accessibilityLayer>
          <Pie data={[
            { name: 'Repeated', value: 10, _jiniChartKey: 'slice-0' },
            { name: 'Repeated', value: 20, _jiniChartKey: 'slice-1' },
          ]} dataKey="value" nameKey="name" isAnimationActive={false}>
            <Cell fill="var(--jini-chart-1)" />
            <Cell fill="var(--jini-chart-2)" />
          </Pie>
          <Tooltip active defaultIndex={1} content={<ChartTooltipContent />} isAnimationActive={false} />
        </PieChart>
      </ChartContainer>,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByText('Repeated')).toBeInTheDocument();
    expect(within(tooltip).getByText('20')).toBeInTheDocument();
    expect(tooltip.querySelector('.jini-chart-swatch')).toHaveStyle({ backgroundColor: 'var(--jini-chart-2)' });
    const legend = screen.getByRole('list', { name: 'Chart legend' });
    expect(within(legend).getAllByText('Repeated')).toHaveLength(2);
    expect(within(legend).getByText('10')).toBeInTheDocument();
    expect(within(legend).getByText('20')).toBeInTheDocument();
  });

  it('renders no tooltip for inactive, empty, missing or decorative payloads', () => {
    const { rerender } = render(<ChartTooltipContent payload={[{ value: 10 }]} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    rerender(<ChartTooltipContent active />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    rerender(<ChartTooltipContent active payload={[{ value: null }, { value: 10, type: 'none' }]} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('retains zero values and escapes agent-authored labels as text', () => {
    render(<ChartTooltipContent active label="<script>alert(1)</script>" payload={[
      { dataKey: 'constructor', name: '<img src=x onerror=alert(1)>', value: 0 },
    ]} />);
    const tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByText('0')).toBeInTheDocument();
    expect(within(tooltip).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(tooltip.querySelectorAll('script, img')).toHaveLength(0);
    expect(tooltip.querySelector('.jini-chart-swatch')).toHaveStyle({ backgroundColor: 'var(--jini-chart-1, var(--jini-chart-default-1))' });
  });

  it('uses a payload color for unconfigured series, with a readable fallback label', () => {
    const { rerender } = render(<ChartTooltipContent active payload={[{ dataKey: 'other', value: 5, color: 'var(--brand)' }]} />);
    expect(screen.getByText('other')).toBeInTheDocument();
    expect(screen.getByRole('tooltip').querySelector('.jini-chart-swatch')).toHaveStyle({ backgroundColor: 'var(--brand)' });
    rerender(<ChartTooltipContent active payload={[{ value: 5 }]} />);
    expect(screen.getByText('Value')).toBeInTheDocument();
  });

  it('does not display an empty legend', () => {
    render(<ChartLegendContent />);
    expect(screen.queryByRole('list')).toBeNull();
  });

  // Computed styles serialize named colors as RGB; keep exact color assertions in that form.
  it.each([
    { entry: { dataKey: 'revenue', name: 'Raw name', value: 7, color: 'red', payload: { _jiniChartKey: 'slice-1' } }, label: 'Revenue', color: 'rgb(0, 0, 255)' },
    { entry: { name: 'revenue', value: 7 }, label: 'Revenue', color: 'rgb(0, 0, 255)' },
    { entry: { dataKey: 'value', name: 'Repeated', value: 7, payload: { _jiniChartKey: 'slice-1' } }, label: 'Slice', color: 'rgb(0, 128, 0)' },
    { entry: { dataKey: 'value', name: 'Raw name', value: 7, color: 'red', payload: {} }, label: 'Raw name', color: 'rgb(255, 0, 0)' },
    { entry: { dataKey: 'value', name: 'Raw name', value: 7, color: 'red', payload: { _jiniChartKey: 'missing' } }, label: 'Raw name', color: 'rgb(255, 0, 0)' },
    { entry: { dataKey: 'constructor', name: 'Raw name', value: 7, payload: { _jiniChartKey: 'slice-1' } }, label: 'Slice', color: 'rgb(0, 128, 0)' },
    { entry: { dataKey: 'value', name: 'Raw name', value: 7, payload: { _jiniChartKey: 'constructor' } }, label: 'Raw name', color: 'var(--jini-chart-1, var(--jini-chart-default-1))' },
    { entry: { dataKey: 'blank', name: 'Raw name', value: 7, color: 'red' }, label: '', color: '' },
  ])('resolves tooltip identity and presentation for $entry', ({ entry, label, color }) => {
    render(
      <ChartContainer config={{
        revenue: { label: 'Revenue', color: 'blue' },
        'slice-1': { label: 'Slice', color: 'green' },
        blank: { label: '', color: '' },
      }} title="Tooltip lookup" description="Lookup precedence.">
        <div><ChartTooltipContent active payload={[entry]} /></div>
      </ChartContainer>,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.querySelector('.jini-chart-tooltip-name')?.textContent).toBe(label);
    expect(tooltip.querySelector('.jini-chart-swatch')).toHaveStyle({ backgroundColor: color });
    expect(within(tooltip).getByText('7')).toHaveClass('jini-chart-tooltip-value');
  });

  it.each([
    { entry: { name: 0, dataKey: 'ignored', value: 0 }, name: '0' },
    { entry: { dataKey: 0, value: false }, name: '0' },
    { entry: { value: 'categorical' }, name: 'Value' },
    { entry: { name: '', dataKey: 'ignored', value: 1 }, name: '' },
  ])('preserves nullish rather than truthy name fallbacks for $entry', ({ entry, name }) => {
    render(<ChartTooltipContent active payload={[entry]} />);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.querySelector('.jini-chart-tooltip-name')?.textContent).toBe(name);
    expect(tooltip.querySelector('.jini-chart-swatch')).toHaveStyle({ backgroundColor: 'var(--jini-chart-1, var(--jini-chart-default-1))' });
  });

  it('filters only decorative and nullish entries while preserving order and false values', () => {
    render(<ChartTooltipContent active payload={[
      { name: 'decorative', value: 10, type: 'none' },
      { name: 'null', value: null },
      { name: 'missing' },
      { name: 'zero', value: 0 },
      { name: 'false', value: false, type: 'line' },
      { name: 'empty', value: '' },
    ]} />);
    const tooltip = screen.getByRole('tooltip');
    expect(Array.from(tooltip.querySelectorAll('.jini-chart-tooltip-name'), (node) => node.textContent)).toEqual(['zero', 'false', 'empty']);
    expect(Array.from(tooltip.querySelectorAll('.jini-chart-tooltip-value'), (node) => node.textContent)).toEqual(['0', 'false', '']);
  });

  it.each([undefined, null, 0, 'January'])('renders a label only when it is non-nullish: %s', (label) => {
    render(<ChartTooltipContent active label={label} payload={[{ value: 1 }]} />);
    const tooltip = screen.getByRole('tooltip');
    if (label == null) {
      expect(tooltip.querySelector('.jini-chart-tooltip-label')).toBeNull();
    } else {
      expect(tooltip.querySelector('.jini-chart-tooltip-label')).toHaveTextContent(String(label));
    }
  });
});
