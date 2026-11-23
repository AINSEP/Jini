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

/** The reset's fields, or `null` when one is missing. @complexity O(1). */
function parseResetRequestFields({ rawBody }: { rawBody: unknown }, _options: Record<string, never> = {}): { namespace: string; scope: SettingScope; bodyWorkspaceId: unknown } | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const namespace = String(body.namespace ?? "");
  const scope = body.scope as SettingScope;
  if (!namespace || !SETTING_SCOPES.includes(scope)) {
    return null;
  }
  return { namespace, scope, bodyWorkspaceId: body.workspaceId };
}

/** POST a namespace reset at one scope: every value in it is cleared. Validates before authorizing. */
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
    const targetWorkspace = resolveTargetWorkspaceId({ workspaceId: deps.workspaceId, input: { bodyWorkspaceId, scope } });
    if (!targetWorkspace.ok) rejectRoute({ status: 400, error: targetWorkspace.error, code: "VALIDATION_ERROR" });
    await auth({ permission: `settings.reset.${scope}`, entityType: "setting-namespace" });
    const result = await deps.settingsService().reset({
      namespace, scope, workspaceId: targetWorkspace.workspaceId, callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId,
    });
    return { namespace, clearedCount: result.clearedCount, revisionSeqs: result.revisionSeqs };
  } }, { write: { body: input.body }, mappings: RESET_ERROR_MAPPINGS }) }),
});
