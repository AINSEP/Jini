export class ImportHistoryUnavailable extends Error {
  readonly code: 'IMPORT_PAYLOADS_UNMOVABLE' | 'IMPORT_HISTORY_BUSY' | 'INSUFFICIENT_STORAGE' | 'IMPORT_HISTORY_DAMAGED' | 'IMPORT_HISTORY_NEWER' | 'IMPORT_HISTORY_MISSING';
  readonly status: 503 | 507;

  constructor({ code, status, message }: { code: ImportHistoryUnavailable['code']; status: 503 | 507; message: string }, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.name = 'ImportHistoryUnavailable';
    this.code = code;
    this.status = status;
  }
}

// One table instead of a branch per driver code keeps the mapping readable and every code visible at once.
const SQLITE_FAILURES: Readonly<Record<string, { code: ImportHistoryUnavailable['code']; status: 503 | 507; message: 'busy' | 'storage' | 'damaged' }>> = {
  SQLITE_BUSY: { code: 'IMPORT_HISTORY_BUSY', status: 503, message: 'busy' },
  SQLITE_LOCKED: { code: 'IMPORT_HISTORY_BUSY', status: 503, message: 'busy' },
  SQLITE_FULL: { code: 'INSUFFICIENT_STORAGE', status: 507, message: 'storage' },
  ENOSPC: { code: 'INSUFFICIENT_STORAGE', status: 507, message: 'storage' },
  SQLITE_CORRUPT: { code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'damaged' },
  SQLITE_NOTADB: { code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'damaged' },
  NOTADB: { code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'damaged' },
};

export function mapSqliteError({ error, messages }: { error: unknown; messages: { busy: string; storage: string; damaged: string } }, _optional: Record<string, never> = {}): never {
  if (error instanceof ImportHistoryUnavailable) throw error;
  const code = (error as { code?: string } | null)?.code;
  const failure = code !== undefined && Object.hasOwn(SQLITE_FAILURES, code) ? SQLITE_FAILURES[code] : undefined;
  if (failure !== undefined) throw new ImportHistoryUnavailable({ code: failure.code, status: failure.status, message: messages[failure.message] }, { cause: error });
  throw error;
}

/**
 * The fail-closed refusal for lost import-history authority: a missing or mismatched DB after an
 * indexed write, or a missing/unreadable index state that other evidence says once existed. Imports
 * stop instead of reopening the JSON snapshot, which lacks every post-cutover row and request fence.
 */
export function importHistoryMissing(_required: Record<string, never>, { cause }: { cause?: unknown } = {}): ImportHistoryUnavailable {
  return new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_MISSING', status: 503, message: 'Import history is missing, so imports are paused to avoid creating the same site twice. Nothing was changed. Contact support with this error ID.' }, { cause });
}
