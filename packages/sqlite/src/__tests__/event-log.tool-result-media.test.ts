/**
 * Proves `tool_result.media` survives the daemon's OWN persistence boundary — a real
 * `JSON.stringify`/`JSON.parse` round trip through an actual SQLite TEXT column (`rowToEntry` /
 * `appendTxn` in `../event-log.ts`), not merely an in-memory object reference. This is the second
 * of two real serialization hops between a handler returning a `media` block and a browser
 * rendering it — the first is the HTTP/SSE wire, covered by `delegated-tool-bridge.media.test.ts`
 * (daemon) and the host application's own client-side wire-to-`AgentEvent` reducer (the one real
 * reconstruction seam a consuming host owns — see that side's own tests for its coverage). Split
 * into its own file rather than folded into `event-log.test.ts`'s general ordering/
 * cursor suite, since this is a payload-shape concern, not an ordering one.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteEventLog, type SqliteEventLog } from '../event-log.js';

let dir: string;
let dbPath: string;
let log: SqliteEventLog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jini-sqlite-event-log-media-'));
  dbPath = join(dir, 'events.db');
  log = createSqliteEventLog(dbPath);
});

afterEach(async () => {
  await log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createSqliteEventLog — tool_result.media round trip', () => {
  it('a tool_result event with an image block survives append + replay byte-for-byte', async () => {
    const media = [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSU==' }];
    const payload = { type: 'tool_result', toolUseId: 'call-1', content: 'ok', media };

    await log.append({ runId: 'r1', event: 'agent', data: payload });
    const replay = await log.replay('r1', null);

    expect(replay.kind).toBe('ok');
    if (replay.kind !== 'ok') throw new Error('expected ok');
    // Structural equality, not reference equality — the point of this test is that the value went
    // through a real JSON.stringify -> SQLite TEXT column -> JSON.parse trip, not a JS object hop.
    expect(replay.entries[0]?.data).toEqual(payload);
    const roundTripped = replay.entries[0]?.data as typeof payload;
    expect(roundTripped.media).toEqual(media);
    expect(roundTripped.media[0]?.data).toBe('iVBORw0KGgoAAAANSU==');
  });

  it('the same round trip holds after closing and reopening the database file — durable, not just this connection', async () => {
    const media = [{ type: 'image', mimeType: 'image/jpeg', data: 'FFD8FFE0AAAA' }];
    await log.append({ runId: 'r1', event: 'agent', data: { type: 'tool_result', toolUseId: 'call-2', content: 'ok', media } });
    await log.close();

    const reopened = createSqliteEventLog(dbPath);
    try {
      const replay = await reopened.replay('r1', null);
      expect(replay.kind).toBe('ok');
      if (replay.kind !== 'ok') throw new Error('expected ok');
      expect((replay.entries[0]?.data as { media: unknown }).media).toEqual(media);
    } finally {
      await reopened.close();
      // `afterEach` above will call `log.close()` again on the already-closed original handle;
      // `better-sqlite3`'s `close()` is idempotent (no-op on an already-closed database), so this
      // is safe without a second cleanup branch.
    }
  });

  it('an ordinary tool_result with no media carries no media key after the round trip', async () => {
    await log.append({ runId: 'r1', event: 'agent', data: { type: 'tool_result', toolUseId: 'call-3', content: 'ok' } });
    const replay = await log.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind !== 'ok') throw new Error('expected ok');
    expect(replay.entries[0]?.data).not.toHaveProperty('media');
  });
});
