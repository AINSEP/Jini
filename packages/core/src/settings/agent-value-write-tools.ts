import { adaptLegacyAuthorize, ForbiddenError as PermissionDeniedError, requireToolPermission } from "../tool-permissions.js";
import { ToolInputError, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler } from "../tool-registry.js";
import type { JsonValue } from "../primitives/index.js";
import { AGENT_WRITE_CONFIRMATION_SETTINGS, AGENT_WRITE_DENIED_SETTINGS, findAgentWriteRule, type AgentSettingWriteRule } from "./agent-write-denylist.js";
import { DefinitionNotFoundError, DefinitionTombstonedError, ForbiddenError, ScopeNotAllowedError, ValueValidationFailedError } from "./errors.js";
import { getEffective, resolveDefinitionRaw, validateValueAgainstSchema } from "./settings.js";
import type { SettingsToolDeps } from "./tool-registrations.js";
import { SCOPE_BIT, type SettingDefinitionRecord, type SettingValueRecord } from "./types.js";
import { clear, deriveRequiredPermission, set, type SettingsWriteServiceDeps } from "./write-service.js";

export type SettingsValueWriteToolId = "settings_set_value" | "settings_clear_value";

/** Host-only port. This request is never an agent input and only the host's authenticated
 * human transport or a persisted human identity grant may answer it. Model input never authorizes it. */
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

const WRITE_FIELDS: Record<SettingsValueWriteToolId, readonly string[]> = {
  settings_set_value: ["namespace", "key", "value", "scope"],
  settings_clear_value: ["namespace", "key", "scope"],
};

/** Strict boundary, including direct handler calls. JSON is cloned before the first await
 * so a held-open card cannot consent to a value later changed by the caller. O(input size).
 * Refusal order: non-object, unexpected field, namespace, key, scope, missing value, non-JSON value. */
function parseTarget(toolId: SettingsValueWriteToolId, raw: unknown): WriteTarget {
  const input = requireInputObject(toolId, raw);
  const fields = WRITE_FIELDS[toolId];
  const extra = Object.keys(input).find((key) => !fields.includes(key));
  if (extra) throw new ToolInputError({ message: `${toolId}: unexpected input '${extra}'. Only ${fields.join(", ")} are accepted; the caller's own user layer is the only user target.` });
  const namespace = requireCoordinate(toolId, input, "namespace");
  const key = requireCoordinate(toolId, input, "key");
  const scope = parseScope(toolId, input.scope);
  if (toolId === "settings_clear_value") return { namespace, key, scope };
  return { namespace, key, scope, value: snapshotJsonValue(toolId, input) };
}

function requireInputObject(toolId: SettingsValueWriteToolId, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ToolInputError({ message: `${toolId}: input must be an object containing namespace and key.` });
  return raw as Record<string, unknown>;
}

function requireCoordinate(toolId: SettingsValueWriteToolId, input: Record<string, unknown>, field: "namespace" | "key"): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) throw new ToolInputError({ message: `${toolId}: '${field}' must be a non-empty string. Call settings_list_definitions to see valid keys.` });
  return value;
}

/** Omitted means workspace; anything other than workspace/user (including null and global) is refused. */
function parseScope(toolId: SettingsValueWriteToolId, raw: unknown): "workspace" | "user" {
  const scope = raw === undefined ? "workspace" : raw;
  if (scope !== "workspace" && scope !== "user") throw new ToolInputError({ message: `${toolId}: scope must be 'workspace' or 'user'; global settings are not writable by this tool.` });
  return scope;
}

function snapshotJsonValue(toolId: SettingsValueWriteToolId, input: Record<string, unknown>): JsonValue {
  if (!("value" in input)) throw new ToolInputError({ message: `${toolId}: a JSON 'value' is required.` });
  // The executor validates JSON input too. The round trip protects direct callers and isolates
  // the snapshot; values JSON would silently change (NaN, undefined, functions) are rejected.
  // A serialization that yields nothing makes JSON.parse throw, so it is refused the same way.
  try {
    return JSON.parse(JSON.stringify(input.value, rejectNonJson)) as JsonValue;
  } catch (cause) {
    throw new ToolInputError({ message: `${toolId}: value must be valid JSON.` }, { cause });
  }
}

/** `typeof` results JSON cannot represent. */
const NON_JSON_TYPES: ReadonlySet<string> = new Set(["undefined", "function", "symbol"]);

function rejectNonJson(_key: string, value: unknown): unknown {
  const nonFiniteNumber = typeof value === "number" && !Number.isFinite(value);
  if (NON_JSON_TYPES.has(typeof value) || nonFiniteNumber) throw new Error("not JSON");
  return value;
}

/** Definition/scope/value preflight for readable refusal before any card. O(1) repository
 * lookups plus alias resolution and schema validation, with no writes. */
async function resolveTarget(deps: SettingsToolDeps, target: WriteTarget, isSet: boolean): Promise<SettingDefinitionRecord> {
  const definition = await resolveDefinitionRaw({ repo: deps.settingsRepo }, { namespace: target.namespace, key: target.key, workspaceId: deps.workspaceId });
  const name = `${target.namespace}.${target.key}`;
  if (!definition) throw new DefinitionNotFoundError(`setting '${name}' was not found`);
  if (definition.status === "tombstone") throw new DefinitionTombstonedError(`setting '${name}' has been tombstoned`);
  const scopeAllowed = (definition.scopes & SCOPE_BIT[target.scope]) !== 0;
  if (!scopeAllowed) throw new ScopeNotAllowedError(name);
  if (isSet && !validateValueAgainstSchema(definition.schema, target.value!)) throw new ValueValidationFailedError(`value for '${name}' does not match the definition schema`);
  return definition;
}

/** Reads exactly the override being changed, never an effective value or another principal.
 * One repository read, O(1) outside adapter cost. */
function readLayer(deps: SettingsToolDeps, target: WriteTarget, settingId: string, principalId: string): Promise<SettingValueRecord | null> {
  const base = { workspaceId: deps.workspaceId, settingId };
  return target.scope === "user" ? deps.settingsRepo.getUserValue({ ...base, principalId }) : deps.settingsRepo.getWorkspaceValue(base);
}

/** The effective agent-write key policy: package denials plus host extensions (never agent input),
 * and the host's confirmation policy (replacing the package defaults) plus host extensions. O(r). */
export function agentWriteRules(deps: SettingsToolDeps): { denied: AgentSettingWriteRule[]; confirmation: AgentSettingWriteRule[] } {
  return {
    denied: [...AGENT_WRITE_DENIED_SETTINGS, ...(deps.extraDeniedSettings ?? [])],
    confirmation: [...(deps.confirmationSettings ?? AGENT_WRITE_CONFIRMATION_SETTINGS), ...(deps.extraConfirmationSettings ?? [])],
  };
}

/** Fail closed on host-denied keys, including a protected target reached through an alias.
 * Returns a confirmation rule if either coordinate needs one; O(r) in fixed policy rules. */
function writePolicy(deps: SettingsToolDeps, toolId: SettingsValueWriteToolId, target: WriteTarget, definition?: SettingDefinitionRecord) {
  const targets = definition ? [target, definition] : [target];
  const { denied, confirmation } = agentWriteRules(deps);
  for (const coordinate of targets) {
    const rule = findAgentWriteRule(denied, coordinate);
    if (rule) throw new ToolInputError({ message: `${toolId}: '${coordinate.namespace}.${coordinate.key}' can't be changed by the assistant: ${rule.reason}. The owner can change it in Settings.` });
  }
  for (const coordinate of targets) {
    const rule = findAgentWriteRule(confirmation, coordinate);
    if (rule) return { ...rule, namespace: coordinate.namespace, key: coordinate.key };
  }
  return undefined;
}

/** Maps expected caller-fixable errors; infrastructure failures remain untouched. O(1). */
function rethrowWriteError(error: unknown, toolId: SettingsValueWriteToolId, target: WriteTarget, permission: string): never {
  if (error instanceof DefinitionNotFoundError || error instanceof DefinitionTombstonedError) throw new ToolInputError({ message: `${toolId}: ${error.message}. Call settings_list_definitions to see valid keys.` }, { cause: error });
  if (error instanceof ScopeNotAllowedError) throw new ToolInputError({ message: `${toolId}: '${target.namespace}.${target.key}' can't be set ${target.scope === "user" ? "per-user" : "at workspace scope"}. Call settings_list_definitions to see allowed scopes.` }, { cause: error });
  if (error instanceof ValueValidationFailedError) throw new ToolInputError({ message: `${toolId}: ${error.message}. Call settings_list_definitions and use a value matching the setting's schema.` }, { cause: error });
  if (error instanceof ForbiddenError || error instanceof PermissionDeniedError) throw new ToolInputError({ message: `${toolId}: permission '${permission}' is required. Ask the owner to grant it before retrying.` }, { cause: error });
  throw error;
}

/**
 * Builds `write-service.ts`'s own five-field dep shape from `RouteDeps`.
 *
 * Deliberately duplicates a host's own HTTP admin layer's equivalent field-mapping helper rather
 * than importing it, for the reason `tool-registrations.ts`'s header already gives about
 * `resolveOwnOrOtherPrincipalRead`: this is domain-owned wiring, and importing from a host's HTTP
 * admin layer would invert the ports/adapters direction. It is a field mapping, not logic, so the
 * two copies carry no behavioral drift risk — and `write-service.ts` is the single chokepoint
 * either way, so a divergence here could only produce a missing dependency, which fails loudly.
 */
export function toWriteDeps(routeDeps: SettingsToolDeps): SettingsWriteServiceDeps {
  return {
    repo: routeDeps.settingsRepo,
    clock: routeDeps.clock,
    ids: routeDeps.idGen,
    authorize: routeDeps.authorize,
    principals: routeDeps.principalRepo,
  };
}

/** Cancellation is checked at each step that precedes a card or a write. O(1). */
function assertRunActive(ctx: ToolExecutionContext, toolId: SettingsValueWriteToolId): void {
  if (ctx.signal.aborted) throw new ToolInputError({ message: `${toolId}: the run ended before the change could be applied. Nothing was changed.` });
}

interface WriteRequest {
  ctx: ToolExecutionContext;
  toolId: SettingsValueWriteToolId;
  target: WriteTarget;
  permission: string;
}

/** What the readiness/authorization/preflight phase established, carried into the card and the write. */
interface PreparedWrite {
  definition: SettingDefinitionRecord;
  rule: ReturnType<typeof writePolicy>;
  layer: SettingValueRecord | null;
  previous: JsonValue | null;
}

/** Effects: policy -> readiness -> authorize -> definition preflight -> raw read. No writes. */
async function prepareWrite(deps: SettingsToolDeps, request: WriteRequest): Promise<PreparedWrite> {
  const { ctx, toolId, target, permission } = request;
  assertRunActive(ctx, toolId);
  writePolicy(deps, toolId, target);
  await Promise.all([deps.settingsReady, deps.settingsUiTabsReady]);
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission }, { entityType: "setting-value" });
  const definition = await resolveTarget(deps, target, toolId === "settings_set_value");
  const rule = writePolicy(deps, toolId, target, definition);
  const layer = await readLayer(deps, target, definition.settingId, ctx.principal.id);
  const previous = layer?.state === "set" ? structuredClone(layer.valueJson) : null;
  return { definition, rule, layer, previous };
}

/** Opens the host's human card for a protected key, then proves nothing changed while it was open.
 * Fails closed without a confirmation port, on any answer but `true`, and on a stale definition or layer. */
async function confirmProtectedWrite(deps: SettingsToolDeps, request: WriteRequest, prepared: PreparedWrite & { rule: NonNullable<PreparedWrite["rule"]> }, options?: ToolExecutionOptions): Promise<void> {
  const { ctx, toolId, target } = request;
  const { definition, layer, previous, rule } = prepared;
  const isSet = toolId === "settings_set_value";
  if (!deps.confirmWrite) throw new ToolInputError({ message: `${toolId}: '${rule.namespace}.${rule.key}' requires a human confirmation card: ${rule.reason}. The owner can change it in Settings.` });
  const confirmed = await deps.confirmWrite({ ctx, toolId, namespace: rule.namespace, key: rule.key, scope: target.scope, previous: structuredClone(previous), ...(isSet ? { value: structuredClone(target.value!) } : {}), reason: rule.reason }, options);
  if (confirmed !== true) throw new ToolInputError({ message: `${toolId}: the human did not confirm the change. Nothing was changed.` });
  const current = await resolveTarget(deps, target, isSet);
  const currentLayer = await readLayer(deps, target, current.settingId, ctx.principal.id);
  if (current.settingId !== definition.settingId || current.version !== definition.version || currentLayer?.seq !== layer?.seq) throw new ToolInputError({ message: `${toolId}: this setting changed while the confirmation card was open. Read it again and request a new confirmation. Nothing was changed by this call.` });
}

/** The service write itself; `write-service.ts` rechecks authorization inside its transaction. */
async function applyWrite(deps: SettingsToolDeps, request: WriteRequest, prepared: PreparedWrite) {
  const { ctx, toolId, target } = request;
  const { definition, previous } = prepared;
  const writeDeps = toWriteDeps(deps);
  // Resolved coordinates preserve host validators even when the request named an alias.
  const input = { namespace: definition.namespace, key: definition.key, scope: target.scope, workspaceId: deps.workspaceId, callerPrincipalId: ctx.principal.id, authWorkspaceId: deps.workspaceId };
  const key = `${target.namespace}.${target.key}`;
  if (toolId === "settings_set_value") {
    const result = await (deps.setValue ?? set)({ deps: writeDeps, input: { ...input, value: target.value! } });
    return { key, scope: target.scope, previous, value: result.value, revisionSeq: result.revisionSeq };
  }
  await clear({ deps: writeDeps, input });
  const effective = await getEffective({ repo: deps.settingsRepo }, { namespace: definition.namespace, key: definition.key, scopeContext: { workspaceId: deps.workspaceId, principalId: ctx.principal.id } });
  return { key, scope: target.scope, previous, effective: effective?.value ?? null };
}

/** Builds one value-write handler. Effects: authorize -> raw read -> optional human card ->
 * service write -> result. The service rechecks authorization and performs its normal transaction.
 * @complexity O(value size + rule count) plus bounded repository calls and a human wait.
 * @throws ToolInputError for invalid input, denied keys, absent/declined/stale confirmation. */
export function buildSettingsValueWriteHandler(deps: SettingsToolDeps, toolId: SettingsValueWriteToolId): ToolHandler {
  return async (ctx, options?: ToolExecutionOptions) => {
    // Keep the delegating actor/run bound across readiness, consent and fresh service checks.
    // parseTarget owns JSON validation/snapshotting so invalid values retain their exact refusal.
    ctx = { ...ctx, principal: { ...ctx.principal }, run: { ...ctx.run } };
    const target = parseTarget(toolId, ctx.input);
    const permission = deriveRequiredPermission({ scope: target.scope, callerPrincipalId: ctx.principal.id });
    const request: WriteRequest = { ctx, toolId, target, permission };
    try {
      const prepared = await prepareWrite(deps, request);
      // Cancellation may have arrived during readiness, authorization or the raw read.
      // Check before opening a card so a finished run cannot leave a new exchange waiting.
      assertRunActive(ctx, toolId);
      if (prepared.rule) await confirmProtectedWrite(deps, request, { ...prepared, rule: prepared.rule }, options);
      assertRunActive(ctx, toolId);
      return await applyWrite(deps, request, prepared);
    } catch (error) { return rethrowWriteError(error, toolId, target, permission); }
  };
}
