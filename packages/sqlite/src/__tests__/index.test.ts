import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@jini-ai/sqlite barrel', () => {
  it('re-exports the event-log and db-inspect public surfaces', () => {
    expect(typeof barrel.createSqliteEventLog).toBe('function');
    expect(typeof barrel.inspectSqliteDatabase).toBe('function');
    expect(typeof barrel.verifySqliteIntegrity).toBe('function');
  });
});

it('publishes the final @jini-ai/sqlite 0.5.0 compatibility release from the matching directory', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(manifest.name).toBe('@jini-ai/sqlite');
  expect(manifest.version).toBe('0.5.0');
  expect(manifest.repository.directory).toBe('packages/sqlite');
});
