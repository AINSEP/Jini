import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { SqliteDb } from '@jini-ai/core/contracts/storage';
import { createSqliteEventLog, openSqliteEventLog } from '../sqlite.js';

/**
 * @file R8a step 0 (R9): who opens, configures and closes the event-log connection. The opener is
 * the host's `SqliteSyncOpener`; daemon owns the handle it opened, borrows any other. Pinned so
 * that replacing `openSqliteConnection` with a direct `open` + `pragma` cannot lose the handle
 * between open and the first thing that can throw.
 */

const clock = { nowMs: () => 1 };

interface Probe {
  readonly db: SqliteDb;
  readonly calls: string[];
  readonly openArgs: Array<{ file: string; settings: unknown }>;
  readonly open: (file: string, settings: unknown) => SqliteDb;
}

/** A recording view over a real in-memory database; `fail` makes one named method throw. */
function probe(fail: { readonly method?: string; readonly error?: unknown } = {}): Probe {
  const real = new Database(':memory:');
  const calls: string[] = [];
  const openArgs: Probe['openArgs'] = [];
  const db = new Proxy(real, {
    get(target, property) {
      if (typeof property === 'string' && ['pragma', 'exec', 'prepare', 'close'].includes(property)) {
        return (...args: unknown[]) => {
          calls.push(property === 'pragma' ? `pragma:${String(args[0])}` : property);
          if (fail.method === property) throw fail.error;
          return (target as never as Record<string, (...a: unknown[]) => unknown>)[property]!(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as SqliteDb;
  const open = (file: string, settings: unknown): SqliteDb => { openArgs.push({ file, settings }); return db; };
  return { db, calls, openArgs, open };
}

describe('openSqliteEventLog connection ownership', () => {
  it('opens once with (file, {}), applies WAL before any statement, and the opened handle is the one closed', async () => {
    const p = probe();
    const log = openSqliteEventLog({ file: '/data/events.db', open: p.open, clock });
    expect(p.openArgs).toEqual([{ file: '/data/events.db', settings: {} }]);
    expect(p.calls[0]).toBe('pragma:journal_mode = WAL');
    expect(p.calls.indexOf('exec')).toBeGreaterThan(0);
    await log.close({});
    expect(p.calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it('closing twice closes the owned handle once', async () => {
    const p = probe();
    const log = openSqliteEventLog({ file: ':memory:', open: p.open, clock });
    await log.close({});
    await log.close({});
    expect(p.calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it.each([
    ['an Error', new Error('pragma refused')],
    ['a non-Error', 'pragma refused'],
  ])('a pragma that throws %s closes the opened handle once and rethrows that failure', (_label, failure) => {
    const p = probe({ method: 'pragma', error: failure });
    expect(() => openSqliteEventLog({ file: ':memory:', open: p.open, clock })).toThrow(failure instanceof Error ? failure : /pragma refused/);
    expect(p.calls.filter((call) => call === 'close')).toHaveLength(1);
    expect(p.calls.indexOf('exec')).toBe(-1);
  });

  it('a schema failure closes the opened handle once and rethrows the schema failure', () => {
    const failure = new Error('schema refused');
    const p = probe({ method: 'exec', error: failure });
    expect(() => openSqliteEventLog({ file: ':memory:', open: p.open, clock })).toThrow(failure);
    expect(p.calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it('a failing close during cleanup never masks the setup failure', () => {
    const failure = new Error('schema refused');
    const real = new Database(':memory:');
    const db = new Proxy(real, {
      get(target, property) {
        if (property === 'exec') return () => { throw failure; };
        if (property === 'close') return () => { throw new Error('close refused'); };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as unknown as SqliteDb;
    expect(() => openSqliteEventLog({ file: ':memory:', open: () => db, clock })).toThrow(failure);
  });

  it('a borrowed createSqliteEventLog never closes the connection it was handed', () => {
    const p = probe();
    createSqliteEventLog({ db: p.db, clock });
    expect(p.calls).not.toContain('close');
    p.db.close();
  });
});
