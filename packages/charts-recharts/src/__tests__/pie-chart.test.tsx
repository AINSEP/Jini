import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PieChart } from '../pie-chart.js';

const data = [
  { name: 'A', value: 10 },
  { name: 'B', value: 20 },
  { name: 'C', value: 30 },
];

describe('recharts PieChart', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one real recharts slice per datum', () => {
    const { container } = render(<PieChart data={data} />);
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(3);
  });

  it('cycles through the default palette across slices', () => {
    const { container } = render(<PieChart data={data} />);
    const paths = container.querySelectorAll('.recharts-pie-sector path');
    const fills = Array.from(paths).map((path) => path.getAttribute('fill'));
    expect(new Set(fills).size).toBe(3);
  });

  it('takes slice colors from the host chart tokens in fixed order', () => {
    const { container } = render(<PieChart data={data} />);
    const fills = Array.from(container.querySelectorAll('.recharts-pie-sector path')).map((path) => path.getAttribute('fill'));
    expect(fills).toEqual([
      'var(--jini-chart-1, var(--jini-chart-default-1))',
      'var(--jini-chart-2, var(--jini-chart-default-2))',
      'var(--jini-chart-3, var(--jini-chart-default-3))',
    ]);
  });

  it('applies a single override color to every slice when color is given', () => {
    const { container } = render(<PieChart data={data} color="#123456" />);
    const paths = container.querySelectorAll('.recharts-pie-sector path');
    for (const path of Array.from(paths)) {
      expect(path).toHaveAttribute('fill', '#123456');
    }
  });

  it('draws a rounded donut without strokes or crowded outside labels', () => {
    const { container } = render(<PieChart data={data} />);
    const paths = Array.from(container.querySelectorAll('.recharts-pie-sector path'));
    expect(paths).toHaveLength(3);
    for (const path of paths) {
      expect(path).toHaveAttribute('stroke', 'none');
      // An inner and an outer arc prove a donut; small-radius arcs round the slice ends.
      expect(path.getAttribute('d')?.match(/A/g)).toHaveLength(6);
    }
    expect(container.querySelectorAll('.recharts-pie-label-text, .recharts-pie-label-line')).toHaveLength(0);
    expect(container.querySelector('.jini-chart-total')).toHaveTextContent('60Total');
    expect(screen.getByRole('figure', { name: 'Distribution' })).toHaveAccessibleDescription('Donut chart with 3 categories. Total: 60. Values are listed in the legend.');
  });

  it('lists category labels and values with the same swatches as the donut', () => {
    const { container } = render(<PieChart data={data} />);
    const legend = screen.getByRole('list', { name: 'Chart legend' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['A10', 'B20', 'C30']);
    expect(Array.from(legend.querySelectorAll('.jini-chart-swatch')).map((swatch) => (swatch as HTMLElement).style.backgroundColor)).toEqual(
      Array.from(container.querySelectorAll('.recharts-pie-sector path')).map((slice) => slice.getAttribute('fill')),
    );
  });

  it('keeps duplicate names and zero values distinct without mutating agent data', () => {
    const repeated = Object.freeze([Object.freeze({ name: 'Same', value: 0 }), Object.freeze({ name: 'Same', value: 20 })]);
    render(<PieChart data={repeated} />);
    const legend = screen.getByRole('list', { name: 'Chart legend' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Same0', 'Same20']);
    expect(repeated).toEqual([{ name: 'Same', value: 0 }, { name: 'Same', value: 20 }]);
  });

  it('still shows a useful zero total and legend when every value is zero', () => {
    const { container } = render(<PieChart data={[{ name: 'Empty', value: 0 }]} />);
    expect(container.querySelector('.jini-chart-total')).toHaveTextContent('0Total');
    expect(screen.getByRole('list', { name: 'Chart legend' })).toHaveTextContent('Empty0');
  });
});
