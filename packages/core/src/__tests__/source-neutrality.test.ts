import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('all package source rejects host paths and product references', async () => {
  const forbidden = ['apps/' + 'website', '#' + 'src/', '@' + 'to' + 'vu', 'To' + 'vu'];
  const root = new URL('../', import.meta.url);
  const violations: string[] = [];
  async function inspect(directory: URL): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await inspect(url);
      else if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) {
        const content = await readFile(url, 'utf8');
        for (const pattern of forbidden) {
          if (content.toLowerCase().includes(pattern.toLowerCase())) violations.push(`${fileURLToPath(url)}: ${pattern}`);
        }
      }
    }
  }
  await inspect(root);
  // The published manifest also must not depend on a host checkout or host package.
  const manifestUrl = new URL('../../package.json', import.meta.url);
  const manifest = await readFile(manifestUrl, 'utf8');
  for (const pattern of forbidden) {
    if (manifest.toLowerCase().includes(pattern.toLowerCase())) {
      violations.push(`${fileURLToPath(manifestUrl)}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});
