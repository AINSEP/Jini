import { describe, expect, it } from 'vitest';
import { IMPORT_INDEX_STATE_SCHEMA, retireLegacySnapshot, type ImportIndexState, type LegacyRetireFs } from '../mode.js';

const DAY_30 = 2_592_000_000;
const CUTOVER = 10_000;
const indexed: ImportIndexState = { schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'indexed', dbId: '33333333-3333-4333-8333-333333333333', cutoverAt: CUTOVER, firstIndexedWriteAt: CUTOVER + 1, legacyRetiredAt: 0 };
const cutover: ImportIndexState = { ...indexed, mode: 'cutover', firstIndexedWriteAt: 0 };
const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;

type Entry = { kind: 'file' | 'directory' | 'symlink' | 'other'; mtimeMs: number };
function fakeFs(entries: Record<string, Entry>) {
  const files = new Map(Object.entries(entries));
  const unlinked: string[] = [];
  const fs: LegacyRetireFs = {
    readdir: ({ dir }) => { expect(dir).toBe('/ws'); return [...files.keys()]; },
    stat: ({ file }) => files.get(file.slice('/ws/'.length)) ?? { kind: 'missing', mtimeMs: 0 },
    unlink: ({ file }) => { const name = file.slice('/ws/'.length); expect(files.get(name)?.kind).toBe('file'); files.delete(name); unlinked.push(name); },
  };
  return { fs, files, unlinked };
}

function retire({ fs, state = indexed, now = CUTOVER + DAY_30 }: { fs: LegacyRetireFs; state?: ImportIndexState; now?: number }) {
  const writes: ImportIndexState[] = []; const logs: string[] = [];
  const result = retireLegacySnapshot({ root: '/ws', state, clock: { nowMs: () => now }, policy: { legacyRetireMs: DAY_30 }, fs, writeState: ({ state: next }) => writes.push(next), log: ({ message }) => logs.push(message) });
  return { result, writes, logs };
}

describe('legacy snapshot retirement', () => {
  it('snapshot retained at 30d − 1 ms, removed at 30d, never in cutover mode', () => {
    const early = fakeFs({ [`${uuid(1)}.json`]: { kind: 'file', mtimeMs: CUTOVER - 1 } });
    expect(retire({ fs: early.fs, now: CUTOVER + DAY_30 - 1 })).toEqual({ result: { removed: 0, finished: false }, writes: [], logs: [] });
    expect(early.unlinked).toEqual([]);
    const during = fakeFs({ [`${uuid(1)}.json`]: { kind: 'file', mtimeMs: CUTOVER - 1 } });
    expect(retire({ fs: during.fs, state: cutover, now: CUTOVER + 10 * DAY_30 }).result).toEqual({ removed: 0, finished: false });
    expect(during.unlinked).toEqual([]);
    const due = fakeFs({ [`${uuid(1)}.json`]: { kind: 'file', mtimeMs: CUTOVER - 1 } });
    const run = retire({ fs: due.fs });
    expect(run.result).toEqual({ removed: 1, finished: true });
    expect(due.unlinked).toEqual([`${uuid(1)}.json`]);
    expect(run.writes).toEqual([{ ...indexed, legacyRetiredAt: CUTOVER + DAY_30 }]);
    const done = fakeFs({ [`${uuid(2)}.json`]: { kind: 'file', mtimeMs: 0 } });
    expect(retire({ fs: done.fs, state: { ...indexed, legacyRetiredAt: 5 } })).toEqual({ result: { removed: 0, finished: true }, writes: [], logs: [] });
  });

  it('retirement keeps a history file written after cutover', () => {
    const disk = fakeFs({
      [`${uuid(1)}.json`]: { kind: 'file', mtimeMs: CUTOVER },
      [`${uuid(2)}.json`]: { kind: 'file', mtimeMs: CUTOVER + 1 },
      [`${uuid(3)}.json`]: { kind: 'file', mtimeMs: CUTOVER + 5_000 },
    });
    const run = retire({ fs: disk.fs });
    expect(disk.unlinked).toEqual([`${uuid(1)}.json`]);
    expect([...disk.files.keys()]).toEqual([`${uuid(2)}.json`, `${uuid(3)}.json`]);
    // A newer file can only come from a downgraded pre-index build and may be its only copy.
    expect(run.logs).toEqual(['Kept 2 import history files written after the switch to indexed history.']);
    expect(run.result).toEqual({ removed: 1, finished: true });
    expect(run.writes).toHaveLength(1);
  });

  it('retirement resumes after a partial pass and keeps non-history files', () => {
    const entries: Record<string, Entry> = {};
    for (let n = 0; n < 250; n++) entries[`${uuid(n)}.json`] = { kind: 'file', mtimeMs: 1 };
    const keep: Record<string, Entry> = {
      'notes.json': { kind: 'file', mtimeMs: 1 }, 'import-index.state.json': { kind: 'file', mtimeMs: 1 }, '.history-indexed-v1': { kind: 'file', mtimeMs: 1 },
      'site-imports.db': { kind: 'file', mtimeMs: 1 }, 'site-imports.db-wal': { kind: 'file', mtimeMs: 1 }, payloads: { kind: 'directory', mtimeMs: 1 },
      [`${uuid(900)}.json.tmp`]: { kind: 'file', mtimeMs: 1 }, [`${uuid(0xabcdef).toUpperCase()}.json`]: { kind: 'file', mtimeMs: 1 },
      [`${uuid(902)}.json`]: { kind: 'directory', mtimeMs: 1 }, [`${uuid(903)}.json`]: { kind: 'symlink', mtimeMs: 1 }, [`${uuid(904)}.json`]: { kind: 'other', mtimeMs: 1 },
    };
    const disk = fakeFs({ ...entries, ...keep });
    const first = retire({ fs: disk.fs });
    expect(first.result).toEqual({ removed: 200, finished: false });
    expect(first.writes).toEqual([]);
    const second = retire({ fs: disk.fs });
    expect(second.result).toEqual({ removed: 50, finished: true });
    expect(second.writes).toEqual([{ ...indexed, legacyRetiredAt: CUTOVER + DAY_30 }]);
    expect([...disk.files.keys()].sort()).toEqual(Object.keys(keep).sort());
  });

  it('a failed deletion leaves retirement unfinished for the next tidy', () => {
    const disk = fakeFs({ [`${uuid(1)}.json`]: { kind: 'file', mtimeMs: 1 }, [`${uuid(2)}.json`]: { kind: 'file', mtimeMs: 1 } });
    const fs: LegacyRetireFs = { ...disk.fs, unlink: ({ file }) => { if (file.endsWith(`${uuid(1)}.json`)) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); disk.fs.unlink({ file }); } };
    const run = retire({ fs });
    expect(run.result).toEqual({ removed: 1, finished: false });
    expect(run.writes).toEqual([]);
    expect(run.logs).toEqual(['1 old import history files could not be removed; tidy will retry.']);
    const gone: LegacyRetireFs = { ...disk.fs, unlink: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } };
    expect(retire({ fs: gone })).toMatchObject({ result: { removed: 0, finished: true }, writes: [{ legacyRetiredAt: CUTOVER + DAY_30 }] });
  });
});
