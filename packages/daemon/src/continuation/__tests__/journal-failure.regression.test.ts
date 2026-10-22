import { expect, it, vi } from 'vitest';
import type { EventLog, JournalEntry } from '@jini-ai/protocol';
import { createRunByteJournal } from '../journal.js';

// Requires the finished-lane merge patch: its comment must describe this existing failure behavior.
it('propagates append failure so a driver can report lost journal durability', async () => {
  const cause = new Error('journal disk unavailable');
  const append = vi.fn().mockRejectedValue(cause);
  const log: EventLog = { append, replay: async () => ({ kind: 'unknown-run' }), listRunIds: async () => [], drop: async () => {} };
  const entry = { direction: 'received', stream: 'stdout', content: 'bytes', at: 1 } as unknown as JournalEntry;
  const journal = createRunByteJournal({ eventLog: log });
  await expect(journal.record({ runId: 'r', entry })).rejects.toBe(cause);
  expect(append).toHaveBeenCalledWith({ runId: 'r', event: 'journal', data: entry });
});
