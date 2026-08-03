/**
 * @file Settings' tool-registration wiring: maps the wireable subset of `agent-tools.ts`'s eight
 * catalog entries onto three reads and one curated write, as `ToolRegistration`s. See
 * `agent-tools.ts`'s own file header for why the four GENERIC write entries are documented but
 * deliberately never wired ({@link UNWIRED_SETTINGS_TOOL_IDS}), and why `settings_set_ui_preference`
 * is not one of them.
 *
 * The one write here is shaped so that its blast radius is a property of the code rather than of
 * the caller's restraint: its target key comes from a fixed enum
 * (`agent-writable-preferences.ts`), its scope is a constant, and it never names a principal — so
 * "write another operator's settings" and "write a key outside the list" are unrepresentable
 * inputs, not merely unauthorized ones.
 *
 * Authorization shape: `getEffective`/`resolveDefinition` (`settings.ts`) and a direct
 * `settingsRepo.listActiveDefinitions`/`getGlobalValue`/`getWorkspaceValue`/`getUserValue` read
 * carry no `authorize()` call of their own — a host's admin routes gate inline — so every handler
 * here calls the kit's `requireToolPermission` itself, mirroring those routes' identical checks.
 * `resolveOwnOrOtherPrincipalRead` below deliberately duplicates (rather than imports) any HTTP
 * admin layer's read-target resolution logic — this file is domain-owned wiring, and importing
 * logic from a host's HTTP admin layer would invert this library's ports/adapters direction
 * (features must not depend on a host's server/routes layer); the two are kept behaviorally
 * identical by inspection, the same discipline that logic's own host-side callers should apply.
 */
import type { AuthorizeFn } from "../core/commands/command.js";
import {
  buildDomainRegistrations,
  indexCatalogById,
  optionalString,
  requireInputRecord,
  requireNoInput,
  requireString,
  requireToolPermission,
  withSchemaOnRejection,
  type AgentToolSideEffect,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "../core/tools/registration-kit.js";
import type { JsonValue } from "../core/ports.js";
import type { PrincipalRepoPort } from "../identity/index.js";
import { getSettingsAgentToolCatalog } from "./agent-tools.js";
import {
  AGENT_PREFERENCE_WRITE_SCOPE,
  AGENT_WRITABLE_PREFERENCE_IDS,
  resolveAgentWritablePreference,
} from "./agent-writable-preferences.js";
import {
  DefinitionNotFoundError,
  DefinitionTombstonedError,
  ScopeNotAllowedError,
  ValueValidationFailedError,
} from "./errors.js";
import type { SettingsRepoPort } from "./ports.js";
import { getEffective, resolveDefinition } from "./settings.js";
import type { SettingValueRecord } from "./types.js";
import { set as setSettingValue, type SettingsWriteServiceDeps } from "./write-service.js";

const CATALOG_BY_ID = indexCatalogById(getSettingsAgentToolCatalog());

/**
 * The exact slice of a host's route-deps bag Settings' tool handlers read. Declared structurally
 * (rather than importing any host's own route-deps type) so this module carries no back-edge into
 * a host's composition root. A host satisfies this structurally by passing its existing route deps
 * object; nothing there needs to change shape.
 */
export interface SettingsToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  settingsReady: Promise<void>;
  settingsUiTabsReady: Promise<void>;
  settingsRepo: SettingsRepoPort;
  principalRepo: PrincipalRepoPort;
}

/** Permission gating a read that names a DIFFERENT principal than the caller — mirrors a host's
 * own HTTP admin layer's equivalent constant (kept as a literal here per this file's header; the
 * two are data, not logic, so duplication carries no drift risk beyond a string comparison). */
const CROSS_PRINCIPAL_SETTINGS_READ_PERMISSION = "settings.user.read";

/**
 * Decides which principal's user layer a settings read tool may target — the tool-wiring twin of
 * a host's own HTTP admin layer's equivalent read-target resolver (see this file's header for why
 * it is duplicated rather than imported).
 *
 * @throws {ForbiddenError} (`core/commands`, via `requireToolPermission`) If `requestedPrincipalId`
 * names a different principal than the caller and the caller lacks `settings.user.read`.
 * @returns The principal id to read (`undefined` = skip the user layer entirely).
 * @complexity O(1); at most one `authorize()` call (none for a self-read or no-op read).
 * @overallScore 100
 */
async function resolveOwnOrOtherPrincipalRead(
  routeDeps: SettingsToolDeps,
  required: { requestedPrincipalId: string | undefined; callerPrincipalId: string }
): Promise<string | undefined> {
  const { requestedPrincipalId, callerPrincipalId } = required;
  // Defaults to the CALLER, never to `undefined`. `undefined` does not mean "the caller" to
  // `getEffective` — it means "skip the user layer entirely" (`settings.ts`'s
  // `if (workspaceId && principalId)` guard), so an omitted `principalId` would otherwise make
  // every read tool report the workspace/global/default value while silently ignoring the
  // operator's own — a read tool that cannot see the layer the operator is actually looking at
  // does not fail loudly; it produces confident wrong answers.
  const target = requestedPrincipalId ?? callerPrincipalId;
  if (target === callerPrincipalId) return target;

  await requireToolPermission(routeDeps, {
    principalId: callerPrincipalId,
    permission: CROSS_PRINCIPAL_SETTINGS_READ_PERMISSION,
    entityType: "setting-value",
  });
  return requestedPrincipalId;
}

function layerValueOf(record: SettingValueRecord | null): JsonValue | null {
  return record && record.state === "set" ? record.valueJson : null;
}

/**
 * Builds `write-service.ts`'s own five-field dep shape from `RouteDeps`.
 *
 * Deliberately duplicates a host's own HTTP admin layer's equivalent field-mapping helper rather
 * than importing it, for the reason this file's header already gives about
 * `resolveOwnOrOtherPrincipalRead`: this is domain-owned wiring, and importing from a host's HTTP
 * admin layer would invert the ports/adapters direction. It is a field mapping, not logic, so the
 * two copies carry no behavioral drift risk — and `write-service.ts` is the single chokepoint
 * either way, so a divergence here could only produce a missing dependency, which fails loudly.
 */
function toWriteDeps(routeDeps: SettingsToolDeps): SettingsWriteServiceDeps {
  return {
    repo: routeDeps.settingsRepo,
    clock: routeDeps.clock,
    ids: routeDeps.idGen,
    authorize: routeDeps.authorize,
    principals: routeDeps.principalRepo,
  };
}

/**
 * Errors a DIFFERENT input would fix, for `withSchemaOnRejection`'s decoration.
 *
 * `ValueValidationFailedError` is the common one — the model sent a value of the wrong shape for
 * the chosen setting, and republishing the schema (with its per-key value hints) lets it correct
 * in one turn instead of guessing. The two definition errors are included because they are
 * genuinely reachable from a bad `setting`: an id that passed the enum but names a definition this
 * workspace has tombstoned. A `ForbiddenError` is deliberately absent — no input change fixes a
 * missing grant, and decorating it would imply the call is worth retrying.
 */
function isPreferenceShapeRejection(error: unknown): boolean {
  return (
    error instanceof ValueValidationFailedError ||
    error instanceof DefinitionNotFoundError ||
    error instanceof DefinitionTombstonedError ||
    error instanceof ScopeNotAllowedError
  );
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration — and note that the four excluded writes appear NOWHERE here, which is
 * itself the strongest of the guards: an unclassified id cannot be wired at all.
 */
export const settingsDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> settingsRepo.listActiveDefinitions() x2 (platform + this workspace): reads only.
  ["settings_list_definitions", "none"],
  // -> settingsRepo.listActiveDefinitions() x2 + getEffective() per key: reads only, no write path.
  ["settings_get_effective", "none"],
  // -> resolveDefinition() + settingsRepo.getGlobalValue/getWorkspaceValue/getUserValue: reads only.
  ["settings_get_raw", "none"],
  // -> write-service.set() at scope=user against the caller's own principal: writes a value row
  // and a revision-ledger entry. Durable, and correctly classified as such even though every key
  // it can reach is a reversible display preference — the classification describes what the
  // handler DOES, not how much the operator would mind.
  ["settings_set_ui_preference", "mutates-durable-state"],
]);

/** Settings catalog entries this pass does not wire, and why — see `agent-tools.ts`'s own per-entry comments for the full reasoning. */
const UNWIRED_SETTINGS_TOOL_IDS = new Set([
  // EXCLUDED BY DESIGN: generic "set any setting key" — a typical human admin UI for this domain
  // is itself an uncurated free-text/raw-JSON editor, not a fixed named list (see agent-tools.ts
  // file header).
  "settings_set",
  "settings_clear",
  // EXCLUDED BY DESIGN: bulk variant — clears every value in an operator-named namespace at a
  // scope in one call, irreversible.
  "settings_reset",
  // EXCLUDED BY DESIGN: schema-level, not value-level — can rename/retype/deprecate/tombstone the
  // definition a key resolves through, reinterpreting every existing stored value for that key
  // platform-wide.
  "settings_register_definitions",
]);

export function buildSettingsRegistrations(routeDeps: SettingsToolDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    settings_list_definitions: async (ctx) => {
      requireNoInput(ctx.input);
      await routeDeps.settingsReady;
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "settings.read.definitions", entityType: "setting-definition" });

      const [platformDefs, siteDefs] = await Promise.all([
        routeDeps.settingsRepo.listActiveDefinitions({ workspaceId: null }),
        routeDeps.settingsRepo.listActiveDefinitions({ workspaceId: routeDeps.workspaceId }),
      ]);

      const data = [...platformDefs, ...siteDefs]
        .map((def) => ({ namespace: def.namespace, key: def.key, ownerKind: def.ownerKind, scopes: def.scopes, status: def.status, version: def.version }))
        .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key));

      return { data };
    },

    settings_get_effective: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      const namespace = requireString(input, "namespace");
      await routeDeps.settingsReady;
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "settings.read", entityType: "setting-value" });

      const workspaceId = routeDeps.workspaceId;
      const principalId = await resolveOwnOrOtherPrincipalRead(routeDeps, {
        requestedPrincipalId: optionalString(input, "principalId"),
        callerPrincipalId: ctx.principal.id,
      });

      const [platformDefs, siteDefs] = await Promise.all([
        routeDeps.settingsRepo.listActiveDefinitions({ workspaceId: null }),
        routeDeps.settingsRepo.listActiveDefinitions({ workspaceId }),
      ]);
      const keys = new Set([...platformDefs, ...siteDefs].filter((d) => d.namespace === namespace).map((d) => d.key));

      const data: Array<{ key: string; value: unknown; sourceLayer: string; defVersion: number }> = [];
      for (const key of keys) {
        const resolved = await getEffective({ repo: routeDeps.settingsRepo }, { namespace, key, scopeContext: { workspaceId, principalId } });
        if (resolved) data.push({ key, value: resolved.value, sourceLayer: resolved.sourceLayer, defVersion: resolved.defVersion });
      }

      return { data };
    },

    settings_get_raw: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      const namespace = requireString(input, "namespace");
      const key = requireString(input, "key");
      await routeDeps.settingsReady;
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "settings.read.raw", entityType: "setting-value" });

      const workspaceId = routeDeps.workspaceId;
      const principalId = await resolveOwnOrOtherPrincipalRead(routeDeps, {
        requestedPrincipalId: optionalString(input, "principalId"),
        callerPrincipalId: ctx.principal.id,
      });

      const definition = await resolveDefinition({ repo: routeDeps.settingsRepo }, { namespace, key, workspaceId });
      if (!definition) throw new Error(`definition '${namespace}.${key}' was not found`);

      const [globalValue, workspaceValue, userValue] = await Promise.all([
        routeDeps.settingsRepo.getGlobalValue(definition.settingId),
        routeDeps.settingsRepo.getWorkspaceValue({ workspaceId, settingId: definition.settingId }),
        principalId ? routeDeps.settingsRepo.getUserValue({ workspaceId, principalId, settingId: definition.settingId }) : Promise.resolve(null),
      ]);

      return {
        key: `${namespace}.${key}`,
        global: layerValueOf(globalValue),
        workspace: layerValueOf(workspaceValue),
        user: layerValueOf(userValue),
        default: definition.defaultValue,
      };
    },

    settings_set_ui_preference: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      const settingId = requireString(input, "setting");

      // Re-checked here even though the published schema carries the same enum. See
      // `agent-writable-preferences.ts` on why: the enum is enforced by a caller's descriptor
      // validation, and this is the check that still holds if a stale or bypassed descriptor lets
      // an unlisted id through. Rejected BEFORE `settingsUiTabsReady` is awaited so an unlisted id
      // cannot even be used to probe which definitions exist.
      const preference = resolveAgentWritablePreference(settingId);
      if (!preference) {
        throw new Error(
          `'${settingId}' is not an agent-writable preference. Allowed: ${AGENT_WRITABLE_PREFERENCE_IDS.join(", ")}.`,
        );
      }

      // `in` rather than a truthiness check: `false` and `0` are legitimate values here
      // (`soundEnabled`, `desktopEnabled`), and rejecting them would make the two boolean
      // preferences settable in one direction only.
      if (!("value" in input)) {
        throw new Error(`a 'value' is required to set '${settingId}'`);
      }
      const value = input.value as JsonValue;

      // This tool's definitions are registered by `ensureSettingsUiTabDefinitions()` at boot, not
      // by any legacy-migration promise a host might also cover — awaiting the wrong promise would
      // make an early call fail with a spurious "definition was not found".
      await routeDeps.settingsUiTabsReady;

      // No `requireToolPermission` call here, unlike every read above. That is deliberate and is
      // the opposite of the reads' situation: the read paths carry no `authorize()` of their own,
      // so this layer must supply it, whereas `write-service.set()` IS the authorization
      // chokepoint (INV-07) and derives the permission itself from the scope and target. Adding a
      // pre-check would mean this file naming a permission string that the chokepoint might later
      // derive differently — the exact fail-open drift `deriveRequiredPermission`'s own header
      // (Red-Team RT-003) says must not be duplicated. Omitting `principalId` is what makes the
      // derived permission `settings.user.self.write`.
      const { value: stored, revisionSeq } = await withSchemaOnRejection(
        {
          toolId: "settings_set_ui_preference",
          catalog: CATALOG_BY_ID,
          isShapeRejection: isPreferenceShapeRejection,
        },
        () =>
          setSettingValue({
            deps: toWriteDeps(routeDeps),
            input: {
              namespace: preference.namespace,
              key: preference.key,
              scope: AGENT_PREFERENCE_WRITE_SCOPE,
              value,
              workspaceId: routeDeps.workspaceId,
              // `principalId` is deliberately NOT passed. `write-service.set()` falls back to
              // `callerPrincipalId` for a user-scoped write, so the caller's own layer is the only
              // reachable target — and the self-vs-other permission derivation sees a self-write.
              callerPrincipalId: ctx.principal.id,
              authWorkspaceId: routeDeps.workspaceId,
            },
          }),
      );

      return { setting: settingId, value: stored, scope: AGENT_PREFERENCE_WRITE_SCOPE, revisionSeq };
    },
  };

  return buildDomainRegistrations({
    domain: "settings",
    catalogModule: "settings/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: settingsDerivedRisk,
    unwiredToolIds: UNWIRED_SETTINGS_TOOL_IDS,
  });
}
