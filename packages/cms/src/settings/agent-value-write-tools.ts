import { adaptLegacyAuthorize } from "../core/tools/index.js";
import { ToolInputError, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler } from "@jini-ai/core";
import { ForbiddenError as PermissionDeniedError } from "../core/commands/command.js";
import { requireToolPermission } from "../core/tools/index.js";
import type { JsonValue } from "@jini-ai/core/primitives";
import { AGENT_WRITE_CONFIRMATION_SETTINGS, AGENT_WRITE_DENIED_SETTINGS, findAgentWriteRule } from "./agent-write-denylist.js";
import { DefinitionNotFoundError, DefinitionTombstonedError, ForbiddenError, ScopeNotAllowedError, ValueValidationFailedError } from "./errors.js";
import { getEffective, resolveDefinitionRaw, validateValueAgainstSchema } from "./settings.js";
import type { SettingsToolDeps } from "./tool-registrations.js";
import { SCOPE_BIT, type SettingDefinitionRecord, type SettingValueRecord } from "./types.js";
import { clear, deriveRequiredPermission, set, type SettingsWriteServiceDeps } from "./write-service.js";

export type SettingsValueWriteToolId = "settings_set_value" | "settings_clear_value";

/** Host-only port. This request is never an agent input and only the host's authenticated
 * human transport may answer it. Returning true without a human violates this contract. */
export interface SettingsWriteConfirmation {
  ctx: ToolExecutionContext;
  toolId: SettingsValueWriteToolId;
  namespace: string;
  key: string;
  scope: "workspace" | "user";
  previous: JsonValue | null;
  value?: JsonValue;
  reason: string;
}

interface WriteTarget {
  namespace: string;
  key: string;
  scope: "workspace" | "user";
  value?: JsonValue;
}

/** Strict boundary, including direct handler calls. JSON is cloned before the first await
 * so a held-open card cannot consent to a value later changed by the caller. O(input size). */
function parseTarget(toolId: SettingsValueWriteToolId, raw: unknown): WriteTarget {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ToolInputError({ message: `${toolId}: input must be an object containing namespace and key.` });
  const input = raw as Record<string, unknown>;
  const fields = toolId === "settings_set_value" ? ["namespace", "key", "value", "scope"] : ["namespace", "key", "scope"];
  const extra = Object.keys(input).find((key) => !fields.includes(key));
  if (extra) throw new ToolInputError({ message: `${toolId}: unexpected input '${extra}'. Only ${fields.join(", ")} are accepted; the caller's own user layer is the only user target.` });
  for (const field of ["namespace", "key"]) {
    if (typeof input[field] !== "string" || !(input[field] as string).trim()) throw new ToolInputError({ message: `${toolId}: '${field}' must be a non-empty string. Call settings_list_definitions to see valid keys.` });
  }
  const namespace = input.namespace as string;
  const key = input.key as string;
  const scope = input.scope === undefined ? "workspace" : input.scope;
  if (scope !== "workspace" && scope !== "user") throw new ToolInputError({ message: `${toolId}: scope must be 'workspace' or 'user'; global settings are not writable by this tool.` });
  if (toolId === "settings_clear_value") return { namespace, key, scope };
  if (!("value" in input)) throw new ToolInputError({ message: `${toolId}: a JSON 'value' is required.` });
  // The executor validates JSON input too. The round trip protects direct callers and isolates
  // the snapshot; values JSON would silently change (NaN, undefined, functions) are rejected.
  let serialized: string | undefined;
  try { serialized = JSON.stringify(input.value, (_key, value) => {
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || (typeof value === "number" && !Number.isFinite(value))) throw new Error("not JSON");
    return value;
  }); } catch { throw new ToolInputError({ message: `${toolId}: value must be valid JSON.` }); }
  if (serialized === undefined) throw new ToolInputError({ message: `${toolId}: value must be valid JSON.` });
  return { namespace, key, scope, value: JSON.parse(serialized) as JsonValue };
}

/** Definition/scope/value preflight for readable refusal before any card. O(1) repository
 * lookups plus alias resolution and schema validation, with no writes. */
async function resolveTarget(deps: SettingsToolDeps, target: WriteTarget, isSet: boolean): Promise<SettingDefinitionRecord> {
  const definition = await resolveDefinitionRaw({ repo: deps.settingsRepo }, { namespace: target.namespace, key: target.key, workspaceId: deps.workspaceId });
  const name = `${target.namespace}.${target.key}`;
  if (!definition) throw new DefinitionNotFoundError(`setting '${name}' was not found`);
  if (definition.status === "tombstone") throw new DefinitionTombstonedError(`setting '${name}' has been tombstoned`);
  if ((definition.scopes & SCOPE_BIT[target.scope]) === 0) throw new ScopeNotAllowedError(name);
  if (isSet && !validateValueAgainstSchema(definition.schema, target.value!)) throw new ValueValidationFailedError(`value for '${name}' does not match the definition schema`);
  return definition;
}

/** Reads exactly the override being changed, never an effective value or another principal.
 * One repository read, O(1) outside adapter cost. */
function readLayer(deps: SettingsToolDeps, target: WriteTarget, settingId: string, principalId: string): Promise<SettingValueRecord | null> {
  const base = { workspaceId: deps.workspaceId, settingId };
  return target.scope === "user" ? deps.settingsRepo.getUserValue({ ...base, principalId }) : deps.settingsRepo.getWorkspaceValue(base);
}

/** Fail closed on host-denied keys, including a protected target reached through an alias.
 * Returns a confirmation rule if either coordinate needs one; O(r) in fixed policy rules. */
function writePolicy(deps: SettingsToolDeps, toolId: SettingsValueWriteToolId, target: WriteTarget, definition?: SettingDefinitionRecord) {
  const targets = definition ? [target, definition] : [target];
  const denied = [...AGENT_WRITE_DENIED_SETTINGS, ...(deps.extraDeniedSettings ?? [])];
  for (const coordinate of targets) {
    const rule = findAgentWriteRule(denied, coordinate);
    if (rule) throw new ToolInputError({ message: `${toolId}: '${coordinate.namespace}.${coordinate.key}' can't be changed by the assistant: ${rule.reason}. The owner can change it in Settings.` });
  }
  const confirmation = [...AGENT_WRITE_CONFIRMATION_SETTINGS, ...(deps.extraConfirmationSettings ?? [])];
  for (const coordinate of targets) {
    const rule = findAgentWriteRule(confirmation, coordinate);
    if (rule) return { ...rule, namespace: coordinate.namespace, key: coordinate.key };
  }
  return undefined;
}

/** Maps expected caller-fixable errors; infrastructure failures remain untouched. O(1). */
function rethrowWriteError(error: unknown, toolId: SettingsValueWriteToolId, target: WriteTarget, permission: string): never {
  if (error instanceof DefinitionNotFoundError || error instanceof DefinitionTombstonedError) throw new ToolInputError({ message: `${toolId}: ${error.message}. Call settings_list_definitions to see valid keys.` });
  if (error instanceof ScopeNotAllowedError) throw new ToolInputError({ message: `${toolId}: '${target.namespace}.${target.key}' can't be set ${target.scope === "user" ? "per-user" : "at workspace scope"}. Call settings_list_definitions to see allowed scopes.` });
  if (error instanceof ValueValidationFailedError) throw new ToolInputError({ message: `${toolId}: ${error.message}. Call settings_list_definitions and use a value matching the setting's schema.` });
  if (error instanceof ForbiddenError || error instanceof PermissionDeniedError) throw new ToolInputError({ message: `${toolId}: permission '${permission}' is required. Ask the owner to grant it before retrying.` });
  throw error;
}

/** Builds one value-write handler. Effects: authorize -> raw read -> optional human card ->
 * service write -> result. The service rechecks authorization and performs its normal transaction.
 * @complexity O(value size + rule count) plus bounded repository calls and a human wait.
 * @throws ToolInputError for invalid input, denied keys, absent/declined/stale confirmation. */
export function buildSettingsValueWriteHandler(deps: SettingsToolDeps, toolId: SettingsValueWriteToolId): ToolHandler {
  return async (ctx, options?: ToolExecutionOptions) => {
    const target = parseTarget(toolId, ctx.input);
    const permission = deriveRequiredPermission({ scope: target.scope, callerPrincipalId: ctx.principal.id });
    const isSet = toolId === "settings_set_value";
    try {
      if (ctx.signal.aborted) throw new ToolInputError({ message: `${toolId}: the run ended before the change could be applied. Nothing was changed.` });
      writePolicy(deps, toolId, target);
      await Promise.all([deps.settingsReady, deps.settingsUiTabsReady]);
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission }, { entityType: "setting-value" });
      const definition = await resolveTarget(deps, target, isSet);
      const rule = writePolicy(deps, toolId, target, definition);
      const layer = await readLayer(deps, target, definition.settingId, ctx.principal.id);
      const previous = layer?.state === "set" ? structuredClone(layer.valueJson) : null;
      // Cancellation may have arrived during readiness, authorization or the raw read.
      // Check before opening a card so a finished run cannot leave a new exchange waiting.
      if (ctx.signal.aborted) throw new ToolInputError({ message: `${toolId}: the run ended before the change could be applied. Nothing was changed.` });
      if (rule) {
        if (!deps.confirmWrite) throw new ToolInputError({ message: `${toolId}: '${rule.namespace}.${rule.key}' requires a human confirmation card: ${rule.reason}. The owner can change it in Settings.` });
        const confirmed = await deps.confirmWrite({ ctx, toolId, namespace: rule.namespace, key: rule.key, scope: target.scope, previous: structuredClone(previous), ...(isSet ? { value: structuredClone(target.value!) } : {}), reason: rule.reason }, options);
        if (confirmed !== true) throw new ToolInputError({ message: `${toolId}: the human did not confirm the change. Nothing was changed.` });
        const current = await resolveTarget(deps, target, isSet);
        const currentLayer = await readLayer(deps, target, current.settingId, ctx.principal.id);
        if (current.settingId !== definition.settingId || current.version !== definition.version || currentLayer?.seq !== layer?.seq) throw new ToolInputError({ message: `${toolId}: this setting changed while the confirmation card was open. Read it again and request a new confirmation. Nothing was changed by this call.` });
      }
      if (ctx.signal.aborted) throw new ToolInputError({ message: `${toolId}: the run ended before the change could be applied. Nothing was changed.` });
      const writeDeps: SettingsWriteServiceDeps = { repo: deps.settingsRepo, clock: deps.clock, ids: deps.idGen, authorize: deps.authorize, principals: deps.principalRepo };
      // Resolved coordinates preserve host validators even when the request named an alias.
      const input = { namespace: definition.namespace, key: definition.key, scope: target.scope, workspaceId: deps.workspaceId, callerPrincipalId: ctx.principal.id, authWorkspaceId: deps.workspaceId };
      const key = `${target.namespace}.${target.key}`;
      if (isSet) {
        const result = await (deps.setValue ?? set)({ deps: writeDeps, input: { ...input, value: target.value! } });
        return { key, scope: target.scope, previous, value: result.value, revisionSeq: result.revisionSeq };
      }
      await clear({ deps: writeDeps, input });
      const effective = await getEffective({ repo: deps.settingsRepo }, { namespace: definition.namespace, key: definition.key, scopeContext: { workspaceId: deps.workspaceId, principalId: ctx.principal.id } });
      return { key, scope: target.scope, previous, effective: effective?.value ?? null };
    } catch (error) { rethrowWriteError(error, toolId, target, permission); }
  };
}
