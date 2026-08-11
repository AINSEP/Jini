/**
 * Guards the `./db/sqlite` public surface — the driver counterpart to the `db/core` barrel test.
 */
import { describe, expect, it } from 'vitest';

import * as sqlite from '../index.js';

describe('@jini-ai/infra/db/sqlite barrel', () => {
  it('exports exactly the runtime surface it promises', () => {
    expect(Object.keys(sqlite).sort()).toEqual([
      'DEFAULT_PRAGMAS',
      'SqliteDbOpsAdapter',
      'findOneBy',
      'openSqliteDb',
    ]);
  });

  it('re-exports working implementations, not just names', () => {
    const db = sqlite.openSqliteDb({ filePath: ':memory:', schema: {} });
    expect(db.$client.open).toBe(true);
    expect(sqlite.DEFAULT_PRAGMAS).toContain('journal_mode = WAL');
  });
});
