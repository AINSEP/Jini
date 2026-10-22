// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Like chart-default-palette-css.test.ts: jsdom does not resolve CSS custom properties.
const styles = readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

describe('chart stylesheet contract', () => {
  it('ships plain chart classes as scoped provider styles', () => {
    expect(styles).not.toContain('@jini-ai/ui/styles/variables.css');
    expect(styles).toContain('@import "./chart-palette.css";');
    for (const name of ['jini-chart', 'jini-chart-tooltip', 'jini-chart-swatch', 'jini-chart-legend', 'jini-chart-total']) {
      expect(styles).toContain(name === 'jini-chart' ? '.jini-chart[data-chart-provider="plugin.recharts"] {' : `.jini-chart[data-chart-provider="plugin.recharts"] .${name} {`);
    }
  });

  it('paints tooltip, legend and total with host chart tokens and package fallbacks', () => {
    expect(styles).toContain('background: var(--jini-chart-surface, var(--jini-bg, #ffffff));');
    expect(styles).toContain('color: var(--jini-chart-text, var(--jini-text, #171717));');
    expect(styles).toContain('color: var(--jini-chart-axis, var(--jini-muted, #737373));');
    expect(styles).toContain('fill: var(--jini-chart-text, var(--jini-text, #171717));');
    expect(styles).toContain('box-shadow: var(--jini-shadow-md, 0 4px 12px #0002);');
    expect(styles).toContain('border-radius: var(--jini-radius-sm, 0.375rem);');
  });

  it('wraps legends, keeps keyboard focus visible and suppresses reduced-motion effects', () => {
    expect(styles).toContain('flex-wrap: wrap;');
    expect(styles).toContain('.jini-chart[data-chart-provider="plugin.recharts"] .recharts-surface:focus-visible');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('animation: none !important;');
    expect(styles).toContain('transition: none !important;');
  });
});
