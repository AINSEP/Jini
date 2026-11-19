import { nowIso as kernelNowIso } from "../primitives/index.js";
import type { Clock, IdGenerator, UUID } from "../primitives/index.js";
import type { SettingsPrincipalLookupPort } from "./principal-lookup.js";
import { DefinitionInvalidError, DefinitionNotFoundError, DefinitionTombstonedError, ForbiddenError } from "./errors.js";
import type { SettingsRepoPort } from "./ports.js";
import { type DefinitionInput, invalidateDefinitionNamespaceCache, validateDefinitionInput } from "./settings.js";
import { type SettingDefinitionRecord, type SettingScope } from "./types.js";
/**
 * @file `SettingsWriteService` — the single write chokepoint.
 *
 * Purpose:
 * The ONLY value/definition-mutation path. Repo write methods
 * (`saveDefinition`/`save*Value`/`appendRevision`/`delete*Value`) must never
 * be called from outside the settings write-service modules (Code Review
 * enforces this boundary).
 *
 * Every export here: `authorize` first (fail-closed) -> validate ->
 * write value/definition row + revision in one transaction.
 *
 * `deriveRequiredPermission` is the sole source of truth for the self-vs-
 * other permission rule (behavior.spec.md §1.3) — closes Red-Team.
 * target-principal checks use a host-supplied active-principal lookup over core Principal;
 * identity and membership policy remain at the host boundary.
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */

/** Matches `core/commands/command.ts`'s `AuthorizeFn` shape structurally — no import, kept decoupled. */
export type AuthorizeFn = (params: {
  principalId: UUID;
  permission: string;
  workspaceId: UUID;
  entityType?: string;
  entityId?: UUID;
}) => Promise<{ allowed: boolean; reason: string }>;

export interface SettingsWriteServiceDeps {
  repo: SettingsRepoPort;
  clock: Clock;
  ids: IdGenerator;
  authorize: AuthorizeFn;
  /** Host lookup must hide disabled and out-of-workspace principals. See docs/decisions/DR-003-settings-ledger-invariants.md. */
  principals: SettingsPrincipalLookupPort;
}

/**
 * behavior.spec.md §1.3 / `[internal-invariant]` — the self-vs-other
 * permission derivation. `targetPrincipalId` omitted or equal to the caller
 * -> `settings.user.self.write`; any other principal -> `settings.user.write`.
 * A divergence between this function and any other implementation of the
 * rule is a fail-open authorization bug (Red-Team ) — this is the only
 * place the rule may be encoded.
 *
 * @complexity O(1), pure.
 * @overallScore 100
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
export function deriveRequiredPermission(input: {
  scope: SettingScope;
  targetPrincipalId?: UUID | undefined;
  callerPrincipalId: UUID;
}): string {
  if (input.scope === "global") return "settings.global.write";
  if (input.scope === "workspace") return "settings.workspace.write";
  const isSelf = input.targetPrincipalId == null || input.targetPrincipalId === input.callerPrincipalId;
  return isSelf ? "settings.user.self.write" : "settings.user.write";
}

export interface RegisterDefinitionsRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    definitions: DefinitionInput[];
    callerPrincipalId: UUID;
    /** The workspace the caller is authorizing in (always required — even platform-def registration is authorized within a workspace context). */
    authWorkspaceId: UUID;
  };
}

/** One definition, one transaction: the row and its `register` revision commit together. Returns the new setting id. */
async function saveRegisteredDefinition(
  { deps, definitionInput, callerPrincipalId }: { deps: SettingsWriteServiceDeps; definitionInput: DefinitionInput; callerPrincipalId: UUID },
): Promise<string> {
  return deps.repo.transaction(async () => {
    const now = kernelNowIso({ clock: deps.clock });
    const settingId = deps.ids.newId();
    await deps.repo.saveDefinition({
      settingId,
      version: 1,
      workspaceId: definitionInput.workspaceId,
      namespace: definitionInput.namespace,
      key: definitionInput.key,
      ownerKind: definitionInput.ownerKind,
      ownerId: definitionInput.ownerId ?? null,
      schema: definitionInput.schema,
      defaultValue: definitionInput.defaultValue,
      scopes: definitionInput.scopes,
      secret: false,
      status: "active",
      aliasOfNamespace: null,
      aliasOfKey: null,
      coercionTag: null,
      createdAt: now,
      updatedAt: now,
    });
    await deps.repo.appendRevision({
      entityKind: "definition",
      settingId,
      scope: null,
      workspaceId: definitionInput.workspaceId,
      principalId: null,
      op: "register",
      beforeJson: null,
      afterJson: null,
      defVersion: 1,
      actor: callerPrincipalId,
      originPluginId: null,
      changeSetId: null,
      createdAt: now,
    });
    return settingId;
  });
}

/** chokepoint write: authorize `settings.definitions.manage` -> validate -> write + revision, one per definition, each its own tx. See docs/decisions/DR-003-settings-ledger-invariants.md. */
export async function registerDefinitions(
  required: RegisterDefinitionsRequired
): Promise<{ registered: string[] }> {
  const { deps, input } = required;

  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission: "settings.definitions.manage",
    workspaceId: input.authWorkspaceId,
    entityType: "setting-definition",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${input.callerPrincipalId}' is not authorized for 'settings.definitions.manage' (${authResult.reason})`
    );
  }

  const registered: string[] = [];
  for (const definitionInput of input.definitions) {
    const validation = validateDefinitionInput(definitionInput);
    if (!validation.valid) throw validation.error;

    registered.push(await saveRegisteredDefinition({ deps, definitionInput, callerPrincipalId: input.callerPrincipalId }));
    invalidateDefinitionNamespaceCache({ repo: deps.repo, namespace: definitionInput.namespace });
  }

  return { registered };
}

/**
 * The single authorization gate shared by every definition-
 * lifecycle op (rename/retype/deprecate/tombstone), matching
 * `registerDefinitions`'s own `settings.definitions.manage` check (same
 * permission also gates `purge`/`coerce` per §7 — high privilege, human-only).
 */
export async function authorizeDefinitionsManage(
  deps: SettingsWriteServiceDeps,
  callerPrincipalId: UUID,
  authWorkspaceId: UUID
): Promise<void> {
  const authResult = await deps.authorize({
    principalId: callerPrincipalId,
    permission: "settings.definitions.manage",
    workspaceId: authWorkspaceId,
    entityType: "setting-definition",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${callerPrincipalId}' is not authorized for 'settings.definitions.manage' (${authResult.reason})`
    );
  }
}

/** Resolves the canonical active definition at (namespace,key,workspaceId), rejecting anything but `status='active'`. */
export async function resolveActiveDefinitionOrThrow(
  deps: SettingsWriteServiceDeps,
  input: { namespace: string; key: string; workspaceId: UUID | null },
  verb: string
): Promise<SettingDefinitionRecord> {
  const current = await deps.repo.findActiveDefinition(input);
  if (!current) {
    throw new DefinitionNotFoundError(`setting '${input.namespace}.${input.key}' was not found`);
  }
  if (current.status === "tombstone") {
    throw new DefinitionTombstonedError(`setting '${input.namespace}.${input.key}' has been tombstoned`);
  }
  if (current.status === "alias") {
    throw new DefinitionInvalidError(
      `cannot ${verb} '${input.namespace}.${input.key}': it is an alias marker, not the canonical active definition`
    );
  }
  return current;
}
export type ActiveDefinition = Awaited<ReturnType<typeof resolveActiveDefinitionOrThrow>>;
