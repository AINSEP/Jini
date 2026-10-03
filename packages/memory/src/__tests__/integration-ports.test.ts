import { promises as filesystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNoteStore } from '../index.js';

// Preserve the real disk round trip while proving every effect uses the supplied port.
describe('note-store injected effects', () => {
  it('uses the filesystem, clock and temporary-ID dependencies', async () => {
    const dataDir = await filesystem.mkdtemp(join(tmpdir(), 'jini-memory-ports-'));
    const open = vi.fn(filesystem.open.bind(filesystem));
    const store = createNoteStore(
      { validTypes: ['fact'], defaultType: 'fact' },
      { filesystem: { ...filesystem, open }, now: () => 123, ids: () => 'test-write' },
    );
    const changes: unknown[] = [];
    store.events.on('change', (event) => changes.push(event));
    try {
      const entry = await store.upsertEntry({ dataDir, input: { name: 'Preference', type: 'fact', body: 'Tea' } });
      expect(await store.readEntry({ dataDir, id: entry.id })).toEqual(entry);
      expect(open).toHaveBeenCalledTimes(2); // entry plus its index
      expect(open.mock.calls[0]?.[0]).toBe(join(await filesystem.realpath(dataDir), 'notes', '.fact_preference.md.test-write.tmp'));
      expect(changes).toEqual([{ kind: 'upsert', id: 'fact_preference', name: 'Preference', description: '', type: 'fact', at: 123 }]);
      await store.updateTreeNode({ dataDir, id: entry.id, patch: { body: 'Coffee' } });
      // The persisted frontmatter format terminates the body with a newline.
      expect((await store.readEntry({ dataDir, id: entry.id }))?.body).toBe('Coffee\n');
    } finally {
      await filesystem.rm(dataDir, { recursive: true, force: true });
    }
  });
});
