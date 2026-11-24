import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// RT-2 (owner retire order, 2026-11-22) deleted the `db/core` and `db/sqlite` compatibility shims; their
// owner is `@jini-ai/db`. The outbox entry stays because a host composes it directly. Pin the manifest so a
// shim entry, or the database peer it needed, cannot come back without this test being changed on purpose.
// The domain-event in-memory adapters (`events/memory-bus`) and domain-port worker binding
// (`events/domain-outbox`) were added on purpose in the w4-runtime extraction; neither touches a database.
test('the package publishes only the event entries, and no database peer', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(Object.keys(manifest.exports)).toEqual(['./events/outbox', './events/memory-bus', './events/domain-outbox']);
  expect(manifest.exports['./events/outbox']).toEqual({
    types: './dist/events/outbox/index.d.ts', import: './dist/events/outbox/index.js', default: './dist/events/outbox/index.js',
  });
  expect(manifest.exports['./events/memory-bus']).toEqual({
    types: './dist/events/memory-bus.d.ts', import: './dist/events/memory-bus.js', default: './dist/events/memory-bus.js',
  });
  expect(manifest.exports['./events/domain-outbox']).toEqual({
    types: './dist/events/domain-outbox.d.ts', import: './dist/events/domain-outbox.js', default: './dist/events/domain-outbox.js',
  });
  expect(manifest.typesVersions).toEqual({ '*': {
    'events/outbox': ['./dist/events/outbox/index.d.ts'],
    'events/memory-bus': ['./dist/events/memory-bus.d.ts'],
    'events/domain-outbox': ['./dist/events/domain-outbox.d.ts'],
  } });
  expect(manifest.peerDependencies?.['@jini-ai/db']).toBeUndefined();
  expect(manifest.jini.optionalPeers?.['@jini-ai/db']).toBeUndefined();
});
