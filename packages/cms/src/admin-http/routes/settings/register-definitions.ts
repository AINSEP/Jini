import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { JsonValue } from "@jini-ai/core/primitives";
import {
  NON_REGISTER_DEFINITION_OPS, parseNonRegisterDefinitionOp, registerDefinitions,
  AliasDepthExceededError, DefinitionInvalidError, DefinitionTombstonedError, ForbiddenError, RenameRetypeConflictError, SecretNotSupportedError,
  type DefinitionInput, type DefinitionOpContext, type DefinitionOpRequestItem, type SettingOwnerKind, type SettingValueSchema,
  type SettingsWriteServiceDeps,
} from "@jini-ai/core/settings";

import {
  runSettingsRoute, settingsRouteInput,
  type SettingsErrorRung, type SettingsRouteInput, type SettingsRoutePrincipal, type SettingsWriteRouteBaseDeps,
} from "./shared.js";

/** The deps this route reads: the write base plus the host-bound write-service deps (repo, clock,
 * ids, authorizer, principal lookup), built per request as the hand-written route did. */
export interface SettingsRegisterDefinitionsRouteDeps extends SettingsWriteRouteBaseDeps {
  writeServiceDeps: () => SettingsWriteServiceDeps;
}

/** The `catch` ladder `POST /settings/definitions` always had, in order. */
export const REGISTER_DEFINITIONS_ERROR_MAPPINGS: readonly SettingsErrorRung[] = [
  { matches: (e) => e instanceof SecretNotSupportedError, status: 400, code: "SECRET_NOT_SUPPORTED" },
  { matches: (e) => e instanceof DefinitionInvalidError, status: 400, code: "DEFINITION_INVALID" },
  { matches: (e) => e instanceof RenameRetypeConflictError, status: 409, code: "RENAME_RETYPE_CONFLICT" },
  { matches: (e) => e instanceof AliasDepthExceededError, status: 409, code: "ALIAS_DEPTH_EXCEEDED" },
  { matches: (e) => e instanceof DefinitionTombstonedError, status: 409, code: "DEFINITION_TOMBSTONED" },
  { matches: (e) => e instanceof ForbiddenError, status: 403, code: "FORBIDDEN" },
];

/** `String(value ?? fallback)`: a missing field reads as the fallback, anything else as its string form.
 * @complexity O(1). */
function readString({ value }: { value: unknown }, { fallback = "" }: { fallback?: string } = {}): string {
  return String(value ?? fallback);
}

/** The batch's items, or `null` when `definitions` is not an array (including a missing body). @complexity O(1). */
function parseDefinitionItems({ body }: { body: unknown }, _options: Record<string, never> = {}): unknown[] | null {
  const definitions = (body as { definitions?: unknown } | null)?.definitions;
  return Array.isArray(definitions) ? definitions : null;
}

type DefinitionItemOutcome =
  | { readonly applied: { key: string; op: string; status: string } }
  | { readonly unknownOp: string };

/** The non-register op's request item; the three op-specific fields are copied only when present.
 * @complexity O(1). */
function toOpItem(
  { item, base }: { item: Record<string, unknown>; base: Omit<DefinitionOpRequestItem, "newNamespace" | "newKey" | "coercionJson"> },
  _options: Record<string, never> = {},
): DefinitionOpRequestItem {
  return {
    ...base,
    ...(item.newNamespace === undefined ? {} : { newNamespace: item.newNamespace as string }),
    ...(item.newKey === undefined ? {} : { newKey: item.newKey as string }),
    ...(item.coercionJson === undefined ? {} : { coercionJson: item.coercionJson as string | { tag?: string } }),
  };
}

/**
 * One batch item: a `register` is queued (registered together after the loop); any other known op
 * runs now; an unknown op is reported to the caller. A site-owned definition lives in the
 * authorized workspace's partition; every other owner kind is platform-wide (`workspaceId: null`).
 * @complexity O(1) plus the op's own ledger work.
 */
async function applyDefinitionItem(
  { raw, opCtx, toRegister }: { raw: unknown; opCtx: DefinitionOpContext; toRegister: DefinitionInput[] }, _options: Record<string, never> = {}
): Promise<DefinitionItemOutcome> {
  const item = raw as Record<string, unknown>;
  const ownerKind = item.ownerKind as SettingOwnerKind;
  const namespace = readString({ value: item.namespace });
  const key = readString({ value: item.key });
  const op = readString({ value: item.op }, { fallback: "register" });
  const workspaceId = ownerKind === "site" ? opCtx.authWorkspaceId : null;
  const defaultValue = (item.defaultJson ?? null) as JsonValue | null;
  if (op === "register") {
    toRegister.push({
      namespace, key, ownerKind, workspaceId, schema: item.schemaJson as SettingValueSchema, defaultValue,
      scopes: Number(item.scopes), secret: Boolean(item.secret ?? false),
    });
    return { applied: { key: `${namespace}.${key}`, op, status: "applied" } };
  }
  const parsedOp = parseNonRegisterDefinitionOp({ op });
  if (!parsedOp) return { unknownOp: op };
  const opItem = toOpItem({ item, base: { namespace, key, ownerKind, workspaceId, schemaJson: item.schemaJson as SettingValueSchema, defaultJson: defaultValue } });
  await NON_REGISTER_DEFINITION_OPS[parsedOp]({ ctx: opCtx, item: opItem });
  return { applied: { key: `${namespace}.${key}`, op, status: "applied" } };
}

/**
 * POST a batch of definition ops (register / rename / retype / tombstone …). Authorizes first,
 * then validates the batch shape; items apply in order and an unknown op stops the batch with a
 * 400 (earlier non-register ops have already applied, as before). Registers go last, together.
 */
export const settingsRegisterDefinitionsRoute = defineJsonRoute<SettingsRouteInput, { applied: Array<{ key: string; op: string; status: string }> }, SettingsRegisterDefinitionsRouteDeps, SettingsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/definitions",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    await auth({ permission: "settings.definitions.manage", entityType: "setting-definition" });
    const items = parseDefinitionItems({ body: input.body });
    if (!items) rejectRoute({ status: 400, error: "'definitions' must be an array", code: "VALIDATION_ERROR" });
    const writeDeps = deps.writeServiceDeps();
    const opCtx: DefinitionOpContext = { deps: writeDeps, callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId };
    const applied: Array<{ key: string; op: string; status: string }> = [];
    const toRegister: DefinitionInput[] = [];
    for (const raw of items) {
      const outcome = await applyDefinitionItem({ raw, opCtx, toRegister });
      if ("unknownOp" in outcome) rejectRoute({ status: 400, error: `unknown op '${outcome.unknownOp}'`, code: "VALIDATION_ERROR" });
      applied.push(outcome.applied);
    }
    if (toRegister.length > 0) {
      await registerDefinitions({ deps: writeDeps, input: { definitions: toRegister, callerPrincipalId: principal.id, authWorkspaceId: deps.workspaceId } });
    }
    return { applied };
  } }, { write: { body: input.body }, mappings: REGISTER_DEFINITIONS_ERROR_MAPPINGS }) }),
});
