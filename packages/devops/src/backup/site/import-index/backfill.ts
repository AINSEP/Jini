import type { ImportHistoryPolicy, SiteImportRecord } from '@jini-ai/core/contracts/site/site-import-history';
import type { JsonFileRead } from '@jini-ai/core/contracts/site/fs-durable-json';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { isTerminal, minimalOutcome, replayFenceFor, toRowParams } from './rows.js';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export type BackfillResult = { state: 'blocked' } | { state: 'cutover'; dbId: string; cutoverAt: number; backfillCount: number };

function identityChecks({ row, id }: { row: SiteImportRecord; id: string }, _optional: Record<string, never> = {}): boolean[] {
  return [
    ID.test(row.importId), row.importId === id, typeof row.principalId === 'string', /\S/.test(row.principalId),
    ['verifying', 'needs-owner', 'creating', 'ready', 'failed'].includes(row.status),
    typeof row.createdAt === 'string', Number.isFinite(Date.parse(row.createdAt)), Number.isSafeInteger(row.expiresAt),
  ];
}

// Optional fields only have to be well formed when they are present.
function optionalFieldChecks({ row }: { row: SiteImportRecord }, _optional: Record<string, never> = {}): boolean[] {
  return [
    row.requestId === undefined ? true : [typeof row.requestId === 'string', /^[a-zA-Z0-9_-]{1,128}$/.test(row.requestId)].every(Boolean),
    row.sourceDigest === undefined ? true : [typeof row.sourceDigest === 'string', /^[a-fA-F0-9]{64}$/.test(row.sourceDigest)].every(Boolean),
    row.status === 'creating' ? (row.creation === undefined ? true : typeof row.creation?.siteId === 'string') : true,
  ];
}

// Returns undefined when the source is not even an object, or its link cannot be parsed: no check list can rescue that row.
function sourceChecks({ source }: { source: SiteImportRecord['source'] }, _optional: Record<string, never> = {}): boolean[] | undefined {
  if (Object.prototype.toString.call(source) !== '[object Object]') return undefined;
  const checks = [Object.keys(source).length === 1, ['url', 'uploadId'].filter(key => key in source).length === 1];
  if (!('url' in source)) return [...checks, typeof source.uploadId === 'string', ID.test(source.uploadId)];
  try {
    const url = new URL(source.url);
    return [...checks, typeof source.url === 'string', url.protocol === 'https:', url.username === '', url.password === '', url.hash === ''];
  } catch { return undefined; }
}

export function validateLegacyRow({ value, id }: { value: unknown; id: string }, _optional: Record<string, never> = {}): SiteImportRecord | undefined {
  if (Object.prototype.toString.call(value) !== '[object Object]') return undefined;
  const row = value as SiteImportRecord;
  const source = sourceChecks({ source: row.source });
  if (source === undefined) return undefined;
  return [...identityChecks({ row, id }), ...optionalFieldChecks({ row }), ...source].every(Boolean) ? row : undefined;
}

export function scanLegacy({ root, fs, readJson }: {
  root: string; fs: { readdir(required: { dir: string }, optional?: Record<string, never>): string[] };
  readJson: (required: { file: string }, optional?: Record<string, never>) => JsonFileRead;
}, _optional: Record<string, never> = {}) {
  const names = fs.readdir({ dir: root }, {}).filter(name => name.endsWith('.json') && ID.test(name.slice(0, -5)));
  const rows: SiteImportRecord[] = [];
  let unreadable = 0; let malformed = 0;
  for (let start = 0; start < names.length; start += 500) {
    for (const name of names.slice(start, start + 500)) {
      const read = readJson({ file: `${root}/${name}` }, {});
      // Bad JSON is evidence to preserve.
      if (read.state !== 'ok') { unreadable++; continue; }
      const row = validateLegacyRow({ value: read.value, id: name.slice(0, -5) });
      if (row === undefined) malformed++;
      else rows.push(row);
    }
  }
  return { rows, unreadable, malformed };
}

export function pickFenceOwners({ candidates }: { candidates: {
  principalId: string; requestId: string; fenceKind: 'sha256' | 'upload' | 'origin'; fenceValue: string; importId: string; acceptedMs: number; outcomeJson: string;
}[] }, _optional: Record<string, never> = {}) {
  // Newest-wins matches historical scan precedence and makes ties deterministic.
  const sorted = [...candidates].sort((a, b) => b.acceptedMs - a.acceptedMs || (a.importId < b.importId ? 1 : a.importId > b.importId ? -1 : 0));
  const owners = new Map<string, (typeof candidates)[number]>();
  for (const candidate of sorted) {
    const key = JSON.stringify([candidate.principalId, candidate.requestId]);
    if (!owners.has(key)) owners.set(key, candidate);
  }
  return [...owners.values()];
}

type FenceCandidate = Parameters<typeof pickFenceOwners>[0]['candidates'][number];

function fenceCandidateFor({ row, createdMs }: { row: SiteImportRecord; createdMs: number }, _optional: Record<string, never> = {}): FenceCandidate {
  return { principalId: row.principalId, requestId: row.requestId!, importId: row.importId, acceptedMs: createdMs, outcomeJson: JSON.stringify(minimalOutcome({ row })),
    ...replayFenceFor({ source: row.source, digest: row.sourceDigest }) };
}

export function deriveBackfillRows({ rows, now, policy }: { rows: SiteImportRecord[]; now: number; policy: ImportHistoryPolicy }, _optional: Record<string, never> = {}) {
  const detail: ReturnType<typeof toRowParams>[] = [];
  const candidates: FenceCandidate[] = [];
  for (const row of rows) {
    const createdMs = Date.parse(row.createdAt);
    const terminal = isTerminal(row);
    // Legacy has no settlement timestamp.
    if (!terminal || now < createdMs + policy.historyVisibleMs) detail.push(toRowParams({ row, settledMs: terminal ? createdMs : null }));
    if (row.requestId !== undefined && now < createdMs + policy.replayFenceMs) candidates.push(fenceCandidateFor({ row, createdMs }));
  }
  return { rows: detail, fences: pickFenceOwners({ candidates }) };
}

export function commitBackfill({ db, rows, fences, dbId, now }: {
  db: SqliteSyncClient; rows: ReturnType<typeof deriveBackfillRows>['rows']; fences: ReturnType<typeof deriveBackfillRows>['fences']; dbId: string; now: number;
}, _optional: Record<string, never> = {}): number {
  // One transaction makes the marker proof of a complete candidate.
  return db.transaction(() => {
    db.exec("DELETE FROM imports; DELETE FROM replay; DELETE FROM meta WHERE key='last_sweep_ms';");
    for (const row of rows) db.prepare<typeof row>('INSERT INTO imports(import_id,principal_id,request_id,status,created_ms,settled_ms,expires_ms,row_json) VALUES(@importId,@principalId,@requestId,@status,@createdMs,@settledMs,@expiresMs,@rowJson)').run(row);
    for (const fence of fences) db.prepare<typeof fence>('INSERT INTO replay(principal_id,request_id,fence_kind,fence_value,import_id,accepted_ms,outcome_json) VALUES(@principalId,@requestId,@fenceKind,@fenceValue,@importId,@acceptedMs,@outcomeJson)').run(fence);
    const count = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM imports').get()!.count;
    // Upserts cover both the schema row created by migration and all four meta rows left by a previously committed attempt.
    for (const [key, value] of [['db_id', dbId], ['cutover_at', String(now)], ['backfill_count', String(count)], ['schema', 'site-imports-v1']]) {
      db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    }
    return count;
  }).immediate();
}

export function backfillImportIndex({ root, fs, readJson, openCandidate, clock, policy, newDbId, log }: {
  root: string; fs: { readdir(required: { dir: string }, optional?: Record<string, never>): string[] };
  readJson: (required: { file: string }, optional?: Record<string, never>) => JsonFileRead;
  openCandidate: (required: Record<string, never>, optional?: Record<string, never>) => { db: SqliteSyncClient; close(required: Record<string, never>, optional?: Record<string, never>): void };
  clock: { nowMs(): number }; policy: ImportHistoryPolicy;
  newDbId: (required: Record<string, never>, optional?: Record<string, never>) => string;
  log: (required: { message: string; counts: Readonly<Record<string, number>> }, optional?: Record<string, never>) => void;
}, _optional: Record<string, never> = {}): BackfillResult {
  const scanned = scanLegacy({ root, fs, readJson });
  if (scanned.rows.length + scanned.unreadable + scanned.malformed > 20_000) log({ message: 'Import history contains more than 20,000 records.', counts: { records: scanned.rows.length + scanned.unreadable + scanned.malformed } }, {});
  if (scanned.unreadable + scanned.malformed > 0) {
    log({ message: 'An import record could not be read; imports keep using the old store until it is fixed.', counts: { unreadable: scanned.unreadable, malformed: scanned.malformed } }, {});
    return { state: 'blocked' };
  }
  const now = clock.nowMs();
  const derived = deriveBackfillRows({ rows: scanned.rows, now, policy });
  let candidate: ReturnType<typeof openCandidate> | undefined;
  try {
    candidate = openCandidate({}, {});
    const dbId = newDbId({}, {});
    const backfillCount = commitBackfill({ db: candidate.db, ...derived, dbId, now });
    return { state: 'cutover', dbId, cutoverAt: now, backfillCount };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== 'SQLITE_FULL' && code !== 'INSUFFICIENT_STORAGE') throw error;
    log({ message: 'INSUFFICIENT_STORAGE', counts: {} }, {});
    return { state: 'blocked' };
  } finally { candidate?.close({}, {}); }
}
