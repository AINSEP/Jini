import {
  getEffective, resolveDefinition, set, clear, resetNamespace, registerDefinitions,
  NON_REGISTER_DEFINITION_OPS, parseNonRegisterDefinitionOp, collectChangedNamespaces,
  type SettingsWriteServiceDeps, type SettingsRepoPort, type SettingOwnerKind,
  type SettingValueSchema, type DefinitionInput, type DefinitionOpRequestItem,
} from "../../settings/index.js";
import type { JsonValue } from "@jini-ai/core/primitives";
import type { SettingsService, SettingsPermissions, SettingsChangeFeed, DefinitionResult } from "./contracts.js";

/** Keep the CMS write chokepoint while translating its permission vocabulary to host policy. */
/** Bind the CMS ledger and write chokepoint without copying their domain logic.
 * Effective reads scan definitions and resolve each namespace key; mutations inherit CMS transactions/errors.
 * @complexity O(1) setup. Per operation: O(definitions + keys) reads, or O(batch size) writes.
 * @example createCmsSettingsService({ deps: cmsPorts, permissions });
 */
export function createCmsSettingsService(required: {
  deps: SettingsWriteServiceDeps; permissions: SettingsPermissions;
}): SettingsService {
  const { deps: original, permissions } = required;
  const permissionMap = new Map([
    ["settings.definitions.manage", permissions.manageDefinitions],
    ["settings.global.write", permissions.writeGlobal],
    ["settings.workspace.write", permissions.writeWorkspace],
    ["settings.user.self.write", permissions.writeUserSelf],
    ["settings.user.write", permissions.writeUserOther],
    ["settings.reset.global", permissions.reset.global],
    ["settings.reset.workspace", permissions.reset.workspace],
    ["settings.reset.user", permissions.reset.user],
  ]);
  const deps: SettingsWriteServiceDeps = { ...original,
    authorize: (input) => {
      const permission = permissionMap.get(input.permission);
      if (permission === undefined) return Promise.resolve({ allowed: false, reason: "unknown_settings_permission" });
      return original.authorize({ ...input, permission });
    },
  };
  const repo = deps.repo;
  const listDefinitions: SettingsService["listDefinitions"] = async ({ workspaceId }) => {
    const [platform, workspace] = await Promise.all([
      repo.listActiveDefinitions({ workspaceId: null }), repo.listActiveDefinitions({ workspaceId }),
    ]);
    return [...platform, ...workspace];
  };
  return {
    listDefinitions,
    effective: async ({ namespace, workspaceId, principalId }) => {
      const defs = await listDefinitions({ workspaceId });
      const keys = new Set(defs.filter((d) => d.namespace === namespace).map((d) => d.key));
      const data = [];
      for (const key of keys) {
        const result = await getEffective({ repo }, { namespace, key, scopeContext: { workspaceId, principalId } });
        if (result) data.push({ key, value: result.value, sourceLayer: result.sourceLayer, defVersion: result.defVersion });
      }
      return data;
    },
    raw: async ({ namespace, key, workspaceId, principalId }) => {
      const definition = await resolveDefinition({ repo }, { namespace, key, workspaceId });
      if (!definition) return null;
      const settingId = definition.settingId;
      const records = await Promise.all([
        repo.getGlobalValue(settingId), repo.getWorkspaceValue({ workspaceId, settingId }),
        principalId ? repo.getUserValue({ workspaceId, principalId, settingId }) : Promise.resolve(null),
      ]);
      const values = records.map((r) => r?.state === "set" ? r.valueJson : null);
      return { key: `${namespace}.${key}`, global: values[0], workspace: values[1], user: values[2], default: definition.defaultValue };
    },
    set: (input) => set({ deps, input }),
    clear: (input) => clear({ deps, input }),
    reset: async (input) => {
      const definitions = await repo.listActiveDefinitions({ workspaceId: input.scope === "global" ? null : (input.workspaceId ?? input.authWorkspaceId ?? null) });
      const keys = definitions.filter((d) => d.namespace === input.namespace).map((d) => d.key);
      return resetNamespace({ deps, input }, keys);
    },
    definitions: ({ items, callerPrincipalId, authWorkspaceId }) => applyDefinitions({ deps, items, callerPrincipalId, authWorkspaceId }),
  };
}

/** Preserve register batching and ordered non-register writes over existing CMS operation contracts.
 * Unknown operations return their name. Earlier non-register writes are not rolled back by later failures.
 * @complexity O(item count) time/space plus CMS effects; this batch is not atomic.
 */
async function applyDefinitions(required: {
  deps: SettingsWriteServiceDeps; items: readonly unknown[]; callerPrincipalId: string; authWorkspaceId: string;
}): Promise<DefinitionResult> {
  const { deps, items, callerPrincipalId, authWorkspaceId } = required;
  const toRegister: DefinitionInput[] = [];
  const applied: Array<{ key: string; op: string; status: string }> = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const op = String(item.op ?? "register");
    const namespace = String(item.namespace ?? "");
    const key = String(item.key ?? "");
    const ownerKind = item.ownerKind as SettingOwnerKind;
    const workspaceId = ownerKind === "site" ? authWorkspaceId : null;
    const defaultValue = (item.defaultJson ?? null) as JsonValue | null;
    if (op === "register") {
      toRegister.push({ namespace, key, ownerKind, workspaceId, schema: item.schemaJson as SettingValueSchema,
        defaultValue, scopes: Number(item.scopes), secret: Boolean(item.secret ?? false) });
    } else {
      const parsedOp = parseNonRegisterDefinitionOp({ op });
      if (!parsedOp) return { unknownOp: op };
      const opItem: DefinitionOpRequestItem = { namespace, key, ownerKind, workspaceId, defaultJson: defaultValue,
        ...(item.newNamespace === undefined ? {} : { newNamespace: item.newNamespace as string }),
        ...(item.newKey === undefined ? {} : { newKey: item.newKey as string }),
        ...(item.schemaJson === undefined ? {} : { schemaJson: item.schemaJson as SettingValueSchema }),
        ...(item.coercionJson === undefined ? {} : { coercionJson: item.coercionJson as string | { tag?: string } }),
      };
      await NON_REGISTER_DEFINITION_OPS[parsedOp]({ ctx: { deps, callerPrincipalId, authWorkspaceId }, item: opItem });
    }
    applied.push({ key: `${namespace}.${key}`, op, status: "applied" });
  }
  if (toRegister.length) await registerDefinitions({ deps, input: { definitions: toRegister, callerPrincipalId, authWorkspaceId } });
  return { applied };
}

/** Adapt the ledger through CMS tenant/principal disclosure rules, returning names and cursors only.
 * @complexity O(1) setup; collect is O(page size), with namespace lookup per visible revision.
 * @example createCmsSettingsChangeFeed({ repo });
 */
export function createCmsSettingsChangeFeed(required: { repo: SettingsRepoPort }): SettingsChangeFeed {
  const { repo } = required;
  return {
    head: () => repo.maxRevisionSeq(),
    collect: async ({ sinceSeq, limit, viewer }) => {
      const revisions = await repo.listRevisionsSince({ sinceSeq, limit, workspaceId: viewer.workspaceId });
      // Resolve afresh each batch: a rename must never leave a stale namespace cached forever.
      const batch = await collectChangedNamespaces({ revisions, viewer, resolveNamespace: async ({ settingId }) =>
        (await repo.findDefinitionBySettingId({ settingId }))?.namespace ?? null });
      return { ...batch, examinedCount: revisions.length };
    },
  };
}
