import './dom-setup.js';
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
  // recharts also sizes tick text through its hidden `#recharts_measurement_span` (and caches each
  // string's size for the whole file), so that span reports a text-proportional width (7px/char):
  // a flat 600px would make every label "overlap" and the x axis would thin even two ticks.
  function layout(frameWidth: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.id === 'recharts_measurement_span') {
        const width = (this.textContent ?? '').length * 7;
        return { width, height: 14, top: 0, left: 0, bottom: 14, right: width, x: 0, y: 0, toJSON: () => {} };
      }
      return { width: frameWidth, height: 300, top: 0, left: 0, bottom: 300, right: frameWidth, x: 0, y: 0, toJSON: () => {} };
    });
  }

  beforeEach(() => layout(600));

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

  // 2026-10-12: a 24-month chart in the narrow assistant dock drew every x label on top of the
  // next (`interval={0}`). Relies on the text-proportional measurement stub above.
  describe('x-axis label density', () => {
    // A label may wrap onto up to three <tspan> lines; join them back into the words shown.
    const tickLines = (tick: Element) => Array.from(tick.querySelectorAll('tspan')).map((line) => line.textContent ?? '');
    const tickValues = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'));
    const tickLabels = (container: HTMLElement) => tickValues(container).map((el) => tickLines(el).join(' '));

    it('thins crowded category labels and keeps the first and last', () => {
      const months = Array.from({ length: 24 }, (_, i) => ({ month: `Month ${i + 1}`, value: i }));
      const { container } = render(<BarChart data={months} categoryKey="month" valueKey="value" />);
      const ticks = tickLabels(container);
      expect(ticks.length).toBeLessThan(24);
      expect(ticks[0]).toBe('Month 1');
      expect(ticks.at(-1)).toBe('Month 24');
    });

    // 2026-10-13: `preserveStartEnd` kept only 1 of 5 long labels. Each now wraps inside its band
    // (ending in "…" if it still does not fit); the tick's <title> keeps the full text.
    it('shows every long label, clipped to its band, with the full text in a title', () => {
      const labels = ['Draft landing pages awaiting review', 'Archived product announcements', 'Scheduled newsletter issues', 'Expired promotional banners', 'Media library uploads (images)'];
      const { container } = render(<BarChart data={labels.map((name, i) => ({ name, count: i + 1 }))} categoryKey="name" valueKey="count" />);
      const ticks = tickValues(container);
      expect(ticks).toHaveLength(5);
      expect(Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels title')).map((el) => el.textContent)).toEqual(labels);
      // At most 600px / 5 bands, less 4px air (2026-10-31), at the stub's 7px per character: three
      // lines of at most 16 characters.
      for (const tick of ticks) {
        const lines = tickLines(tick);
        expect(lines.length).toBeLessThanOrEqual(3);
        for (const line of lines) expect(line.length * 7).toBeLessThanOrEqual(116);
      }
      // Two lines used to cut this to "Draft landing / pages awaiting…"; the third line holds it whole.
      expect(tickLines(ticks[0]!)).toEqual(['Draft landing', 'pages awaiting', 'review']);
    });

    // 2026-10-31, measured in the dock: at a ~300px chart each 4-bar band gave the label its band
    // less 8px and two lines, so "Pages · Published" became "Pages · / Publish…". The label now gets
    // the band less 4px and three lines.
    it('keeps a three-line label whole at a ~300px dock width and still ends an overlong one in "…"', () => {
      layout(300);
      const labels = ['Posts · Draft · Live', 'Pages', 'Archived announcements from last year', 'Media'];
      const { container } = render(<BarChart data={labels.map((name, i) => ({ name, count: i + 1 }))} categoryKey="name" valueKey="count" />);
      const ticks = tickValues(container);
      expect(ticks).toHaveLength(4);
      // Each separator stays on its word's line through a no-break space (2026-11-01).
      expect(tickLines(ticks[0]!)).toEqual(['Posts\u00a0·', 'Draft\u00a0·', 'Live']);
      expect(tickLines(ticks[1]!)).toEqual(['Pages']);
      expect(tickLines(ticks[2]!).length).toBeLessThanOrEqual(3);
      expect(ticks[2]!.textContent).toMatch(/…$/);
      expect(Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels title')).map((el) => el.textContent)).toEqual(labels);
    });

    // 2026-11-01 (Tovu 47b4199e0): at dock widths "Pages · Published" wrapped as "Pages / · / Publ…",
    // a separator alone on its own line. It must stay attached to a word at every width.
    it.each([180, 240, 375])('never leaves a middle-dot separator alone on a line at %ipx', (width) => {
      layout(width);
      const labels = ['Pages · Published', 'Posts · Drafts', 'Media · Active'];
      const { container } = render(<BarChart data={labels.map((status) => ({ status, count: 1 }))} categoryKey="status" valueKey="count" />);
      const lines = tickValues(container).flatMap(tickLines).map((line) => line.trim());
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.filter((line) => /^[·\s…]*$/.test(line))).toEqual([]);
      expect(Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels title')).map((el) => el.textContent)).toEqual(labels);
    });

    // The separator binds to the word before it, as a comma would. Binding it to the next word (the
    // shape of Tovu's bundle patch) lengthens the second line and re-truncates "Published" at the
    // ~300px dock width that the three-line fix (2026-10-31) made whole.
    it('keeps the separator at the end of the first line and the next word whole at ~300px', () => {
      layout(300);
      const labels = ['Pages · Published', 'Posts · Drafts', 'Media · Active'];
      const { container } = render(<BarChart data={labels.map((status) => ({ status, count: 1 }))} categoryKey="status" valueKey="count" />);
      expect(tickValues(container).map(tickLines)).toEqual([['Pages ·', 'Published'], ['Posts ·', 'Drafts'], ['Media ·', 'Active']]);
    });

    it('still shows every label when a few categories fit', () => {
      const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map((quarter, i) => ({ quarter, value: i }));
      const { container } = render(<BarChart data={quarters} categoryKey="quarter" valueKey="value" />);
      expect(tickLabels(container)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    });
  });
});
