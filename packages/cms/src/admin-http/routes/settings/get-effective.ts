import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminSettingsListDto } from "@jini-ai/core/contracts/site/cms-settings";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { EffectiveSettingRow, SettingsService } from "@jini-ai/core/settings";

import {
  rejectCrossPrincipalRead, runSettingsRoute, settingsRouteInput,
  type SettingsReadTargetFn, type SettingsRouteBaseDeps, type SettingsRouteInput, type SettingsRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: readiness, the host's settings service, and the cross-principal read policy. */
export interface SettingsGetEffectiveRouteDeps extends SettingsRouteBaseDeps {
  settingsService: () => Pick<SettingsService, "effective">;
  resolveReadTarget: SettingsReadTargetFn;
  crossPrincipalReadPermission: string;
}

/** What a 400 for a missing or empty `namespace` tells the caller, in plain words (a person reads it in the admin). */
const NAMESPACE_REQUIRED_MESSAGE = "Say which group of settings to read: add ?namespace=<group> to the address, for example ?namespace=core.language.";

/**
 * GET the effective (layer-resolved) values of one settings namespace
 * (SPEC-007 api.spec.md `SETTINGS_GET_EFFECTIVE`, tasks.md T039). Authorizes before it
 * validates; the user layer defaults to the caller's own, and naming another principal needs the
 * injected cross-principal read permission. A `workspaceId` query param is ignored, not trusted.
 *
 * Resolves every effective value for a namespace across the keys registered on either the
 * platform partition (`workspaceId=null`) or this workspace's own site-owned partition.
 *
 * Path deviation: see `register-definitions.ts`'s header — this route
 * follows the codebase's established `/api/admin/v1/workspaces/:workspaceId/...`
 * mount convention rather than api.spec.md's literal (workspace-less) path.
 *
 * `getEffective`/`resolveDefinition` (the settings service in `@jini-ai/core/settings`) are
 * pure reads with no `authorize()` call of their own (unlike the write service),
 * so this route does the explicit authorize-then-call dance itself, mirroring
 * the other admin read routes.
 *
 * Query contract deviation (disclosed): api.spec.md §4 documents `workspaceId?`
 * as a request param, but it is NOT honored — the workspace always comes from the
 * authorized `deps.workspaceId`. `principalId` naming another principal requires
 * `settings.user.read`, which is what the Settings admin screen's target-principal
 * selector (AC-23) gates itself on too.
 *
 * Enumerates every active key in the requested namespace across both the
 * platform partition (`workspaceId=null`, core/theme owners) and this
 * workspace's own site-owned partition — matches `resolveDefinitionRaw`'s own
 * fallback order, since `SettingsRepoPort.listActiveDefinitions`
 * only takes one exact `workspaceId` per call.
 * @complexity O(keys registered in the namespace).
 */
export const settingsGetEffectiveRoute = defineJsonRoute<SettingsRouteInput, AdminSettingsListDto<EffectiveSettingRow>, SettingsGetEffectiveRouteDeps, SettingsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/effective",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    await auth({ permission: "settings.read", entityType: "setting-value" });
    const namespace = String(input.query.namespace ?? "");
    if (!namespace) rejectRoute({ status: 400, error: NAMESPACE_REQUIRED_MESSAGE, code: "VALIDATION_ERROR" });
    // Bug found while wiring up the settings-dialog Language tab's Spanish
    // locale (2026-07-31): every settings-dialog tab adapter (the host admin
    // app's `loadNamespaceValues`) calls
    // this route with NO `principalId` query param at all -- it just wants
    // "my own effective settings". Omitting the param used to resolve to
    // `requestedPrincipalId: undefined`, which `resolveUserLayerReadTarget`
    // returns as-is (`undefined` = "skip the user layer entirely" per that
    // function's own contract, correct for `get-raw.ts`'s multi-principal
    // ledger inspector). Fed into `getEffective`, that made its
    // `scopeContext.principalId` check (the settings service's
    // `if (workspaceId && principalId)`) always false, so a self-read could
    // NEVER see its own `scope=user` value -- it silently fell through to
    // workspace/global/default every time, on every reload, for every
    // `scope=user` setting (Notifications, Appearance, Language) -- the
    // save always worked; only reading it back was broken. Defaulting to
    // `principal.id` here (this route only, not the shared helper or
    // `get-raw.ts`) is exactly the self-read case `resolveUserLayerReadTarget`
    // already treats as free (no `settings.user.read` check, matches
    // the settings read-scoping tests' "F2 control: reading your OWN user
    // layer via ?principalId=<self>" case) and mirrors the write service's
    // own default-to-self (`input.principalId ?? input.callerPrincipalId`)
    // for the exact same "no explicit principal named" input shape.
    const requested = input.query.principalId ? String(input.query.principalId) : principal.id;
    const readTarget = await deps.resolveReadTarget({ requestedPrincipalId: requested, callerPrincipalId: principal.id });
    if (!readTarget.allowed) {
      rejectCrossPrincipalRead({ principalId: principal.id, reason: readTarget.reason, permission: deps.crossPrincipalReadPermission });
    }
    // `authorize()` above was checked against `deps.workspaceId` and `principal.id` — never let
    // the actual read target a different workspace or principal than what was authorized.
    // The `:workspaceId` path param is already pinned to `deps.workspaceId` above; a
    // `workspaceId` query param is ignored rather than trusted (ADR-007).
    const data = await deps.settingsService().effective({ namespace, workspaceId: deps.workspaceId, principalId: readTarget.principalId });
    return { data };
  } }) }),
});
