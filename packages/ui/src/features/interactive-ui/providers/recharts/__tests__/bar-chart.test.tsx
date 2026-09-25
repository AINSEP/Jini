import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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

  it('applies a custom color to the bars', () => {
    const { container } = render(<BarChart data={data} categoryKey="month" valueKey="revenue" color="#ff0000" />);
    const bar = container.querySelector('.recharts-bar-rectangle path.recharts-rectangle');
    expect(bar).toHaveAttribute('fill', '#ff0000');
  });
});
