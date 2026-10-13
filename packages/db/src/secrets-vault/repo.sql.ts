import { sql, type Expression, type Kysely } from "kysely";
import { assertVaultReplacement, VaultError, type VaultBatchOp, type VaultBatchResult, type VaultDefaultQuery, type VaultSingletonQuery, type VaultMeta, type VaultOptions, type VaultQuery,
  type VaultRecord, type VaultRepoPort } from "@jini-ai/platform/secrets/credential-sets";
import { jsonSet, toBool } from "../kernel/dialect.js";
import type { StorageKernel } from "../kernel/port.js";

/** Fixed columns consumed by the adapter; hosts own DDL, foreign keys and migration provenance.
 * A partial unique default index and label index use the same scope as VaultRepoPort.
 * Nullable principal/provider scope columns must be normalized in those index expressions, spelled
 * as findDefault spells them, and the default index's predicate is `is_default = 1` on SQLite, `= true` on Postgres.
 * Read indexes: (workspace_id,kind,owner_key,principal_id,provider,is_default), and the same
 * group prefix plus (updated_at DESC,id DESC) with binary/C ID collation for promotion.
 * Singleton reads use the lookup index's (workspace_id,kind) prefix, optionally owner/principal.
 */
export interface SecretsVaultTable {
  workspace_id: string; id: string; kind: VaultRecord["kind"]; owner_key: string;
  principal_id: string | null; binding: string | null; provider: string | null; label: string;
  is_default: boolean | number; revision: number;
  sealed_key_id: string | null; sealed_ciphertext: string | null; sealed_nonce: string | null; sealed_alg: string | null;
  last4: string | null; token_length: number | null;
  meta: string | VaultMeta; created_at: string; updated_at: string;
}
export interface SecretsVaultDatabase { secrets_vault: SecretsVaultTable }

function fromRow(row: SecretsVaultTable): VaultRecord {
  const parts = [row.sealed_key_id, row.sealed_ciphertext, row.sealed_nonce, row.sealed_alg];
  if (parts.some(v => v === null) && !parts.every(v => v === null)) throw new VaultError({ code: "invalid-record" });
  let meta: VaultMeta;
  try { meta = typeof row.meta === "string" ? JSON.parse(row.meta) as VaultMeta : row.meta; }
  catch { throw new VaultError({ code: "invalid-meta" }); }
  return { workspaceId: row.workspace_id, id: row.id, kind: row.kind, ownerKey: row.owner_key,
    principalId: row.principal_id, binding: row.binding, provider: row.provider, label: row.label,
    isDefault: toBool(row.is_default) ?? false, revision: Number(row.revision),
    sealed: row.sealed_key_id === null ? null : { keyId: row.sealed_key_id, ciphertext: row.sealed_ciphertext!, nonce: row.sealed_nonce!, alg: row.sealed_alg! },
    last4: row.last4, tokenLength: row.token_length,
    meta,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function toRow(record: VaultRecord): SecretsVaultTable {
  return { workspace_id: record.workspaceId, id: record.id, kind: record.kind, owner_key: record.ownerKey,
    principal_id: record.principalId, binding: record.binding, provider: record.provider, label: record.label,
    is_default: record.isDefault, revision: record.revision, sealed_key_id: record.sealed?.keyId ?? null,
    sealed_ciphertext: record.sealed?.ciphertext ?? null, sealed_nonce: record.sealed?.nonce ?? null, sealed_alg: record.sealed?.alg ?? null,
    last4: record.last4, token_length: record.tokenLength, meta: JSON.stringify(record.meta),
    created_at: record.createdAt, updated_at: record.updatedAt };
}

/** One Kysely adapter for SQLite and Postgres/PGlite. Workspace lock `secrets_vault:<workspaceId>`
 * serializes every writer, including targeted patches and boot rotation. Nested transactions join
 * the host's transaction, allowing MCP payload/pointer/status writes to commit together.
 */
export class SqlSecretsVaultRepo implements VaultRepoPort {
  private readonly kernel: StorageKernel<SecretsVaultDatabase>;
  constructor({ kernel }: { kernel: StorageKernel<SecretsVaultDatabase> }, _options: VaultOptions = {}) { this.kernel = kernel; }

  private write<T>(workspaceId: string, body: () => Promise<T>): Promise<T> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(`secrets_vault:${workspaceId}`);
      return body();
    });
  }
  private group(record: VaultRecord) {
    return { workspaceId: record.workspaceId, kind: record.kind, ownerKey: record.ownerKey,
      principalId: record.principalId, provider: record.provider };
  }
  private scoped({ db, input }: { db: Kysely<SecretsVaultDatabase>; input: VaultQuery }, _options: VaultOptions = {}) {
    let query = db.selectFrom("secrets_vault").where("workspace_id", "=", input.workspaceId)
      .where("kind", "=", input.kind).where("owner_key", "=", input.ownerKey)
      .where("principal_id", input.principalId === null ? "is" : "=", input.principalId);
    if (input.provider !== undefined) query = query.where("provider", input.provider === null ? "is" : "=", input.provider);
    return query;
  }
  async find(input: { workspaceId: string; id: string }, _options: VaultOptions = {}): Promise<VaultRecord | null> {
    const row = await this.kernel.run(db => db.selectFrom("secrets_vault").selectAll()
      .where("workspace_id", "=", input.workspaceId).where("id", "=", input.id).executeTakeFirst());
    return row ? fromRow(row) : null;
  }
  /** One indexed singleton SELECT; provider/default never participate in this lookup. */
  async findOne(input: VaultSingletonQuery, _options: VaultOptions = {}): Promise<VaultRecord | null> {
    const row = await this.kernel.run(db => {
      let query = db.selectFrom("secrets_vault").selectAll().where("workspace_id", "=", input.workspaceId).where("kind", "=", input.kind);
      if (input.ownerKey !== undefined) query = query.where("owner_key", "=", input.ownerKey);
      if (input.principalId !== undefined) query = query.where("principal_id", input.principalId === null ? "is" : "=", input.principalId);
      return query.limit(1).executeTakeFirst();
    });
    return row ? fromRow(row) : null;
  }
  /** One kernel transaction; nested mutations join it and retain their CAS/default owner.
   * Lock every workspace in sorted order before writes to avoid opposite-order batch deadlocks.
   * Failures must escape a surrounding host transaction (the kernel does not use savepoints).
   */
  async applyBatch({ ops }: { ops: readonly VaultBatchOp[] }, _options: VaultOptions = {}): Promise<VaultBatchResult[]> {
    return this.kernel.transaction(async () => {
      const workspaces = ops.map(op => "put" in op ? op.put.record.workspaceId : "delete" in op ? op.delete.workspaceId : op.patchMeta.workspaceId);
      for (const workspaceId of [...new Set(workspaces)].sort()) await this.kernel.lockKey(`secrets_vault:${workspaceId}`);
      const results: VaultBatchResult[] = [];
      for (const op of ops) {
        results.push("put" in op ? await this.put(op.put) : "delete" in op ? await this.delete(op.delete) : await this.patchMeta(op.patchMeta));
      }
      return results;
    });
  }
  /** One indexed exact-group lookup; ciphertext is loaded only for the chosen default.
   * The group is restated in the default index's normalized expressions and `is_default` is a
   * literal, else neither SQLite nor a generic Postgres plan can match the partial index (Tovu
   * EXPLAIN 2026-10-12: SQLite fell back to a raw-column index, Postgres to the label index). */
  async findDefault(input: VaultDefaultQuery, _options: VaultOptions = {}): Promise<VaultRecord | null> {
    const row = await this.kernel.run(db => this.scoped({ db, input }).selectAll()
      .where(sql<boolean>`(principal_id IS NULL)`, "=", input.principalId === null).where(sql<string>`coalesce(principal_id,'')`, "=", input.principalId ?? "")
      .where(sql<boolean>`(provider IS NULL)`, "=", input.provider === null).where(sql<string>`coalesce(provider,'')`, "=", input.provider ?? "")
      .where(sql<boolean>`is_default = ${sql.raw(this.kernel.dialect === "sqlite" ? "1" : "true")}`).limit(1).executeTakeFirst());
    return row ? fromRow(row) : null;
  }
  async list(input: VaultQuery, _options: VaultOptions = {}): Promise<VaultRecord[]> {
    const rows = await this.kernel.run(db => this.scoped({ db, input }).selectAll().execute());
    // Sort identifiers in JS to avoid host database collation changing the memory contract.
    return rows.map(fromRow).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  async put(input: { record: VaultRecord; expectedRevision: number | null }, _options: VaultOptions = {}): Promise<VaultRecord> {
    return this.write(input.record.workspaceId, async () => {
      const existing = await this.find(input.record);
      assertVaultReplacement({ ...input, existing });
      const scope = this.group(input.record);
      // Unchanged-label rotations need no uniqueness read; DB constraints still guard writes.
      const moved = existing !== null && existing.provider !== input.record.provider;
      if (moved || existing?.label !== input.record.label) {
        const duplicate = await this.kernel.run(db => this.scoped({ db, input: scope }).select("id")
          .where("id", "!=", input.record.id).where("label", "=", input.record.label).limit(1).executeTakeFirst());
        if (duplicate) throw new VaultError({ code: "conflict" });
      }
      const hasGroup = (existing !== null && !moved) || input.record.isDefault || Boolean(await this.kernel.run(db =>
        this.scoped({ db, input: scope }).select("id").limit(1).executeTakeFirst()));
      const saved = { ...input.record, isDefault: input.record.isDefault || !hasGroup };
      // Clear before insert/update so a partial UNIQUE default index never sees two defaults.
      if (saved.isDefault) await this.kernel.run(db => db.updateTable("secrets_vault")
        .set(eb => ({ is_default: false, revision: eb("revision", "+", 1) }))
        .where("workspace_id", "=", saved.workspaceId).where("kind", "=", saved.kind).where("owner_key", "=", saved.ownerKey)
        .where("principal_id", saved.principalId === null ? "is" : "=", saved.principalId)
        .where("provider", saved.provider === null ? "is" : "=", saved.provider)
        .where("id", "!=", saved.id).where("is_default", "=", true).execute());
      const row = await this.kernel.run(db => input.expectedRevision === null
        ? db.insertInto("secrets_vault").values(toRow(saved)).returningAll().executeTakeFirstOrThrow()
        : db.updateTable("secrets_vault").set(toRow(saved)).where("workspace_id", "=", saved.workspaceId)
          .where("id", "=", saved.id).where("revision", "=", input.expectedRevision).returningAll().executeTakeFirst());
      if (!row) throw new VaultError({ code: "conflict" });
      if (moved && existing.isDefault) await this.promote({ record: existing });
      return fromRow(row);
    });
  }
  /** Top-level targeted JSON writes preserve ciphertext/default fields; caller validates merged meta. */
  async patchMeta(input: { workspaceId: string; id: string; expectedRevision: number; patch: VaultMeta; updatedAt: string }, _options: VaultOptions = {}): Promise<VaultRecord> {
    return this.write(input.workspaceId, async () => {
      const row = await this.kernel.run(db => db.updateTable("secrets_vault").set(eb => {
        let meta: Expression<unknown> = eb.ref("meta");
        for (const [key, value] of Object.entries(input.patch)) meta = jsonSet(this.kernel.dialect, meta, [key], value);
        return { meta: meta as Expression<string>, revision: eb("revision", "+", 1), updated_at: input.updatedAt };
      }).where("workspace_id", "=", input.workspaceId).where("id", "=", input.id)
        .where("revision", "=", input.expectedRevision).returningAll().executeTakeFirst());
      if (!row) throw new VaultError({ code: "conflict" });
      return fromRow(row);
    });
  }
  async delete(input: { workspaceId: string; id: string; expectedRevision: number }, _options: VaultOptions = {}): Promise<boolean> {
    return this.write(input.workspaceId, async () => {
      const existing = await this.find(input);
      if (!existing) return false;
      if (existing.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
      await this.kernel.run(db => db.deleteFrom("secrets_vault").where("workspace_id", "=", input.workspaceId)
        .where("id", "=", input.id).where("revision", "=", input.expectedRevision).execute());
      if (existing.isDefault) await this.promote({ record: existing });
      return true;
    });
  }
  /** Pick only one identity using the same binary ordering for deletion and provider moves. */
  private async promote({ record }: { record: VaultRecord }, _options: VaultOptions = {}): Promise<void> {
    // Let the database pick one identity; binary collation avoids locale-dependent winners.
    const promoted = await this.kernel.run(db => this.scoped({ db, input: this.group(record) })
      .select(["id", "updated_at"]).orderBy("updated_at", "desc")
      .orderBy(this.kernel.dialect === "sqlite" ? sql<string>`id COLLATE BINARY` : sql<string>`id COLLATE "C"`, "desc")
      .limit(1).executeTakeFirst());
    if (promoted) await this.kernel.run(db => db.updateTable("secrets_vault")
      .set(eb => ({ is_default: true, revision: eb("revision", "+", 1) }))
      .where("workspace_id", "=", record.workspaceId).where("id", "=", promoted.id).execute());
  }
}
