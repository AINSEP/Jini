import type { Clock, IdGenerator, JsonValue, UUID } from "../primitives/index.js";
import type { SettingsPrincipalLookupPort } from "./principal-lookup.js";
import type { SettingsRepoPort } from "./ports.js";
import { resolveDefinitionRaw } from "./settings.js";
import { SCOPE_BIT, type SettingValueSchema } from "./types.js";
import { reconcileDefinitionDefault, registerDefinitions, type AuthorizeFn } from "./write-service.js";

/**
 * @file The one boot-time "register these definitions if they aren't already,
 * and keep their defaults honest if they are" loop, shared by every registrar
 * that backs a settings-dialog tab.
 *
 * This exists because the loop is genuinely identical everywhere it appears —
 * the first host to use this library had one hand-written copy per tab before
 * this helper existed, and each additional tab would have added another. A
 * host's per-tab modules keep what actually differs (the namespace, the key
 * list, each key's schema and default) and hand it to
 * `ensureSettingDefinitions` as data.
 *
 * Site-owned groups also share registration, but keep their bespoke get/set
 * services, validation and domain permissions. Unlike code-owned core defaults,
 * an existing site definition is never reconciled: its stored default belongs
 * to the site. The explicit site target preserves that ownership difference.
 */

/** One key's registration data — everything `registerDefinitions` needs that
 *  varies per key. */
export interface SettingDefinitionSpec<Key extends string = string> {
  key: Key;
  schema: SettingValueSchema;
  /**
   * Every non-secret definition needs a NON-NULL default.
   * `validateDefinitionInput` (`settings.ts`) rejects a null `default_json` for
   * every non-secret definition, full stop — there is no nullable-schema
   * carve-out in the actual check, regardless of what a nullable schema might
   * suggest. A field that is nullable in spirit needs a sentinel instead (a
   * distinguished non-null value the host's own code treats as "unset"). See
   * `docs/decisions/settings-json-schema-variant.md` for why this diverges
   * from this ledger's own originating design notes.
   *
   * Typed `Exclude<…, null>` rather than a bare primitive union: `DefinitionInput`
   * already accepts any `JsonValue`, and a `{ type: "json" }` definition needs an
   * array/object default. Excluding `null` at the type level keeps the non-null
   * rule above a compile error rather than a boot-time throw.
   */
  defaultValue: Exclude<JsonValue, null>;
  /**
   * Bitmask over `SCOPE_BIT`. Defaults to `workspace`, which is what most
   * settings-dialog tabs want: one operator's choice shouldn't silently
   * become every workspace's. Pass `SCOPE_BIT.user` (or a mask including it)
   * for a genuinely per-operator preference.
   */
  scopes?: number;
}

export interface EnsureSettingDefinitionsDeps {
  settingsRepo: SettingsRepoPort;
  clock: Clock;
  ids: IdGenerator;
  principals: SettingsPrincipalLookupPort;
}

interface SettingDefinitionsInput {
  namespace: string;
  definitions: readonly SettingDefinitionSpec[];
  /** The trusted boot-time actor these writes are attributed to (mirrors a
   *  host's other boot-time registrars' identical convention). */
  systemPrincipalId: UUID;
}

/** Core definitions are platform-wide; site definitions require a workspace.
 * Omitting the target retains the existing core-default reconciliation policy. */
export type EnsureSettingDefinitionsInput = SettingDefinitionsInput & (
  | { ownerKind?: "core"; workspaceId?: never }
  | { ownerKind: "site"; workspaceId: UUID }
);

/** Boot-time infra work is trusted by construction — mirrors every other
 *  `ensure*SettingDefinitions`'s identical shim. */
const alwaysAllowBoot: AuthorizeFn = async () => ({ allowed: true, reason: "system_boot" });

/**
 * Idempotently registers every definition in `input.definitions` under
 * `input.namespace`, and reconciles the stored default of any that already
 * exist to the default source declares. Safe to call on every boot.
 *
 * The reconcile half matters as much as the register half: registration is
 * once-only, so without it a `defaultValue` edited in source never reaches an
 * install that has booted before. Code owns `core` defaults; the stored row
 * does not get to outvote it.
 *
 * By default definitions are `ownerKind: "core"` — a settings-dialog
 * tab configures a platform-level capability, not per-site content. Per the
 * namespace-fence CHECK, `owner_kind='core'` requires `workspaceId: null` at
 * the DEFINITION level regardless of which workspace is booting, while the
 * `scopes` bitmask still lets each workspace (or user) hold its own VALUE row.
 *
 * Site targets instead use their workspace for lookup, registration and the
 * authorization context, and skip every existing row without changing defaults.
 * Writes are sequential so boot never overlaps transactions on one connection.
 * Errors from the ledger propagate to the caller's readiness promise.
 *
 * @example ensureSettingDefinitions(deps, { namespace: "site.seo", definitions,
 *   systemPrincipalId, ownerKind: "site", workspaceId });
 * @complexity O(n) time, O(1) auxiliary space for n definitions — each is one
 * lookup plus at most one registration or default reconciliation.
 */
export async function ensureSettingDefinitions(
  deps: EnsureSettingDefinitionsDeps,
  input: EnsureSettingDefinitionsInput,
): Promise<void> {
  const ownerKind = input.ownerKind ?? "core";
  const workspaceId = input.ownerKind === "site" ? input.workspaceId : null;
  const authWorkspaceId = workspaceId ?? input.systemPrincipalId;
  const writeDeps = {
    repo: deps.settingsRepo,
    clock: deps.clock,
    ids: deps.ids,
    authorize: alwaysAllowBoot,
    principals: deps.principals,
  };

  for (const def of input.definitions) {
    const existing = await resolveDefinitionRaw(
      { repo: deps.settingsRepo },
      { namespace: input.namespace, key: def.key, workspaceId },
    );
    if (existing) {
      // Core registration is once-only, but the DEFAULT is not. Without this, a
      // `defaultValue` changed in source is unreachable in any install that
      // has already booted — the stored `default_json` from first boot keeps
      // winning, for every settings-dialog tab. See `reconcileDefinitionDefault`
      // for the bug this closes.
      //
      // Three slots are deliberately left alone rather than reconciled:
      // a non-`active` row (deprecated/tombstoned) is not ours to rewrite; a
      // non-`core` row is operator-owned; and a row whose identity differs
      // from the slot we asked for means `resolveDefinitionRaw` followed an
      // alias, so rewriting it would silently change a DIFFERENT definition's
      // default. `reconcileDefinitionDefault` would throw on the first two —
      // this skips them quietly because boot must not fail on them.
      const isSameSlot = existing.namespace === input.namespace && existing.key === def.key;
      if (ownerKind === "core" && existing.status === "active" && existing.ownerKind === "core" && isSameSlot) {
        await reconcileDefinitionDefault({
          deps: writeDeps,
          input: {
            namespace: input.namespace,
            key: def.key,
            workspaceId: null,
            defaultValue: def.defaultValue,
            callerPrincipalId: input.systemPrincipalId,
            authWorkspaceId,
          },
        });
      }
      continue;
    }

    await registerDefinitions({
      deps: writeDeps,
      input: {
        callerPrincipalId: input.systemPrincipalId,
        // Platform (core) definitions aren't scoped to any one workspace, but
        // `registerDefinitions`'s authorization check still needs a workspace
        // context to authorize against — the seeded workspace mirrors every
        // other boot-time registrar's identical `authWorkspaceId` shape.
        authWorkspaceId,
        definitions: [
          {
            namespace: input.namespace,
            key: def.key,
            ownerKind,
            workspaceId,
            schema: def.schema,
            defaultValue: def.defaultValue,
            scopes: def.scopes ?? SCOPE_BIT.workspace,
            secret: false,
          },
        ],
      },
    });
  }
}
