# tool-audit

Storage adapters for the daemon's tool-attempt audit contract
(`ToolAttemptAuditSink` / `ToolAttemptEvent` from `@jini-ai/core/contracts/site/daemon-tool-audit`).

## Wiring

- **Provides (`./repo.memory`):** `createInMemoryToolAttemptAuditSink({}, { maxEvents? })` — the
  in-memory sink: events kept in append order on a live `events` array, bounded to the newest
  `maxEvents` (default 20,000) so public traffic cannot grow it without limit; an explicit
  `optional.detail` overrides a legacy event-shaped `detail`. Throws `RangeError` for a
  non-positive or non-integer `maxEvents`.
- **Provides (`./repo`):** `new SqlToolAttemptAuditSink({ kernel, tables, onError }, { maxRowsPerWorkspace?,
  maxVisitorRowsPerWorkspace?, pruneCheckInterval? })` — the durable sink, one Kysely query body for
  every dialect, with per-workspace administrator/visitor retention buckets. `append` never rejects;
  a failed write goes to `onError`. Also `MAX_ROWS_PER_WORKSPACE`, `MAX_VISITOR_ROWS_PER_WORKSPACE`.
- **Provides (`./tool-gaps.repo`):** `createToolGapReader({ kernel, tables, toolGapAuditId,
  decodeToolGapEntry }, {})` — the `ToolGapReadPort` over the same audit table.
- **Needs injected:** the memory sink needs nothing. The SQL adapters need a schema-free
  `StorageKernel<Kysely<unknown>, unknown>` (`kernel`), the host's table name
  (`tables.toolAttempts`; no default here), and either the host's error reporter (`onError`,
  required: this package never logs) or the daemon's gap marker and decoder
  (`TOOL_GAP_AUDIT_ID` / `decodeToolGapEntry` from `@jini-ai/daemon/tool-audit`; this package does
  not depend on the daemon). `kysely` is an optional peer: only the SQL subpaths need it.
- **Host wiring example:**

  ```ts
  import { createInMemoryToolAttemptAuditSink } from "@jini-ai/diagnostics/tool-audit/repo.memory";
  import { SqlToolAttemptAuditSink } from "@jini-ai/diagnostics/tool-audit/repo";
  import { createToolGapReader } from "@jini-ai/diagnostics/tool-audit/tool-gaps.repo";
  import { TOOL_GAP_AUDIT_ID, decodeToolGapEntry } from "@jini-ai/daemon/tool-audit";

  const memorySink = createInMemoryToolAttemptAuditSink({});
  const tables = { toolAttempts: "agent_tool_attempts" };
  const sqlSink = new SqlToolAttemptAuditSink({ kernel, tables, onError: ({ error }) => logger.error(error) });
  const toolGaps = createToolGapReader({ kernel, tables, toolGapAuditId: TOOL_GAP_AUDIT_ID, decodeToolGapEntry }, {});
  ```
- **Must never import:** host paths, a concrete database handle, or a console logger.
