import type { ImportHistoryPolicy, SiteImportRecord, SiteImportStatus } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { assertTransition, isTerminal, minimalOutcome, toRowParams } from './rows.js';

export interface ImportIndexStore {
  get(required: { importId: string; principalId: string }, optional?: Record<string, never>): SiteImportRecord | undefined;
  statusOf(required: { importId: string }, optional?: Record<string, never>): SiteImportStatus | undefined;
  activeRows(required: Record<string, never>, optional?: Record<string, never>): SiteImportRecord[];
  dueOwnerSetups(required: { now: number }, optional?: Record<string, never>): SiteImportRecord[];
  put(required: { row: SiteImportRecord; beforeWrite: (required: Record<string, never>, optional?: Record<string, never>) => void }, optional?: Record<string, never>): void;
}

export function createImportIndexStore({ db, clock, policy: _policy }: { db: SqliteSyncClient; clock: { nowMs(): number }; policy: ImportHistoryPolicy }, _optional: Record<string, never> = {}): ImportIndexStore {
  return {
    get({ importId, principalId }, _optional = {}) {
      const result = db.prepare<[string, string], { row_json: string }>('SELECT row_json FROM imports WHERE import_id = ? AND principal_id = ?').get(importId, principalId);
      return result === undefined ? undefined : JSON.parse(result.row_json) as SiteImportRecord;
    },
    statusOf({ importId }, _optional = {}) {
      return db.prepare<[string], { status: SiteImportStatus }>('SELECT status FROM imports WHERE import_id = ?').get(importId)?.status;
    },
    activeRows(_required, _optional = {}) {
      return db.prepare<[], { row_json: string }>("SELECT row_json FROM imports WHERE status IN ('verifying','creating')").all().map(row => JSON.parse(row.row_json) as SiteImportRecord);
    },
    dueOwnerSetups({ now }, _optional = {}) {
      return db.prepare<[number], { row_json: string }>("SELECT row_json FROM imports WHERE status = 'needs-owner' AND expires_ms < ?").all(now).map(row => JSON.parse(row.row_json) as SiteImportRecord);
    },
    put({ row, beforeWrite }, _optional = {}) {
      db.transaction(() => {
        const prior = db.prepare<[string], { row_json: string; settled_ms: number | null }>('SELECT row_json, settled_ms FROM imports WHERE import_id = ?').get(row.importId);
        assertTransition({ previous: prior === undefined ? undefined : JSON.parse(prior.row_json) as SiteImportRecord, row });
        beforeWrite({}, {});
        // Settlement and acceptance are distinct clocks.
        const settledMs = prior?.settled_ms ?? (isTerminal(row) ? clock.nowMs() : null);
        const params = toRowParams({ row, settledMs });
        // A ready row and its fence commit together.
        db.prepare<typeof params>('INSERT INTO imports(import_id,principal_id,request_id,status,created_ms,settled_ms,expires_ms,row_json) VALUES(@importId,@principalId,@requestId,@status,@createdMs,@settledMs,@expiresMs,@rowJson) ON CONFLICT(import_id) DO UPDATE SET status=excluded.status, settled_ms=COALESCE(imports.settled_ms,excluded.settled_ms), expires_ms=excluded.expires_ms, row_json=excluded.row_json').run(params);
        if (row.requestId !== undefined) db.prepare('UPDATE replay SET outcome_json = ? WHERE principal_id = ? AND request_id = ? AND import_id = ?').run(JSON.stringify(minimalOutcome({ row })), row.principalId, row.requestId, row.importId);
      }).immediate();
    },
  };
}
