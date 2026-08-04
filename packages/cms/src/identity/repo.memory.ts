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
} from "./types.js";
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
} from "./ports.js";

/**
 * @file In-memory adapters for the `identity` repo ports.
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

export class InMemoryPrincipalRepo implements PrincipalRepoPort {
  private rows: PrincipalRecord[];

  constructor(initialRows: PrincipalRecord[] = []) {
    this.rows = [...initialRows];
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

export class InMemoryUserRepo implements UserRepoPort {
  private rows: UserRecord[];

  constructor(initialRows: UserRecord[] = []) {
    this.rows = [...initialRows];
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

export class InMemorySessionRepo implements SessionRepoPort {
  private rows: SessionRecord[];

  constructor(initialRows: SessionRecord[] = []) {
    this.rows = [...initialRows];
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

export class InMemoryRoleRepo implements RoleRepoPort {
  private rows: RoleRecord[];

  constructor(initialRows: RoleRecord[] = []) {
    this.rows = [...initialRows];
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

export class InMemoryPolicyRepo implements PolicyRepoPort {
  private rows: PolicyRecord[];

  constructor(initialRows: PolicyRecord[] = []) {
    this.rows = [...initialRows];
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

export class InMemoryPolicyPermissionRepo implements PolicyPermissionRepoPort {
  private rows: PolicyPermissionRecord[];

  constructor(initialRows: PolicyPermissionRecord[] = []) {
    this.rows = [...initialRows];
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
}

export class InMemoryRolePolicyRepo implements RolePolicyRepoPort {
  private rows: RolePolicyRecord[];

  constructor(initialRows: RolePolicyRecord[] = []) {
    this.rows = [...initialRows];
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

export class InMemoryPrincipalRoleRepo implements PrincipalRoleRepoPort {
  private rows: PrincipalRoleRecord[];

  constructor(initialRows: PrincipalRoleRecord[] = []) {
    this.rows = [...initialRows];
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

export class InMemoryPrincipalPolicyRepo implements PrincipalPolicyRepoPort {
  private rows: PrincipalPolicyRecord[];

  constructor(initialRows: PrincipalPolicyRecord[] = []) {
    this.rows = [...initialRows];
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
