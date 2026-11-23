import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';

import { requireAuthorizer } from './require-authorizer.js';

/** The drift summary the introspection port reports, passed through verbatim (see the route doc). */
export interface DatabaseSchemaStateSummary {
  status: string;
  siteMeta: unknown;
  runtime: unknown;
}

/** The only deps this route reads. */
export interface DatabaseSchemaStateRouteDeps {
  databaseIntrospection: { getSchemaState(): Promise<DatabaseSchemaStateSummary> };
}

/**
 * @file ADR-041 §3 — `GET /api/admin/v1/database/schema-state` (this site's drift classification:
 * its persisted `.site-meta.json` schema stamp versus the runtime's applied `__drizzle_migrations`
 * lineage). Gated by `database.read` (ADR-041 §6's permission catalog), matching `timeline.ts`'s
 * and `restore-points.ts`'s list route exactly.
 *
 * WHY THIS ROUTE EXISTS: `db/drift.ts`'s `getDriftStatus` and its `SqliteDatabaseIntrospection
 * Adapter` caller have both been built and correct for some time, but the only thing that ever
 * called them was the `database_get_schema_state` AGENT tool
 * (`features/database/tool-registrations.ts`). A site owner whose database had diverged onto a
 * different migration lineage had no admin surface that would ever tell them — the Database
 * screen's own file header recorded the drift banner as having "no route yet", and this closes
 * exactly that gap. It is the read half only: nothing here migrates, repairs, or reconciles
 * anything. `migrate-forward.ts`'s plan/confirm/execute ceremony remains the only write path, and
 * it keeps its own independent preflight.
 *
 * PASSTHROUGH, DELIBERATELY: the response body is `SchemaStateSummary` verbatim —
 * `{ status, siteMeta, runtime }` — with no server-side rewording, collapsing, or severity ranking.
 * `status` therefore carries all five values the port can produce (`in-sync`/`ahead`/`behind`/
 * `diverged`/`unknown`), and both snapshots stay independently `null`able. That matters for the
 * `"unknown"` case in particular: `getSchemaState()` returns it whenever either snapshot side is
 * unavailable, and flattening it into a boolean here (or defaulting it toward "fine") would
 * manufacture the exact reassurance `adapter.sqlite.ts`'s own "never fabricated" rule exists to
 * prevent. The client is left to decide how to say "we could not determine this".
 *
 * A failed read throws to the host failure port. No `status` field on that envelope, deliberately:
 * a caller that cannot read a status must see the read FAIL, not receive a clean-looking one.
 */
export const adminDatabaseSchemaStateRoute = defineJsonRoute<undefined, DatabaseSchemaStateSummary, DatabaseSchemaStateRouteDeps, { id: string }>({
  method: 'get',
  path: '/api/admin/v1/database/schema-state',
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, authorize }) => {
    await requireAuthorizer({ authorize })({ permission: 'database.read', entityType: 'database-schema' });
    return ok({ value: await deps.databaseIntrospection.getSchemaState() });
  },
});
