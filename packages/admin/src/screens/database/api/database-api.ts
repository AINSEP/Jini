import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { GatedConfirmResult, GatedPlanResult } from "@jini-ai/core/contracts/site/gated-results";
import type { AdminLedgerRow, AdminRestorePointSummary, AdminSchemaState, MigrateForwardResult } from "../../../core/index.js";

/** What the host injects into {@link createDatabaseApi}. */
export interface DatabaseApiDeps {
  /** The host's `request`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  request: <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;
}

/** The admin API calls of the database feature, bound to the host's injected collaborators.
 *  @example const databaseApi = createDatabaseApi({ request }); */
export function createDatabaseApi({ request }: DatabaseApiDeps, _optional: Record<string, never> = {}) {
  return {
    // Database — Timeline + restore points (ADR-041).
    getDatabaseTimeline: (options: {
      kind?: string;
      outcome?: string;
      fromDate?: string;
      toDate?: string;
      cursor?: string;
      limit?: number;
    } = {}) => {
      const params = new URLSearchParams();
      if (options.kind) params.set("kind", options.kind);
      if (options.outcome) params.set("outcome", options.outcome);
      if (options.fromDate) params.set("fromDate", options.fromDate);
      if (options.toDate) params.set("toDate", options.toDate);
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.limit) params.set("limit", String(options.limit));
      const qs = params.toString();
      return request<{ items: AdminLedgerRow[]; nextCursor: string | null }>(
        { path: `/database/timeline${querySuffix({ query: qs })}` }
      );
    },
    /** This site's drift classification. Read-only: there is deliberately no matching
     *  write/repair call, and the server exposes none. */
    getDatabaseSchemaState: () => request<AdminSchemaState>({ path: "/database/schema-state" }),

    // Database — migrate-forward ceremony (ADR-041 §3, SPEC-017 C-103/C-105). Plan takes no body —
    // the plan is computed entirely from the site's current migration/capability state server-side.
    planMigrateForward: () =>
      request<GatedPlanResult>({ path: "/database/migrate-forward/plan" }, { init: { method: "POST" } }),
    confirmMigrateForward: (
      { planId, planHash }: { planId: string; planHash: string },
      _options: Record<string, never> = {}
    ) =>
      request<GatedConfirmResult>({ path: "/database/migrate-forward/confirm" }, { init: {
        method: "POST",
        body: JSON.stringify({ planId, planHash }),
      } }),
    executeMigrateForward: ({ confirmationToken }: { confirmationToken: string }, _optional: Record<string, never> = {}) =>
      request<MigrateForwardResult>({ path: "/database/migrate-forward/execute" }, { init: {
        method: "POST",
        body: JSON.stringify({ confirmationToken }),
      } }),
    /** Same underlying `/database/restore-points` write `createDatabaseRestorePoint` above uses — the
     *  `restore_points` table is genuinely shared (see `AdminRestorePoint`'s own doc comment) and
     *  there is no separate Recovery-owned write route. Recovery grew its own create action
     *  (2026-09-10, restore-point functionality consolidation) so this gets a Recovery-named entry
     *  point for that reason, not because the backend route differs. */
    createRecoveryRestorePoint: (options: { trigger?: string; costAck?: boolean } = {}) =>
      request<{ restorePoint: AdminRestorePointSummary }>({ path: "/database/restore-points" }, { init: {
        method: "POST",
        body: JSON.stringify(options),
      } }),
  };
}
