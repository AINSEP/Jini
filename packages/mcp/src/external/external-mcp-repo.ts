import { isDeepStrictEqual } from "node:util";
import { sql, type Selectable, type Kysely, type RawBuilder } from "kysely";
import { VaultError, type VaultRecord, type VaultRepoPort, type VaultMeta } from "@jini-ai/core/contracts/vault";
import { persistExternalMcpVaultEnvelope, type HostedMcpVaultPorts } from "../federation/hosted/index.js";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

import type { UUID } from "@jini-ai/core/primitives";

import { externalMcpAccessSnapshot, externalMcpVaultEnvelope, deleteExternalMcpVaultEnvelope } from "../federation/hosted/index.js";
import { insertRow, toRow, updateRowIfVersion, updateRuntime, type ServerKey } from "./external-mcp-repo.writes.js";
import type { ExternalMcpAccessUpdate, ExternalMcpOAuthRuntimePatch, ExternalMcpReplacedSecrets, ExternalMcpServerRecord, ExternalMcpServerRepoPort } from "@jini-ai/core/contracts/hosted-mcp";
import type { SealedSecret } from "@jini-ai/core/contracts/vault";
export interface ExternalMcpServersTable {
  workspace_id: string;
  server_id: string;
  label: string | null;
  provisioned_by_plugin_id: string | null;
  transport: string;
  auth_mode: string;
  enabled: boolean | number;
  command: string | null;
  url: string | null;
  args: string | null;
  allowed_tool_names: string | null;
  write_allowed_tool_names: string | null;
  write_grants_updated_by_principal_id: string | null;
  write_grants_updated_at: string | null;
  env_names: string | null;
  env_secret_id: string | null;
  oauth_secret_id: string | null;
  oauth_provider_id: string | null;
  oauth_grant: string | null;
  oauth_client_id: string | null;
  oauth_endpoints_json: string | null;
  oauth_scopes_json: string | null;
  oauth_status: string | null;
  oauth_expires_at: string | null;
  oauth_token_env_name: string | null;
  oauth_refresh_lease_until: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface SecretsVaultTable {
  workspace_id: string; id: string; kind: VaultRecord["kind"]; owner_key: string;
  principal_id: string | null; binding: string | null; provider: string | null; label: string;
  is_default: boolean | number; revision: number;
  sealed_key_id: string | null; sealed_ciphertext: string | null; sealed_nonce: string | null; sealed_alg: string | null;
  last4: string | null; token_length: number | null;
  meta: string | VaultMeta; created_at: string; updated_at: string;
}

import { toBool } from "@jini-ai/core/contracts/storage";

/**
 * @file THE `ExternalMcpServerRepoPort` adapter: one Kysely query body for every dialect (storage
 * plan §4, ADR-066) — the ADR-006 rule-of-two "second adapter" half;
 * `features/external-mcp/external-mcp-store.memory.ts` is the first. `apps/website/src/features/external-mcp/external-mcp-repo.sqlite.ts` is
 * the thin subclass the composition root builds from the content db handle.
 *
 * Secret envelopes live in Jini's vault, with two pointers on the server. Reads hydrate both
 * pointers in one query; writes join the host transaction before replacing pointers or status.
 *
 * One method here is NOT a plain translation: {@link SqlExternalMcpServerRepo.tryClaimOAuthRefreshLease}
 * is a compare-and-set, and it is the only place in this adapter where the SQL shape carries a
 * correctness guarantee rather than a storage detail. See its doc.
 */

type Row = Selectable<ExternalMcpServersTable>;
type JoinedRow = Row & Record<string, unknown>;
type PayloadKind = "mcp-env" | "mcp-auth";
const vaultColumns = ["workspace_id", "id", "kind", "owner_key", "principal_id", "binding", "provider", "label", "is_default",
  "revision", "sealed_key_id", "sealed_ciphertext", "sealed_nonce", "sealed_alg", "last4", "token_length", "meta", "created_at", "updated_at"] as const;

function joinedEnvelope({ row, prefix, kind }: { row: JoinedRow; prefix: "env" | "oauth"; kind: PayloadKind }) {
  if (row[`${prefix}_secret_id`] === null) return null;
  const vault = Object.fromEntries(vaultColumns.map(column => [column, row[`${prefix}_${column}`]])) as unknown as SecretsVaultTable;
  assertJoinedContext({ vault, row, kind });
  return externalMcpVaultEnvelope({ record: toVaultRecord({ vault }) });
}

/** Refuses a joined payload that is not this server's own unscoped `kind` payload (or is missing). */
function assertJoinedContext({ vault, row, kind }: { vault: SecretsVaultTable; row: JoinedRow; kind: PayloadKind }): void {
  const invalidOwner = !vault.id || vault.workspace_id !== row.workspace_id || vault.owner_key !== row.server_id;
  const invalidScope = vault.kind !== kind || vault.principal_id !== null || vault.binding !== null;
  if (invalidOwner || invalidScope) throw new VaultError({ code: "context" });
}

/** The vault record behind a context-checked payload; one missing any sealed part is refused. */
function toVaultRecord({ vault }: { vault: SecretsVaultTable }): VaultRecord {
  const { sealed_key_id, sealed_ciphertext, sealed_nonce, sealed_alg } = vault;
  if (typeof sealed_key_id !== "string" || typeof sealed_ciphertext !== "string" || typeof sealed_nonce !== "string" || typeof sealed_alg !== "string") throw new VaultError({ code: "invalid-record" });
  return { workspaceId: vault.workspace_id, id: vault.id, kind: vault.kind, ownerKey: vault.owner_key,
    principalId: vault.principal_id, binding: vault.binding, provider: vault.provider, label: vault.label,
    isDefault: toBool({ value: vault.is_default }) ?? false, revision: Number(vault.revision),
    sealed: { keyId: sealed_key_id, ciphertext: sealed_ciphertext, nonce: sealed_nonce, alg: sealed_alg },
    last4: vault.last4, tokenLength: vault.token_length, meta: typeof vault.meta === "string" ? JSON.parse(vault.meta) : vault.meta,
    createdAt: vault.created_at, updatedAt: vault.updated_at };
}

function toRecord(row: JoinedRow): ExternalMcpServerRecord {
  const sealedEnv = joinedEnvelope({ row, prefix: "env", kind: "mcp-env" });
  const sealedOAuth = joinedEnvelope({ row, prefix: "oauth", kind: "mcp-auth" });
  return {
    workspaceId: row.workspace_id,
    serverId: row.server_id,
    label: row.label,
    provisionedByPluginId: row.provisioned_by_plugin_id,
    transport: row.transport,
    authMode: row.auth_mode,
    enabled: toBool({ value: row.enabled }) ?? false,
    command: row.command,
    url: row.url,
    args: row.args,
    allowedToolNames: row.allowed_tool_names,
    writeAllowedToolNames: row.write_allowed_tool_names,
    writeGrantsUpdatedByPrincipalId: row.write_grants_updated_by_principal_id,
    writeGrantsUpdatedAt: row.write_grants_updated_at,
    envNames: row.env_names,
    sealedEnv,
    oauthProviderId: row.oauth_provider_id,
    oauthGrant: row.oauth_grant,
    oauthClientId: row.oauth_client_id,
    oauthEndpointsJson: row.oauth_endpoints_json,
    oauthScopesJson: row.oauth_scopes_json,
    oauthStatus: row.oauth_status,
    oauthExpiresAt: row.oauth_expires_at,
    oauthTokenEnvName: row.oauth_token_env_name,
    oauthRefreshLeaseUntil: row.oauth_refresh_lease_until,
    sealedOAuth,
    aadVersion: 1,
    oauthAadVersion: 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

export class SqlExternalMcpServerRepo implements ExternalMcpServerRepoPort {
  readonly vaultRepo: VaultRepoPort;
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown> & { query<Row>(statement: RawBuilder<Row>): Promise<Row[]> };
  private readonly tables: { servers: string; vault: string };
  private readonly vaultErrors: HostedMcpVaultPorts["vaultErrors"];
  constructor({ kernel, vaultRepo, tables, vaultErrors }: {
    kernel: StorageKernel<Kysely<unknown>, unknown> & { query<Row>(statement: RawBuilder<Row>): Promise<Row[]> };
    vaultRepo: VaultRepoPort; tables: { servers: string; vault: string }; vaultErrors: HostedMcpVaultPorts["vaultErrors"];
  }, _optional = {}) {
    this.kernel = kernel;
    this.vaultRepo = vaultRepo;
    this.tables = tables;
    this.vaultErrors = vaultErrors;
  }

  /** One query hydrates both pointers for the entire roster, including empty rosters.
   * @complexity O(server count + envelope bytes); two indexed LEFT JOINs, no per-row I/O.
   */
  private async read({ workspaceId, serverId }: { workspaceId: UUID; serverId?: string }): Promise<ExternalMcpServerRecord[]> {
    const projection = (["env", "oauth"] as const).flatMap(prefix => vaultColumns.map(column => {
      const source = sql.ref(`${prefix}.${column}`);
      const alias = sql.ref(`${prefix}_${column}`);
      return sql`${source} AS ${alias}`;
    }));
    const serverFilter = serverId === undefined ? sql`` : sql`AND s.server_id=${serverId}`;
    const rows = await this.kernel.query<JoinedRow>(sql`SELECT s.*, ${sql.join(projection)} FROM ${sql.table(this.tables.servers)} s
      LEFT JOIN ${sql.table(this.tables.vault)} env ON env.workspace_id=s.workspace_id AND env.id=s.env_secret_id
      LEFT JOIN ${sql.table(this.tables.vault)} oauth ON oauth.workspace_id=s.workspace_id AND oauth.id=s.oauth_secret_id
      WHERE s.workspace_id=${workspaceId} ${serverFilter}`);
    return rows.map(toRecord);
  }

  async listByWorkspaceId(workspaceId: UUID): Promise<ExternalMcpServerRecord[]> {
    return this.read({ workspaceId });
  }

  async findByServerId(input: ServerKey): Promise<ExternalMcpServerRecord | null> {
    return (await this.read(input))[0] ?? null;
  }

  async upsert(record: ExternalMcpServerRecord): Promise<void> {
    await this.kernel.transaction(async () => {
      // Match Jini's writer lock before reading pointers, including callbacks and token refresh.
      await this.kernel.lockKey(`secrets_vault:${record.workspaceId}`);
      const previous = await this.kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().selectFrom(this.tables.servers)
        .select(["env_secret_id", "oauth_secret_id"]).where("workspace_id", "=", record.workspaceId)
        .where("server_id", "=", record.serverId).executeTakeFirst());
      const env_secret_id = await persistExternalMcpVaultEnvelope({ repo: this.vaultRepo, vaultErrors: this.vaultErrors, sealed: record.sealedEnv, identity: record, kind: "mcp-env" });
      const oauth_secret_id = await persistExternalMcpVaultEnvelope({ repo: this.vaultRepo, vaultErrors: this.vaultErrors, sealed: record.sealedOAuth, identity: record, kind: "mcp-auth" });
      const row = toRow({ record, pointers: { env_secret_id, oauth_secret_id } });
      await this.kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().insertInto(this.tables.servers).values(row)
        .onConflict(oc => oc.columns(["workspace_id", "server_id"]).doUpdateSet(row)).execute());
      // The upsert unlinks old pointers first; RESTRICT foreign keys remain satisfied throughout.
      if (previous?.env_secret_id !== env_secret_id) await deleteExternalMcpVaultEnvelope({ repo: this.vaultRepo, workspaceId: record.workspaceId, id: previous?.env_secret_id ?? null });
      if (previous?.oauth_secret_id !== oauth_secret_id) await deleteExternalMcpVaultEnvelope({ repo: this.vaultRepo, workspaceId: record.workspaceId, id: previous?.oauth_secret_id ?? null });
    });
  }

  async insert({ record }: { record: ExternalMcpServerRecord }): Promise<boolean> {
    return insertRow({ kernel: this.kernel, vaultRepo: this.vaultRepo, tables: this.tables, vaultErrors: this.vaultErrors, record });
  }

  async updateIfVersion(required: { record: ExternalMcpServerRecord; expectedVersion: number; replaces: ExternalMcpReplacedSecrets }): Promise<boolean> {
    return updateRowIfVersion({ kernel: this.kernel, vaultRepo: this.vaultRepo, tables: this.tables, vaultErrors: this.vaultErrors, ...required });
  }

  async updateOAuthRuntime(required: { key: ServerKey; expectedSealedOAuth: SealedSecret | null; patch: ExternalMcpOAuthRuntimePatch }): Promise<boolean> {
    return updateRuntime({ kernel: this.kernel, vaultRepo: this.vaultRepo, tables: this.tables, vaultErrors: this.vaultErrors, ...required });
  }

  /** Serialize with credential writers, validate the approved source, then replace access only.
   * The conditional UPDATE also compares prior grants and their decision; no credential/vault column is written.
   * @complexity One indexed hydrated read and conditional UPDATE, O(a+w) bounded grant bytes.
   */
  async updateAccessIfCurrent(input: ExternalMcpAccessUpdate, _options = {}): Promise<boolean> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(`secrets_vault:${input.workspaceId}`);
      const current = await this.findByServerId(input);
      if (!current || !isDeepStrictEqual(externalMcpAccessSnapshot({ record: current }), input.expected)) return false;
      const expected = input.expected;
      const result = await this.kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().updateTable(this.tables.servers)
        .set({ enabled: input.access.enabled, allowed_tool_names: input.access.allowedToolNames,
          write_allowed_tool_names: input.access.writeAllowedToolNames, write_grants_updated_by_principal_id: input.principalId,
          write_grants_updated_at: input.nowIso, updated_at: input.nowIso, version: sql<number>`version + 1` })
        .where("workspace_id", "=", input.workspaceId).where("server_id", "=", input.serverId)
        .where("enabled", "=", expected.enabled)
        .where("allowed_tool_names", expected.allowedToolNames === null ? "is" : "=", expected.allowedToolNames)
        .where("write_allowed_tool_names", expected.writeAllowedToolNames === null ? "is" : "=", expected.writeAllowedToolNames)
        .where("write_grants_updated_by_principal_id", expected.writeGrantsUpdatedByPrincipalId === null ? "is" : "=", expected.writeGrantsUpdatedByPrincipalId)
        .where("write_grants_updated_at", expected.writeGrantsUpdatedAt === null ? "is" : "=", expected.writeGrantsUpdatedAt)
        .where("provisioned_by_plugin_id", expected.provisionedByPluginId === null ? "is" : "=", expected.provisionedByPluginId)
        .executeTakeFirst());
      return Number(result.numUpdatedRows) === 1;
    });
  }

  async deleteByServerId(input: ServerKey): Promise<boolean> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(`secrets_vault:${input.workspaceId}`);
      const previous = await this.kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().selectFrom(this.tables.servers)
        .select(["env_secret_id", "oauth_secret_id"]).where("workspace_id", "=", input.workspaceId)
        .where("server_id", "=", input.serverId).executeTakeFirst());
      if (!previous) return false;
      await this.kernel.run(db => db.withTables<Record<string, ExternalMcpServersTable>>().deleteFrom(this.tables.servers).where("workspace_id", "=", input.workspaceId)
        .where("server_id", "=", input.serverId).execute());
      for (const id of [previous.env_secret_id, previous.oauth_secret_id]) await deleteExternalMcpVaultEnvelope({ repo: this.vaultRepo, workspaceId: input.workspaceId, id });
      return true;
    });
  }

  /**
   * Claims the OAuth refresh lease with a single conditional UPDATE.
   *
   * The condition is in the `WHERE`, not in a preceding `SELECT`, and that is the whole guarantee:
   * a read-then-write loses the race it exists to prevent, because between reading "no lease" and
   * writing "my lease" the other process does exactly the same and both go on to redeem the same
   * single-use rotating refresh token — which permanently kills the connection. The updated-row
   * count is therefore the answer, not a diagnostic. (One statement is atomic on every dialect: on
   * Postgres the second UPDATE waits for the first's row lock, then re-checks the `WHERE`.)
   *
   * A lease at or before `nowIso` is treated as abandoned, so a process that crashed mid-refresh
   * cannot wedge the connection until someone restarts something.
   *
   * @returns `true` when this caller now holds the lease.
   * @complexity O(1) — one indexed conditional UPDATE on the primary key.
   */
  async tryClaimOAuthRefreshLease(input: ServerKey & { nowIso: string; leaseUntil: string }): Promise<boolean> {
    const result = await this.kernel.run((db) =>
      db
        .withTables<Record<string, ExternalMcpServersTable>>().updateTable(this.tables.servers)
        .set({ oauth_refresh_lease_until: input.leaseUntil })
        .where("workspace_id", "=", input.workspaceId)
        .where("server_id", "=", input.serverId)
        .where((eb) => eb.or([eb("oauth_refresh_lease_until", "is", null), eb("oauth_refresh_lease_until", "<=", input.nowIso)]))
        .executeTakeFirst()
    );
    return Number(result.numUpdatedRows) > 0;
  }

  async releaseOAuthRefreshLease(input: ServerKey): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, ExternalMcpServersTable>>().updateTable(this.tables.servers)
        .set({ oauth_refresh_lease_until: null })
        .where("workspace_id", "=", input.workspaceId)
        .where("server_id", "=", input.serverId)
        .execute()
    );
  }
}
