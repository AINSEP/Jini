import { describe, expect, it } from 'vitest';
import { ImportHistoryUnavailable, importHistoryMissing, mapSqliteError } from '../errors.js';

const messages = { busy: 'busy copy', storage: 'storage copy', damaged: 'damaged copy' };
const thrown = (error: unknown) => { try { mapSqliteError({ error, messages }); } catch (caught) { return caught; } return undefined; };

describe('import history errors', () => {
  it('maps each driver code to its refusal and keeps the cause', () => {
    for (const [code, expected] of [
      ['SQLITE_BUSY', ['IMPORT_HISTORY_BUSY', 503, 'busy copy']], ['SQLITE_LOCKED', ['IMPORT_HISTORY_BUSY', 503, 'busy copy']],
      ['SQLITE_FULL', ['INSUFFICIENT_STORAGE', 507, 'storage copy']], ['ENOSPC', ['INSUFFICIENT_STORAGE', 507, 'storage copy']],
      ['SQLITE_CORRUPT', ['IMPORT_HISTORY_DAMAGED', 503, 'damaged copy']], ['SQLITE_NOTADB', ['IMPORT_HISTORY_DAMAGED', 503, 'damaged copy']], ['NOTADB', ['IMPORT_HISTORY_DAMAGED', 503, 'damaged copy']],
    ] as const) {
      const cause = Object.assign(new Error('driver'), { code });
      const error = thrown(cause) as ImportHistoryUnavailable;
      expect([error.code, error.status, error.message, error.cause]).toEqual([...expected, cause]);
    }
    const unknown = Object.assign(new Error('other'), { code: 'toString' });
    expect(thrown(unknown)).toBe(unknown);
    expect(thrown(null)).toBeNull();
    const already = importHistoryMissing({});
    expect(thrown(already)).toBe(already);
  });

  it('IMPORT_HISTORY_MISSING is a 503 with the plain-words copy', () => {
    const cause = new Error('gone');
    expect(importHistoryMissing({}, { cause })).toMatchObject({ code: 'IMPORT_HISTORY_MISSING', status: 503, cause,
      message: 'Import history is missing, so imports are paused to avoid creating the same site twice. Nothing was changed. Contact support with this error ID.' });
  });
});
