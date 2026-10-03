import { readFile, readdir } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('production source contains no host paths or product package references', async () => {
  const forbidden = ['apps/' + 'website', '#' + 'src/', '@' + 'to' + 'vu', 'To' + 'vu'];
  const violations: string[] = [];
  async function inspect(directory: URL): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      // Test fixtures can name forbidden patterns; shipped source cannot.
      if (entry.name === '__tests__' || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await inspect(url);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const content = (await readFile(url, 'utf8')).toLowerCase();
        for (const pattern of forbidden) {
          if (content.includes(pattern.toLowerCase())) violations.push(`${url.pathname}: ${pattern}`);
        }
      }
    }
  }
  await inspect(new URL('../', import.meta.url));
  expect(violations).toEqual([]);
});
