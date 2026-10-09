// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Like chart-default-palette-css.test.ts: jsdom does not resolve CSS custom properties.
const styles = readFileSync(path.resolve(__dirname, '../../../styles.css'), 'utf8');

describe('chart stylesheet contract', () => {
  it('ships plain chart classes through the existing Tailwind CLI entry point', () => {
    expect(styles).toContain('@import "../../styles/variables.css";');
    expect(styles).toContain('@source "./providers/**/*.{ts,tsx}";');
    for (const name of ['jini-chart', 'jini-chart-tooltip', 'jini-chart-swatch', 'jini-chart-legend', 'jini-chart-total']) {
      expect(styles).toContain(`.${name} {`);
    }
  });

  it('paints tooltip, legend and total with host chart tokens and package fallbacks', () => {
    expect(styles).toContain('background: var(--jini-chart-surface, var(--jini-bg));');
    expect(styles).toContain('color: var(--jini-chart-text, var(--jini-text));');
    expect(styles).toContain('color: var(--jini-chart-axis, var(--jini-muted));');
    expect(styles).toContain('fill: var(--jini-chart-text, var(--jini-text));');
    expect(styles).toContain('box-shadow: var(--jini-shadow-md);');
    expect(styles).toContain('border-radius: var(--jini-radius-sm);');
  });

  it('wraps legends, keeps keyboard focus visible and suppresses reduced-motion effects', () => {
    expect(styles).toContain('flex-wrap: wrap;');
    expect(styles).toContain('.jini-chart .recharts-surface:focus-visible');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('animation: none !important;');
    expect(styles).toContain('transition: none !important;');
  });
});
