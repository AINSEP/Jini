import { describe, expect, it } from 'vitest';
import type { JournalEntry } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunByteJournal } from '../journal.js';

const SENT: JournalEntry = { content: 'hello', provenance: { source: 'host', channel: 'stdin' }, trust: 'trusted' };
const RECEIVED: JournalEntry = { content: 'world', provenance: { source: 'agent', channel: 'stdout' }, trust: 'untrusted' };

describe('createRunByteJournal', () => {
  it('records and replays entries for a run in append order', async () => {
    const journal = createRunByteJournal({ eventLog: createInMemoryEventLog({}) });
    await journal.record({ runId: 'run-1', entry: SENT });
    await journal.record({ runId: 'run-1', entry: RECEIVED });

    expect(await journal.read({ runId: 'run-1' })).toEqual([SENT, RECEIVED]);
  });

  it('keeps different runs isolated from each other', async () => {
    const journal = createRunByteJournal({ eventLog: createInMemoryEventLog({}) });
    await journal.record({ runId: 'run-1', entry: SENT });
    await journal.record({ runId: 'run-2', entry: RECEIVED });

    expect(await journal.read({ runId: 'run-1' })).toEqual([SENT]);
    expect(await journal.read({ runId: 'run-2' })).toEqual([RECEIVED]);
  });

  it('returns an empty array for a run with no recorded entries, rather than throwing', async () => {
    const journal = createRunByteJournal({ eventLog: createInMemoryEventLog({}) });
    expect(await journal.read({ runId: 'never-recorded' })).toEqual([]);
  });

  it('stores journal entries under a dedicated event name distinct from any RunProtocolEvent kind', async () => {
    const eventLog = createInMemoryEventLog({});
    const journal = createRunByteJournal({ eventLog: eventLog });
    await journal.record({ runId: 'run-1', entry: SENT });

    const replay = await eventLog.replay({ runId: 'run-1', afterCursor: null });
    if (replay.kind !== 'ok') throw new Error('expected ok replay');
    expect(replay.entries).toHaveLength(1);
    expect(replay.entries[0]!.event).not.toMatch(/^(start|agent|stdout|stderr|error|end)$/);
  });
});
