import { nowIso as kernelNowIso } from "../primitives/index.js";
import type { JsonValue, UUID } from "../primitives/index.js";
import { DefinitionInvalidError, RenameRetypeConflictError } from "./errors.js";
import { invalidateDefinitionNamespaceCache } from "./settings.js";
import { SCOPE_BIT, type SettingValueSchema } from "./types.js";
import { type SettingsWriteServiceDeps, type ActiveDefinition, authorizeDefinitionsManage, resolveActiveDefinitionOrThrow } from './write-service.js';
export interface RetypeDefinitionRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    workspaceId: UUID | null;
    schema: SettingValueSchema;
    defaultValue: JsonValue | null;
    /** A total coercer id/tag ( registry in `settings.ts`) for reading values recorded under any prior version. See docs/decisions/DR-003-settings-ledger-invariants.md. */
    coercionTag: string;
    /**
     * Present only to detect a combined rename+retype request;
     * retype never actually moves `(namespace,key)` -- if provided and it
     * differs from the current name while `schema` also differs, the whole
     * op is rejected `RENAME_RETYPE_CONFLICT` rather than silently doing
     * only the schema half.
     */
    newNamespace?: string | undefined;
    newKey?: string | undefined;
    callerPrincipalId: UUID;
    authWorkspaceId: UUID;
  };
}

/** One transaction body: deprecate the prior active version, insert the new one, ledger the retype. */
async function writeRetypedVersion(
  { deps, input, current }: { deps: SettingsWriteServiceDeps; input: RetypeDefinitionRequired["input"]; current: ActiveDefinition },
): Promise<{ settingId: string; version: number }> {
  const now = kernelNowIso({ clock: deps.clock });
  const newVersion = current.version + 1;

  // Step 1: deprecate the prior active version first.
  await deps.repo.saveDefinition({ ...current, status: "deprecated", updatedAt: now });

  // Step 2: insert the new version as active -- same setting_id/namespace/key.
  await deps.repo.saveDefinition({
    settingId: current.settingId,
    version: newVersion,
    workspaceId: current.workspaceId,
    namespace: current.namespace,
    key: current.key,
    ownerKind: current.ownerKind,
    ownerId: current.ownerId,
    schema: input.schema,
    defaultValue: input.defaultValue,
    scopes: current.scopes,
    secret: current.secret,
    status: "active",
    aliasOfNamespace: null,
    aliasOfKey: null,
    coercionTag: input.coercionTag,
    createdAt: now,
    updatedAt: now,
  });

  await deps.repo.appendRevision({
    entityKind: "definition",
    settingId: current.settingId,
    scope: null,
    workspaceId: current.workspaceId,
    principalId: null,
    op: "retype",
    beforeJson: null,
    afterJson: null,
    defVersion: newVersion,
    actor: input.callerPrincipalId,
    originPluginId: null,
    changeSetId: null,
    createdAt: now,
  });

  return { settingId: current.settingId, version: newVersion };
}

/**
 * The retype mechanism : a same-tx pair --
 * (1) UPDATE the prior active version's `status` to `deprecated` FIRST (else
 * the insert in step 2 collides with the one-active-row-per-slot
 * invariant); (2) INSERT the new `version+1` row as `active`, same
 * `setting_id`/`namespace`/`key`. Rejected unless every prior version
 * (2..N) already carries a total coercer -- `coercionTag` is `null` only for
 * version 1 by construction (`types.ts`), so this walks 2..N and requires
 * each to be non-null.
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
export async function retypeDefinition(
  required: RetypeDefinitionRequired
): Promise<{ settingId: string; version: number }> {
  const { deps, input } = required;
  await authorizeDefinitionsManage(deps, input.callerPrincipalId, input.authWorkspaceId);

  const current = await resolveActiveDefinitionOrThrow(deps, input, "retype");

  const namespaceOrKeyChanged =
    (input.newNamespace !== undefined && input.newNamespace !== current.namespace) ||
    (input.newKey !== undefined && input.newKey !== current.key);
  const schemaChanged = JSON.stringify(input.schema) !== JSON.stringify(current.schema);
  if (namespaceOrKeyChanged && schemaChanged) {
    throw new RenameRetypeConflictError(
      `cannot rename and retype '${input.namespace}.${input.key}' in the same operation; submit the rename and the retype as two separate chokepoint calls`
    );
  }

  for (let version = 2; version <= current.version; version++) {
    const priorVersion = await deps.repo.findDefinitionBySettingId({ settingId: current.settingId, version });
    if (!priorVersion || priorVersion.coercionTag == null) {
      throw new DefinitionInvalidError(
        `retype of '${input.namespace}.${input.key}' rejected: version ${version} does not carry a total coercer`
      );
    }
  }

  const result = await deps.repo.transaction(() => writeRetypedVersion({ deps, input, current }));

  invalidateDefinitionNamespaceCache({ repo: deps.repo, namespace: input.namespace });
  return result;
}

/** Add source-declared scopes to a core definition without moving or rewriting existing values.
 * Boot uses this when a workspace preference gains a personal override. Scope removal is a
 * separate migration decision: this operation only adds bits and preserves definition identity.
 * @throws DefinitionInvalidError for operator-owned definitions or invalid scope bits.
 * @complexity O(1), one definition transaction and cache invalidation.
 * @example await extendDefinitionScopes({ deps, input: { namespace, key, workspaceId: null,
 *   scopes: SCOPE_BIT.user, callerPrincipalId, authWorkspaceId } });
 */
export async function extendDefinitionScopes({ deps, input }: {
  deps: SettingsWriteServiceDeps;
  input: { namespace: string; key: string; workspaceId: UUID | null; scopes: number; callerPrincipalId: UUID; authWorkspaceId: UUID };
}, _options = {}): Promise<void> {
  await authorizeDefinitionsManage(deps, input.callerPrincipalId, input.authWorkspaceId);
  const current = await resolveActiveDefinitionOrThrow(deps, input, "extend the scopes of");
  const validBits = SCOPE_BIT.global | SCOPE_BIT.workspace | SCOPE_BIT.user;
  if (current.ownerKind !== "core" || !Number.isInteger(input.scopes) || input.scopes <= 0 || input.scopes > validBits) {
    throw new DefinitionInvalidError("Only core definitions can gain valid source-declared scope bits");
  }
  const scopes = current.scopes | input.scopes;
  if (scopes === current.scopes) return;
  await deps.repo.transaction(async () => {
    const now = kernelNowIso({ clock: deps.clock });
    await deps.repo.saveDefinition({ ...current, scopes, updatedAt: now });
    // Re-registration of metadata, not a value/schema change; retain the existing revision vocabulary.
    await deps.repo.appendRevision({ entityKind: "definition", settingId: current.settingId,
      scope: null, workspaceId: current.workspaceId, principalId: null, op: "register",
      beforeJson: { scopes: current.scopes }, afterJson: { scopes }, defVersion: current.version,
      actor: input.callerPrincipalId, originPluginId: null, changeSetId: null, createdAt: now });
  });
  invalidateDefinitionNamespaceCache({ repo: deps.repo, namespace: input.namespace });
}
