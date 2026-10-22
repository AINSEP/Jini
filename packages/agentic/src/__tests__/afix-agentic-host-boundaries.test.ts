import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps production sources independent of application paths and aliases', () => {
  const forbidden = ['apps/' + 'website', '#' + 'src/', '@' + String.fromCharCode(116, 111, 118, 117)];
  const violations: string[] = [];
  let scanned = 0;
  function scan(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') scan(file);
      } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        scanned++;
        const source = readFileSync(file, 'utf8').toLowerCase();
        if (forbidden.some(reference => source.includes(reference))) violations.push(file);
      }
    }
  }
  scan(fileURLToPath(new URL('../', import.meta.url)));
  expect(scanned).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});
