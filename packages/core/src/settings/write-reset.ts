import type { UUID } from "../primitives/index.js";
import { ForbiddenError } from "./errors.js";
import { type SettingScope } from "./types.js";
import { type SettingsWriteServiceDeps } from './write-service.js';
import { clear } from './write-values.js';
import { assertTargetWorkspaceMatchesAuth } from './write-value-revisions.js';
export interface ResetNamespaceRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    scope: Exclude<SettingScope, never>;
    workspaceId?: UUID | undefined;
    principalId?: UUID | undefined;
    callerPrincipalId: UUID;
    /** See `SetValueRequired.input.authWorkspaceId`'s doc. Optional/additive. */
    authWorkspaceId?: UUID | undefined;
  };
}

/**
 * — an explicit, human-invoked orchestrator: authorize
 * the matching `settings.reset.*` permission once, then loop `clear` for
 * every setting in the namespace in the reset-authorized internal context
 * (`skipAuthorize: true`) — the outer reset permission is sufficient on its
 * own; each inner clear still emits its own `op='clear'` revision.
 *
 * `revisionSeqs` collects each inner `clear` call's own `revisionSeq` so a
 * host's admin HTTP route can surface the full contract without a second
 * read. Existing callers that only read `.clearedCount` are unaffected.
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
export async function resetNamespace(
  { keysInNamespace, ...required }: ResetNamespaceRequired & { keysInNamespace: string[] },
  _optional: Record<string, never> = {},
): Promise<{ clearedCount: number; revisionSeqs: number[] }> {
  const { deps, input } = required;

  const resetPermission = `settings.reset.${input.scope}`;
  const authWorkspaceId = input.authWorkspaceId ?? input.workspaceId ?? input.callerPrincipalId;
  // Asserted once here rather than per inner `clear()`: those run with `skipAuthorize: true`, which
  // short-circuits the same check inside `clear()`. This is the only gate for the whole loop.
  assertTargetWorkspaceMatchesAuth({ ...input, authWorkspaceId });
  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission: resetPermission,
    workspaceId: authWorkspaceId,
    entityType: "setting-namespace",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${input.callerPrincipalId}' is not authorized for '${resetPermission}' (${authResult.reason})`
    );
  }

  // One transaction around the whole loop, so a reset is all-or-nothing.
  //
  // Each `clear()` opens its own transaction and commits on its own, so a
  // failure partway through used to leave the namespace HALF reset — some keys
  // durably cleared, the rest untouched — while the caller received an error and
  // could reasonably assume nothing had happened. "Reset this namespace" is not
  // a meaningful operation if it can apply to an arbitrary prefix of the keys.
  //
  // This works because each inner `clear()` is passed `skipTransaction: true`
  // and so writes into THIS frame instead of opening its own. That is explicit
  // at the call site by design: an earlier version made `transaction` reentrant
  // via an instance-level depth counter, which could not tell a genuine nested
  // call from an unrelated concurrent one and silently merged the two.
  //
  // Both adapters honour the rollback: a SQLite adapter via ROLLBACK, and
  // `repo.memory.ts` via a snapshot/restore journal.
  return deps.repo.transaction(async () => {
    let clearedCount = 0;
    const revisionSeqs: number[] = [];
    for (const key of keysInNamespace) {
      const result = await clear({
        deps,
        input: {
          namespace: input.namespace,
          key,
          scope: input.scope,
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          callerPrincipalId: input.callerPrincipalId,
          skipAuthorize: true,
          skipTransaction: true,
        },
      });
      revisionSeqs.push(result.revisionSeq);
      clearedCount++;
    }

    return { clearedCount, revisionSeqs };
  });
}
