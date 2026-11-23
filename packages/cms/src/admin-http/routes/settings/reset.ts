import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { ForbiddenError, resolveTargetWorkspaceId, type SettingScope, type SettingsService } from "@jini-ai/core/settings";

import {
  SETTING_SCOPES, runSettingsRoute, settingsRouteInput,
  type SettingsErrorRung, type SettingsRouteInput, type SettingsRoutePrincipal, type SettingsWriteRouteBaseDeps,
} from "./shared.js";

/** The deps this route reads: the write base (readiness, ledger, fence) and the host's settings service. */
export interface SettingsResetRouteDeps extends SettingsWriteRouteBaseDeps {
  settingsService: () => Pick<SettingsService, "reset">;
}

/** The `catch` ladder `POST /settings/reset` always had: only the service's inner 403. */
export const RESET_ERROR_MAPPINGS: readonly SettingsErrorRung[] = [{ matches: (error) => error instanceof ForbiddenError, status: 403, code: "FORBIDDEN" }];

/**
 * This route's required fields, off an untyped body: `namespace` and a `SETTING_SCOPES` member.
 * `null` means the body failed that check.
 * @complexity O(1).
 */
function parseResetRequestFields({ rawBody }: { rawBody: unknown }, _options: Record<string, never> = {}): { namespace: string; scope: SettingScope; bodyWorkspaceId: unknown } | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const namespace = String(body.namespace ?? "");
  const scope = body.scope as SettingScope;
  if (!namespace || !SETTING_SCOPES.includes(scope)) {
    return null;
  }
  return { namespace, scope, bodyWorkspaceId: body.workspaceId };
}

/**
 * POST reset every setting in a namespace to defaults at a scope
 * (SPEC-007 api.spec.md `SETTINGS_RESET`, tasks.md T042). Every value in it is cleared.
 * Validates before authorizing.
 *
 * `resetNamespace` (ADR-028 §7 R3-01) is the "explicit, human-invoked
 * orchestrator": it authorizes the coarse `settings.reset.<scope>` permission
 * once, then loops `clear()` in a reset-authorized internal context (skipping
 * each inner authorize() re-check). This route pre-checks the same
 * `settings.reset.<scope>` permission for a fast, structured 403, mirroring
 * `set.ts`/`clear.ts`.
 *
 * The keys in a namespace aren't tracked anywhere as a first-class list — the service
 * derives them the same way the write service's own `resolveScopedDefinitionOrThrow`
 * resolves a single key's definition partition: `scope=global` reads the
 * platform partition (`workspaceId=null`); `scope=workspace`/`scope=user` read
 * this workspace's site-owned partition. That partition is `null` (platform) for
 * `global`, else this workspace's own, falling back to the ambient workspace when
 * the resolved target workspace itself was `undefined` (the `scope: "global"` case
 * `resolveTargetWorkspaceId` itself returns, which never reaches there since
 * `scope !== "global"` on this path).
 * @complexity O(keys registered in the namespace), including CMS ledger writes.
 */
export const settingsResetRoute = defineJsonRoute<SettingsRouteInput, { namespace: string; clearedCount: number; revisionSeqs: number[] }, SettingsResetRouteDeps, SettingsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/reset",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    const parsedBody = parseResetRequestFields({ rawBody: input.body });
    if (!parsedBody) {
      rejectRoute({ status: 400, error: "namespace and scope (global|workspace|user) are required", code: "VALIDATION_ERROR" });
    }
    const { namespace, scope, bodyWorkspaceId } = parsedBody;
    // See `resolveTargetWorkspaceId` (`@jini-ai/core/settings`). This was the worst of the three: it took the
    // target workspace from the body while authorizing against `deps.workspaceId` below, so one
    // request could wipe an entire namespace in another tenant.
    const targetWorkspace = resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId, scope } });
    if (!targetWorkspace.ok) rejectRoute({ status: 400, error: targetWorkspace.error, code: "VALIDATION_ERROR" });
    await auth({ permission: `settings.reset.${scope}`, entityType: "setting-namespace" });
    // See `set.ts`'s identical comment: always the ambient `deps.workspaceId`,
    // never a fallback to the caller's own principal id.
    const result = await deps.settingsService().reset({
      namespace, scope, workspaceId: targetWorkspace.workspaceId, callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId,
    });
    return { namespace, clearedCount: result.clearedCount, revisionSeqs: result.revisionSeqs };
  } }, { write: { body: input.body }, mappings: RESET_ERROR_MAPPINGS }) }),
});
