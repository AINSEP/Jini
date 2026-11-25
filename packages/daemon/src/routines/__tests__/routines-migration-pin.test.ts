import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { pinnedChecksum } from '../migrations/index.js';

it('pins the normalized migration source without VACUUM', () => {
  const source = readFileSync(new URL('../migrations/0001_jini_routines_v1.ts', import.meta.url), 'utf8');
  const normalized = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  expect(pinnedChecksum({ id: '0001_jini_routines_v1' }, {})).toBe(createHash('sha256').update(normalized).digest('hex'));
  expect(source).not.toMatch(/\bVACUUM\b/i);
});
