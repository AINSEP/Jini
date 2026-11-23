import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// RT-2 (owner retire order, 2026-11-22) deleted the `db/core` and `db/sqlite` compatibility shims; their
// owner is `@jini-ai/db`. The outbox entry stays because a host composes it directly. Pin the manifest so a
// shim entry, or the database peer it needed, cannot come back without this test being changed on purpose.
test('the package publishes only the event outbox entry, and no database peer', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(Object.keys(manifest.exports)).toEqual(['./events/outbox']);
  expect(manifest.exports['./events/outbox']).toEqual({
    types: './dist/events/outbox/index.d.ts', import: './dist/events/outbox/index.js', default: './dist/events/outbox/index.js',
  });
  expect(manifest.typesVersions).toEqual({ '*': { 'events/outbox': ['./dist/events/outbox/index.d.ts'] } });
  expect(manifest.peerDependencies?.['@jini-ai/db']).toBeUndefined();
  expect(manifest.jini.optionalPeers?.['@jini-ai/db']).toBeUndefined();
});
