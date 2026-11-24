import { sql, type RawBuilder } from "kysely";

import type { BackstopAuditPort, BackstopAuditRecord, BackstopGap } from "../backstop-audit.js";

/**
 * @file THE `BackstopAuditPort` adapter over the host's publish backstop log table: raw SQL on the
 * host's storage kernel (an `INSERT … ON CONFLICT(id) DO UPDATE` save, a workspace-scoped read by id
 * or run id, the gap ranking over successful/undone source events). The host injects the kernel, the
 * table name and its `tableExists` check; it decides which dialects it wires this on.
 */

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface BackstopAuditTables { log: string }

/** The raw-SQL slice of the host's storage kernel this adapter runs on. */
export interface BackstopAuditSqlKernel {
  query<Row>(statement: RawBuilder<Row>): Promise<Row[]>;
  execute(statement: RawBuilder<unknown>): Promise<void>;
}

/** Required collaborators: the kernel, the host's table name, and the host's table-existence check on that kernel. */
export interface BackstopAuditSqlRequired<K extends BackstopAuditSqlKernel = BackstopAuditSqlKernel> {
  kernel: K;
  tables: BackstopAuditTables;
  tableExists: (required: { kernel: K; table: string }) => Promise<boolean>;
}

/** @complexity O(size of the stored JSON columns) — fixed-shape mapping plus four JSON parses. */
function toRecord(row: Record<string, unknown>): BackstopAuditRecord {
  return { id: row.id, workspaceId: row.workspace_id, direction: row.direction, actorId: row.actor_id, destination: row.destination, reason: row.reason,
    at: row.at, items: JSON.parse(row.items_json as string), gapLabels: JSON.parse(row.gap_labels_json as string), result: row.result, runId: row.run_id,
    details: JSON.parse(row.details_json as string), inverses: JSON.parse(row.inverses_json as string) } as BackstopAuditRecord;
}

/**
 * Each label counted once per event, newest event first so the first sighting carries the latest reason.
 * @complexity O(e·l + g log g) — e events, l labels each, g distinct labels sorted.
 */
function rankGaps(events: readonly { gap_labels_json: string; reason: string; at: string }[]): BackstopGap[] {
  const groups = new Map<string, BackstopGap>();
  for (const event of events) for (const label of new Set(JSON.parse(event.gap_labels_json) as string[])) {
    const prior = groups.get(label);
    groups.set(label, prior ? { ...prior, count: prior.count + 1 } : { label, count: 1, lastReason: event.reason, lastAt: event.at });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Optional, staged schema: absent storage keeps the feature closed, without crashing boot. */
export function createBackstopAuditSqlPort<K extends BackstopAuditSqlKernel>(
  { kernel, tables, tableExists }: BackstopAuditSqlRequired<K>,
  _optional: Record<string, never> = {}
): BackstopAuditPort {
  const log = sql.table(tables.log);
  return {
    ready: async () => tableExists({ kernel, table: tables.log }),
    save: async ({ record }) => {
      await kernel.execute(sql`INSERT INTO ${log}
        (id, workspace_id, direction, actor_id, destination, reason, at, items_json, gap_labels_json, result, run_id, details_json, inverses_json)
        VALUES (${record.id}, ${record.workspaceId}, ${record.direction}, ${record.actorId}, ${record.destination}, ${record.reason}, ${record.at},
          ${JSON.stringify(record.items)}, ${JSON.stringify(record.gapLabels)}, ${record.result}, ${record.runId}, ${JSON.stringify(record.details)}, ${JSON.stringify(record.inverses)})
        ON CONFLICT(id) DO UPDATE SET result=excluded.result, run_id=excluded.run_id, details_json=excluded.details_json, inverses_json=excluded.inverses_json, items_json=excluded.items_json`);
    },
    get: async ({ workspaceId, id }) => {
      const [row] = await kernel.query<Record<string, unknown>>(sql`SELECT * FROM ${log} WHERE workspace_id=${workspaceId} AND (id=${id} OR run_id=${id}) ORDER BY direction ASC LIMIT 1`);
      return row ? toRecord(row) : null;
    },
    gaps: async ({ workspaceId }) => {
      const events = await kernel.query<{ gap_labels_json: string; reason: string; at: string }>(sql`SELECT gap_labels_json, reason, at FROM ${log} WHERE workspace_id=${workspaceId} AND direction='source' AND result IN ('success', 'undone') ORDER BY at DESC`);
      return rankGaps(events);
    },
  };
}
