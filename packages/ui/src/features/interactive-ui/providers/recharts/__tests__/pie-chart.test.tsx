import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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

  it('applies a single override color to every slice when color is given', () => {
    const { container } = render(<PieChart data={data} color="#123456" />);
    const paths = container.querySelectorAll('.recharts-pie-sector path');
    for (const path of Array.from(paths)) {
      expect(path).toHaveAttribute('fill', '#123456');
    }
  });
});
