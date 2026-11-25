import type { JsonFileRead } from '@jini-ai/core/contracts/site/fs-durable-json';
import { SiteShareRefusal } from '../share-refusal.js';
import { ImportHistoryUnavailable } from './errors.js';

export interface ImportPayloadFs {
  readdir(required: { dir: string }, optional?: Record<string, never>): string[];
  kind(required: { file: string }, optional?: Record<string, never>): 'file' | 'directory' | 'other' | 'missing';
  rename(required: { from: string; to: string }, optional?: Record<string, never>): void;
  rm(required: { file: string; recursive: boolean }, optional?: Record<string, never>): void;
  mkdir(required: { dir: string; mode: number }, optional?: Record<string, never>): void;
  chmod(required: { file: string; mode: number }, optional?: Record<string, never>): void;
  writeExclusive(required: { file: string; mode: number }, optional?: Record<string, never>): void;
  fsyncFile(required: { file: string }, optional?: Record<string, never>): void;
  fsyncDir(required: { dir: string }, optional?: Record<string, never>): void;
}

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const ID = new RegExp(`^${UUID}$`);
const PAYLOAD = new RegExp(`^(${UUID})(\\.upload\\.zip|\\.upload\\.json|\\.stage)$`);
const UNMOVABLE = 'Imports are paused because the app could not move its import files. Check that the app can write to its data folder, then try again.';

export function payloadPaths({ root }: { root: string }, _optional: Record<string, never> = {}) {
  const dir = `${root}/payloads`;
  return {
    dir, marker: `${dir}/.namespace-v1`,
    upload: ({ uploadId }: { uploadId: string }, _optional: Record<string, never> = {}) => {
      if (!ID.test(uploadId)) throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Invalid import or upload id.' });
      return `${dir}/${uploadId}.upload.zip`;
    },
    uploadMeta: ({ uploadId }: { uploadId: string }, _optional: Record<string, never> = {}) => {
      if (!ID.test(uploadId)) throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Invalid import or upload id.' });
      return `${dir}/${uploadId}.upload.json`;
    },
    stage: ({ importId }: { importId: string }, _optional: Record<string, never> = {}) => {
      if (!ID.test(importId)) throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Invalid import or upload id.' });
      return `${dir}/${importId}.stage`;
    },
  };
}

function classifyPayload({ name }: { name: string }, _optional: Record<string, never> = {}) {
  const match = PAYLOAD.exec(name);
  if (!match) return undefined;
  return { id: match[1]!, suffix: match[2]!, kind: match[2] === '.stage' ? 'directory' as const : 'file' as const };
}

function movePayload({ from, to, kind, fs }: { from: string; to: string; kind: 'file' | 'directory'; fs: ImportPayloadFs }, _optional: Record<string, never> = {}): void {
  const destination = fs.kind({ file: to });
  if (destination === 'missing') {
    // Atomic rename is same-volume; directory fsync has platform limits.
    fs.rename({ from, to });
    return;
  }
  if (destination !== kind) throw new ImportHistoryUnavailable({ code: 'IMPORT_PAYLOADS_UNMOVABLE', status: 503, message: UNMOVABLE });
  fs.rm({ file: from, recursive: kind === 'directory' });
}

function movePass({ root, paths, fs, names, suffix }: { root: string; paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs; names: string[]; suffix: string }, _optional: Record<string, never> = {}): void {
  for (const name of names) {
    const entry = classifyPayload({ name });
    if (!entry || entry.suffix !== suffix) continue;
    const from = `${root}/${name}`;
    if (fs.kind({ file: from }) !== entry.kind) continue;
    movePayload({ from, to: `${paths.dir}/${name}`, kind: entry.kind, fs });
  }
}

function writeMarker({ paths, fs }: { paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs }, _optional: Record<string, never> = {}): void {
  try { fs.writeExclusive({ file: paths.marker, mode: 0o600 }); }
  catch (error) {
    if ((error as { code?: string } | null)?.code !== 'EEXIST' || fs.kind({ file: paths.marker }) !== 'file') throw error;
  }
  fs.fsyncFile({ file: paths.marker });
  fs.fsyncDir({ dir: paths.dir });
}

function ensurePayloadDirectory({ paths, fs }: { paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs }, _optional: Record<string, never> = {}): void {
  const directory = fs.kind({ file: paths.dir });
  if (directory === 'missing') fs.mkdir({ dir: paths.dir, mode: 0o700 });
  else if (directory !== 'directory') throw new ImportHistoryUnavailable({ code: 'IMPORT_PAYLOADS_UNMOVABLE', status: 503, message: UNMOVABLE });
  fs.chmod({ file: paths.dir, mode: 0o700 });
}

// Permission and disk-full failures get plain-words, retryable errors; anything else is a real bug and passes through.
function namespaceFailure({ error }: { error: unknown }, _optional: Record<string, never> = {}): unknown {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'EACCES' || code === 'EPERM') return new ImportHistoryUnavailable({ code: 'IMPORT_PAYLOADS_UNMOVABLE', status: 503, message: UNMOVABLE }, { cause: error });
  if (code === 'ENOSPC') return new ImportHistoryUnavailable({ code: 'IMPORT_PAYLOADS_UNMOVABLE', status: 507, message: 'There is not enough free disk space to prepare imports. Free up space and try again.' }, { cause: error });
  return error;
}

export function ensurePayloadNamespace({ root, paths, fs }: { root: string; paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs }, _optional: Record<string, never> = {}): void {
  try {
    // The marker makes root enumeration a one-time migration cost.
    const marker = fs.kind({ file: paths.marker });
    if (marker === 'file') return;
    if (marker !== 'missing') throw new ImportHistoryUnavailable({ code: 'IMPORT_PAYLOADS_UNMOVABLE', status: 503, message: UNMOVABLE });
    ensurePayloadDirectory({ paths, fs });
    const names = fs.readdir({ dir: root });
    // ZIP precedes metadata on write and on migration.
    for (const suffix of ['.upload.zip', '.upload.json', '.stage']) movePass({ root, paths, fs, names, suffix });
    fs.fsyncDir({ dir: paths.dir });
    fs.fsyncDir({ dir: root });
    writeMarker({ paths, fs });
  } catch (error) {
    throw namespaceFailure({ error });
  }
}

type PayloadEntry = NonNullable<ReturnType<typeof classifyPayload>>;
type ExpireReaders = {
  readUpload: (required: { uploadId: string }, optional?: Record<string, never>) => JsonFileRead;
  statusOf: (required: { importId: string }, optional?: Record<string, never>) => 'active' | 'terminal' | 'unreadable' | 'absent';
};

// Removes a stage no in-progress record owns; an unreadable record keeps its stage untouched.
function expireStage({ entry, paths, fs, statusOf }: { entry: PayloadEntry; paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs; statusOf: ExpireReaders['statusOf'] }, _optional: Record<string, never> = {}): void {
  // An unreadable owner is not evidence that its stage is orphaned.
  const status = statusOf({ importId: entry.id });
  if (status === 'terminal' || status === 'absent') fs.rm({ file: paths.stage({ importId: entry.id }), recursive: true });
}

// A zip whose metadata is missing or unreadable is an orphan (a crash between the two writes), so it expires at once;
// otherwise it expires only past its one-hour claim window. A metadata file we cannot read is kept, never guessed at.
function isUploadExpired({ entry, read, now }: { entry: PayloadEntry; read: JsonFileRead; now: number }, _optional: Record<string, never> = {}): boolean {
  if (entry.suffix === '.upload.json' && read.state !== 'ok') return false;
  const metadata = read.state === 'ok' ? read.value as { createdAt: number } | null : null;
  return metadata === null || metadata.createdAt + 3_600_000 < now;
}

// Removes an upload (payload, then record) once it is past its one-hour claim window.
// Removes a zip whose metadata is missing or unreadable: a crash between the two writes.
function expireUpload({ entry, paths, fs, now, readUpload }: { entry: PayloadEntry; paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs; now: number; readUpload: ExpireReaders['readUpload'] }, _optional: Record<string, never> = {}): void {
  if (!isUploadExpired({ entry, read: readUpload({ uploadId: entry.id }), now })) return;
  const zip = paths.upload({ uploadId: entry.id });
  if (fs.kind({ file: zip }) === 'file') fs.rm({ file: zip, recursive: false });
  if (entry.suffix === '.upload.json') fs.rm({ file: paths.uploadMeta({ uploadId: entry.id }), recursive: false });
}

export function expirePayloads({ paths, fs, clock, readUpload, statusOf, report }: {
  paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs; clock: { nowMs(): number };
  report: (required: { operation: string; error: unknown }, optional?: Record<string, never>) => void;
} & ExpireReaders, _optional: Record<string, never> = {}): void {
  const now = clock.nowMs();
  for (const name of fs.readdir({ dir: paths.dir })) {
    const entry = classifyPayload({ name });
    if (!entry) continue;
    try {
      if (fs.kind({ file: `${paths.dir}/${name}` }) !== entry.kind) continue;
      if (entry.suffix === '.stage') expireStage({ entry, paths, fs, statusOf });
      else expireUpload({ entry, paths, fs, now, readUpload });
    } catch (error) { report({ operation: 'expire-import-payload', error }); }
  }
}

export function countStagedPayloads({ paths, fs }: { paths: ReturnType<typeof payloadPaths>; fs: ImportPayloadFs }, _optional: Record<string, never> = {}): number {
  return fs.readdir({ dir: paths.dir }).filter(name => {
    const entry = classifyPayload({ name });
    return entry !== undefined && entry.suffix !== '.upload.json' && fs.kind({ file: `${paths.dir}/${name}` }) === entry.kind;
  }).length;
}
