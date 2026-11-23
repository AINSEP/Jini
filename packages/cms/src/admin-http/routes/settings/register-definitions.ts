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

/** Coerces a possibly-absent field to a string, matching this route's `?? ""`/`?? "register"`
 *  fallback shape everywhere it reads a field off an untrusted batch item.
 *  @complexity O(1). */
function readString({ value }: { value: unknown }, { fallback = "" }: { fallback?: string } = {}): string {
  return String(value ?? fallback);
}

/** Body's `definitions` array, or `null` if it's missing or not an array.
 *  @complexity O(1). */
function parseDefinitionItems({ body }: { body: unknown }, _options: Record<string, never> = {}): unknown[] | null {
  const definitions = (body as { definitions?: unknown } | null)?.definitions;
  return Array.isArray(definitions) ? definitions : null;
}

/** One batch item's outcome: queued for the batched `register` call, or already applied via its
 *  non-register op's write-service call. `unknownOp` carries the rejected op string so the caller
 *  can 400 without this function rejecting the request itself. */
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
 *
 * Normalizes one request item and either queues it for the batched `registerDefinitions` call in
 * the route below (`register` is not dispatched immediately) or runs its non-register op now via
 * the Phase-2 dispatch table (`NON_REGISTER_DEFINITION_OPS`).
 *
 * @complexity O(1) plus, for non-register ops, one write-service call.
 */
async function applyDefinitionItem(
  { raw, opCtx, toRegister }: { raw: unknown; opCtx: DefinitionOpContext; toRegister: DefinitionInput[] }, _options: Record<string, never> = {}
): Promise<DefinitionItemOutcome> {
  const item = raw as Record<string, unknown>;
  const ownerKind = item.ownerKind as SettingOwnerKind;
  const namespace = readString({ value: item.namespace });
  const key = readString({ value: item.key });
  const op = readString({ value: item.op }, { fallback: "register" });
  // Platform defs (core/theme) are workspace_id=null; site-owned defs carry this workspace's
  // id (REQ-02 namespace fence, `settings.ts`'s `NAMESPACE_FENCE`).
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
 * POST register/rename/retype/deprecate/tombstone setting definitions
 * (SPEC-007 api.spec.md `SETTINGS_REGISTER_DEFINITIONS`, tasks.md T038).
 * Authorizes first, then validates the batch shape; items apply in order and an unknown op stops
 * the batch with a 400 (earlier non-register ops have already applied, as before). Registers go
 * last, together.
 *
 * Path deviation: api.spec.md §1 lists the literal path
 * `/api/v1/admin/settings/definitions` (no workspace segment). Every other
 * admin route spec in the CMS mounts under
 * `/api/admin/v1/workspaces/:workspaceId/...` and validates `:workspaceId`
 * against `deps.workspaceId` — this route follows that established convention
 * instead, since v1 is single-workspace and every sibling admin route already
 * does the same 404-on-mismatched-workspace check.
 *
 * Each item's `op` (default `"register"`) routes to the matching Phase-2
 * write-service function. All five share the `settings.definitions.manage`
 * gate — each function re-checks it internally (chokepoint discipline), but
 * this route also pre-checks it once up front for a fast, structured 403
 * (the explicit-authorize-then-call pattern) rather than parsing a thrown
 * `ForbiddenError`'s message.
 *
 * Deviation: `coercionJson` (api.spec.md's field name for `retype`) is
 * declared as an opaque `object` there, but `retypeDefinition` needs a string
 * `coercionTag` naming an already-registered coercer (the settings service's
 * `registerCoercer` registry). This route accepts either a bare string or an
 * object with a `tag` field, falling back to `"identity"` — smallest
 * reasonable bridge between the two shapes, disclosed here rather than
 * silently guessing.
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
