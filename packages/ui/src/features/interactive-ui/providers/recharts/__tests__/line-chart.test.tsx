import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LineChart } from '../line-chart.js';

const data = [
  { day: 'Mon', users: 12 },
  { day: 'Tue', users: 18 },
];

describe('recharts LineChart', () => {
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

  it('renders a real recharts line curve for the series', () => {
    const { container } = render(<LineChart data={data} categoryKey="day" valueKey="users" />);
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull();
  });

  it('renders the category axis ticks from categoryKey', () => {
    // Scoped for the same reason as bar-chart.test.tsx's equivalent assertion — avoids matching
    // recharts' invisible `#recharts_measurement_span`.
    const { container } = render(<LineChart data={data} categoryKey="day" valueKey="users" />);
    const ticks = Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).map(
      (el) => el.textContent,
    );
    expect(ticks).toEqual(['Mon', 'Tue']);
  });

  it('applies a custom color to the line stroke', () => {
    const { container } = render(<LineChart data={data} categoryKey="day" valueKey="users" color="#00ff00" />);
    expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke', '#00ff00');
  });
});
