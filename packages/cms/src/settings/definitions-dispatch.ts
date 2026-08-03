import type { JsonValue, UUID } from "../core/ports.js";
import type { SettingOwnerKind, SettingValueSchema } from "./types.js";
import { renameDefinition, retypeDefinition, deprecateDefinition, tombstoneDefinition } from "./write-service.js";
import type { SettingsWriteServiceDeps } from "./write-service.js";

/**
 * @file `SETTINGS_REGISTER_DEFINITIONS` per-op dispatch (ADR-042 item 2).
 *
 * A route handler's inline `switch (op)` shape can grow into the
 * highest-complexity function in a codebase because four of its five branches
 * are the same shape: parse the raw request item, call one write-service
 * function, record `applied`. This table is that shape, written once per op;
 * a host's route becomes a lookup + call.
 *
 * `register` is deliberately NOT here — it batches every item into a single
 * `registerDefinitions()` call (one shared `authorize()` check for the whole batch) instead
 * of running one write per item, so it stays a route-level special case alongside the
 * `default: unknown op` branch.
 */

/** The raw request-body shape for a non-`register` op item, already namespace/key/workspace-normalized. */
export interface DefinitionOpRequestItem {
  namespace: string;
  key: string;
  ownerKind: SettingOwnerKind;
  workspaceId: UUID | null;
  newNamespace?: string;
  newKey?: string;
  schemaJson?: SettingValueSchema;
  defaultJson?: JsonValue | null;
  coercionJson?: string | { tag?: string };
}

export interface DefinitionOpContext {
  deps: SettingsWriteServiceDeps;
  callerPrincipalId: UUID;
  authWorkspaceId: UUID;
}

export type DefinitionOpHandler = (ctx: DefinitionOpContext, item: DefinitionOpRequestItem) => Promise<void>;

/** `coercionJson` may arrive as a bare coercer tag string or `{tag}`; defaults to the identity coercer. */
function resolveCoercionTag(coercionJson: string | { tag?: string } | undefined): string {
  return typeof coercionJson === "string" ? coercionJson : (coercionJson?.tag ?? "identity");
}

/**
 * The closed set of non-`register` ops: an untrusted `op` string is narrowed to this union at the
 * parse boundary via {@link parseNonRegisterDefinitionOp} BEFORE any dispatch table lookup, so the
 * lookup key is provably one of these four literals, not an arbitrary attacker-controlled string.
 * `satisfies Record<NonRegisterDefinitionOp, DefinitionOpHandler>` below additionally makes the
 * dispatch table itself compile-time exhaustive: adding a fifth op here without a matching handler
 * is a type error, not a silent runtime gap.
 */
export const NON_REGISTER_DEFINITION_OP_NAMES = ["rename", "retype", "deprecate", "tombstone"] as const;
export type NonRegisterDefinitionOp = (typeof NON_REGISTER_DEFINITION_OP_NAMES)[number];

/** Narrows an untrusted `op` string to {@link NonRegisterDefinitionOp}, or `null` if it isn't one. */
export function parseNonRegisterDefinitionOp(op: string): NonRegisterDefinitionOp | null {
  return (NON_REGISTER_DEFINITION_OP_NAMES as readonly string[]).includes(op)
    ? (op as NonRegisterDefinitionOp)
    : null;
}

/**
 * Op name -> handler, keyed only by {@link NonRegisterDefinitionOp} (never an arbitrary string —
 * see {@link parseNonRegisterDefinitionOp}). Still built `Object.create(null)`-based as
 * defense-in-depth: even though the parse boundary should make prototype-chain keys unreachable,
 * the null-prototype construction means a lookup can never resolve an inherited value even under a
 * future regression that skips the parse step.
 */
const nonRegisterDefinitionOps = {
  rename: async (ctx, item) => {
    await renameDefinition({
      deps: ctx.deps,
      input: {
        namespace: item.namespace,
        key: item.key,
        workspaceId: item.workspaceId,
        newNamespace: item.newNamespace ?? "",
        newKey: item.newKey ?? "",
        callerPrincipalId: ctx.callerPrincipalId,
        authWorkspaceId: ctx.authWorkspaceId,
      },
    });
  },
  retype: async (ctx, item) => {
    await retypeDefinition({
      deps: ctx.deps,
      input: {
        namespace: item.namespace,
        key: item.key,
        workspaceId: item.workspaceId,
        schema: item.schemaJson as SettingValueSchema,
        defaultValue: item.defaultJson ?? null,
        coercionTag: resolveCoercionTag(item.coercionJson),
        newNamespace: item.newNamespace,
        newKey: item.newKey,
        callerPrincipalId: ctx.callerPrincipalId,
        authWorkspaceId: ctx.authWorkspaceId,
      },
    });
  },
  deprecate: async (ctx, item) => {
    await deprecateDefinition({
      deps: ctx.deps,
      input: {
        namespace: item.namespace,
        key: item.key,
        workspaceId: item.workspaceId,
        callerPrincipalId: ctx.callerPrincipalId,
        authWorkspaceId: ctx.authWorkspaceId,
      },
    });
  },
  tombstone: async (ctx, item) => {
    await tombstoneDefinition({
      deps: ctx.deps,
      input: {
        namespace: item.namespace,
        key: item.key,
        workspaceId: item.workspaceId,
        callerPrincipalId: ctx.callerPrincipalId,
        authWorkspaceId: ctx.authWorkspaceId,
      },
    });
  },
} satisfies Record<NonRegisterDefinitionOp, DefinitionOpHandler>;

export const NON_REGISTER_DEFINITION_OPS: Record<NonRegisterDefinitionOp, DefinitionOpHandler> = Object.assign(
  Object.create(null) as Record<NonRegisterDefinitionOp, DefinitionOpHandler>,
  nonRegisterDefinitionOps
);
