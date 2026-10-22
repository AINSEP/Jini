import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('resolves derived material defaults per scope without replacing inherited host inputs', () => {
  const css = readFileSync(new URL('../../themes/default/admin.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // This token stylesheet has flat rules; inherited root defaults would freeze the root scheme.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

  for (const role of [
    'app-bg',
    'panel-bg',
    'panel-border',
    'panel-shadow',
    'overlay-bg',
    'overlay-shadow',
    'control-bg',
    'control-border',
  ]) {
    const input = `--jini-default-${role}`;
    expect(css, role).not.toMatch(new RegExp(`--jini-theme-${role}\\s*:`));
    const inputRules = rules.filter(([, , body = '']) => new RegExp(`${input}\\s*:`).test(body));
    expect(inputRules, input).toHaveLength(1);
    const [, selector = ''] = inputRules[0] ?? [];
    const selectors = selector.split(',').map((selector) => selector.trim());
    expect(selectors, input).toEqual(expect.arrayContaining([
      ':root', '[data-admin-theme]', '[data-color-scheme]',
    ]));
  }
});
