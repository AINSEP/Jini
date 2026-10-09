import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('strokes the line from the host chart token, falling back to the default palette token', () => {
    const { container } = render(<LineChart data={data} categoryKey="day" valueKey="users" />);
    expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke', 'var(--jini-chart-1, var(--jini-chart-default-1))');
  });

  it('applies a custom color to the line stroke', () => {
    const { container } = render(<LineChart data={data} categoryKey="day" valueKey="users" color="#00ff00" />);
    expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke', '#00ff00');
  });

  it('adds a soft series-colored gradient beneath the smooth line without default dots', () => {
    const { container } = render(<LineChart data={data} categoryKey="day" valueKey="users" />);
    const stops = container.querySelectorAll('linearGradient stop');
    expect(stops).toHaveLength(2);
    expect(stops[0]).toHaveAttribute('stop-color', 'var(--jini-chart-1, var(--jini-chart-default-1))');
    expect(stops[0]).toHaveAttribute('stop-opacity', '0.22');
    expect(stops[1]).toHaveAttribute('stop-opacity', '0.02');
    const id = container.querySelector('linearGradient')?.id;
    expect(container.querySelector('.recharts-area-area')).toHaveAttribute('fill', `url(#${id})`);
    expect(container.querySelectorAll('.recharts-line-dot, .recharts-area-dot')).toHaveLength(0);
    expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke-width', '2.5');
  });

  it('gives each chart its own gradient so differently colored charts do not share paint', () => {
    const { container } = render(<>
      <LineChart data={data} categoryKey="day" valueKey="users" color="var(--brand-a)" />
      <LineChart data={data} categoryKey="day" valueKey="users" color="var(--brand-b)" />
    </>);
    const gradients = Array.from(container.querySelectorAll('linearGradient'));
    expect(new Set(gradients.map((gradient) => gradient.id)).size).toBe(2);
    expect(gradients[0]?.querySelector('stop')).toHaveAttribute('stop-color', 'var(--brand-a)');
    expect(gradients[1]?.querySelector('stop')).toHaveAttribute('stop-color', 'var(--brand-b)');
    expect(Array.from(container.querySelectorAll('.recharts-area-area')).map((area) => area.getAttribute('fill'))).toEqual(gradients.map((gradient) => `url(#${gradient.id})`));
  });

  it('shows one active point and one tooltip value when navigating the shaded line', async () => {
    const { container } = render(<LineChart data={data} categoryKey="day" valueKey="users" />);
    const chart = screen.getByRole('application');
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    await waitFor(() => expect(within(screen.getByRole('tooltip')).getByText('18')).toBeInTheDocument());
    expect(container.querySelectorAll('.recharts-active-dot circle')).toHaveLength(1);
    expect(container.querySelector('.recharts-active-dot circle')).toHaveAttribute('r', '5');
    expect(screen.getByRole('tooltip').querySelectorAll('.jini-chart-tooltip-item')).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-cartesian-axis-line, .recharts-cartesian-grid-vertical line')).toHaveLength(0);
  });
});
