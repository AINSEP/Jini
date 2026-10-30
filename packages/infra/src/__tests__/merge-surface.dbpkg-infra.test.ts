import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as shimCore from '../db/driver/index.js';

test('the database shim preserves the artifact wire format', () => {
  expect(shimCore.restorePointFilename({ scopeId: 'a/b', watermarkAtCapture: 3, timestamp: 4 })).toBe('restore-point-a_b-wm3-4.db');
});

// This acceptance test deliberately remains pending until the owner merges the protected manifest.
// A source barrel alone cannot make an npm subpath resolve; both runtime and declaration paths matter.
test('the event entry is published without removing either database shim entry', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports['./db/core']).toBeDefined();
  expect(manifest.exports['./db/sqlite']).toBeDefined();
  expect(manifest.exports['./events/outbox']).toEqual({
    types: './dist/events/outbox/index.d.ts', import: './dist/events/outbox/index.js', default: './dist/events/outbox/index.js',
  });
  expect(manifest.typesVersions['*']['events/outbox']).toEqual(['./dist/events/outbox/index.d.ts']);
});
