import { sql, type Insertable, type Selectable } from "kysely";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
interface RolesTable {
  id: string;
  workspace_id: string;
  name: string;
  is_builtin: number;
  version: number;
}

interface PoliciesTable {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_builtin: number;
  is_frozen: number;
  version: number;
}

interface PolicyPermissionsTable {
  id: string;
  workspace_id: string;
  policy_id: string;
  permission: string;
  resource_type: string | null;
  constraint_json: string | null;
}

import type { PolicyPermissionRepoPort, PolicyRepoPort, RoleRepoPort } from "../index.js";
import type { PolicyPermissionRecord } from "../index.js";
import type { PolicyRecord, RoleRecord } from "@jini-ai/core/contracts/site/user-management";
import type { AssertVersionedWritePort } from "@jini-ai/core/optimistic-concurrency";
import { createIdentityTransactions, type SqlVersionedIdentityRequired } from "./repo.js";

function toRoleRecord(row: Selectable<RolesTable>): RoleRecord {
  return { id: row.id, workspaceId: row.workspace_id, name: row.name, isBuiltin: row.is_builtin === 1, version: row.version };
}

export class SqlRoleRepo implements RoleRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly table: string;
  private readonly assertVersionedWrite: AssertVersionedWritePort;
  constructor({ kernel, table, assertVersionedWrite }: SqlVersionedIdentityRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.table = table;
    this.assertVersionedWrite = assertVersionedWrite;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<RoleRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, RolesTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toRoleRecord(row) : null;
  }

  async findByName(required: { workspaceId: string; name: string }): Promise<RoleRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, RolesTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("name", "=", required.name)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toRoleRecord(row) : null;
  }

  async list(required: { workspaceId: string }): Promise<RoleRecord[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<Record<string, RolesTable>>().selectFrom(this.table).selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map(toRoleRecord);
  }

  /** Without a basis: create/seed upsert that still advances the version. With one: a rename whose
   * conditional `WHERE version = :expectedVersion` is the lock — see `SqlUserRepo.save`. */
  async save(record: RoleRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const { expectedVersion } = optional;
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: record.workspaceId, execute: async () => {
      if (expectedVersion === undefined) return this.upsert(record);
      const result = await this.kernel.run((db) => db.withTables<Record<string, RolesTable>>().updateTable(this.table)
        .set({ name: record.name, version: sql<number>`version + 1` })
        .where("workspace_id", "=", record.workspaceId).where("id", "=", record.id)
        .where("version", "=", expectedVersion).executeTakeFirst());
      await this.assertVersionedWrite({ changedRows: result.numUpdatedRows, recordKind: "role", recordId: record.id, expectedVersion,
        readCurrentVersion: async () => (await this.findById({ workspaceId: record.workspaceId, id: record.id }))?.version ?? null });
    } });
  }

  private async upsert(record: RoleRecord): Promise<void> {
    const row: Insertable<RolesTable> = {
      id: record.id,
      workspace_id: record.workspaceId,
      name: record.name,
      is_builtin: record.isBuiltin ? 1 : 0,
      version: record.version,
    };
    await this.kernel.run((db) =>
      db.withTables<Record<string, RolesTable>>().insertInto(this.table).values(row).onConflict((oc) => oc.column("id").doUpdateSet({ ...row, version: sql<number>`${sql.ref(`${this.table}.version`)} + 1` })).execute());
  }

  async delete(required: { workspaceId: string; id: string }): Promise<void> {
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: required.workspaceId, execute: () => this.kernel.run((db) =>
      db
        .withTables<Record<string, RolesTable>>().deleteFrom(this.table)
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .execute()) });
  }
}

function toPolicyRecord(row: Selectable<PoliciesTable>): PolicyRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description ?? undefined,
    isBuiltin: row.is_builtin === 1,
    isFrozen: row.is_frozen === 1,
    version: row.version,
  };
}

export class SqlPolicyRepo implements PolicyRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly table: string;
  private readonly assertVersionedWrite: AssertVersionedWritePort;
  constructor({ kernel, table, assertVersionedWrite }: SqlVersionedIdentityRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.table = table;
    this.assertVersionedWrite = assertVersionedWrite;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<PolicyRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, PoliciesTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toPolicyRecord(row) : null;
  }

  async findByName(required: { workspaceId: string; name: string }): Promise<PolicyRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, PoliciesTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("name", "=", required.name)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toPolicyRecord(row) : null;
  }

  async list(required: { workspaceId: string }): Promise<PolicyRecord[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<Record<string, PoliciesTable>>().selectFrom(this.table).selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map(toPolicyRecord);
  }

  /** Without a basis: create/seed upsert that still advances the version. With one: a name and
   * description edit whose conditional `WHERE version = :expectedVersion` is the lock — see `SqlUserRepo.save`. */
  async save(record: PolicyRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const { expectedVersion } = optional;
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: record.workspaceId, execute: async () => {
      if (expectedVersion === undefined) return this.upsert(record);
      const result = await this.kernel.run((db) => db.withTables<Record<string, PoliciesTable>>().updateTable(this.table)
        .set({ name: record.name, description: record.description ?? null, version: sql<number>`version + 1` })
        .where("workspace_id", "=", record.workspaceId).where("id", "=", record.id)
        .where("version", "=", expectedVersion).executeTakeFirst());
      await this.assertVersionedWrite({ changedRows: result.numUpdatedRows, recordKind: "policy", recordId: record.id, expectedVersion,
        readCurrentVersion: async () => (await this.findById({ workspaceId: record.workspaceId, id: record.id }))?.version ?? null });
    } });
  }

  private async upsert(record: PolicyRecord): Promise<void> {
    const row: Insertable<PoliciesTable> = {
      id: record.id,
      workspace_id: record.workspaceId,
      name: record.name,
      description: record.description ?? null,
      is_builtin: record.isBuiltin ? 1 : 0,
      is_frozen: record.isFrozen ? 1 : 0,
      version: record.version,
    };
    await this.kernel.run((db) =>
      db.withTables<Record<string, PoliciesTable>>().insertInto(this.table).values(row).onConflict((oc) => oc.column("id").doUpdateSet({ ...row, version: sql<number>`${sql.ref(`${this.table}.version`)} + 1` })).execute());
  }

  async delete(required: { workspaceId: string; id: string }): Promise<void> {
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: required.workspaceId, execute: () => this.kernel.run((db) =>
      db
        .withTables<Record<string, PoliciesTable>>().deleteFrom(this.table)
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .execute()) });
  }
}

function toPolicyPermissionRecord(row: Selectable<PolicyPermissionsTable>): PolicyPermissionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    policyId: row.policy_id,
    permission: row.permission,
    resourceType: row.resource_type ?? null,
    constraintJson: row.constraint_json ?? null,
  };
}

export class SqlPolicyPermissionRepo implements PolicyPermissionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly table: string;
  constructor({ kernel, table }: { kernel: StorageKernel<Kysely<unknown>, unknown>; table: string }, _optional = {}) {
    this.kernel = kernel;
    this.table = table;
  }

  async listByPolicyId(required: {
    workspaceId: string;
    policyId: string;
  }): Promise<PolicyPermissionRecord[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<Record<string, PolicyPermissionsTable>>().selectFrom(this.table)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("policy_id", "=", required.policyId)
        .execute()
    );
    return rows.map(toPolicyPermissionRecord);
  }

  async save(record: PolicyPermissionRecord): Promise<void> {
    const row: Insertable<PolicyPermissionsTable> = {
      id: record.id,
      workspace_id: record.workspaceId,
      policy_id: record.policyId,
      permission: record.permission,
      resource_type: record.resourceType ?? null,
      constraint_json: record.constraintJson ?? null,
    };
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: record.workspaceId, execute: () => this.kernel.run((db) =>
      db.withTables<Record<string, PolicyPermissionsTable>>().insertInto(this.table).values(row).onConflict((oc) => oc.column("id").doUpdateSet(row)).execute()) });
  }

  async deleteByPolicyId(required: { workspaceId: string; policyId: string }): Promise<void> {
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: required.workspaceId, execute: () => this.kernel.run((db) =>
      db
        .withTables<Record<string, PolicyPermissionsTable>>().deleteFrom(this.table)
        .where("workspace_id", "=", required.workspaceId)
        .where("policy_id", "=", required.policyId)
        .execute()) });
  }

  async delete(required: { workspaceId: string; id: string }): Promise<void> {
    await createIdentityTransactions({ kernel: this.kernel }).run({ workspaceId: required.workspaceId, execute: () => this.kernel.run((db) =>
      db
        .withTables<Record<string, PolicyPermissionsTable>>().deleteFrom(this.table)
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .execute()) });
  }
}
