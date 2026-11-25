import type { ImportHistoryPolicy } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';

export function sweepExpired({ db, clock, policy }: { db: SqliteSyncClient; clock: { nowMs(): number }; policy: ImportHistoryPolicy }, _optional: Record<string, never> = {}): void {
  const now = clock.nowMs();
  const highWater = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key='last_sweep_ms'").get();
  if (highWater !== undefined && now < Number(highWater.value)) return;
  let count: number;
  do {
    count = db.transaction(() => {
      const rows = db.prepare<[number], { import_id: string }>('SELECT import_id FROM imports WHERE settled_ms <= ? ORDER BY settled_ms LIMIT 500').all(now - policy.historyVisibleMs);
      for (const row of rows) db.prepare('DELETE FROM imports WHERE import_id = ?').run(row.import_id);
      return rows.length;
    }).immediate();
  } while (count === 500);
  do {
    count = db.transaction(() => {
      const rows = db.prepare<[number], { principal_id: string; request_id: string }>('SELECT principal_id, request_id FROM replay WHERE accepted_ms <= ? ORDER BY accepted_ms LIMIT 500').all(now - policy.replayFenceMs);
      // The composite PK is required for replay deletion.
      for (const row of rows) db.prepare('DELETE FROM replay WHERE principal_id = ? AND request_id = ?').run(row.principal_id, row.request_id);
      return rows.length;
    }).immediate();
  } while (count === 500);
  db.prepare("INSERT INTO meta(key,value) VALUES('last_sweep_ms',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now));
}
