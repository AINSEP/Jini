import type { ImportHistoryPolicy, MinimalImportOutcome, SiteImportRecord, SiteImportSource } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { SiteShareRefusal } from '../share-refusal.js';
import { minimalOutcome, replayFenceFor, toRowParams } from './rows.js';

export function lookupFence({ db, policy, principalId, requestId, now }: { db: SqliteSyncClient; policy: ImportHistoryPolicy; principalId: string; requestId: string; now: number }, _optional: Record<string, never> = {}) {
  // A fence outlives detail.
  return db.prepare<[string, string, number], { principal_id: string; request_id: string; fence_kind: 'sha256' | 'upload' | 'origin'; fence_value: string; import_id: string; accepted_ms: number; outcome_json: string }>('SELECT principal_id, request_id, fence_kind, fence_value, import_id, accepted_ms, outcome_json FROM replay WHERE principal_id = ? AND request_id = ? AND accepted_ms > ?').get(principalId, requestId, now - policy.replayFenceMs);
}

export function sameFence({ fence, source, digestSource }: {
  fence: NonNullable<ReturnType<typeof lookupFence>>; source: SiteImportSource;
  digestSource: (required: { source: SiteImportSource }, optional?: Record<string, never>) => string | undefined;
}, _optional: Record<string, never> = {}): boolean {
  if (fence.fence_kind === 'upload') return 'uploadId' in source && source.uploadId === fence.fence_value;
  if (!('url' in source)) return false;
  if (fence.fence_kind === 'origin') return new URL(source.url).origin === fence.fence_value;
  return digestSource({ source }, {})?.toLowerCase() === fence.fence_value;
}

type Admission = { kind: 'replay'; row: SiteImportRecord } | { kind: 'replay'; outcome: MinimalImportOutcome } | { kind: 'admitted'; row: SiteImportRecord };

function replayFromFence({ db, policy, principalId, fence, now }: { db: SqliteSyncClient; policy: ImportHistoryPolicy; principalId: string; fence: NonNullable<ReturnType<typeof lookupFence>>; now: number }, _optional: Record<string, never> = {}): Admission {
  const detail = db.prepare<[string, string, number], { row_json: string }>('SELECT row_json FROM imports WHERE import_id = ? AND principal_id = ? AND (settled_ms IS NULL OR settled_ms > ?)').get(fence.import_id, principalId, now - policy.historyVisibleMs);
  if (detail !== undefined) return { kind: 'replay' as const, row: JSON.parse(detail.row_json) as SiteImportRecord };
  return { kind: 'replay' as const, outcome: JSON.parse(fence.outcome_json) as MinimalImportOutcome };
}

function recordFence({ db, policy, principalId, requestId, source, digest, row, now }: { db: SqliteSyncClient; policy: ImportHistoryPolicy; principalId: string; requestId: string; source: SiteImportSource; digest: string | undefined; row: SiteImportRecord; now: number }, _optional: Record<string, never> = {}): void {
  db.prepare('DELETE FROM replay WHERE principal_id = ? AND request_id = ? AND accepted_ms <= ?').run(principalId, requestId, now - policy.replayFenceMs);
  const params = { principalId, requestId, ...replayFenceFor({ source, digest }), importId: row.importId, acceptedMs: now, outcomeJson: JSON.stringify(minimalOutcome({ row })) };
  db.prepare<typeof params>('INSERT INTO replay(principal_id,request_id,fence_kind,fence_value,import_id,accepted_ms,outcome_json) VALUES(@principalId,@requestId,@fenceKind,@fenceValue,@importId,@acceptedMs,@outcomeJson)').run(params);
}

export function admitImport({ db, clock, policy, principalId, requestId, source, digestSource, requireBudget, makeRow, beforeWrite }: {
  db: SqliteSyncClient; clock: { nowMs(): number }; policy: ImportHistoryPolicy; principalId: string; requestId?: string | undefined; source: SiteImportSource;
  digestSource: (required: { source: SiteImportSource }, optional?: Record<string, never>) => string | undefined;
  requireBudget: (required: Record<string, never>, optional?: Record<string, never>) => void;
  makeRow: (required: { now: number }, optional?: Record<string, never>) => SiteImportRecord;
  beforeWrite: (required: Record<string, never>, optional?: Record<string, never>) => void;
}, _optional: Record<string, never> = {}): Admission {
  const now = clock.nowMs();
  return db.transaction((): Admission => {
    const fence = requestId === undefined ? undefined : lookupFence({ db, policy, principalId, requestId, now });
    if (fence !== undefined) {
      if (!sameFence({ fence, source, digestSource })) throw new SiteShareRefusal({ code: 'REQUEST_CONFLICT', message: 'requestId already belongs to another source.' });
      return replayFromFence({ db, policy, principalId, fence, now });
    }
    requireBudget({}, {});
    beforeWrite({}, {});
    const row = makeRow({ now }, {});
    if (requestId !== undefined) recordFence({ db, policy, principalId, requestId, source, digest: digestSource({ source }, {}), row, now });
    const params = toRowParams({ row, settledMs: null });
    db.prepare<typeof params>('INSERT INTO imports(import_id,principal_id,request_id,status,created_ms,settled_ms,expires_ms,row_json) VALUES(@importId,@principalId,@requestId,@status,@createdMs,@settledMs,@expiresMs,@rowJson)').run(params);
    return { kind: 'admitted' as const, row };
  }).immediate();
}
