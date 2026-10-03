import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as events from '../events/index.js';
import * as outbox from '../events/outbox/index.js';
import * as shimCore from '../db/core/index.js';

test('the new events barrel exposes the same outbox implementations', () => {
  expect(Object.keys(events).sort()).toEqual(Object.keys(outbox).sort());
  for (const name of Object.keys(outbox) as (keyof typeof outbox)[]) expect(events[name]).toBe(outbox[name]);
});

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
