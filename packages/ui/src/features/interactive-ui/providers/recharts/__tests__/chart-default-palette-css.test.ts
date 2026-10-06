// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * @file Jini's default chart palette is the warm orange one, in light and dark mode.
 *
 * A host that sets no `--jini-chart-N` used to get bars in Jini's near-black `--jini-primary`
 * (#363636); the owner's call after seeing Tovu's admin chart (2026-10-05): "Claude orange should be
 * the default color." A pure-CSS invariant (jsdom resolves no custom properties), so it is asserted
 * as text over the variable contract, like `tab-count-css.unit.test.ts`.
 */
const variables = readFileSync(path.resolve(__dirname, '../../../../../styles/variables.css'), 'utf8');

/** Every top-level rule as its selector list and body (variables.css has no nested blocks). */
function rules(css: string): Array<{ selectors: string[]; body: string }> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return Array.from(stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, selector, body]) => ({
    selectors: selector!.split(',').map((s) => s.trim()),
    body: body!,
  }));
}

/** The body of the rule that lists every one of `selectors` and declares a default chart token. */
function defaultPaletteBody(selectors: string[]): string {
  const rule = rules(variables).find(
    (candidate) => selectors.every((s) => candidate.selectors.includes(s)) && candidate.body.includes('--jini-chart-default-1'),
  );
  return rule?.body ?? '';
}

const SLOTS = ['1', '2', '3', '4', '5', '6'];

describe('default chart palette', () => {
  it('seats series 1 on the warm orange in light mode, not near-black', () => {
    const body = defaultPaletteBody([':root']);
    expect(body).toMatch(/--jini-chart-default-1:\s*oklch\(55\.29% 0\.1129 43\.4\);/);
    expect(body).not.toMatch(/#363636/);
  });

  // Jini's base tokens flip on `data-color-scheme`; hosts like Tovu's admin flip `data-theme` on <html>.
  it('steps series 1 lighter for dark mode under both dark-scheme attributes', () => {
    const body = defaultPaletteBody(['[data-color-scheme="dark"]', '[data-theme="dark"]']);
    expect(body).toMatch(/--jini-chart-default-1:\s*oklch\(62% 0\.11 44\);/);
  });

  it.each([
    ['light', [':root']],
    ['dark', ['[data-color-scheme="dark"]', '[data-theme="dark"]']],
  ])('declares all six series slots in %s mode', (_mode, selectors) => {
    const body = defaultPaletteBody(selectors);
    for (const slot of SLOTS) expect(body, `slot ${slot}`).toMatch(new RegExp(`--jini-chart-default-${slot}:\\s*oklch\\(`));
  });
});
