/**
 * @file The members session and magic-link SQL repositories, split out of `repo.ts` (same kernel,
 * same host-owned {@link MemberTables}); see that file's header for the query and locking rules.
 */
import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { MemberAuthError } from "./types.js";
import type { MagicLinkTokenRepoPort, MemberSessionRepoPort } from "./ports.js";
import {
  toMagicLinkTokenRecord,
  toMagicLinkTokenRow,
  toMemberSessionRecord,
  toMemberSessionRow,
  type MemberMagicTokensTable,
  type MembersTable,
  type MemberSessionsTable,
} from "./repo.rows.js";
import type { MagicLinkTokenRecord, MemberSessionRecord } from "./types.js";
import type { KeepStoredRevocationPort, MemberSessionSqlRequired, MemberSqlRequired, MemberTables } from "./repo.js";
import { on, withoutId } from "./repo.sql.js";

/**
 * Sessions. Single-session revoke is atomic on its own. Bulk credential revocation takes the
 * member lock and updates the cutoff and sessions together; a repeated revoke never lowers it.
 * @complexity O(s) for bulk revocation, s = sessions of the member; two bulk updates, no per-row I/O.
 */
export class SqlMemberSessionRepo implements MemberSessionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: MemberTables;
  private readonly keepStoredRevocation: KeepStoredRevocationPort;
  constructor(required: MemberSessionSqlRequired, _options: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
    this.keepStoredRevocation = required.keepStoredRevocation;
  }

  async findByTokenHash(required: { workspaceId: string; tokenHash: string }): Promise<MemberSessionRecord | null> {
    const row = await this.kernel.run((db) =>
      on<MemberSessionsTable>(db)
        .selectFrom(this.tables.memberSessions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("token_hash", "=", required.tokenHash)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMemberSessionRecord(row) : null;
  }

  async listByMember(required: { workspaceId: string; memberId: string }): Promise<MemberSessionRecord[]> {
    const rows = await this.kernel.run((db) =>
      on<MemberSessionsTable>(db)
        .selectFrom(this.tables.memberSessions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("member_id", "=", required.memberId)
        .execute()
    );
    return rows.map(toMemberSessionRecord);
  }

  async save(record: MemberSessionRecord): Promise<void> {
    const row = toMemberSessionRow(record);
    await this.kernel.transaction(async () => {
      // Share the marker lock: a sign-in started before Trash must not mint a late credential,
      // even if restoration completes before its session write. Only credential revocation fences
      // that stale mint; ordinary edits and sign-ins leave other pending credentials usable.
      await this.kernel.lockKey(`trash:member:${record.workspaceId}:${record.memberId}`);
      const member = await this.kernel.run(db => on<MembersTable>(db).selectFrom(this.tables.members)
        .select(["status", "credentials_revoked_at"]).where("workspace_id", "=", record.workspaceId)
        .where("id", "=", record.memberId).executeTakeFirst());
      const revokedAfterCreation = member && member.credentials_revoked_at !== null && member.credentials_revoked_at > record.createdAt;
      if (member && (member.status === "trash" || member.status === "disabled" || revokedAfterCreation)) {
        throw new MemberAuthError("member changed before the session was saved; request a new sign-in link");
      }
      await this.kernel.run((db) => on<MemberSessionsTable>(db).insertInto(this.tables.memberSessions).values(row)
        // Revocation is one-way: a save never restores a revoked session (see keepStoredRevocation).
        .onConflict((oc) => oc.column("id").doUpdateSet({ ...withoutId(row), revoked_at: this.keepStoredRevocation({ table: this.tables.memberSessions }) }))
        .execute());
    });
  }

  async revoke(required: { workspaceId: string; id: string; revokedAt: string }): Promise<void> {
    await this.kernel.run((db) =>
      on<MemberSessionsTable>(db)
        .updateTable(this.tables.memberSessions)
        .set({ revoked_at: required.revokedAt })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .execute()
    );
  }

  /** Atomically advance the cutoff and revoke live sessions, optionally excluding one id.
   * @complexity O(s) affected sessions in one bulk update; database failures propagate.
   */
  async revokeAllForMember(required: { workspaceId: string; memberId: string; revokedAt: string },
    options: { exceptSessionId?: string } = {}): Promise<void> {
    await this.kernel.transaction(async () => {
      // Same lock as Trash and session minting: all sessions and the pending-link cutoff commit
      // together. A late request may persist a token after this update, but the cutoff rejects it.
      await this.kernel.lockKey(`trash:member:${required.workspaceId}:${required.memberId}`);
      await this.kernel.run(db => on<MembersTable>(db).updateTable(this.tables.members)
        .set({ credentials_revoked_at: required.revokedAt })
        .where("workspace_id", "=", required.workspaceId).where("id", "=", required.memberId)
        .where(eb => eb.or([eb("credentials_revoked_at", "is", null),
          eb("credentials_revoked_at", "<", required.revokedAt)]))
        .execute());
      const exceptSessionId = options.exceptSessionId;
      await this.kernel.run(db => on<MemberSessionsTable>(db).updateTable(this.tables.memberSessions)
        .set({ revoked_at: required.revokedAt })
        .where("workspace_id", "=", required.workspaceId).where("member_id", "=", required.memberId)
        // Exclude in SQL: revoking then restoring the current row could resurrect a concurrent sign-out.
        .$if(exceptSessionId !== undefined, query => {
          if (exceptSessionId === undefined) throw new Error("Member session exclusion has no session ID");
          return query.where("id", "!=", exceptSessionId);
        })
        .where("revoked_at", "is", null).execute());
    });
  }
}

export class SqlMagicLinkTokenRepo implements MagicLinkTokenRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: MemberTables;
  constructor(required: MemberSqlRequired, _options: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  /** Resolve a code-entry handle inside the member realm; missing/foreign handles return null. */
  async findById(required: { workspaceId: string; id: string }, _options: Record<string, never> = {}): Promise<MagicLinkTokenRecord | null> {
    const row = await this.kernel.run(db => on<MemberMagicTokensTable>(db).selectFrom(this.tables.memberMagicTokens).selectAll()
      .where("workspace_id", "=", required.workspaceId).where("id", "=", required.id).executeTakeFirst());
    return row ? toMagicLinkTokenRecord(row) : null;
  }

  async findByTokenHash(required: { workspaceId: string; tokenHash: string }): Promise<MagicLinkTokenRecord | null> {
    const row = await this.kernel.run((db) =>
      on<MemberMagicTokensTable>(db)
        .selectFrom(this.tables.memberMagicTokens)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("token_hash", "=", required.tokenHash)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMagicLinkTokenRecord(row) : null;
  }

  async save(record: MagicLinkTokenRecord): Promise<void> {
    const row = toMagicLinkTokenRow(record);
    await this.kernel.run((db) =>
      on<MemberMagicTokensTable>(db)
        .insertInto(this.tables.memberMagicTokens)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(withoutId(row)))
        .execute()
    );
  }

  /** The conditional UPDATE is atomic on both dialects, so no lock or read-then-write is needed.
   * `expires_at` is written as `toISOString()` UTC text, so the string comparison is time order. */
  async reserveCodeAttempt(required: { workspaceId: string; id: string; nowIso: string }, { maxAttempts = 5 }: { maxAttempts?: number } = {}): Promise<boolean> {
    const row = await this.kernel.run(db => on<MemberMagicTokensTable>(db).updateTable(this.tables.memberMagicTokens)
      .set(eb => ({ failed_attempts: eb("failed_attempts", "+", 1) }))
      .where("workspace_id", "=", required.workspaceId).where("id", "=", required.id)
      .where("consumed_at", "is", null).where("expires_at", ">", required.nowIso)
      .where("failed_attempts", "<", maxAttempts).returning("id").executeTakeFirst());
    return row !== undefined;
  }

  /**
   * Single-use: the check and the stamp run in one transaction holding the workspace's token lock, so
   * of two concurrent consumes exactly one wins and the other throws "already consumed". The UPDATE
   * also carries `consumed_at IS NULL`, so it can never overwrite an earlier stamp even if the lock
   * were bypassed.
   */
  async consume(required: { workspaceId: string; id: string; consumedAt: string }): Promise<void> {
    await this.kernel.transaction(async () => {
      await this.kernel.lockKey(`members:magic-tokens:${required.workspaceId}`);
      const existing = await this.kernel.run((db) =>
        on<MemberMagicTokensTable>(db)
          .selectFrom(this.tables.memberMagicTokens)
          .select(["consumed_at", "expires_at"])
          .where("workspace_id", "=", required.workspaceId)
          .where("id", "=", required.id)
          .limit(1)
          .executeTakeFirst()
      );
      if (!existing) {
        throw new Error(`magic link token '${required.id}' was not found`);
      }
      if (existing.expires_at <= required.consumedAt) {
        throw new Error(`magic link token '${required.id}' has expired`);
      }
      if (existing.consumed_at) {
        throw new Error(`magic link token '${required.id}' was already consumed`);
      }
      await this.kernel.run((db) =>
        on<MemberMagicTokensTable>(db)
          .updateTable(this.tables.memberMagicTokens)
          .set({ consumed_at: required.consumedAt })
          .where("workspace_id", "=", required.workspaceId)
          .where("id", "=", required.id)
          .where("consumed_at", "is", null)
          .where("expires_at", ">", required.consumedAt)
          .execute()
      );
    });
  }
}
