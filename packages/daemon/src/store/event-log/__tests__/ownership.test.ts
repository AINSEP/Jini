/** C2 connection ownership: real SQLite effects, injected host openers, no ambient driver. */
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { createSqliteEventLog, openSqliteEventLog } from '../sqlite.js';

it('uses the host opener and closes its owned connection exactly once', async () => {
  const db = new Database(':memory:');
  const close = vi.spyOn(db, 'close');
  const open = vi.fn(() => db);
  const log = openSqliteEventLog({ file: ':memory:', open });
  try {
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(':memory:', {});
    await log.append({ runId: 'r', event: 'agent', data: 'host' });
    expect(db.prepare('SELECT data FROM jini_event_log_entries').get()).toEqual({ data: '"host"' });
    await log.close({}); await log.close({});
    expect(close).toHaveBeenCalledTimes(1);
  } finally { await log.close({}); if (db.open) db.close(); }
});

it('a borrowed handle survives log close and does not change host pragmas', async () => {
  const db = new Database(':memory:');
  const pragma = vi.spyOn(db, 'pragma');
  try {
    const log = createSqliteEventLog({db} as any);
    await log.append({ runId: 'r', event: 'start', data: 1 });
    await log.close({}); await log.close({});
    expect(db.open).toBe(true);
    expect(db.prepare('SELECT next_cursor FROM jini_event_log_runs').get()).toEqual({ next_cursor: 2 });
    expect(pragma).not.toHaveBeenCalled();
  } finally { db.close(); }
});

it('schema failure closes an acquired handle and preserves the original failure', () => {
  const db = new Database(':memory:');
  const failure = new Error('schema denied');
  vi.spyOn(db, 'exec').mockImplementation(() => { throw failure; });
  const close = vi.spyOn(db, 'close');
  try {
    expect(() => openSqliteEventLog({ file: ':memory:', open: () => db })).toThrow(failure);
    expect(close).toHaveBeenCalledTimes(1);
    expect(db.open).toBe(false);
  } finally { if (db.open) db.close(); }
});

it('schema failure never closes a borrowed connection', () => {
  const db = new Database(':memory:');
  const failure = new Error('borrowed schema denied');
  vi.spyOn(db, 'exec').mockImplementation(() => { throw failure; });
  try {
    expect(() => createSqliteEventLog({db} as any)).toThrow(failure);
    expect(db.open).toBe(true);
  } finally { db.close(); }
});

it('has no ambient opener and reports exactly how to inject one', () => {
  expect(() => createSqliteEventLog(':memory:' as never)).toThrow('createSqliteEventLog: pass a borrowed SqliteDb');
});

it('propagates failed acquisition without acquiring any other resource', () => {
  const failure = new Error('host open denied');
  const open = vi.fn(() => { throw failure; });
  expect(() => openSqliteEventLog({ file: ':memory:', open })).toThrow(failure);
  expect(open).toHaveBeenCalledTimes(1);
});
