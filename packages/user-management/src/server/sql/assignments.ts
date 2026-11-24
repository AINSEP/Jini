import type { Kysely } from "kysely";
import type {
  PrincipalPolicyRecord, PrincipalPolicyRepoPort, PrincipalRoleRecord, PrincipalRoleRepoPort,
  IdentityTransactionPort, RolePolicyRecord, RolePolicyRepoPort,
} from "../../core/index.js";
import type { SqlIdentityKernel } from "./kernel.js";

/**
 * @file The three identity assignment join repositories (role->policy, principal->role, principal->policy) as
 * one Kysely query body for every dialect. Each `save` is an upsert on `id` inside the injected identity
 * transaction, so the workspace lock also covers it and a grant writer cannot insert a phantom reference
 * while a guarded mutation is deciding. Table names are host-owned.
 */

/** Stored column shape of the host's role->policy join table. */
export interface RolePoliciesTable { id: string; workspace_id: string; role_id: string; policy_id: string }
/** Stored column shape of the host's principal->role join table. */
export interface PrincipalRolesTable { id: string; workspace_id: string; principal_id: string; role_id: string }
/** Stored column shape of the host's principal->policy join table. */
export interface PrincipalPoliciesTable { id: string; workspace_id: string; principal_id: string; policy_id: string }

/** Host-owned table names. */
export interface RolePolicyTables { rolePolicies: string }
export interface PrincipalRoleTables { principalRoles: string }
export interface PrincipalPolicyTables { principalPolicies: string }

export interface AssignmentSqlRequired<Tables> { kernel: SqlIdentityKernel; transactions: IdentityTransactionPort; tables: Tables }

const rolePoliciesView = (db: Kysely<unknown>) => db.withTables<Record<string, RolePoliciesTable>>();
const principalRolesView = (db: Kysely<unknown>) => db.withTables<Record<string, PrincipalRolesTable>>();
const principalPoliciesView = (db: Kysely<unknown>) => db.withTables<Record<string, PrincipalPoliciesTable>>();

function toRolePolicyRecord(row: RolePoliciesTable): RolePolicyRecord {
  return { id: row.id, workspaceId: row.workspace_id, roleId: row.role_id, policyId: row.policy_id };
}

export class SqlRolePolicyRepo implements RolePolicyRepoPort {
  protected readonly kernel: SqlIdentityKernel;
  protected readonly transactions: IdentityTransactionPort;
  protected readonly tables: RolePolicyTables;
  constructor({ kernel, transactions, tables }: AssignmentSqlRequired<RolePolicyTables>, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.transactions = transactions;
    this.tables = tables;
  }

  async listByRoleId(required: { workspaceId: string; roleId: string }): Promise<RolePolicyRecord[]> {
    const rows = await this.kernel.run((db) =>
      rolePoliciesView(db)
        .selectFrom(this.tables.rolePolicies)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("role_id", "=", required.roleId)
        .execute()
    );
    return rows.map(toRolePolicyRecord);
  }

  async listByPolicyId(required: { workspaceId: string; policyId: string }): Promise<RolePolicyRecord[]> {
    const rows = await this.kernel.run((db) =>
      rolePoliciesView(db)
        .selectFrom(this.tables.rolePolicies)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("policy_id", "=", required.policyId)
        .execute()
    );
    return rows.map(toRolePolicyRecord);
  }

  async save(record: RolePolicyRecord): Promise<void> {
    const row: RolePoliciesTable = {
      id: record.id,
      workspace_id: record.workspaceId,
      role_id: record.roleId,
      policy_id: record.policyId,
    };
    await this.transactions.run({ workspaceId: record.workspaceId, execute: () => this.kernel.run((db) =>
      rolePoliciesView(db).insertInto(this.tables.rolePolicies).values(row).onConflict((oc) => oc.column("id").doUpdateSet(row)).execute()) });
  }
}

function toPrincipalRoleRecord(row: PrincipalRolesTable): PrincipalRoleRecord {
  return { id: row.id, workspaceId: row.workspace_id, principalId: row.principal_id, roleId: row.role_id };
}

export class SqlPrincipalRoleRepo implements PrincipalRoleRepoPort {
  protected readonly kernel: SqlIdentityKernel;
  protected readonly transactions: IdentityTransactionPort;
  protected readonly tables: PrincipalRoleTables;
  constructor({ kernel, transactions, tables }: AssignmentSqlRequired<PrincipalRoleTables>, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.transactions = transactions;
    this.tables = tables;
  }

  async listByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<PrincipalRoleRecord[]> {
    const rows = await this.kernel.run((db) =>
      principalRolesView(db)
        .selectFrom(this.tables.principalRoles)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("principal_id", "=", required.principalId)
        .execute()
    );
    return rows.map(toPrincipalRoleRecord);
  }

  async listByRoleId(required: { workspaceId: string; roleId: string }): Promise<PrincipalRoleRecord[]> {
    const rows = await this.kernel.run((db) =>
      principalRolesView(db)
        .selectFrom(this.tables.principalRoles)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("role_id", "=", required.roleId)
        .execute()
    );
    return rows.map(toPrincipalRoleRecord);
  }

  async save(record: PrincipalRoleRecord): Promise<void> {
    const row: PrincipalRolesTable = {
      id: record.id,
      workspace_id: record.workspaceId,
      principal_id: record.principalId,
      role_id: record.roleId,
    };
    await this.transactions.run({ workspaceId: record.workspaceId, execute: () => this.kernel.run((db) =>
      principalRolesView(db).insertInto(this.tables.principalRoles).values(row).onConflict((oc) => oc.column("id").doUpdateSet(row)).execute()) });
  }
}

function toPrincipalPolicyRecord(row: PrincipalPoliciesTable): PrincipalPolicyRecord {
  return { id: row.id, workspaceId: row.workspace_id, principalId: row.principal_id, policyId: row.policy_id };
}

export class SqlPrincipalPolicyRepo implements PrincipalPolicyRepoPort {
  protected readonly kernel: SqlIdentityKernel;
  protected readonly transactions: IdentityTransactionPort;
  protected readonly tables: PrincipalPolicyTables;
  constructor({ kernel, transactions, tables }: AssignmentSqlRequired<PrincipalPolicyTables>, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.transactions = transactions;
    this.tables = tables;
  }

  async listByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<PrincipalPolicyRecord[]> {
    const rows = await this.kernel.run((db) =>
      principalPoliciesView(db)
        .selectFrom(this.tables.principalPolicies)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("principal_id", "=", required.principalId)
        .execute()
    );
    return rows.map(toPrincipalPolicyRecord);
  }

  async listByPolicyId(required: {
    workspaceId: string;
    policyId: string;
  }): Promise<PrincipalPolicyRecord[]> {
    const rows = await this.kernel.run((db) =>
      principalPoliciesView(db)
        .selectFrom(this.tables.principalPolicies)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("policy_id", "=", required.policyId)
        .execute()
    );
    return rows.map(toPrincipalPolicyRecord);
  }

  async save(record: PrincipalPolicyRecord): Promise<void> {
    const row: PrincipalPoliciesTable = {
      id: record.id,
      workspace_id: record.workspaceId,
      principal_id: record.principalId,
      policy_id: record.policyId,
    };
    await this.transactions.run({ workspaceId: record.workspaceId, execute: () => this.kernel.run((db) =>
      principalPoliciesView(db)
        .insertInto(this.tables.principalPolicies)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(row))
        .execute()) });
  }
}
