import type {
  PolicyPermissionRecord,
  PolicyRecord,
  PrincipalPolicyRecord,
  PrincipalRecord,
  PrincipalRoleRecord,
  RolePolicyRecord,
  RoleRecord,
  SessionRecord,
  UserRecord,
} from "../core/types.js";
import type {
  PolicyPermissionRepoPort,
  PolicyRepoPort,
  PrincipalPolicyRepoPort,
  PrincipalRepoPort,
  PrincipalRoleRepoPort,
  RolePolicyRepoPort,
  RoleRepoPort,
  SessionRepoPort,
  UserRepoPort,
} from "../core/ports.js";

/**
 * @file In-memory adapters for the `user-management` repo ports.
 *
 * Purpose:
 * Test/dev implementations of the nine identity repo ports. Mirrors the exact
 * style of `src/features/post/repo.memory.ts` / `src/members/repo.memory.ts`:
 * constructor takes seed rows, methods filter/mutate an internal array. No
 * business rules live here — that belongs to `authorize.ts`/`auth-service.ts`/
 * `seed.ts`.
 *
 * Architectural role:
 * The only adapter this pass — a SQLite adapter is a later step (see
 * `ports.ts` header and `server/deps.ts` comments), matching the disclosed
 * precedent of members/navigation/integrations/analytics.
 */

/** Snapshot seam used only by the memory transaction adapter; no business rules live here. */
export abstract class InMemoryIdentityRows<Row> {
  protected rows: Row[];

  constructor(required: Record<string, never>, optional: { initialRows?: Row[] } = {}) {
    this.rows = [...(optional.initialRows ?? [])];
  }

  /** Detached state so rollback also restores in-place changes such as session revocation. */
  snapshotRows(required: Record<string, never>): Row[] {
    return structuredClone(this.rows);
  }

  /** Restore a detached snapshot after the transaction rejects. */
  restoreRows(required: { rows: Row[] }): void {
    this.rows = required.rows;
  }
}

export class InMemoryPrincipalRepo extends InMemoryIdentityRows<PrincipalRecord> implements PrincipalRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: PrincipalRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async findById(required: { workspaceId: string; id: string }): Promise<PrincipalRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id) ?? null
    );
  }

  async list(required: { workspaceId: string }): Promise<PrincipalRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async save(record: PrincipalRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }
}

export class InMemoryUserRepo extends InMemoryIdentityRows<UserRecord> implements UserRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: UserRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async findByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<UserRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.principalId === required.principalId
      ) ?? null
    );
  }

  async findByUsername(required: {
    workspaceId: string;
    username: string;
  }): Promise<UserRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.username === required.username
      ) ?? null
    );
  }

  async list(required: { workspaceId: string }): Promise<UserRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async save(record: UserRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.principalId === record.principalId
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }
}

export class InMemorySessionRepo extends InMemoryIdentityRows<SessionRecord> implements SessionRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: SessionRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async findById(required: { workspaceId: string; id: string }): Promise<SessionRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id) ?? null
    );
  }

  async findByTokenHash(required: {
    workspaceId: string;
    tokenHash: string;
  }): Promise<SessionRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.tokenHash === required.tokenHash
      ) ?? null
    );
  }

  async save(record: SessionRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async revoke(required: { workspaceId: string; id: string; revokedAt: string }): Promise<void> {
    const row = this.rows.find(
      (candidate) => candidate.workspaceId === required.workspaceId && candidate.id === required.id
    );
    if (row) row.revokedAt = required.revokedAt;
  }

  async listByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<SessionRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.principalId === required.principalId
    );
  }
}

export class InMemoryRoleRepo extends InMemoryIdentityRows<RoleRecord> implements RoleRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: RoleRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async findById(required: { workspaceId: string; id: string }): Promise<RoleRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id) ?? null
    );
  }

  async findByName(required: { workspaceId: string; name: string }): Promise<RoleRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.name === required.name) ??
      null
    );
  }

  async list(required: { workspaceId: string }): Promise<RoleRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async save(record: RoleRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async delete(required: { workspaceId: string; id: string }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
  }
}

export class InMemoryPolicyRepo extends InMemoryIdentityRows<PolicyRecord> implements PolicyRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: PolicyRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async findById(required: { workspaceId: string; id: string }): Promise<PolicyRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id) ?? null
    );
  }

  async findByName(required: { workspaceId: string; name: string }): Promise<PolicyRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.name === required.name) ??
      null
    );
  }

  async list(required: { workspaceId: string }): Promise<PolicyRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  async save(record: PolicyRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async delete(required: { workspaceId: string; id: string }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
  }
}

export class InMemoryPolicyPermissionRepo extends InMemoryIdentityRows<PolicyPermissionRecord> implements PolicyPermissionRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: PolicyPermissionRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async listByPolicyId(required: {
    workspaceId: string;
    policyId: string;
  }): Promise<PolicyPermissionRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.policyId === required.policyId
    );
  }

  async save(record: PolicyPermissionRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }

  async deleteByPolicyId(required: { workspaceId: string; policyId: string }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.policyId === required.policyId)
    );
  }

  async delete(required: { workspaceId: string; id: string }): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === required.workspaceId && row.id === required.id)
    );
  }
}

export class InMemoryRolePolicyRepo extends InMemoryIdentityRows<RolePolicyRecord> implements RolePolicyRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: RolePolicyRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async listByRoleId(required: { workspaceId: string; roleId: string }): Promise<RolePolicyRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.roleId === required.roleId
    );
  }

  async listByPolicyId(required: { workspaceId: string; policyId: string }): Promise<RolePolicyRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.policyId === required.policyId
    );
  }

  async save(record: RolePolicyRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }
}

export class InMemoryPrincipalRoleRepo extends InMemoryIdentityRows<PrincipalRoleRecord> implements PrincipalRoleRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: PrincipalRoleRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async listByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<PrincipalRoleRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.principalId === required.principalId
    );
  }

  async listByRoleId(required: { workspaceId: string; roleId: string }): Promise<PrincipalRoleRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.roleId === required.roleId
    );
  }

  async save(record: PrincipalRoleRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }
}

export class InMemoryPrincipalPolicyRepo extends InMemoryIdentityRows<PrincipalPolicyRecord> implements PrincipalPolicyRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: PrincipalPolicyRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async listByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<PrincipalPolicyRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.principalId === required.principalId
    );
  }

  async listByPolicyId(required: {
    workspaceId: string;
    policyId: string;
  }): Promise<PrincipalPolicyRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.policyId === required.policyId
    );
  }

  async save(record: PrincipalPolicyRecord): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === record.workspaceId && row.id === record.id
    );
    if (index === -1) {
      this.rows.push(record);
      return;
    }
    this.rows[index] = record;
  }
}
