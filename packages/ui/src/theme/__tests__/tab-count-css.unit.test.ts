// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('uses a declared typography token so tab counts do not inherit the tab font size', () => {
  const css = readFileSync(path.resolve(__dirname, '../../styles/admin.css'), 'utf8');
  const variables = readFileSync(path.resolve(__dirname, '../../styles/variables.css'), 'utf8');
  const countRule = css.match(/\.tab-bar-count\s*\{([^}]+)\}/)?.[1];
  expect(countRule).toMatch(/font-size:\s*var\(--jini-font-size-2xs\)/);
  expect(variables).toMatch(/--jini-font-size-2xs:\s*0\.6875rem;/);
});
