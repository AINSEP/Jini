import type { Insertable, Selectable } from "kysely";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely, RawBuilder } from "kysely";
interface SessionsTable {
  id: string;
  workspace_id: string;
  principal_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip: string | null;
  user_agent: string | null;
}

interface ApiKeysTable {
  id: string;
  workspace_id: string;
  principal_id: string;
  label: string;
  key_hash: string;
  prefix: string;
  issued_policy_id: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

import type { ApiKeyRecord, ApiKeyRepoPort } from "./api-key-types.js";
import type { SessionRepoPort, SessionRecord } from "../core/index.js";
import { createIdentityTransactions } from "./repo.js";

function toSessionRecord(row: Selectable<SessionsTable>): SessionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    principalId: row.principal_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.revoked_at == null ? {} : { revokedAt: row.revoked_at }),
    ...(row.ip == null ? {} : { ip: row.ip }),
    ...(row.user_agent == null ? {} : { userAgent: row.user_agent }),
  };
}

export class SqlSessionRepo implements SessionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly table: string;
  private readonly keepStoredRevocation: (required: { table: string }) => RawBuilder<string | null>;
  constructor({ kernel, table, keepStoredRevocation }: { kernel: StorageKernel<Kysely<unknown>, unknown>; table: string; keepStoredRevocation: (required: { table: string }) => RawBuilder<string | null> }, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.table = table;
    this.keepStoredRevocation = keepStoredRevocation;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<SessionRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, SessionsTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toSessionRecord(row) : null;
  }

  async findByTokenHash(required: {
    workspaceId: string;
    tokenHash: string;
  }): Promise<SessionRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, SessionsTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("token_hash", "=", required.tokenHash)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toSessionRecord(row) : null;
  }

  async save(record: SessionRecord): Promise<void> {
    const row: Insertable<SessionsTable> = {
      id: record.id,
      workspace_id: record.workspaceId,
      principal_id: record.principalId,
      token_hash: record.tokenHash,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
      revoked_at: record.revokedAt ?? null,
      ip: record.ip ?? null,
      user_agent: record.userAgent ?? null,
    };
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: record.workspaceId, execute: () => this.kernel.run((db) =>
      db.withTables<Record<string, SessionsTable>>().insertInto(this.table).values(row).onConflict((oc) => oc.column("id").doUpdateSet({ ...row, revoked_at: this.keepStoredRevocation({ table: this.table }) })).execute()) });
  }

  async revoke(required: { workspaceId: string; id: string; revokedAt: string }): Promise<void> {
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: required.workspaceId, execute: () => this.kernel.run((db) =>
      db
        .withTables<Record<string, SessionsTable>>().updateTable(this.table)
        .set({ revoked_at: required.revokedAt })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .execute()) });
  }

  async listByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<SessionRecord[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<Record<string, SessionsTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("principal_id", "=", required.principalId)
        .execute()
    );
    return rows.map(toSessionRecord);
  }
}

/**
 * SPEC-006 REQ-08 — the tenth identity table, added after the original nine (see this file's
 * header). Its port lives in this repo (`api-key-types.ts`) rather than in `@jini-ai/user-management`,
 * which scopes API keys out; everything else about this adapter — save-is-upsert, composite
 * `(workspaceId, id)` lookups, `null`-for-absent — matches the nine above exactly.
 */
function toApiKeyRecord(row: Selectable<ApiKeysTable>): ApiKeyRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    principalId: row.principal_id,
    label: row.label,
    keyHash: row.key_hash,
    prefix: row.prefix,
    ...(row.issued_policy_id == null ? {} : { issuedPolicyId: row.issued_policy_id }),
    createdAt: row.created_at,
    ...(row.last_used_at == null ? {} : { lastUsedAt: row.last_used_at }),
    ...(row.expires_at == null ? {} : { expiresAt: row.expires_at }),
    ...(row.revoked_at == null ? {} : { revokedAt: row.revoked_at }),
  };
}

export class SqlApiKeyRepo implements ApiKeyRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly table: string;
  constructor({ kernel, table }: { kernel: StorageKernel<Kysely<unknown>, unknown>; table: string }, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.table = table;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<ApiKeyRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, ApiKeysTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toApiKeyRecord(row) : null;
  }

  /** The verification hot path — served by `idx_api_keys_workspace_prefix`, never a scan. */
  async findByPrefix(required: { workspaceId: string; prefix: string }): Promise<ApiKeyRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, ApiKeysTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("prefix", "=", required.prefix)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toApiKeyRecord(row) : null;
  }

  async listByPrincipalId(required: { workspaceId: string; principalId: string }): Promise<ApiKeyRecord[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<Record<string, ApiKeysTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("principal_id", "=", required.principalId)
        .execute()
    );
    return rows.map(toApiKeyRecord);
  }

  async save(record: ApiKeyRecord): Promise<void> {
    const row: Insertable<ApiKeysTable> = {
      id: record.id,
      workspace_id: record.workspaceId,
      principal_id: record.principalId,
      label: record.label,
      key_hash: record.keyHash,
      prefix: record.prefix,
      issued_policy_id: record.issuedPolicyId ?? null,
      created_at: record.createdAt,
      last_used_at: record.lastUsedAt ?? null,
      expires_at: record.expiresAt ?? null,
      revoked_at: record.revokedAt ?? null,
    };
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: record.workspaceId, execute: () => this.kernel.run((db) =>
      // Revocation is terminal: a stale authentication usage write must never clear it.
      db.withTables<Record<string, ApiKeysTable>>().insertInto(this.table).values(row).onConflict((oc) => oc.column("id").doUpdateSet(row).where(`${this.table}.revoked_at`, "is", null)).execute()) });
  }
}
