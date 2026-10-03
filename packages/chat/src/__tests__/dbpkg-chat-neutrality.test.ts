import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const product = ['to', 'vu'].join('');
const forbidden = [product, 'apps/' + 'website', '#' + 'src/', '@' + product];
const violations = (source: string) => forbidden.filter(token => source.toLowerCase().includes(token));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:tsx?|css)$/.test(path) ? [path] : [];
  });
}

it('rejects consumer identity, paths and import aliases, including rationale comments', () => {
  expect(violations(forbidden.join('\n'))).toEqual(forbidden);
  expect(violations("import type { ChatMessage } from '../core/messages.js';")).toEqual([]);
  const root = fileURLToPath(new URL('../', import.meta.url));
  expect(sourceFiles(root).flatMap(path => violations(readFileSync(path, 'utf8')).map(token => ({ path, token })))).toEqual([]);
});
