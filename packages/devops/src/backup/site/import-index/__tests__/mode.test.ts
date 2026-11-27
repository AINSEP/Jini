import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy, SiteImportRecord } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { admitImport } from '../admission.js';
import type { BackfillResult } from '../backfill.js';
import { ImportHistoryUnavailable } from '../errors.js';
import {
  IMPORT_INDEX_STATE_SCHEMA, confirmLegacyAuthority, indexStatePaths, markIndexedWrite, readIndexState, resolveMode, writeIndexState, writeIndexedWitness,
  type ImportIndexModeHandle, type ImportIndexState, type ImportIndexStateRead,
} from '../mode.js';

const DB_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_DB = '44444444-4444-4444-8444-444444444444';
const IMPORT_ID = '11111111-1111-4111-8111-111111111111';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const legacy: ImportIndexState = { schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'legacy', dbId: null, cutoverAt: 0, firstIndexedWriteAt: 0, legacyRetiredAt: 0 };
const cutover: ImportIndexState = { schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'cutover', dbId: DB_ID, cutoverAt: 1_000, firstIndexedWriteAt: 0, legacyRetiredAt: 0 };
const indexed: ImportIndexState = { schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'indexed', dbId: DB_ID, cutoverAt: 1_000, firstIndexedWriteAt: 2_000, legacyRetiredAt: 0 };
const valid = (state: ImportIndexState): ImportIndexStateRead => ({ kind: 'valid', state });
const stored: SiteImportRecord = { importId: IMPORT_ID, principalId: 'owner', requestId: 'key', source: { uploadId: UPLOAD_ID }, status: 'ready', createdAt: new Date(1_500).toISOString(), expiresAt: 3_601_500, displayName: 'Site', newSiteId: 'site-1', newSiteName: 'site-1' };

const { requestId: _requestId, ...withoutRequest } = stored;

/** A fake DB handle: `meta` answers the mode check, `replay`/`imports` answer an admission lookup. */
function fakeHandle({ meta = { db_id: DB_ID, cutover_at: '1000' }, metaError, onRun }: { meta?: Record<string, string>; metaError?: unknown; onRun?: (sql: string) => void } = {}) {
  const close = vi.fn();
  const db = {
    transaction: (body: () => unknown) => ({ immediate: () => body() }),
    prepare: (sql: string) => ({
      get: (key: unknown) => {
        if (sql.includes('FROM meta')) {
          if (metaError !== undefined) throw metaError;
          const value = meta[String(key)];
          return value === undefined ? undefined : { value };
        }
        if (sql.includes('FROM replay')) return { principal_id: 'owner', request_id: 'key', fence_kind: 'upload', fence_value: UPLOAD_ID, import_id: IMPORT_ID, accepted_ms: 1_500, outcome_json: '{}' };
        if (sql.includes('FROM imports')) return { row_json: JSON.stringify(stored) };
        return undefined;
      },
      run: (..._args: unknown[]) => { onRun?.(sql); return { changes: 1 }; },
    }),
  } as unknown as SqliteSyncClient;
  return { db, close } satisfies ImportIndexModeHandle;
}

function resolve({ read, db = true, witness = false, access = 'locked', cutoverPolicy = 'enable', open, backfill }: {
  read: ImportIndexStateRead; db?: boolean; witness?: boolean; access?: 'read' | 'locked'; cutoverPolicy?: ImportHistoryPolicy['cutoverPolicy'];
  open?: () => ImportIndexModeHandle; backfill?: () => BackfillResult;
}) {
  const writes: ImportIndexState[] = [];
  const retries: string[] = [];
  const logs: string[] = [];
  const events: string[] = [];
  const openExisting = vi.fn((_required: { readonly: boolean }) => { events.push('open'); return (open ?? (() => fakeHandle()))(); });
  const runBackfill = vi.fn(() => { events.push('backfill'); return (backfill ?? ((): BackfillResult => ({ state: 'blocked' })))(); });
  const result = resolveMode({
    state: read, evidence: { dbArtifactsPresent: db, indexedWitnessPresent: witness }, access, policy: { cutoverPolicy }, openExisting,
    writeState: ({ state }) => { events.push(`write:${state.mode}`); writes.push(state); },
    backfill: runBackfill, prepareRetry: ({ reason }) => { events.push(`retry:${reason}`); retries.push(reason); }, log: ({ message }) => logs.push(message),
  });
  return { result, writes, retries, logs, events, openExisting, backfill: runBackfill };
}

const refusedWith = (code: ImportHistoryUnavailable['code']) => ({ mode: 'refused', error: expect.objectContaining({ code, status: 503 }) });

describe('import index mode resolution', () => {
  it('missing DB after an indexed write fails closed', () => {
    for (const cutoverPolicy of ['enable', 'rollback'] as const) {
      for (const access of ['read', 'locked'] as const) {
        const run = resolve({ read: valid(indexed), db: false, witness: true, access, cutoverPolicy });
        expect(run.result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
        // Opening a missing DB could create an empty one; indexed never opens without evidence.
        expect(run.openExisting).not.toHaveBeenCalled();
        expect(run.writes).toEqual([]);
        expect(run.backfill).not.toHaveBeenCalled();
        expect(run.retries).toEqual([]);
      }
    }
    const raced = resolve({ read: valid(indexed), open: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } });
    expect(raced.result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
    expect(raced.writes).toEqual([]);
    expect(() => confirmLegacyAuthority({ state: valid(indexed), evidence: { dbArtifactsPresent: false, indexedWitnessPresent: true } })).toThrow(expect.objectContaining({ code: 'IMPORT_HISTORY_MISSING' }));
  });

  it('index-state says indexed before the first post-cutover row is committed', () => {
    const disk: { state: ImportIndexState; witness: boolean } = { state: cutover, witness: false };
    let firstRun: { mode: string; witness: boolean } | undefined;
    const handle = fakeHandle({ onRun: () => { firstRun ??= { mode: disk.state.mode, witness: disk.witness }; } });
    const run = resolve({ read: valid(cutover), open: () => handle });
    expect(run.result.mode).toBe('cutover');
    if (run.result.mode !== 'cutover') return;
    let state: ImportIndexState = run.result.state;
    const fence = () => { state = markIndexedWrite({ state, clock: { nowMs: () => 5_000 }, writeState: ({ state: next }) => { disk.state = next; }, ensureIndexedWitness: () => { disk.witness = true; } }); };
    const admitted = admitImport({ db: handle.db, clock: { nowMs: () => 5_000 }, policy: { cutoverPolicy: 'enable', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false },
      principalId: 'owner', source: { url: 'https://share.example/site' }, digestSource: () => undefined, requireBudget: () => {}, beforeWrite: fence,
      makeRow: ({ now }) => ({ ...withoutRequest, source: { url: 'https://share.example/site' }, status: 'verifying', createdAt: new Date(now).toISOString() }) });
    expect(admitted.kind).toBe('admitted');
    expect(firstRun).toEqual({ mode: 'indexed', witness: true });
    expect(disk.state).toEqual({ ...cutover, mode: 'indexed', firstIndexedWriteAt: 5_000 });
  });

  it('pre-write rollback reads the legacy snapshot', () => {
    const missing = resolve({ read: valid(cutover), db: false, cutoverPolicy: 'rollback' });
    expect(missing.result).toEqual({ mode: 'legacy' });
    // Artifacts are preserved for retry first, then legacy authority becomes durable.
    expect(missing.events).toEqual(['retry:missing', 'write:legacy']);
    const handle = fakeHandle();
    const healthy = resolve({ read: valid(cutover), cutoverPolicy: 'rollback', open: () => handle });
    expect(healthy.result).toEqual({ mode: 'legacy' });
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(healthy.events).toEqual(['open', 'write:legacy']);
    const reader = resolve({ read: valid(cutover), db: false, access: 'read' });
    expect(reader.result).toEqual({ mode: 'legacy' });
    expect(reader.events).toEqual([]);
    const enabled = resolve({ read: valid(cutover), db: false });
    expect(enabled.result).toEqual({ mode: 'legacy' });
    expect(enabled.events).toEqual(['retry:missing', 'write:legacy', 'backfill']);
  });

  it('permitted pre-write rollback can still complete owner setup', () => {
    const run = resolve({ read: valid(cutover), db: false, cutoverPolicy: 'rollback' });
    expect(run.result).toEqual({ mode: 'legacy' });
    const noEvidence = { dbArtifactsPresent: false, indexedWitnessPresent: false };
    // The owner-setup put is a legacy JSON write: refused against the old cutover state, allowed once legacy is durable.
    expect(() => confirmLegacyAuthority({ state: valid(cutover), evidence: noEvidence })).toThrow(expect.objectContaining({ code: 'IMPORT_HISTORY_MISSING' }));
    expect(() => confirmLegacyAuthority({ state: valid(run.writes.at(-1)!), evidence: { ...noEvidence, dbArtifactsPresent: true } })).not.toThrow();
    // Rollback never asks the host to delete anything; prepareRetry only preserves the DB artifacts.
    expect(run.retries).toEqual(['missing']);
    expect(run.backfill).not.toHaveBeenCalled();
  });

  it('post-cutover replay after restart returns the stored site, not a second one', () => {
    const started: string[] = [];
    const registryAfterRestart = (result: ReturnType<typeof resolve>['result']) => {
      // A legacy JSON snapshot holds no post-cutover fence, so admitting there starts a second site.
      if (result.mode !== 'indexed') { started.push('second-site'); return undefined; }
      return admitImport({ db: result.handle.db, clock: { nowMs: () => 9_000 }, policy: { cutoverPolicy: 'rollback', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false },
        principalId: 'owner', requestId: 'key', source: { uploadId: UPLOAD_ID }, digestSource: () => undefined, requireBudget: () => {}, beforeWrite: () => {},
        makeRow: () => { started.push('second-site'); return stored; } });
    };
    for (const cutoverPolicy of ['enable', 'rollback'] as const) {
      const run = resolve({ read: valid(indexed), witness: true, cutoverPolicy });
      expect(registryAfterRestart(run.result)).toEqual({ kind: 'replay', row: stored });
      expect(run.backfill).not.toHaveBeenCalled();
      expect(run.writes).toEqual([]);
    }
    expect(started).toEqual([]);
  });

  it('DB from another workspace is refused', () => {
    const swapped = fakeHandle({ meta: { db_id: OTHER_DB, cutover_at: '1000' } });
    const run = resolve({ read: valid(indexed), witness: true, open: () => swapped });
    expect(run.result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
    expect(swapped.close).toHaveBeenCalledTimes(1);
    expect(run.writes).toEqual([]);
    const otherCutover = fakeHandle({ meta: { db_id: DB_ID, cutover_at: '999' } });
    expect(resolve({ read: valid(indexed), open: () => otherCutover }).result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
    // Before the first write a mismatched DB is untrusted, so legacy keeps authority.
    const preWrite = fakeHandle({ meta: { db_id: OTHER_DB, cutover_at: '1000' } });
    const early = resolve({ read: valid(cutover), cutoverPolicy: 'rollback', open: () => preWrite });
    expect(early.result).toEqual({ mode: 'legacy' });
    expect(early.events).toEqual(['open', 'retry:mismatch', 'write:legacy']);
    expect(preWrite.close).toHaveBeenCalledTimes(1);
  });

  it('lost state with evidence of indexed writes fails closed', () => {
    for (const evidence of [{ db: true, witness: false }, { db: false, witness: true }, { db: true, witness: true }]) {
      const run = resolve({ read: { kind: 'missing' }, ...evidence });
      expect(run.result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
      expect(run.events).toEqual([]);
    }
    expect(resolve({ read: { kind: 'invalid' }, db: false }).result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
    // A witness next to a non-indexed state means the state file went backwards.
    expect(resolve({ read: valid(legacy), witness: true }).result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
    expect(resolve({ read: valid(cutover), witness: true }).result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
    const fresh = resolve({ read: { kind: 'missing' }, db: false });
    expect(fresh.result).toEqual({ mode: 'legacy' });
    expect(fresh.events).toEqual(['write:legacy', 'backfill']);
  });

  it('newer sidecar is not quarantined', () => {
    const newer = () => { throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_NEWER', status: 503, message: 'newer' }); };
    for (const read of [valid(cutover), valid(indexed)]) {
      for (const cutoverPolicy of ['enable', 'rollback'] as const) {
        const run = resolve({ read, open: newer, cutoverPolicy });
        expect(run.result).toEqual(refusedWith('IMPORT_HISTORY_NEWER'));
        expect(run.events).toEqual(['open']);
      }
    }
    for (const error of [new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_BUSY', status: 503, message: 'busy' }), Object.assign(new Error('denied'), { code: 'EACCES' })]) {
      const writes: unknown[] = []; const retries: unknown[] = [];
      expect(() => resolveMode({ state: valid(cutover), evidence: { dbArtifactsPresent: true, indexedWitnessPresent: false }, access: 'locked', policy: { cutoverPolicy: 'enable' },
        openExisting: () => { throw error; }, writeState: state => writes.push(state), backfill: () => ({ state: 'blocked' }), prepareRetry: reason => retries.push(reason), log: () => {} })).toThrow(error);
      expect([writes, retries]).toEqual([[], []]);
    }
  });

  it('damaged DB is refused when indexed and handed back to legacy before the first write', () => {
    const corrupt = fakeHandle({ metaError: Object.assign(new Error('malformed'), { code: 'SQLITE_CORRUPT' }) });
    expect(resolve({ read: valid(indexed), open: () => corrupt }).result).toEqual(refusedWith('IMPORT_HISTORY_DAMAGED'));
    expect(corrupt.close).toHaveBeenCalledTimes(1);
    const early = resolve({ read: valid(cutover), cutoverPolicy: 'rollback', open: () => { throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'damaged' }); } });
    expect(early.result).toEqual({ mode: 'legacy' });
    expect(early.events).toEqual(['open', 'retry:damaged', 'write:legacy']);
  });

  it('read access never writes, backfills or quarantines', () => {
    for (const read of [{ kind: 'missing' } as const, valid(legacy), valid(cutover)]) {
      const run = resolve({ read, db: false, access: 'read' });
      expect(run.result).toEqual({ mode: 'legacy' });
      expect(run.events).toEqual([]);
    }
    const reader = resolve({ read: valid(cutover), access: 'read' });
    expect(reader.result.mode).toBe('cutover');
    expect(reader.openExisting).toHaveBeenCalledWith({ readonly: true }, {});
  });

  it('locked legacy with enable publishes cutover only after a complete backfill and blocked stays legacy', () => {
    const backfilled = resolve({ read: valid(legacy), db: false, backfill: () => ({ state: 'cutover', dbId: DB_ID, cutoverAt: 1_000, backfillCount: 3 }) });
    expect(backfilled.result).toEqual({ mode: 'cutover', state: cutover, handle: expect.anything() });
    expect(backfilled.events).toEqual(['backfill', 'write:cutover', 'open']);
    expect(backfilled.openExisting).toHaveBeenCalledWith({ readonly: false }, {});
    const blocked = resolve({ read: valid(legacy), backfill: () => ({ state: 'blocked' }) });
    expect(blocked.result).toEqual({ mode: 'legacy' });
    expect(blocked.events).toEqual(['backfill']);
    // A just-built candidate that fails verification is not rebuilt in a loop.
    const broken = resolve({ read: valid(legacy), db: false, backfill: () => ({ state: 'cutover', dbId: DB_ID, cutoverAt: 1_000, backfillCount: 0 }), open: () => fakeHandle({ meta: { db_id: OTHER_DB, cutover_at: '1000' } }) });
    expect(broken.result).toEqual({ mode: 'legacy' });
    expect(broken.events).toEqual(['backfill', 'write:cutover', 'open', 'retry:mismatch', 'write:legacy']);
    expect(resolve({ read: valid(legacy), cutoverPolicy: 'rollback' }).events).toEqual([]);
  });

  it('indexed ignores rollback and says so in the log', () => {
    const run = resolve({ read: valid(indexed), cutoverPolicy: 'rollback' });
    expect(run.result.mode).toBe('indexed');
    expect(run.logs).toEqual(['Rollback is not possible after the first indexed import write; the index-aware store stays in use.']);
  });
});

describe('import index write fence', () => {
  it('a failing state write leaves no witness and runs no SQL', () => {
    let witness = false; const sql = vi.fn();
    const handle = fakeHandle({ onRun: sql });
    const failing = () => markIndexedWrite({ state: cutover, clock: { nowMs: () => 5_000 }, writeState: () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); }, ensureIndexedWitness: () => { witness = true; } });
    expect(() => handle.db.transaction(() => { failing(); handle.db.prepare('INSERT INTO imports').run(); }).immediate()).toThrow('full');
    expect([witness, sql.mock.calls.length]).toEqual([false, 0]);
    const noWitness = () => markIndexedWrite({ state: cutover, clock: { nowMs: () => 5_000 }, writeState: () => {}, ensureIndexedWitness: () => { throw new Error('witness'); } });
    expect(() => handle.db.transaction(() => { noWitness(); handle.db.prepare('INSERT INTO imports').run(); }).immediate()).toThrow('witness');
    expect(sql).not.toHaveBeenCalled();
    expect(() => markIndexedWrite({ state: legacy, clock: { nowMs: () => 1 }, writeState: () => {}, ensureIndexedWitness: () => {} })).toThrow();
  });

  it('an already-indexed state with a missing witness re-establishes it before SQL', () => {
    const events: string[] = [];
    const next = markIndexedWrite({ state: indexed, clock: { nowMs: () => 9_000 }, writeState: () => events.push('state'), ensureIndexedWitness: () => events.push('witness') });
    expect(next).toBe(indexed);
    expect(events).toEqual(['witness']);
    const first: string[] = [];
    markIndexedWrite({ state: cutover, clock: { nowMs: () => 9_000 }, writeState: () => first.push('state'), ensureIndexedWitness: () => first.push('witness') });
    expect(first).toEqual(['state', 'witness']);
  });

  it('writeIndexedWitness creates the witness exclusively at 0600, then flushes file and root', () => {
    const calls: string[] = [];
    const fs = { writeExclusive: ({ file, mode }: { file: string; mode: number }) => calls.push(`create ${file} ${mode.toString(8)}`), kind: () => 'file' as const,
      fsyncFile: ({ file }: { file: string }) => calls.push(`fsync ${file}`), fsyncDir: ({ dir }: { dir: string }) => calls.push(`flush ${dir}`) };
    writeIndexedWitness({ root: '/ws', fs });
    expect(calls).toEqual(['create /ws/.history-indexed-v1 600', 'fsync /ws/.history-indexed-v1', 'flush /ws']);
    const exists = { ...fs, writeExclusive: () => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); } };
    expect(() => writeIndexedWitness({ root: '/ws', fs: exists })).not.toThrow();
    expect(() => writeIndexedWitness({ root: '/ws', fs: { ...exists, kind: () => 'directory' as const } })).toThrow('exists');
    expect(indexStatePaths({ root: '/ws' })).toEqual({ state: '/ws/import-index.state.json', witness: '/ws/.history-indexed-v1' });
  });
});

describe('import index state file', () => {
  it('readIndexState rejects malformed but parseable shapes without salvaging them', () => {
    const read = (value: unknown) => readIndexState({ file: '/ws/import-index.state.json', readJson: () => ({ state: 'ok', value }) });
    for (const state of [legacy, cutover, indexed, { ...indexed, legacyRetiredAt: 3_000 }]) expect(read(state)).toEqual({ kind: 'valid', state });
    for (const bad of [
      null, [], { ...legacy, dbId: DB_ID }, { ...legacy, cutoverAt: 5 }, { ...cutover, dbId: 'not-a-uuid' }, { ...cutover, firstIndexedWriteAt: 3 }, { ...cutover, cutoverAt: 0 },
      { ...indexed, firstIndexedWriteAt: 0 }, { ...indexed, cutoverAt: '1000' }, { ...indexed, legacyRetiredAt: -1 }, { ...indexed, mode: 'frozen' },
      { ...indexed, schema: 'site-import-index-state/2' }, { ...indexed, extra: true }, { ...cutover, dbId: 'ABCDEF01-3333-4333-8333-333333333333' },
    ]) expect(read(bad)).toEqual({ kind: 'invalid' });
    expect(readIndexState({ file: 'f', readJson: () => ({ state: 'missing' }) })).toEqual({ kind: 'missing' });
    expect(readIndexState({ file: 'f', readJson: () => ({ state: 'unreadable', text: '{' }) })).toEqual({ kind: 'invalid' });
  });

  it('writeIndexState publishes only a valid state through the atomic writer', () => {
    const writeJson = vi.fn();
    writeIndexState({ file: '/ws/import-index.state.json', writeJson, state: cutover });
    expect(writeJson).toHaveBeenCalledWith({ file: '/ws/import-index.state.json', value: cutover }, {});
    expect(() => writeIndexState({ file: 'f', writeJson, state: { ...indexed, firstIndexedWriteAt: 0 } as ImportIndexState })).toThrow();
    expect(writeJson).toHaveBeenCalledTimes(1);
  });
});

it('binds indexed authority to the recorded cutover even when the database identity matches', () => {
  const handle = fakeHandle({ meta: { db_id: DB_ID, cutover_at: '999' } });
  const run = resolve({ read: valid(indexed), witness: true, access: 'read', open: () => handle });
  expect(run.result).toEqual(refusedWith('IMPORT_HISTORY_MISSING'));
  expect(run.openExisting.mock.calls).toEqual([[{ readonly: true }, {}]]);
  expect(handle.close.mock.calls).toEqual([[{}, {}]]);
  expect(run.backfill).not.toHaveBeenCalled();
  expect(run.writes).toEqual([]);
});
