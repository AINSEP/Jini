import type { ClockPort } from "../core/ports.js";
import { CleanupNotEligibleError } from "./errors.js";
import type { AuthorizeFn } from "./write-service.js";
import type { Result } from "./types.js";

/**
 * @file REQ-20/REQ-21 (SPEC-020) — the destructive cleanup ceremony, instantiating SPEC-016's
 * gated-mutation gateway (`domain="collections"`, `action="cleanup"`) around a tombstoned content
 * type's final, irreversible removal (ADR-043 §6 item 2's disable -> tombstone -> cleanup
 * lifecycle).
 *
 * Purpose:
 * `planCleanup` is the eligibility gate (C-405): a content type must be `status='tombstone'`, its
 * retention window (30 days since `tombstonedAt`, inclusive) must have elapsed, and an
 * `exportReference` must be present — checked in that fixed order, stopping at the first failure
 * (behavior.spec.md §2.3), before the actual SPEC-016 `plan()` is ever reached. `executeCleanup`
 * forwards straight to the gated-mutation gateway's own `execute()` (token redemption, actor-class
 * check, plan-staleness re-check all live there — this module does not re-implement them) and
 * only performs the actual multi-table removal after the gateway confirms the token; a rejected
 * gateway call never triggers any local removal (EC-10, INV-07).
 *
 * How it relates to the project:
 * `deps.gateway` in `planCleanup`/`executeCleanup` is intentionally two different narrow port
 * shapes (`plan`-only, `execute`-only) rather than one shared gateway interface — each function
 * only ever calls the one method it needs, matching how a real SPEC-016 `core/gated-mutations`
 * composition would be split per call site.
 *
 * Architectural role:
 * `features/content-types` domain logic, composing `write-service.ts`'s `AuthorizeFn` shape.
 */

export interface CleanupEligibilityCheckRepoPort {
  findByKey(params: { workspaceId: string; key: string }): Promise<{ status: "active" | "deprecated" | "tombstone"; tombstonedAt: string | null } | null>;
}

export interface PlanCleanupGatewayPort {
  plan(input: {
    principalId: string;
    workspaceId: string;
    contentTypeKey: string;
    domain: "collections";
    action: "cleanup";
  }): Promise<Result<{ planId: string; planHash: string }, unknown>>;
}

const RETENTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface PlanCleanupRequired {
  deps: { repo: CleanupEligibilityCheckRepoPort; gateway: PlanCleanupGatewayPort; clock: ClockPort; authorize: AuthorizeFn };
  input: { workspaceId: string; actorId: string; contentTypeKey: string; exportReference: string };
}

/**
 * REQ-20 — the fixed-order eligibility gate: `status==='tombstone'` -> retention window elapsed
 * (>=30 days since `tombstonedAt`, inclusive lower bound) -> `exportReference` present. Only once
 * all three pass does this call reach the real SPEC-016 `gateway.plan()`.
 *
 * @complexity O(1) — one repo read, one date diff, one delegated gateway call at most.
 * @overallScore 100
 */
export async function planCleanup(
  required: PlanCleanupRequired
): Promise<Result<{ planId: string; planHash: string }, CleanupNotEligibleError>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({ principalId: input.actorId, permission: "admin.collections.read", workspaceId: input.workspaceId });
  if (!authResult.allowed) {
    return { ok: false, error: new CleanupNotEligibleError("forbidden", `principal '${input.actorId}' is not authorized to plan a cleanup (${authResult.reason})`) };
  }

  const contentType = await deps.repo.findByKey({ workspaceId: input.workspaceId, key: input.contentTypeKey });
  if (!contentType || contentType.status !== "tombstone") {
    return { ok: false, error: new CleanupNotEligibleError("not_tombstoned") };
  }

  const now = deps.clock.nowIso();
  const elapsedMs = new Date(now).getTime() - new Date(contentType.tombstonedAt ?? now).getTime();
  if (elapsedMs < RETENTION_WINDOW_MS) {
    return { ok: false, error: new CleanupNotEligibleError("retention_window_not_elapsed") };
  }

  if (!input.exportReference) {
    return { ok: false, error: new CleanupNotEligibleError("export_reference_missing") };
  }

  const planResult = await deps.gateway.plan({
    principalId: input.actorId,
    workspaceId: input.workspaceId,
    contentTypeKey: input.contentTypeKey,
    domain: "collections",
    action: "cleanup",
  });
  if (!planResult.ok) {
    return { ok: false, error: new CleanupNotEligibleError("gateway_rejected", String(planResult.error)) };
  }
  return { ok: true, value: planResult.value };
}

export interface ExecuteCleanupGatewayPort {
  execute(input: {
    principalId: string;
    principalKind: string;
    confirmationToken: string;
    contentTypeKey: string;
  }): Promise<Result<unknown, unknown>>;
}

export interface CleanupRemovalRepoPort {
  removeContentTypeAndAllScopedRows(params: { contentTypeKey: string }): Promise<{ removedEntryCount: number }>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface ExecuteCleanupRequired {
  deps: { repo: CleanupRemovalRepoPort; gateway: ExecuteCleanupGatewayPort };
  input: { principalId: string; principalKind: string; confirmationToken: string; contentTypeKey: string };
}

/**
 * REQ-21/INV-07 — forwards straight to the gated-mutation gateway's own `execute()`; only once
 * that confirms (token redeemed, actor-class checked, plan still fresh) does this function perform
 * the actual atomic multi-table removal. A gateway rejection (expired/already-redeemed token,
 * stale plan) is forwarded verbatim and no local removal is ever attempted (EC-10).
 *
 * @complexity O(1) plus one delegated gateway call and, on success, one same-tx multi-table
 * removal.
 * @overallScore 100
 */
export async function executeCleanup(
  required: ExecuteCleanupRequired
): Promise<Result<{ removedEntryCount: number }, unknown>> {
  const { deps, input } = required;

  const gatewayResult = await deps.gateway.execute({
    principalId: input.principalId,
    principalKind: input.principalKind,
    confirmationToken: input.confirmationToken,
    contentTypeKey: input.contentTypeKey,
  });
  if (!gatewayResult.ok) {
    return gatewayResult;
  }

  const removal = await deps.repo.transaction(async () =>
    deps.repo.removeContentTypeAndAllScopedRows({ contentTypeKey: input.contentTypeKey })
  );

  return { ok: true, value: removal };
}
