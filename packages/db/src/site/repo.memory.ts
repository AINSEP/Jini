import type { LedgerReadPort, LedgerRow } from "../tools/index.js";
import type { CreateRestorePointRepoPort } from "../recovery/restore-point-create.js";
import type { RestorePointListPort, RestorePointRecord } from "../tools/index.js";
import type { BootLedgerPort, MigrationRunsRepoPort, SiteServeStatus } from "../recovery/reconcile-interrupted-migration.js";
import type { SiteStatusPort } from "@jini-ai/core/contracts/site/recovery-reconcile-interrupted-migration";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import type { DatabaseHealthSummary, DatabaseIntrospectionPort, PendingMigration, SchemaStateSummary } from "@jini-ai/core/contracts/site/database-introspection";

/**
 * @file In-memory `LedgerReadPort` double (ADR-006 rule-of-two's "one being built now" partner
 * to `db/sqlite/database-journal-repo.ts`'s `SqliteDatabaseLedgerRepo`). Backs
 * `apps/website/src/server/runtime/composition/app.ts`'s hermetic test/dev composition, mirroring every other feature's
 * `repo.memory.ts`/`repo.sqlite.ts` split in this codebase.
 */
export class InMemoryDatabaseLedgerRepo implements LedgerReadPort, BootLedgerPort {
  private rows: LedgerRow[] = [];

  private readonly now: () => string;

  /**
   * @param optional.initial Rows present initially.
   * @param optional.now Clock for synthesized rows (defaults to the system clock).
   */
  constructor(_required: Record<string, never> = {}, { initial = [], now }: { initial?: LedgerRow[]; now?: () => string } = {}) {
    this.rows = [...initial];
    this.now = now ?? (() => new Date().toISOString());
  }

  async append(row: LedgerRow): Promise<void> {
    this.rows.push(row);
  }

  /** ADR-041/043/044/045 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, Finding 2 fix)
   * — mirrors `SqliteDatabaseLedgerRepo.appendInterruptedRow`'s exact row shape.
   *
   * Round-5 re-audit (TM-adr041-043-044-045-audit-001, R5-F1 / Fable's
   * R5-F1-INTERRUPTED-SECOND-BOOT-BRICK, both independently confirmed): idempotent on
   * `migrationRunId` — a second boot with the same still-unresolved migration must re-detect and
   * re-block without erroring, not treat the deterministic id as a fresh row. */
  async appendInterruptedRow(params: { siteId: string; migrationRunId: string }): Promise<void> {
    const id = `interrupted-${params.migrationRunId}`;
    if (this.rows.some((row) => row.id === id)) return;
    await this.append({
      id,
      kind: "migration.interrupted",
      createdAt: this.now(),
      restorePointId: null,
      outcome: "blocked_pending_recovery",
    });
  }

  async query(filter: {
    kind?: string;
    fromDate?: string;
    toDate?: string;
    outcome?: string;
    cursor?: string | null;
    limit: number;
  }): Promise<{ items: LedgerRow[]; nextCursor: string | null }> {
    const filtered = this.rows
      .filter((row) => !filter.kind || row.kind === filter.kind)
      .filter((row) => !filter.outcome || row.outcome === filter.outcome)
      .filter((row) => !filter.fromDate || row.createdAt >= filter.fromDate)
      .filter((row) => !filter.toDate || row.createdAt <= filter.toDate)
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      });

    const startIndex = filter.cursor ? filtered.findIndex((row) => row.id === filter.cursor) + 1 : 0;
    const page = filtered.slice(startIndex, startIndex + filter.limit);
    const nextCursor = startIndex + filter.limit < filtered.length ? page[page.length - 1]?.id ?? null : null;

    return { items: page, nextCursor };
  }
}

/**
 * In-memory double for both `recovery/restore-points.ts`'s `CreateRestorePointRepoPort` (the
 * idempotency-keyed persistence side) and `database/restore-points.ts`'s `RestorePointListPort`
 * (the read side this dispatch adds) — the same dual-port shape
 * `db/sqlite/database-journal-repo.ts`'s real `SqliteRestorePointsRepo` already implements.
 * Backs `apps/website/src/server/runtime/composition/app.ts`'s hermetic composition.
 */
export class InMemoryRestorePointsRepo implements CreateRestorePointRepoPort, RestorePointListPort {
  private readonly rows: Array<{
    restorePointId: string;
    idempotencyKey: string;
    trigger: string;
    createdAt: string;
    createdBy: string;
    costClass?: string;
    kind?: string;
    watermarkAtCapture?: number | null;
    artifactRef?: string;
  }> = [];

  async save(row: {
    restorePointId: string;
    idempotencyKey: string;
    trigger: string;
    createdAt: string;
    createdBy: string;
    costClass?: string;
    kind?: string;
    watermarkAtCapture?: number | null;
    artifactRef?: string;
  }): Promise<void> {
    this.rows.push(row);
  }

  async findByIdempotencyKey(key: string): Promise<{ restorePointId: string; idempotencyKey: string } | null> {
    const row = this.rows.find((r) => r.idempotencyKey === key);
    return row ? { restorePointId: row.restorePointId, idempotencyKey: row.idempotencyKey } : null;
  }

  async list(): Promise<RestorePointRecord[]> {
    return [...this.rows]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((row) => ({
        id: row.restorePointId,
        trigger: row.trigger,
        costClass: row.costClass ?? "cheap",
        kind: row.kind ?? "file-snapshot",
        watermarkAtCapture: row.watermarkAtCapture ?? null,
        createdAt: row.createdAt,
        // In-memory `restoreFromArtifact` is a no-op regardless of this value (no real file to
        // restore into) — a fabricated in-process reference is enough to satisfy the type.
        artifactRef: row.artifactRef ?? `memory://restore-point/${row.restorePointId}`,
      }));
  }
}

/** In-memory `SiteStatusPort` double, defaulted to `"SERVING"` — no boot-time reconciliation
 * caller is wired this pass (`reconcileInterruptedMigrationOnBoot`/`evaluateBootMigrationPolicy`
 * are domain logic only, not yet invoked from a composition root's boot sequence; see this
 * dispatch's handoff), so this status only ever changes if a future route/boot-hook calls
 * `.set()`. Backs both `apps/website/src/server/runtime/composition/app.ts` and, until a real persisted site-status store exists,
 * `apps/website/src/server/runtime/composition/deps.ts` too. */
export class InMemorySiteStatusRepo implements SiteStatusPort {
  private status: SiteServeStatus = "SERVING";

  async get(_siteId: string): Promise<SiteServeStatus> {
    return this.status;
  }

  async set(_siteId: string, status: SiteServeStatus): Promise<void> {
    this.status = status;
  }
}

/** In-memory `MigrationRunsRepoPort` double (Finding 2 fix, TM-adr041-043-044-045-audit-001) —
 * `apps/website/src/server/runtime/composition/app.ts`'s hermetic composition never runs a real migration, so `findNonTerminalForSite`
 * always returns `null` by default; tests that DO need to simulate a crash-interrupted migration
 * can override via `setNonTerminal`. */
export class InMemoryMigrationRunsRepo implements MigrationRunsRepoPort {
  private nonTerminal: { id: string; status: string } | null = null;

  setNonTerminal({ value }: { value: { id: string; status: string } | null }): void {
    this.nonTerminal = value;
  }

  async findNonTerminalForSite(_siteId: string): Promise<{ id: string; status: string } | null> {
    return this.nonTerminal;
  }

  /** Round-5 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, R5-F1/R5-F2 fix) — mirrors
   * `SqliteMigrationRunsRepo.markResolved`: clears the tracked non-terminal run once resolved, so a
   * subsequent boot's `findNonTerminalForSite` no longer re-detects it. */
  async markResolved(params: { id: string }): Promise<void> {
    if (this.nonTerminal?.id === params.id) this.nonTerminal = null;
  }
}

/** In-memory `DbOpsPort` double (`@jini-ai/core/contracts/site/gated-mutations-ports`) — reports the same static
 * `cheap`/`file-snapshot` capability `db/sqlite/db-ops.ts`'s real `SqliteDbOpsAdapter` reports
 * for a SQLite-backed site (this codebase's only dialect today), and fabricates an in-process
 * `artifactRef` instead of performing a real online backup, since `apps/website/src/server/runtime/composition/app.ts`'s hermetic
 * composition never touches a real content.db file. `apps/website/src/server/runtime/composition/sqlite-only-services.ts`'s real composition uses
 * `SqliteDbOpsAdapter` instead. */
export class InMemoryDbOpsAdapter implements DbOpsPort {
  private watermark = 0;

  async getCapabilities(): Promise<{ restorePoint: { costClass: "cheap" | "expensive" | "unavailable"; kind: "file-snapshot" | "logical-dump" | "external" } }> {
    return { restorePoint: { costClass: "cheap", kind: "file-snapshot" } };
  }

  async captureRestorePoint(required: { scopeId: string }): Promise<{ artifactRef: string; watermarkAtCapture: number }> {
    this.watermark += 1;
    return { artifactRef: `memory://restore-point/${required.scopeId}/${this.watermark}`, watermarkAtCapture: this.watermark };
  }

  /** No real content.db file exists in this hermetic composition — nothing to swap, no restart
   * needed. `apps/website/src/server/runtime/composition/sqlite-only-services.ts`'s real composition uses `SqliteDbOpsAdapter.restoreFromArtifact`
   * instead, which performs the actual atomic file swap. */
  async restoreFromArtifact(_required: { artifactRef: string }): Promise<{ restartRequired: boolean }> {
    return { restartRequired: false };
  }
}

/** In-memory `DatabaseIntrospectionPort` double (`adapter.sqlite.ts`) — `apps/website/src/server/runtime/composition/app.ts`'s hermetic
 * composition never opens a real `content.db`/`.site-meta.json` pair, so this reports a fixed,
 * always-"in-sync" snapshot with zero pending migrations rather than touching a filesystem. Mirrors
 * `InMemoryDbOpsAdapter`'s identical "plausible static double" precedent. */
export class InMemoryDatabaseIntrospectionAdapter implements DatabaseIntrospectionPort {
  async getHealth(): Promise<DatabaseHealthSummary> {
    return { canOpenDb: true, migrationsTableReadable: true, driftStatus: "in-sync" };
  }

  async getSchemaState(): Promise<SchemaStateSummary> {
    const snapshot = { version: 0, tag: "memory" };
    return { status: "in-sync", siteMeta: snapshot, runtime: snapshot };
  }

  async listPendingMigrations(): Promise<{ items: PendingMigration[] }> {
    return { items: [] };
  }
}
