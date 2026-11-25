import type { AssertVersionedWritePort } from "@jini-ai/core/optimistic-concurrency";
import { matchesRecordFields, upsertRecord } from "@jini-ai/core/records";
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
 * style of `src/features/post/repo.memory.ts` / the host app's `src/features/members/repo.memory.ts`:
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

/** The constructor object of a versioned identity repo (users, roles, policies): the host binds its
 * optimistic-concurrency implementation, as for the in-memory webhook subscription repo. */
export interface InMemoryVersionedIdentityRequired { assertVersionedWrite: AssertVersionedWritePort }

/**
 * Compare-and-swap for one identity row. A supplied basis must still be the stored version; a
 * missing basis (create, seed, credential reset, legacy client) writes unconditionally.
 *
 * @throws {RecordVersionConflictError} (via the bound port) when the basis is stale or the row is gone.
 * @complexity O(1).
 */
async function writeVersionedRow<Row extends { version: number }>(
  required: { rows: Row[]; index: number; record: Row; recordKind: string; recordId: string; assertVersionedWrite: AssertVersionedWritePort },
  optional: { expectedVersion?: number } = {},
): Promise<void> {
  const current = required.rows[required.index];
  if (optional.expectedVersion !== undefined && current?.version !== optional.expectedVersion) {
    await required.assertVersionedWrite({ changedRows: 0, recordKind: required.recordKind, recordId: required.recordId,
      expectedVersion: optional.expectedVersion, readCurrentVersion: async () => current?.version ?? null });
  }
  // The successful compare and write stay synchronous for concurrent memory callers.
  if (current === undefined) { required.rows.push(required.record); return; }
  // Every write to an existing row advances it — even an unversioned credential reset — so an
  // editor's basis read before that write is stale and cannot write the old row back.
  required.rows[required.index] = { ...required.record, version: current.version + 1 };
}

/** Workspace-scoped rows keyed by `id`: the generic find/list/save/delete every identity repo shares. */
export abstract class InMemoryWorkspaceRecords<Row extends { workspaceId: string; id: string }> extends InMemoryIdentityRows<Row> {
  async findById(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<Row | null> { return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, id: required.id } as Partial<Row> })) ?? null; }
  async list(required: { workspaceId: string }, _optional: Record<string, never> = {}): Promise<Row[]> { return this.rows.filter(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId } as Partial<Row> })); }
  async save(record: Row, _optional: Record<string, never> = {}): Promise<void> { upsertRecord({ records: this.rows, record, identity: { workspaceId: record.workspaceId, id: record.id } as Partial<Row> }); }
  async delete(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<void> { this.rows = this.rows.filter(record => !matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, id: required.id } as Partial<Row> })); }
}

export class InMemoryPrincipalRepo extends InMemoryIdentityRows<PrincipalRecord> implements PrincipalRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: PrincipalRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async findById(required: { workspaceId: string; id: string }): Promise<PrincipalRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, id: required.id } })) ?? null;
  }

  async list(required: { workspaceId: string }): Promise<PrincipalRecord[]> {
    return this.rows.filter(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId } }));
  }

  async save(record: PrincipalRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { workspaceId: record.workspaceId, id: record.id } });
  }

  async insertIfAbsent({ record }: { record: PrincipalRecord }, _optional: Record<string, never> = {}): Promise<PrincipalRecord> {
    // No await between lookup and insert: competing calls on this store cannot interleave.
    const existing = this.rows.find(row => matchesRecordFields({ record: row, fields: { workspaceId: record.workspaceId, id: record.id } }));
    if (existing) return existing;
    this.rows.push(record);
    return record;
  }
}

export class InMemoryUserRepo extends InMemoryIdentityRows<UserRecord> implements UserRepoPort {
  private readonly assertVersionedWrite: AssertVersionedWritePort;

  constructor({ assertVersionedWrite }: InMemoryVersionedIdentityRequired, { initialRows = [] }: { initialRows?: UserRecord[] } = {}) {
    super({}, { initialRows });
    this.assertVersionedWrite = assertVersionedWrite;
  }

  async findByPrincipalId(required: {
    workspaceId: string;
    principalId: string;
  }): Promise<UserRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: required })) ?? null;
  }

  async findByUsername(required: {
    workspaceId: string;
    username: string;
  }): Promise<UserRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: required })) ?? null;
  }

  async list(required: { workspaceId: string }): Promise<UserRecord[]> {
    return this.rows.filter(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId } }));
  }

  async save(record: UserRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const index = this.rows.findIndex(row => matchesRecordFields({ record: row, fields: { workspaceId: record.workspaceId, principalId: record.principalId } }));
    const stored = this.rows[index];
    // A versioned save is a profile edit: login and password bookkeeping are written by their own
    // paths and are not part of the editor's snapshot, so the stored values are kept.
    const written = optional.expectedVersion !== undefined && stored !== undefined
      ? { ...record, passwordHash: stored.passwordHash, lastLoginAt: stored.lastLoginAt } : record;
    return writeVersionedRow({ rows: this.rows, index, record: written, recordKind: "user", recordId: record.principalId, assertVersionedWrite: this.assertVersionedWrite }, optional);
  }

  async recordLogin(required: { workspaceId: string; principalId: string; lastLoginAt: string }): Promise<void> {
    const index = this.rows.findIndex(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, principalId: required.principalId } }));
    // Replace the slot with a fresh object (never mutate a row a caller may hold) touching one field only.
    if (index >= 0) this.rows[index] = { ...this.rows[index]!, lastLoginAt: required.lastLoginAt };
  }
}

export class InMemorySessionRepo extends InMemoryIdentityRows<SessionRecord> implements SessionRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: SessionRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async findById(required: { workspaceId: string; id: string }): Promise<SessionRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, id: required.id } })) ?? null;
  }

  async findByTokenHash(required: {
    workspaceId: string;
    tokenHash: string;
  }): Promise<SessionRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: required })) ?? null;
  }

  async save(record: SessionRecord): Promise<void> {
    // Revocation is one-way: a record read before a logout/reset/disable carries no `revokedAt` and must not restore the session.
    const revokedAt = (await this.findById(record))?.revokedAt;
    upsertRecord({ records: this.rows, record: revokedAt ? { ...record, revokedAt } : record, identity: { workspaceId: record.workspaceId, id: record.id } });
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
    return this.rows.filter(record => matchesRecordFields({ record, fields: required }));
  }
}

export class InMemoryRoleRepo extends InMemoryWorkspaceRecords<RoleRecord> implements RoleRepoPort {
  private readonly assertVersionedWrite: AssertVersionedWritePort;

  constructor({ assertVersionedWrite }: InMemoryVersionedIdentityRequired, { initialRows = [] }: { initialRows?: RoleRecord[] } = {}) {
    super({}, { initialRows });
    this.assertVersionedWrite = assertVersionedWrite;
  }

  override async save(record: RoleRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const index = this.rows.findIndex(row => matchesRecordFields({ record: row, fields: { workspaceId: record.workspaceId, id: record.id } }));
    return writeVersionedRow({ rows: this.rows, index, record, recordKind: "role", recordId: record.id, assertVersionedWrite: this.assertVersionedWrite }, optional);
  }

  async findByName(required: { workspaceId: string; name: string }): Promise<RoleRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, name: required.name } })) ?? null;
  }
}

export class InMemoryPolicyRepo extends InMemoryWorkspaceRecords<PolicyRecord> implements PolicyRepoPort {
  private readonly assertVersionedWrite: AssertVersionedWritePort;

  constructor({ assertVersionedWrite }: InMemoryVersionedIdentityRequired, { initialRows = [] }: { initialRows?: PolicyRecord[] } = {}) {
    super({}, { initialRows });
    this.assertVersionedWrite = assertVersionedWrite;
  }

  override async save(record: PolicyRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const index = this.rows.findIndex(row => matchesRecordFields({ record: row, fields: { workspaceId: record.workspaceId, id: record.id } }));
    return writeVersionedRow({ rows: this.rows, index, record, recordKind: "policy", recordId: record.id, assertVersionedWrite: this.assertVersionedWrite }, optional);
  }

  async findByName(required: { workspaceId: string; name: string }): Promise<PolicyRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, name: required.name } })) ?? null;
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
    return this.rows.filter(record => matchesRecordFields({ record, fields: required }));
  }

  async save(record: PolicyPermissionRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { workspaceId: record.workspaceId, id: record.id } });
  }

  async deleteByPolicyId(required: { workspaceId: string; policyId: string }): Promise<void> {
    this.rows = this.rows.filter(record => !matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, policyId: required.policyId } }));
  }

  async delete(required: { workspaceId: string; id: string }): Promise<void> {
    this.rows = this.rows.filter(record => !matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, id: required.id } }));
  }
}

export class InMemoryRolePolicyRepo extends InMemoryIdentityRows<RolePolicyRecord> implements RolePolicyRepoPort {

  constructor(_required: Record<string, never>, { initialRows = [] }: { initialRows?: RolePolicyRecord[] } = {}) {
    super(_required, { initialRows });
  }

  async listByRoleId(required: { workspaceId: string; roleId: string }): Promise<RolePolicyRecord[]> {
    return this.rows.filter(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, roleId: required.roleId } }));
  }

  async listByPolicyId(required: { workspaceId: string; policyId: string }): Promise<RolePolicyRecord[]> {
    return this.rows.filter(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, policyId: required.policyId } }));
  }

  async save(record: RolePolicyRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { workspaceId: record.workspaceId, id: record.id } });
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
    return this.rows.filter(record => matchesRecordFields({ record, fields: required }));
  }

  async listByRoleId(required: { workspaceId: string; roleId: string }): Promise<PrincipalRoleRecord[]> {
    return this.rows.filter(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, roleId: required.roleId } }));
  }

  async save(record: PrincipalRoleRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { workspaceId: record.workspaceId, id: record.id } });
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
    return this.rows.filter(record => matchesRecordFields({ record, fields: required }));
  }

  async listByPolicyId(required: {
    workspaceId: string;
    policyId: string;
  }): Promise<PrincipalPolicyRecord[]> {
    return this.rows.filter(record => matchesRecordFields({ record, fields: required }));
  }

  async save(record: PrincipalPolicyRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { workspaceId: record.workspaceId, id: record.id } });
  }
}
