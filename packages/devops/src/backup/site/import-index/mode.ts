import type { ImportHistoryPolicy } from '@jini-ai/core/contracts/site/site-import-history';
import type { JsonFileRead } from '@jini-ai/core/contracts/site/fs-durable-json';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import type { BackfillResult } from './backfill.js';
import { ImportHistoryUnavailable, importHistoryMissing, mapSqliteError } from './errors.js';
import type { ImportPayloadFs } from './payload-namespace.js';

/**
 * Import-history authority: which store (legacy JSON snapshot or the SQLite index) owns the
 * history, the write fence that records an indexed write before its SQL runs, and the tidy-only
 * retirement of the JSON snapshot. The state lives OUTSIDE the DB because it must still say
 * "indexed" when the DB itself is gone; together with the witness file it stops a missing DB from
 * reopening the stale JSON snapshot, which lacks every post-cutover row and request fence.
 */

export const IMPORT_INDEX_STATE_SCHEMA = 'site-import-index-state/1' as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HISTORY_FILE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
const STATE_KEYS = ['cutoverAt', 'dbId', 'firstIndexedWriteAt', 'legacyRetiredAt', 'mode', 'schema'].join();
const RETIRE_BATCH = 200;

type StateSchema = { schema: typeof IMPORT_INDEX_STATE_SCHEMA };
export type LegacyIndexState = StateSchema & { mode: 'legacy'; dbId: null; cutoverAt: 0; firstIndexedWriteAt: 0; legacyRetiredAt: 0 };
export type CutoverIndexState = StateSchema & { mode: 'cutover'; dbId: string; cutoverAt: number; firstIndexedWriteAt: 0; legacyRetiredAt: 0 };
export type IndexedIndexState = StateSchema & { mode: 'indexed'; dbId: string; cutoverAt: number; firstIndexedWriteAt: number; legacyRetiredAt: number };
/** `mode` is the authority; the timestamps are records, never read as truthy flags. */
export type ImportIndexState = LegacyIndexState | CutoverIndexState | IndexedIndexState;
export type ImportIndexStateRead = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'valid'; state: ImportIndexState };

/** Fixed paths under the workspace root. Neither name matches `^<uuid>\.json$`, so no build reads them as a record. */
export function indexStatePaths({ root }: { root: string }, _optional: Record<string, never> = {}): { state: string; witness: string } {
  return { state: `${root}/import-index.state.json`, witness: `${root}/.history-indexed-v1` };
}

const legacyState = (): LegacyIndexState => ({ schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'legacy', dbId: null, cutoverAt: 0, firstIndexedWriteAt: 0, legacyRetiredAt: 0 });
const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

// Each mode's invariant as one list of checks, so every field is judged and nothing is inferred from another.
function modeChecks({ state }: { state: Record<string, unknown> }): boolean[] {
  const recordedCutover = [typeof state.dbId === 'string' && UUID.test(state.dbId), (state.cutoverAt as number) > 0];
  if (state.mode === 'legacy') return [state.dbId === null, state.cutoverAt === 0, state.firstIndexedWriteAt === 0, state.legacyRetiredAt === 0];
  if (state.mode === 'cutover') return [...recordedCutover, state.firstIndexedWriteAt === 0, state.legacyRetiredAt === 0];
  return [state.mode === 'indexed', ...recordedCutover, (state.firstIndexedWriteAt as number) > 0];
}

const modeFieldsValid = ({ state }: { state: Record<string, unknown> }): boolean => modeChecks({ state }).every(Boolean);

/** Strict shape check: an exact key set and per-mode invariants. Nothing is salvaged from a near miss. */
export function parseIndexState({ value }: { value: unknown }, _optional: Record<string, never> = {}): ImportIndexState | undefined {
  if (Object.prototype.toString.call(value) !== '[object Object]') return undefined;
  const state = value as Record<string, unknown>;
  if (Object.keys(state).sort().join() !== STATE_KEYS || state.schema !== IMPORT_INDEX_STATE_SCHEMA) return undefined;
  if (![state.cutoverAt, state.firstIndexedWriteAt, state.legacyRetiredAt].every(isTime)) return undefined;
  return modeFieldsValid({ state }) ? state as ImportIndexState : undefined;
}

export function readIndexState({ file, readJson }: {
  file: string; readJson: (required: { file: string }, optional?: Record<string, never>) => JsonFileRead;
}, _optional: Record<string, never> = {}): ImportIndexStateRead {
  const read = readJson({ file }, {});
  if (read.state === 'missing') return { kind: 'missing' };
  // Unreadable or malformed state might have said "indexed", so it is never repaired or set aside here.
  const state = read.state === 'ok' ? parseIndexState({ value: read.value }) : undefined;
  return state === undefined ? { kind: 'invalid' } : { kind: 'valid', state };
}

/** `writeJson` must replace the file atomically in private mode (temp file, fsync, rename, directory flush). */
export function writeIndexState({ file, writeJson, state }: {
  file: string; state: ImportIndexState; writeJson: (required: { file: string; value: unknown }, optional?: Record<string, never>) => void;
}, _optional: Record<string, never> = {}): void {
  // Publishing a shape readIndexState rejects would refuse every later open.
  if (parseIndexState({ value: state }) === undefined) throw new TypeError('Refusing to write an invalid import index state.');
  writeJson({ file, value: state }, {});
}

/** The owned handle `openExisting` returns: the existing-only, schema-validated DB plus its closer. */
export interface ImportIndexModeHandle {
  db: SqliteSyncClient;
  close(required: Record<string, never>, optional?: Record<string, never>): void;
}
export type ModeEvidence = { dbArtifactsPresent: boolean; indexedWitnessPresent: boolean };
export type RetryReason = 'missing' | 'damaged' | 'mismatch';

export interface ResolveModeArgs<H extends ImportIndexModeHandle> {
  state: ImportIndexStateRead;
  /** Fixed-path probes only (DB, -wal, -shm; the witness), never a root enumeration. */
  evidence: ModeEvidence;
  /** `read` never writes state, backfills, quarantines or creates a DB; `locked` runs under the workspace lock. */
  access: 'read' | 'locked';
  policy: Pick<ImportHistoryPolicy, 'cutoverPolicy'>;
  /** Opens the existing DB only (`fileMustExist`); throws `ENOENT` when the main file is absent. */
  openExisting: (required: { readonly: boolean }, optional?: Record<string, never>) => H;
  writeState: (required: { state: ImportIndexState }, optional?: Record<string, never>) => void;
  backfill: (required: Record<string, never>, optional?: Record<string, never>) => BackfillResult;
  /** Preserves (moves aside, never deletes) untrusted DB artifacts before legacy takes authority back. */
  prepareRetry: (required: { reason: RetryReason }, optional?: Record<string, never>) => void;
  log: (required: { message: string }, optional?: Record<string, never>) => void;
}
export type ResolvedMode<H extends ImportIndexModeHandle> =
  | { mode: 'legacy' }
  | { mode: 'cutover'; state: CutoverIndexState; handle: H }
  | { mode: 'indexed'; state: IndexedIndexState; handle: H }
  | { mode: 'refused'; error: ImportHistoryUnavailable };

type Opened<H> = { kind: 'ok'; handle: H } | { kind: 'untrusted'; reason: RetryReason; error?: ImportHistoryUnavailable } | { kind: 'refused'; error: ImportHistoryUnavailable };
const LEGACY = { mode: 'legacy' } as const;
const SQLITE_MESSAGES = {
  busy: 'Import history is busy. Try again in a moment.',
  storage: 'There is not enough free disk space to record the import. Free up space and try again.',
  damaged: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.',
};

function classifyOpenError<H>({ error }: { error: unknown }): Opened<H> {
  if ((error as { code?: string } | null)?.code === 'ENOENT') return { kind: 'untrusted', reason: 'missing' };
  let mapped: unknown = error;
  try { mapSqliteError({ error, messages: SQLITE_MESSAGES }); } catch (thrown) { mapped = thrown; }
  if (!(mapped instanceof ImportHistoryUnavailable)) throw error;
  if (mapped.code === 'IMPORT_HISTORY_DAMAGED') return { kind: 'untrusted', reason: 'damaged', error: mapped };
  if (mapped.code === 'IMPORT_HISTORY_NEWER') return { kind: 'refused', error: mapped };
  // Busy and out-of-space are transient: thrown, so the host neither repairs nor latches a refusal.
  throw mapped;
}

const metaValue = ({ db, key }: { db: SqliteSyncClient; key: string }) => db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?').get(key)?.value;

function openChecked<H extends ImportIndexModeHandle>({ args, state }: { args: ResolveModeArgs<H>; state: CutoverIndexState | IndexedIndexState }): Opened<H> {
  // Opening a DB that is not there could create an empty one, so missing evidence never opens.
  if (!args.evidence.dbArtifactsPresent) return { kind: 'untrusted', reason: 'missing' };
  let handle: H;
  try { handle = args.openExisting({ readonly: args.access === 'read' }, {}); } catch (error) { return classifyOpenError({ error }); }
  try {
    // db_id ties the DB to this workspace; cutover_at ties it to this cutover, so a copied or older DB is refused.
    if (metaValue({ db: handle.db, key: 'db_id' }) === state.dbId && metaValue({ db: handle.db, key: 'cutover_at' }) === String(state.cutoverAt)) return { kind: 'ok', handle };
    handle.close({}, {});
    return { kind: 'untrusted', reason: 'mismatch' };
  } catch (error) {
    try { handle.close({}, {}); } catch {}
    return classifyOpenError({ error });
  }
}

function resolveLegacy<H extends ImportIndexModeHandle>({ args, publishLegacy, allowBackfill }: { args: ResolveModeArgs<H>; publishLegacy: boolean; allowBackfill: boolean }): ResolvedMode<H> {
  if (args.access === 'read' || args.policy.cutoverPolicy === 'rollback' || !allowBackfill) return LEGACY;
  // Explicit legacy before any candidate open lets a later open tell an interrupted first backfill
  // (legacy state + DB artifacts) from lost state (no state + DB artifacts, which is refused).
  if (publishLegacy) args.writeState({ state: legacyState() }, {});
  const result = args.backfill({}, {});
  if (result.state === 'blocked') return LEGACY;
  // The SQL marker proves a complete candidate; authority moves only with this later state publish.
  const cutover: CutoverIndexState = { schema: IMPORT_INDEX_STATE_SCHEMA, mode: 'cutover', dbId: result.dbId, cutoverAt: result.cutoverAt, firstIndexedWriteAt: 0, legacyRetiredAt: 0 };
  args.writeState({ state: cutover }, {});
  // The backfill just committed the DB, so the earlier probe is stale; a failed check must not rebuild in a loop.
  return resolveCutover({ args: { ...args, evidence: { ...args.evidence, dbArtifactsPresent: true } }, state: cutover, allowBackfill: false });
}

function resolveCutover<H extends ImportIndexModeHandle>({ args, state, allowBackfill }: { args: ResolveModeArgs<H>; state: CutoverIndexState; allowBackfill: boolean }): ResolvedMode<H> {
  const opened = openChecked({ args, state });
  if (opened.kind === 'refused') return { mode: 'refused', error: opened.error };
  if (opened.kind === 'ok') {
    if (args.policy.cutoverPolicy === 'enable') return { mode: 'cutover', state, handle: opened.handle };
    opened.handle.close({}, {});
    // Pre-write rollback: the DB still equals the JSON, but JSON may be written only once legacy authority is durable.
    if (args.access === 'locked') args.writeState({ state: legacyState() }, {});
    return LEGACY;
  }
  // Before the first indexed write a missing, damaged or foreign DB leaves legacy authoritative.
  // Pending owner stages live in payloads/, which nothing here touches, so owner setup still completes.
  if (args.access === 'read') return LEGACY;
  args.prepareRetry({ reason: opened.reason }, {});
  args.writeState({ state: legacyState() }, {});
  return resolveLegacy({ args, publishLegacy: false, allowBackfill });
}

function resolveIndexed<H extends ImportIndexModeHandle>({ args, state }: { args: ResolveModeArgs<H>; state: IndexedIndexState }): ResolvedMode<H> {
  if (args.policy.cutoverPolicy === 'rollback') args.log({ message: 'Rollback is not possible after the first indexed import write; the index-aware store stays in use.' }, {});
  const opened = openChecked({ args, state });
  if (opened.kind === 'ok') return { mode: 'indexed', state, handle: opened.handle };
  if (opened.kind === 'refused') return { mode: 'refused', error: opened.error };
  // Never fall back to legacy: the snapshot lacks post-cutover rows and fences, so it would admit duplicates.
  return { mode: 'refused', error: opened.reason === 'damaged' && opened.error !== undefined ? opened.error : importHistoryMissing({}) };
}

/** Picks the authority for one lock acquisition (or one lock-free read). The host latches a refusal. */
export function resolveMode<H extends ImportIndexModeHandle>(args: ResolveModeArgs<H>, _optional: Record<string, never> = {}): ResolvedMode<H> {
  const { state, evidence } = args;
  if (state.kind === 'invalid') return { mode: 'refused', error: importHistoryMissing({}) };
  if (state.kind === 'missing') {
    // DB artifacts or a witness without a state file means the state was lost, not that history never existed.
    if (evidence.dbArtifactsPresent || evidence.indexedWitnessPresent) return { mode: 'refused', error: importHistoryMissing({}) };
    return resolveLegacy({ args, publishLegacy: true, allowBackfill: true });
  }
  if (state.state.mode === 'indexed') return resolveIndexed({ args, state: state.state });
  // The witness is written only after state says indexed, so beside an earlier mode it proves the state went backwards.
  if (evidence.indexedWitnessPresent) return { mode: 'refused', error: importHistoryMissing({}) };
  return state.state.mode === 'cutover' ? resolveCutover({ args, state: state.state, allowBackfill: true }) : resolveLegacy({ args, publishLegacy: false, allowBackfill: true });
}

/** Throws unless a legacy JSON put is allowed under the current lock. */
export function confirmLegacyAuthority({ state, evidence }: { state: ImportIndexStateRead; evidence: ModeEvidence }, _optional: Record<string, never> = {}): void {
  const legacy = state.kind === 'missing' ? !evidence.dbArtifactsPresent : state.kind === 'valid' && state.state.mode === 'legacy';
  if (!legacy || evidence.indexedWitnessPresent) throw importHistoryMissing({});
}

/**
 * The write fence, called before every indexed SQL mutation (admission, recovery/expiry put,
 * ordinary put). State is durably indexed first, then the witness exists, and only then may SQL run;
 * a throw from either step means no SQL. A crash after the fence but before SQL only closes the
 * legacy fallback early, which is the conservative direction.
 */
export function markIndexedWrite({ state, clock, writeState, ensureIndexedWitness }: {
  state: ImportIndexState; clock: { nowMs(): number };
  writeState: (required: { state: ImportIndexState }, optional?: Record<string, never>) => void;
  ensureIndexedWitness: (required: Record<string, never>, optional?: Record<string, never>) => void;
}, _optional: Record<string, never> = {}): ImportIndexState {
  if (state.mode === 'legacy') throw new TypeError('An indexed write needs cutover or indexed authority; legacy writes go to the JSON snapshot.');
  if (state.mode === 'indexed') {
    // Re-establishes a lost witness; resolveMode already validated the DB under this lock.
    ensureIndexedWitness({}, {});
    return state;
  }
  const next: IndexedIndexState = { ...state, mode: 'indexed', firstIndexedWriteAt: clock.nowMs() };
  writeState({ state: next }, {});
  ensureIndexedWitness({}, {});
  return next;
}

export type IndexedWitnessFs = Pick<ImportPayloadFs, 'writeExclusive' | 'kind' | 'fsyncFile' | 'fsyncDir'>;

/** Creates `<root>/.history-indexed-v1` exclusively at 0600, fsyncs it, flushes the root. Monotonic: never retired. */
export function writeIndexedWitness({ root, fs }: { root: string; fs: IndexedWitnessFs }, _optional: Record<string, never> = {}): void {
  const file = indexStatePaths({ root }).witness;
  try { fs.writeExclusive({ file, mode: 0o600 }, {}); } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'EEXIST' || fs.kind({ file }, {}) !== 'file') throw error;
  }
  fs.fsyncFile({ file }, {});
  fs.fsyncDir({ dir: root }, {});
}

export interface LegacyRetireFs {
  readdir(required: { dir: string }, optional?: Record<string, never>): string[];
  /** No-follow (lstat) inspection. */
  stat(required: { file: string }, optional?: Record<string, never>): { kind: 'file' | 'directory' | 'symlink' | 'other' | 'missing'; mtimeMs: number };
  /** Removes one file; never recursive. */
  unlink(required: { file: string }, optional?: Record<string, never>): void;
}

function classifyHistoryFiles({ root, fs, cutoverAt }: { root: string; fs: LegacyRetireFs; cutoverAt: number }) {
  const eligible: string[] = [];
  let newer = 0;
  for (const name of fs.readdir({ dir: root }, {})) {
    // Only snapshot records match; state, witness, DB artifacts and payloads/ never do.
    if (!HISTORY_FILE.test(name)) continue;
    const stat = fs.stat({ file: `${root}/${name}` }, {});
    if (stat.kind !== 'file') continue;
    // A newer file can only come from a pre-index build after a downgrade, so it may be the only copy.
    if (stat.mtimeMs > cutoverAt) newer++;
    else eligible.push(`${root}/${name}`);
  }
  return { eligible, newer };
}

function unlinkBatch({ fs, files }: { fs: LegacyRetireFs; files: string[] }) {
  let removed = 0; let gone = 0;
  for (const file of files) {
    try { fs.unlink({ file }, {}); removed++; } catch (error) {
      // Already gone counts as done; any other failure stays for the next tidy.
      if ((error as { code?: string } | null)?.code === 'ENOENT') gone++;
    }
  }
  return { removed, failed: files.length - removed - gone };
}

/**
 * Tidy-only retention (owner-decided, no approval card): in indexed mode, from `cutoverAt +
 * legacyRetireMs`, deletes at most 200 old regular snapshot files per pass. `legacyRetiredAt` is
 * set only once no eligible file remains, so a partial or failed pass resumes on the next tidy.
 */
export function retireLegacySnapshot({ root, state, clock, policy, fs, writeState, log }: {
  root: string; state: ImportIndexState; clock: { nowMs(): number }; policy: Pick<ImportHistoryPolicy, 'legacyRetireMs'>; fs: LegacyRetireFs;
  writeState: (required: { state: ImportIndexState }, optional?: Record<string, never>) => void;
  log: (required: { message: string }, optional?: Record<string, never>) => void;
}, _optional: Record<string, never> = {}): { removed: number; finished: boolean } {
  // Cutover still lets legacy take authority back, so the snapshot must survive until indexed.
  if (state.mode !== 'indexed') return { removed: 0, finished: false };
  if (state.legacyRetiredAt !== 0) return { removed: 0, finished: true };
  const now = clock.nowMs();
  if (now < state.cutoverAt + policy.legacyRetireMs) return { removed: 0, finished: false };
  const { eligible, newer } = classifyHistoryFiles({ root, fs, cutoverAt: state.cutoverAt });
  if (newer > 0) log({ message: `Kept ${newer} import history files written after the switch to indexed history.` }, {});
  const batch = eligible.slice(0, RETIRE_BATCH);
  const { removed, failed } = unlinkBatch({ fs, files: batch });
  if (failed > 0) log({ message: `${failed} old import history files could not be removed; tidy will retry.` }, {});
  const finished = failed === 0 && batch.length === eligible.length;
  if (finished) writeState({ state: { ...state, legacyRetiredAt: now } }, {});
  return { removed, finished };
}
