/** Portable DB read/restore-point handlers; migration gateways stay host-owned. See docs/decisions/DR-001-bounded-operational-timeline.md. */
import { readToolLimit, ToolInputError, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { nowIso, type Clock } from "@jini-ai/core/primitives";
import { defaultDbMessages, type DbMessages } from "../core/messages.js";
import { getDatabaseAgentToolCatalog } from "./database-catalog.js";
import { DEFAULT_TIMELINE_PAGE_SIZE, getTimeline, MAX_TIMELINE_PAGE_SIZE, type LedgerReadPort } from "./timeline.js";
import { createRestorePoint as createDatabaseRestorePoint, listRestorePoints, type RestorePointListPort, type RestorePointSavePort } from "./restore-points.js";
import { registrations, type InputReaders } from "./registration.js";
export interface DatabasePermissionRequest { principalId: string; permission: string; entityType: string; }
export interface DatabaseReadToolPorts {
  workspaceId: string;
  readers: InputReaders;
  requirePermission(request: DatabasePermissionRequest): Promise<void>;
  introspection: { getHealth(): Promise<unknown>; getSchemaState(): Promise<unknown>; listPendingMigrations(): Promise<unknown> };
  ledger: LedgerReadPort;
  restorePoints: RestorePointListPort & RestorePointSavePort;
  dbOps: { getCapabilities(): Promise<{ restorePoint: { costClass: "cheap" | "expensive" | "unavailable"; kind: string } }>; captureRestorePoint(input: { scopeId: string }): Promise<{ artifactRef: string; watermarkAtCapture: number }> };
  clock: Clock; idGen: { newId(): string };
}
/**
 * Binds six authorized read/restore-point handlers and their host-facing catalog copy.
 * @param ports Host effects; construction performs no I/O and retains the ports by reference.
 * @param _optional.messages Catalog and unavailable-capture prose; defaults to neutral copy.
 * @returns Registrations; permission, cost and capture failures propagate from handler execution.
 * @complexity O(1) fixed registrations and space, plus message text length.
 */
export function createDatabaseReadTools(ports: DatabaseReadToolPorts, _optional: { messages?: DbMessages } = {}): ToolRegistration[] {
  const messages = _optional.messages ?? defaultDbMessages;
  const { noInput: requireNoInput, isRecord, optionalString, optionalBoolean } = ports.readers;
  const handlers: Record<string, ToolHandler> = {
    database_query_timeline: async (ctx) => {
      if (ctx.input !== undefined && !isRecord(ctx.input)) throw new ToolInputError({ message: "input must be an object" });
      const input = isRecord(ctx.input) ? ctx.input : {};
      await ports.requirePermission({ principalId: ctx.principal.id, permission: "database.read", entityType: "database-ledger" });

      return getTimeline({
        ledger: ports.ledger,
        filter: {
          kind: optionalString(input, "kind"),
          outcome: optionalString(input, "outcome"),
          fromDate: optionalString(input, "fromDate"),
          toDate: optionalString(input, "toDate"),
          cursor: optionalString(input, "cursor"),
          // The catalog promises "server-capped at 200, defaults to 50": cap here, and refuse 0/-1/2.5
          // as a ToolInputError the model can read instead of getTimeline's redacted plain Error.
          limit: readToolLimit({ input, max: MAX_TIMELINE_PAGE_SIZE, fallback: DEFAULT_TIMELINE_PAGE_SIZE }),
        },
      });
    },

    database_list_restore_points: async (ctx) => {
      requireNoInput(ctx.input);
      await ports.requirePermission({ principalId: ctx.principal.id, permission: "database.read", entityType: "restore-point" });
      return listRestorePoints({ repo: ports.restorePoints });
    },

    database_get_health: async (ctx) => {
      requireNoInput(ctx.input);
      await ports.requirePermission({ principalId: ctx.principal.id, permission: "database.read", entityType: "database" });
      return ports.introspection.getHealth();
    },

    database_get_schema_state: async (ctx) => {
      requireNoInput(ctx.input);
      await ports.requirePermission({ principalId: ctx.principal.id, permission: "database.read", entityType: "database" });
      return ports.introspection.getSchemaState();
    },

    database_list_pending_migrations: async (ctx) => {
      requireNoInput(ctx.input);
      await ports.requirePermission({ principalId: ctx.principal.id, permission: "database.read", entityType: "database" });
      return ports.introspection.listPendingMigrations();
    },

    backup_create_restore_point: async (ctx) => {
      if (ctx.input !== undefined && !isRecord(ctx.input)) throw new ToolInputError({ message: "input must be an object" });
      const input = isRecord(ctx.input) ? ctx.input : {};
      const costAck = optionalBoolean(input, "costAck");

      // `createRestorePoint` (restore-points.ts) has no authorize() call of its own — the real HTTP
      // route (`routes/admin/database/restore-points.ts`) authorizes inline before calling it, so
      // this handler does the identical inline check.
      await ports.requirePermission({ principalId: ctx.principal.id, permission: "backup.create", entityType: "restore-point" });

      const capabilities = await ports.dbOps.getCapabilities();
      let captured: { artifactRef: string; watermarkAtCapture: number } | undefined;

      const summary = await createDatabaseRestorePoint({
        costClass: capabilities.restorePoint.costClass,
        kind: capabilities.restorePoint.kind,
        costAck: costAck ?? false,
        capture: async () => {
          captured = await ports.dbOps.captureRestorePoint({ scopeId: ports.workspaceId });
          return captured;
        },
      }, { messages });

      await ports.restorePoints.save({
        restorePointId: summary.id,
        idempotencyKey: ports.idGen.newId(),
        // Always 'manual' — an agent call is never the system's own pre-migration/template-upgrade
        // auto-snapshot, regardless of what a caller might ask for, so provenance in the ledger can
        // never be mislabeled (see `features/database/agent-tools.ts`'s own schema comment).
        trigger: "manual",
        createdAt: nowIso({ clock: ports.clock }),
        createdBy: ctx.principal.id,
        costClass: summary.costClass,
        kind: summary.kind,
        watermarkAtCapture: captured?.watermarkAtCapture ?? null,
        artifactRef: captured?.artifactRef,
      });

      return { restorePoint: summary };
    },

  };

  // Classified from the lifted handlers: five repository reads and one capture + persisted record.
  const risks = new Map(Object.keys(handlers).map(id => [id, id === "backup_create_restore_point" ? "mutates-durable-state" : "none"]));
  return registrations({ catalog: getDatabaseAgentToolCatalog({}, { messages }), handlers, risks });
}
