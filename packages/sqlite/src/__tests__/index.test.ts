import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';
import { remainingSurface } from './remaining-surface.js';

describe('@jini-ai/sqlite barrel', () => {
  it('re-exports the event-log and db-inspect public surfaces', () => {
    expect(Object.keys(barrel).sort()).toEqual(remainingSurface.filter(entry => entry.runtime).map(entry => entry.name).sort());
    expect(typeof barrel.createSqliteEventLog).toBe('function');
    expect(typeof barrel.inspectSqliteDatabase).toBe('function');
    expect(typeof barrel.verifySqliteIntegrity).toBe('function');
  });
});

it('publishes the frozen @jini-ai/sqlite surface at the repo lockstep version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(manifest.name).toBe('@jini-ai/sqlite');
  // Owner decision (2026-11-01, #8): freeze the shim API, publish its version with the Jini lockstep.
  expect(manifest.version).toBe(JSON.parse(readFileSync(new URL('../../../core/package.json', import.meta.url), 'utf8')).version);
  expect(manifest.repository.directory).toBe('packages/sqlite');
});
