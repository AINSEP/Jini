import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

it('A4 persistence contract documents the one-vault saved-format obligation and core-only vault types', () => {
  const source = readFileSync(new URL('../plugin-state-persistence.ts', import.meta.url), 'utf8');
  expect(source).toContain('Back it with the same vault object as your API connection host; `format` and the row ids are saved; never change them.');
  expect(source).toContain("from '@jini-ai/core/contracts/vault'");
  expect(source).not.toContain('@jini-ai/platform');
  for (const name of ['scope', 'format', 'list', 'get', 'put', 'delete', 'isConflict']) expect(source).toContain(name);
});
