export class ImportHistoryUnavailable extends Error {
  readonly code: 'IMPORT_PAYLOADS_UNMOVABLE' | 'IMPORT_HISTORY_BUSY' | 'INSUFFICIENT_STORAGE' | 'IMPORT_HISTORY_DAMAGED' | 'IMPORT_HISTORY_NEWER';
  readonly status: 503 | 507;

  constructor({ code, status, message }: { code: ImportHistoryUnavailable['code']; status: 503 | 507; message: string }, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.name = 'ImportHistoryUnavailable';
    this.code = code;
    this.status = status;
  }
}

export function mapSqliteError({ error, messages }: { error: unknown; messages: { busy: string; storage: string; damaged: string } }, _optional: Record<string, never> = {}): never {
  if (error instanceof ImportHistoryUnavailable) throw error;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_BUSY', status: 503, message: messages.busy }, { cause: error });
  if (code === 'SQLITE_FULL' || code === 'ENOSPC') throw new ImportHistoryUnavailable({ code: 'INSUFFICIENT_STORAGE', status: 507, message: messages.storage }, { cause: error });
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'NOTADB') throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: messages.damaged }, { cause: error });
  throw error;
}
