import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../../styles/variables.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
// This token stylesheet has flat rules; inspect each alias's own selector, not an ancestor.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

it('keeps chat aliases at root so nested scheme scopes inherit component-local tokens', () => {
  let aliasCount = 0;

  for (const [, selector = '', body = ''] of rules) {
    const aliases = [...body.matchAll(/--jini-chat-[\w-]+\s*:/g)];
    if (aliases.length === 0) continue;
    aliasCount += aliases.length;
    expect(selector.trim()).toMatch(/^(?::root|:where\(:root\))$/);
  }

  expect(aliasCount).toBe(17);
});

it('prefers inherited host material inputs over scoped admin defaults', () => {
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
    const roleRules = rules.filter(([, , body = '']) => new RegExp(`--jini-${role}\\s*:`).test(body));
    expect(roleRules, role).toHaveLength(1);
    const [, selector = '', body = ''] = roleRules[0] ?? [];
    expect(body, role).toContain(`--jini-${role}: var(--jini-theme-${role}, var(--jini-default-${role}));`);
    expect(selector.split(',').map((scope) => scope.trim()), role).toEqual(
      expect.arrayContaining([':root', '[data-admin-theme]', '[data-color-scheme]']),
    );
  }
});
