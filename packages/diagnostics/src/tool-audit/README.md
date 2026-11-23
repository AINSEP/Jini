# tool-audit

Storage adapters for the daemon's tool-attempt audit contract
(`ToolAttemptAuditSink` / `ToolAttemptEvent` from `@jini-ai/core/contracts/site/daemon-tool-audit`).

## Wiring

- **Provides (`./repo.memory`):** `createInMemoryToolAttemptAuditSink({}, { maxEvents? })` — the
  in-memory sink: events kept in append order on a live `events` array, bounded to the newest
  `maxEvents` (default 20,000) so public traffic cannot grow it without limit; an explicit
  `optional.detail` overrides a legacy event-shaped `detail`. Throws `RangeError` for a
  non-positive or non-integer `maxEvents`.
- **Needs injected:** nothing.
- **Host wiring example:**

  ```ts
  import { createInMemoryToolAttemptAuditSink } from "@jini-ai/diagnostics/tool-audit/repo.memory";

  const toolAttemptAuditSink = createInMemoryToolAttemptAuditSink({});
  ```
- **Not here yet:** the durable SQL sink and the tool-gap reader stay with the host until this
  package can take `kysely` as an optional peer (their queries are Kysely-typed).
- **Must never import:** host paths, a concrete database handle, or a console logger.
