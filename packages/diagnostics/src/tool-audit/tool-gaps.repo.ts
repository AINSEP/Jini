import type { Kysely } from 'kysely';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import type { ToolGapReadPort } from '@jini-ai/core/contracts/site/assistant-host-ports';
import type { ToolGapEntry } from '@jini-ai/core/contracts/site/daemon-tool-audit';

import type { ToolAttemptTables } from './repo.js';
import type { AgentToolAttemptsTable } from './repo.rows.js';

/** The reader's constructor object: the schema-free kernel, the host table name, and the daemon's
 * gap marker and decoder (`TOOL_GAP_AUDIT_ID` / `decodeToolGapEntry` from `@jini-ai/daemon/tool-audit`,
 * bound by the host because this package does not depend on the daemon). */
export interface ToolGapReaderRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: ToolAttemptTables;
  toolGapAuditId: string;
  decodeToolGapEntry: (required: { json: string | null }, optional?: Record<string, never>) => ToolGapEntry | null;
}

/** Read the existing bounded audit table, keeping the newest explanation revision per fallback.
 * One query, scoped to this workspace and principal before grouping; no new table/migration.
 * O(n) over at most the audit retention cap; returns at most 200 redacted summaries.
 */
export function createToolGapReader(required: ToolGapReaderRequired, _optional = {}): ToolGapReadPort {
  const table = required.tables.toolAttempts;
  return {
    async list({ workspaceId, principalId }, { limit = 100 } = {}) {
      const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 100;
      const rows = await required.kernel.run(handle => {
        // Host-owned table name needs an explicit column schema, as in the audit sink.
        const db = handle.withTables<Record<string, AgentToolAttemptsTable>>();
        return db.selectFrom(table).select('detail')
          .where('id', 'in', db.selectFrom(table).select(({ fn }) => fn.max('id').as('latest_id'))
            .where('workspace_id', '=', workspaceId).where('principal_id', '=', principalId)
            .where('tool_id', '=', required.toolGapAuditId).groupBy('attempt_id'))
          .orderBy('id', 'desc').limit(boundedLimit).execute();
      });
      return rows.flatMap(row => {
        const entry = required.decodeToolGapEntry({ json: row.detail }, {});
        return entry ? [entry] : [];
      });
    },
  };
}
