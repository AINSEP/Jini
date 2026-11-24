import { defineJsonRoute, ok, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { ForbiddenError, PlanStaleError, TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";

/**
 * @file ADR-041 §4 / ADR-043 — `POST /api/admin/v1/database/migrate-forward/{plan,confirm,execute}`
 * (the gated migrate-forward ceremony). `plan`/`confirm` are gated by `database.read` inside the
 * gated-mutation gateway; `execute` by `database.migrate`, pre-checked here (AUD-001) and re-checked
 * by the gateway. The host binds each step to its gateway, migrate-forward hooks, operation lock
 * and `@jini-ai/db/recovery/migrate-forward-execute`; these specs own the HTTP rules: the body
 * checks, the pre-authorization order and the error → status ladder.
 */

/** `database.migrate` — the permission `execute` pre-checks (and the gateway re-checks). */
const MIGRATE_PERMISSION = "database.migrate";

/** A thrown-error class the ladder maps by `instanceof`. */
export type MigrateForwardErrorClass = abstract new (...args: never[]) => Error;

/** The database package's two execute refusals, injected (the spec never imports the database runtime). */
export interface MigrateForwardErrorClasses {
  restorePointUnavailable: MigrateForwardErrorClass;
  migrationInFlight: MigrateForwardErrorClass;
}

/** Fields every step reads: its error classes and the host's missing-session diagnosis. */
interface MigrateForwardStepDeps {
  migrateForwardErrors: MigrateForwardErrorClasses;
  /** The host's own missing-session message, so its incident log names the miswiring. */
  missingPrincipalMessage: string;
}

/** `plan`: the gateway plan over the host's migrate-forward hooks. */
export interface DatabaseMigrateForwardPlanRouteDeps extends MigrateForwardStepDeps {
  planMigrateForward: (required: { principalId: string }) => Promise<unknown>;
}

/** `confirm`: the gateway confirm over the confirm-only hooks (mints the token). */
export interface DatabaseMigrateForwardConfirmRouteDeps extends MigrateForwardStepDeps {
  confirmMigrateForward: (required: { principalId: string; planId: string; planHash: string }) => Promise<{ confirmationToken: string }>;
}

/** `execute`: the gateway's instance-scoped pre-check and the locked migrate-forward execution. */
export interface DatabaseMigrateForwardExecuteRouteDeps extends MigrateForwardStepDeps {
  authorizeMigrateForward: (required: { principalId: string; permission: string }) => Promise<{ allowed: boolean; reason: string }>;
  executeMigrateForward: (required: { principalId: string; confirmationToken: string }) => Promise<unknown>;
}

/** The principal fields these routes read: the id, as the ceremony's actor. */
export interface DatabaseMigrateForwardPrincipal { id: string }

/** The raw JSON body; validated in `handle`, after the principal (and `execute`'s pre-check). */
export type DatabaseMigrateForwardInput = RouteInputContext["body"];

type Rung = { matches: (err: unknown) => boolean; status: number; code: (err: Error) => string };

/** The `catch` ladder, in the hand-written order; the gateway's `ForbiddenError` keeps its own reason code. */
function ladderFor({ errors }: { errors: MigrateForwardErrorClasses }, _optional: Record<string, never> = {}): readonly Rung[] {
  const rung = (cls: MigrateForwardErrorClass, status: number, code: string): Rung => ({ matches: (err) => err instanceof cls, status, code: () => code });
  return [
    { matches: (err) => err instanceof ForbiddenError, status: 403, code: (err) => (err as ForbiddenError).reasonCode },
    rung(PlanStaleError, 409, "PLAN_STALE"),
    rung(TokenExpiredError, 409, "TOKEN_EXPIRED"),
    rung(TokenAlreadyRedeemedError, 409, "TOKEN_ALREADY_REDEEMED"),
    rung(errors.restorePointUnavailable, 409, "RESTORE_POINT_UNAVAILABLE"),
    rung(errors.migrationInFlight, 409, "OPERATION_IN_FLIGHT"),
  ];
}

/**
 * Runs one step; a laddered failure refuses with `{ error: <message>, code }`, anything else (our own
 * refusals included) is rethrown unchanged so the host answers it (its redacted 500 for the unexpected).
 * @complexity O(1): a fixed six-rung ladder.
 */
async function runStep<T>({ deps, step }: { deps: MigrateForwardStepDeps; step: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  try {
    return await step();
  } catch (err) {
    const rung = ladderFor({ errors: deps.migrateForwardErrors }).find((candidate) => candidate.matches(err));
    if (!rung) throw err;
    return rejectRoute({ status: rung.status, error: (err as Error).message, code: rung.code(err as Error) });
  }
}

/** The session principal, or the host's own missing-session failure. @complexity O(1). */
function principalOf({ context, deps }: { context: DatabaseMigrateForwardPrincipal | undefined; deps: MigrateForwardStepDeps }, _optional: Record<string, never> = {}): DatabaseMigrateForwardPrincipal {
  if (!context) throw new Error(deps.missingPrincipalMessage);
  return context;
}

const fieldsOf = (input: DatabaseMigrateForwardInput): Record<string, unknown> => (input ?? {}) as Record<string, unknown>;
const totalParse = (raw: RouteInputContext) => ok({ value: raw.body });

/** `POST …/migrate-forward/plan` — the body is ignored; the gateway plans from live state. */
export const databaseMigrateForwardPlanRoute = defineJsonRoute<DatabaseMigrateForwardInput, unknown, DatabaseMigrateForwardPlanRouteDeps, DatabaseMigrateForwardPrincipal>({
  method: "post",
  path: "/api/admin/v1/database/migrate-forward/plan",
  parse: totalParse,
  handle: ({ deps, context }) => runStep({ deps, step: async () => {
    const principal = principalOf({ context, deps });
    return ok({ value: await deps.planMigrateForward({ principalId: principal.id }) });
  } }),
});

/** `POST …/migrate-forward/confirm` — answers only `{ confirmationToken }`. */
export const databaseMigrateForwardConfirmRoute = defineJsonRoute<DatabaseMigrateForwardInput, { confirmationToken: string }, DatabaseMigrateForwardConfirmRouteDeps, DatabaseMigrateForwardPrincipal>({
  method: "post",
  path: "/api/admin/v1/database/migrate-forward/confirm",
  parse: totalParse,
  handle: ({ input, deps, context }) => runStep({ deps, step: async () => {
    const principal = principalOf({ context, deps });
    const { planId, planHash } = fieldsOf(input);
    if (typeof planId !== "string" || typeof planHash !== "string") {
      rejectRoute({ status: 400, error: "'planId' and 'planHash' (strings) are required", code: "VALIDATION_ERROR" });
    }
    const record = await deps.confirmMigrateForward({ principalId: principal.id, planId, planHash });
    return ok({ value: { confirmationToken: record.confirmationToken } });
  } }),
});

/**
 * AUD-001: authorize before any lock acquisition (and before the body is read). The host binds the
 * pre-check through the gateway's `authorizeForHooks` with `scopeKind: "instance"` so it agrees with
 * what execute's own internal check decides (a workspace-scoped check would let a
 * workspace-scoped-but-not-instance-authorized caller briefly hold the lock).
 * @complexity O(1) plus the injected pre-check.
 */
async function preAuthorizeMigration({ deps, principalId }: { deps: DatabaseMigrateForwardExecuteRouteDeps; principalId: string }, _optional: Record<string, never> = {}): Promise<void> {
  const { allowed, reason } = await deps.authorizeMigrateForward({ principalId, permission: MIGRATE_PERMISSION });
  if (allowed) return;
  rejectRoute({
    status: 403,
    error: `principal '${principalId}' is not authorized for '${MIGRATE_PERMISSION}' (${reason})`,
    code: "FORBIDDEN",
    details: { permission: MIGRATE_PERMISSION, reason },
  });
}

/** `POST …/migrate-forward/execute` — pre-authorized, then the host's locked execution. */
export const databaseMigrateForwardExecuteRoute = defineJsonRoute<DatabaseMigrateForwardInput, unknown, DatabaseMigrateForwardExecuteRouteDeps, DatabaseMigrateForwardPrincipal>({
  method: "post",
  path: "/api/admin/v1/database/migrate-forward/execute",
  parse: totalParse,
  handle: ({ input, deps, context }) => runStep({ deps, step: async () => {
    const principal = principalOf({ context, deps });
    await preAuthorizeMigration({ deps, principalId: principal.id });
    const { confirmationToken } = fieldsOf(input);
    if (typeof confirmationToken !== "string") rejectRoute({ status: 400, error: "'confirmationToken' (string) is required", code: "VALIDATION_ERROR" });
    return ok({ value: await deps.executeMigrateForward({ principalId: principal.id, confirmationToken }) });
  } }),
});
