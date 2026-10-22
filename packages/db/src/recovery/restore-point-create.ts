import type { PrincipalKind, Result } from "./recovery-orchestrator.js";

/**
 * @file SPEC-019 C-304 / REQ-05 — `createRestorePoint`, an ordinary `authorize()`-gated mutation
 * (ADR-045 §3, "backup.create" independent of any migration).
 *
 * Purpose:
 * Structurally distinct from the gated restore ceremony (`recovery-orchestrator.ts`): this never
 * calls the gateway's `plan()`/`confirm()`/`execute()` at all (AC-10) — it mints a restore point
 * directly once `authorize()` and the shared-lock "no operation in flight" check both pass.
 * `authorize()` runs on EVERY call, before the idempotency short-circuit (AC-11, SPEC-016 REQ-14)
 * — a repeated idempotency key never skips re-authorization, only re-creation.
 *
 * How it relates to the project:
 * `operationInFlight` is supplied by the caller (typically derived from the same shared
 * `core/operation-lock` state `recovery-orchestrator.ts`'s `executeRestore` consults) rather than
 * this module acquiring the lock itself — REQ-13's "extends here too, via `onBeforeCreateOrExecute`"
 * is a pre-check on an already-resolved flag, not this module owning lock lifecycle.
 */

export interface CreateRestorePointRepoPort {
  save(row: {
    restorePointId: string;
    idempotencyKey: string;
    trigger: string;
    createdAt: string;
    createdBy: string;
  }): Promise<void>;
  findByIdempotencyKey(key: string): Promise<{ restorePointId: string; idempotencyKey: string } | null>;
}

export interface CreateRestorePointClockPort {
  nowIso(): string;
}

export interface CreateRestorePointIdPort {
  newId(): string;
}

export type CreateRestorePointAuthorizeFn = (params: {
  principalId: string;
  permission: string;
}) => Promise<{ allowed: boolean; reason: string }>;

export interface CreateRestorePointRequired {
  deps: {
    repo: CreateRestorePointRepoPort;
    clock: CreateRestorePointClockPort;
    ids: CreateRestorePointIdPort;
    authorize: CreateRestorePointAuthorizeFn;
    /** Present in the seam for shape-parity with the gated ceremony's deps; deliberately never
     * called here (AC-10) — kept so a caller wiring a shared deps object cannot be tempted to
     * route restore-point creation through it. */
    gateway: { plan: (...args: unknown[]) => Promise<unknown> };
  };
  input: {
    principalId: string;
    principalKind: PrincipalKind;
    idempotencyKey: string;
    trigger: "manual" | "pre-migration-auto" | "template-upgrade";
    operationInFlight: boolean;
  };
}

export interface CreateRestorePointValue {
  restorePointId: string;
}

/**
 * AC-10/AC-11/REQ-05/REQ-13 — authorize (always) -> in-flight refusal -> idempotency lookup ->
 * write. Never invokes `deps.gateway` at all.
 *
 * @complexity O(1) plus one `authorize()` call, one idempotency lookup, and (on the first call for
 * a given key) one `repo.save()` call.
 */
export async function createRestorePoint(
  required: CreateRestorePointRequired,
  _optional: Record<string, never> = {}
): Promise<Result<CreateRestorePointValue, { code: string; message?: string }>> {
  const { deps, input } = required;

  const authResult = await deps.authorize({ principalId: input.principalId, permission: "backup.create" });
  if (!authResult.allowed) {
    return { ok: false, error: { code: "FORBIDDEN", message: authResult.reason } };
  }

  if (input.operationInFlight) {
    return {
      ok: false,
      error: {
        code: "RESTORE_OPERATION_IN_FLIGHT",
        message: "a migration or restore is already in flight for this site",
      },
    };
  }

  const existing = await deps.repo.findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { ok: true, value: { restorePointId: existing.restorePointId } };
  }

  const restorePointId = deps.ids.newId();
  await deps.repo.save({
    restorePointId,
    idempotencyKey: input.idempotencyKey,
    trigger: input.trigger,
    createdAt: deps.clock.nowIso(),
    createdBy: input.principalId,
  });

  return { ok: true, value: { restorePointId } };
}
