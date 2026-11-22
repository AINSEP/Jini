/**
 * @file Task 7 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 7 / §5 risk #6.
 *
 * `executePublishContentImport` mirrors `@jini-ai/db/recovery/migrate-forward-execute`'s
 * `executeMigrateForward` shape exactly: refuse `costClass: 'unavailable'` BEFORE the gated-mutation
 * gateway's own `execute()` ever runs, so a mutation this instance cannot take a real restore point
 * for is refused with no attestation override (ADR-041 §2's "no attestation override" rule, reused
 * here rather than re-argued) — not merely refused inside `hooks.executeMutation()`, which would
 * already be past `execute()`'s authorize/token/actor-class/plan-hash checks and would have looked,
 * from the caller's perspective, like "everything passed, then it failed" instead of "this was never
 * going to be allowed".
 *
 * Unlike `executeMigrateForward`, this wrapper does NOT acquire `core/operation-lock.ts`'s shared
 * cross-domain lock — that lock exists for the `migration`/`restore` operation-kind pair specifically
 * (ADR-041 §3, SPEC-019 CIC U-003), and publish-content's own concurrency story (per-write
 * `expectedVersion` racing against `saveIfVersion`'s atomic `UPDATE … WHERE version = ?`, plan §5
 * risk #3) is a different, already-adequate mechanism Task 8 owns. Adding this domain to that lock's
 * `operationKind` union is out of this task's scope and not requested by the plan.
 */

/** Thrown when `costClass === 'unavailable'` — publish-content's own apply is refused with no
 *  bypass, mirroring `migrate-forward/execute.ts`'s `RestorePointUnavailableError` (each domain
 *  declares its own class rather than sharing one, the established precedent — see that file's own
 *  header and `@jini-ai/db/tools`'s sibling class of the same name). */
export class RestorePointUnavailableError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "RestorePointUnavailableError";
  }
}

/**
 * Refuses outright when this workspace's restore-point mechanism is `unavailable`; otherwise runs
 * the caller's own gated-mutation `execute()` composition unchanged.
 *
 * @complexity O(1) plus the injected `gatewayExecute()` call.
 * @overallScore 100
 */
export async function executePublishContentImport<TResult>(
  required: {
    workspaceId: string;
    costClass: "cheap" | "expensive" | "unavailable";
    gatewayExecute: () => Promise<TResult>;
  },
  _optional: Record<string, never> = {}
): Promise<TResult> {
  const { workspaceId, costClass, gatewayExecute } = required;

  if (costClass === "unavailable") {
    throw new RestorePointUnavailableError({
      message:
        `workspace '${workspaceId}' has restore-point costClass 'unavailable' — publish-content import ` +
        "is refused with no attestation override (mirrors ADR-041 §2's forward-migrate rule)",
    });
  }

  return gatewayExecute();
}
