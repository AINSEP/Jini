import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('rejects consumer imports, product names and site defaults in shipped source', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const forbidden = new RegExp(['apps/' + 'website', '#' + 'src/', '@' + 'to' + 'vu', 'to' + 'vu'].join('|'), 'i');
  const violations: string[] = [];
  function inspect(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name.includes('.test.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && forbidden.test(readFileSync(path, 'utf8'))) {
        violations.push(relative(root, path));
      }
    }
  }
  inspect(root);
  expect(violations).toEqual([]);
});
