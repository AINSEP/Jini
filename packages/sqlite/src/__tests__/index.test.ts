import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@injini/sqlite barrel', () => {
  it('re-exports the event-log, backend-config, and db-inspect public surfaces', () => {
    expect(typeof barrel.createSqliteEventLog).toBe('function');
    expect(typeof barrel.resolveSqliteBackendConfig).toBe('function');
    expect(barrel.SqliteBackendConfigError).toBeInstanceOf(Function);
    expect(typeof barrel.inspectSqliteDatabase).toBe('function');
    expect(typeof barrel.verifySqliteIntegrity).toBe('function');
  });
});
