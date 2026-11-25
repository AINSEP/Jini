import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { UUID } from "@jini-ai/core/primitives";
import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";
import { externalMcpVaultRecord, persistExternalMcpVaultEnvelope } from "../federation/hosted/index.js";
import { deleteExternalMcpVaultEnvelope } from "../federation/hosted/index.js";
import type { ExternalMcpOAuthRuntimePatch, ExternalMcpReplacedSecrets, ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { ExternalMcpServersTable, SqlExternalMcpServerRepo } from "./external-mcp-repo.js";

/**
 * @file The editor and runtime writes of `SqlExternalMcpServerRepo` (lost-update design S1, M1/M7).
 *
 * Every write takes the same `secrets_vault:<workspace>` writer lock the credential writers take, so
 * the pointers compared here cannot move between the compare and the write. The compare is ALSO in
 * the `UPDATE`'s `WHERE`, which is the guarantee on a database where the lock is advisory only.
 * A write that misses throws {@link WriteMissed} so the transaction rolls back the vault envelopes
 * it staged; the entry points turn that into `false`.
 */

export type ServerKey = { workspaceId: UUID; serverId: string };
type Pointers = { env_secret_id: string | null; oauth_secret_id: string | null };
type WriteDeps = ConstructorParameters<typeof SqlExternalMcpServerRepo>[0];

class WriteMissed extends Error {}

export function toRow({ record, pointers }: { record: ExternalMcpServerRecord; pointers: { env_secret_id: string | null; oauth_secret_id: string | null } }, _optional: Record<string, never> = {}) {
  return {
    workspace_id: record.workspaceId,
    server_id: record.serverId,
    label: record.label,
    provisioned_by_plugin_id: record.provisionedByPluginId,
    transport: record.transport,
    auth_mode: record.authMode,
    enabled: record.enabled,
    command: record.command,
    url: record.url,
    args: record.args,
    allowed_tool_names: record.allowedToolNames,
    write_allowed_tool_names: record.writeAllowedToolNames,
    write_grants_updated_by_principal_id: record.writeGrantsUpdatedByPrincipalId,
    write_grants_updated_at: record.writeGrantsUpdatedAt,
    env_names: record.envNames,
    ...pointers,
    oauth_provider_id: record.oauthProviderId,
    oauth_grant: record.oauthGrant,
    oauth_client_id: record.oauthClientId,
    oauth_endpoints_json: record.oauthEndpointsJson,
    oauth_scopes_json: record.oauthScopesJson,
    oauth_status: record.oauthStatus,
    oauth_expires_at: record.oauthExpiresAt,
    oauth_token_env_name: record.oauthTokenEnvName,
    oauth_refresh_lease_until: record.oauthRefreshLeaseUntil,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}


/** The vault id an envelope the writer read points at, or `null` for no envelope. */
function pointerOf({ sealed, key, kind, vaultErrors }: { vaultErrors: WriteDeps["vaultErrors"]; sealed: SealedSecret | null; key: ServerKey; kind: "mcp-env" | "mcp-auth" }): string | null {
  return sealed ? externalMcpVaultRecord({ sealed, identity: key, kind, vaultErrors }).id : null;
}

async function readPointers({ kernel, key, tables }: { kernel: WriteDeps["kernel"]; key: ServerKey; tables: WriteDeps["tables"] }) {
  return kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().selectFrom(tables.servers).select(["env_secret_id", "oauth_secret_id", "version"])
    .where("workspace_id", "=", key.workspaceId).where("server_id", "=", key.serverId).executeTakeFirst());
}

/** Runs `body` in a locked transaction; `false` when it threw {@link WriteMissed} (rolled back). */
async function lockedWrite({ kernel, workspaceId, body }: { kernel: WriteDeps["kernel"]; workspaceId: UUID; body: () => Promise<boolean> }): Promise<boolean> {
  try {
    return await kernel.transaction(async () => {
      await kernel.lockKey(`secrets_vault:${workspaceId}`);
      return body();
    });
  } catch (error) {
    if (error instanceof WriteMissed) return false;
    throw error;
  }
}

async function stagePointers({ vaultRepo, record, vaultErrors }: { vaultRepo: VaultRepoPort; record: ExternalMcpServerRecord; vaultErrors: WriteDeps["vaultErrors"] }): Promise<Pointers> {
  return {
    env_secret_id: await persistExternalMcpVaultEnvelope({ repo: vaultRepo, vaultErrors, sealed: record.sealedEnv, identity: record, kind: "mcp-env" }),
    oauth_secret_id: await persistExternalMcpVaultEnvelope({ repo: vaultRepo, vaultErrors, sealed: record.sealedOAuth, identity: record, kind: "mcp-auth" }),
  };
}

/** Creates the row at version 1; `false` and nothing written when the key is taken. */
export async function insertRow({ kernel, vaultRepo, tables, vaultErrors, record }: WriteDeps & { record: ExternalMcpServerRecord }, _optional = {}): Promise<boolean> {
  return lockedWrite({ kernel, workspaceId: record.workspaceId, body: async () => {
    if (await readPointers({ kernel, tables, key: record })) return false;
    const row = toRow({ record: { ...record, version: 1 }, pointers: await stagePointers({ vaultRepo, record, vaultErrors }) });
    await kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().insertInto(tables.servers).values(row).execute());
    return true;
  } });
}

/** The edit write: version and both credential pointers compared in the `WHERE`, version + 1 set. */
export async function updateRowIfVersion({ kernel, vaultRepo, tables, vaultErrors, record, expectedVersion, replaces }: WriteDeps & { record: ExternalMcpServerRecord; expectedVersion: number; replaces: ExternalMcpReplacedSecrets }, _optional = {}): Promise<boolean> {
  const replacedEnv = pointerOf({ sealed: replaces.sealedEnv, key: record, kind: "mcp-env", vaultErrors });
  const replacedAuth = pointerOf({ sealed: replaces.sealedOAuth, key: record, kind: "mcp-auth", vaultErrors });
  return lockedWrite({ kernel, workspaceId: record.workspaceId, body: async () => {
    const previous = await readPointers({ kernel, tables, key: record });
    if (!previous || Number(previous.version) !== expectedVersion || previous.env_secret_id !== replacedEnv || previous.oauth_secret_id !== replacedAuth) return false;
    const pointers = await stagePointers({ vaultRepo, record, vaultErrors });
    const { workspace_id: _workspace, server_id: _server, ...columns } = toRow({ record: { ...record, version: expectedVersion + 1 }, pointers });
    const result = await kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().updateTable(tables.servers).set(columns)
      .where("workspace_id", "=", record.workspaceId).where("server_id", "=", record.serverId).where("version", "=", expectedVersion)
      .where("env_secret_id", replacedEnv === null ? "is" : "=", replacedEnv).where("oauth_secret_id", replacedAuth === null ? "is" : "=", replacedAuth).executeTakeFirst());
    if (Number(result.numUpdatedRows) !== 1) throw new WriteMissed();
    // The update unlinked the old pointers; RESTRICT foreign keys are satisfied.
    if (previous.env_secret_id !== pointers.env_secret_id) await deleteExternalMcpVaultEnvelope({ repo: vaultRepo, workspaceId: record.workspaceId, id: previous.env_secret_id });
    if (previous.oauth_secret_id !== pointers.oauth_secret_id) await deleteExternalMcpVaultEnvelope({ repo: vaultRepo, workspaceId: record.workspaceId, id: previous.oauth_secret_id });
    return true;
  } });
}

/** The runtime write: OAuth pointer, status, expiry, lease only, while the credential is the one read. */
export async function updateRuntime({ kernel, vaultRepo, tables, vaultErrors, key, expectedSealedOAuth, patch }: WriteDeps & { key: ServerKey; expectedSealedOAuth: SealedSecret | null; patch: ExternalMcpOAuthRuntimePatch }, _optional = {}): Promise<boolean> {
  const expectedAuth = pointerOf({ sealed: expectedSealedOAuth, key, kind: "mcp-auth", vaultErrors });
  return lockedWrite({ kernel, workspaceId: key.workspaceId, body: async () => {
    const previous = await readPointers({ kernel, tables, key });
    if (!previous || previous.oauth_secret_id !== expectedAuth) return false;
    const oauth_secret_id = await persistExternalMcpVaultEnvelope({ repo: vaultRepo, vaultErrors, sealed: patch.sealedOAuth, identity: key, kind: "mcp-auth" });
    const result = await kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().updateTable(tables.servers)
      .set({ oauth_secret_id, oauth_status: patch.oauthStatus, oauth_expires_at: patch.oauthExpiresAt, oauth_refresh_lease_until: patch.oauthRefreshLeaseUntil, updated_at: patch.updatedAt })
      .where("workspace_id", "=", key.workspaceId).where("server_id", "=", key.serverId)
      .where("oauth_secret_id", expectedAuth === null ? "is" : "=", expectedAuth).executeTakeFirst());
    if (Number(result.numUpdatedRows) !== 1) throw new WriteMissed();
    if (previous.oauth_secret_id !== oauth_secret_id) await deleteExternalMcpVaultEnvelope({ repo: vaultRepo, workspaceId: key.workspaceId, id: previous.oauth_secret_id });
    return true;
  } });
}
