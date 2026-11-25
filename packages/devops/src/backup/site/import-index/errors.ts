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

/**
 * The fail-closed refusal for lost import-history authority: a missing or mismatched DB after an
 * indexed write, or a missing/unreadable index state that other evidence says once existed. Imports
 * stop instead of reopening the JSON snapshot, which lacks every post-cutover row and request fence.
 */
export function importHistoryMissing(_required: Record<string, never>, { cause }: { cause?: unknown } = {}): ImportHistoryUnavailable {
  return new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_MISSING', status: 503, message: 'Import history is missing, so imports are paused to avoid creating the same site twice. Nothing was changed. Contact support with this error ID.' }, { cause });
}

export function mapSqliteError({ error, messages }: { error: unknown; messages: { busy: string; storage: string; damaged: string } }, _optional: Record<string, never> = {}): never {
  if (error instanceof ImportHistoryUnavailable) throw error;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_BUSY', status: 503, message: messages.busy }, { cause: error });
  if (code === 'SQLITE_FULL' || code === 'ENOSPC') throw new ImportHistoryUnavailable({ code: 'INSUFFICIENT_STORAGE', status: 507, message: messages.storage }, { cause: error });
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'NOTADB') throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: messages.damaged }, { cause: error });
  throw error;
}
