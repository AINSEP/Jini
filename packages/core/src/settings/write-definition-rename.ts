import { nowIso as kernelNowIso } from "../primitives/index.js";
import type { UUID } from "../primitives/index.js";
import { AliasDepthExceededError, DefinitionInvalidError } from "./errors.js";
import { invalidateDefinitionNamespaceCache } from "./settings.js";
import { type SettingDefinitionRecord } from "./types.js";
import { type SettingsWriteServiceDeps, authorizeDefinitionsManage, resolveActiveDefinitionOrThrow } from './write-service.js';
export interface RenameDefinitionRequired {
  deps: SettingsWriteServiceDeps;
  input: {
    namespace: string;
    key: string;
    workspaceId: UUID | null;
    newNamespace: string;
    newKey: string;
    callerPrincipalId: UUID;
    /** The workspace the caller is authorizing in (see `registerDefinitions`' identical field). */
    authWorkspaceId: UUID;
  };
}

type RenameInput = RenameDefinitionRequired["input"];

async function assertRenameTargetFree(deps: SettingsWriteServiceDeps, input: RenameInput): Promise<void> {
  // A dispatched `rename` item that omits its target arrives here as `""` (see definitions-dispatch);
  // without this guard the definition was silently moved to the empty name `.`.
  if (!input.newNamespace || !input.newKey) {
    throw new DefinitionInvalidError("rename requires a non-empty newNamespace and newKey");
  }

  if (input.namespace === input.newNamespace && input.key === input.newKey) {
    throw new DefinitionInvalidError("rename requires newNamespace/newKey to differ from the current name");
  }

  const destination = await deps.repo.findActiveDefinition({
    namespace: input.newNamespace,
    key: input.newKey,
    workspaceId: input.workspaceId,
  });
  if (destination) {
    if (destination.status === "alias") {
      throw new AliasDepthExceededError(
        `rename target '${input.newNamespace}.${input.newKey}' resolves to an existing alias marker; a marker's alias_of must point to an active definition (depth <=1)`
      );
    }
    throw new DefinitionInvalidError(
      `rename target '${input.newNamespace}.${input.newKey}' is already in use`
    );
  }
}

/** Sequential rename: retarget every prior marker pointing at the OLD name to the NEW name. */
async function retargetPriorAliasMarkers({ deps, input, now }: { deps: SettingsWriteServiceDeps; input: RenameInput; now: string }): Promise<void> {
  const siblings = await deps.repo.listActiveDefinitions({ workspaceId: input.workspaceId });
  for (const sibling of siblings) {
    if (
      sibling.status === "alias" &&
      sibling.aliasOfNamespace === input.namespace &&
      sibling.aliasOfKey === input.key
    ) {
      await deps.repo.saveDefinition({
        ...sibling,
        aliasOfNamespace: input.newNamespace,
        aliasOfKey: input.newKey,
        updatedAt: now,
      });
    }
  }
}

/** Step 2: insert a fresh v1 alias marker at the OLD name pointing at the NEW name. */
async function insertRenameAliasMarker({ deps, input, current, now }: { deps: SettingsWriteServiceDeps; input: RenameInput; current: SettingDefinitionRecord; now: string }): Promise<string> {
  const markerSettingId = deps.ids.newId();
  await deps.repo.saveDefinition({
    settingId: markerSettingId,
    version: 1,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    key: input.key,
    ownerKind: current.ownerKind,
    ownerId: current.ownerId,
    schema: current.schema,
    defaultValue: current.defaultValue,
    scopes: current.scopes,
    secret: current.secret,
    status: "alias",
    aliasOfNamespace: input.newNamespace,
    aliasOfKey: input.newKey,
    coercionTag: null,
    createdAt: now,
    updatedAt: now,
  });
  return markerSettingId;
}

async function applyRenameInTransaction({ deps, input, current }: { deps: SettingsWriteServiceDeps; input: RenameInput; current: SettingDefinitionRecord }): Promise<{ settingId: string; markerSettingId: string }> {
  const now = kernelNowIso({ clock: deps.clock });

  // Step 1: move the active row to the new name -- same setting_id, same version.
  await deps.repo.saveDefinition({ ...current, namespace: input.newNamespace, key: input.newKey, updatedAt: now });
  await retargetPriorAliasMarkers({ deps, input, now });
  const markerSettingId = await insertRenameAliasMarker({ deps, input, current, now });

  await deps.repo.appendRevision({
    entityKind: "definition",
    settingId: current.settingId,
    scope: null,
    workspaceId: input.workspaceId,
    principalId: null,
    op: "alias",
    beforeJson: null,
    afterJson: null,
    defVersion: current.version,
    actor: input.callerPrincipalId,
    originPluginId: null,
    changeSetId: null,
    createdAt: now,
  });

  return { settingId: current.settingId, markerSettingId };
}

/**
 * The rename mechanism : a same-tx pair —
 * (1) UPDATE the active definition row's `(namespace,key)` to the new name,
 * same `setting_id`/`version` (ledgered `op='alias'`); (2) INSERT a fresh v1
 * alias marker at the OLD name pointing at the new name. Because identity
 * never moves, value rows (keyed on `setting_id` only) stay attached.
 *
 * Sequential rename (A->B then B->C) retargets every prior marker pointing
 * at the OLD name to the NEW name in the same tx. A rename target that
 * itself resolves to an existing alias is rejected `ALIAS_DEPTH_EXCEEDED`
 * (behavior.spec.md §7: "the rename target resolves to an alias").
 *
 * Never touches `schema`/`defaultValue`/`scopes` -- a pure rename can never
 * trigger `RENAME_RETYPE_CONFLICT` by construction; that guard lives in
 * `retypeDefinition` ("no rename+retype in one op").
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */
export async function renameDefinition(
  required: RenameDefinitionRequired
): Promise<{ settingId: string; markerSettingId: string }> {
  const { deps, input } = required;
  await authorizeDefinitionsManage(deps, input.callerPrincipalId, input.authWorkspaceId);

  const current = await resolveActiveDefinitionOrThrow(deps, input, "rename");
  await assertRenameTargetFree(deps, input);

  const result = await deps.repo.transaction(() => applyRenameInTransaction({ deps, input, current }));

  // Both the old (alias-marker) namespace and the new (active-row) namespace
  // need a fresh definition-cache read after a rename.
  invalidateDefinitionNamespaceCache({ repo: deps.repo, namespace: input.namespace });
  invalidateDefinitionNamespaceCache({ repo: deps.repo, namespace: input.newNamespace });
  return result;
}
