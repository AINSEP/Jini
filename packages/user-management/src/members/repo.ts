import { decodeListCursor, pageFromOverfetch, type ListPage } from "@jini-ai/core/list-page";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import type { Expression, Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { on, withoutId } from "./repo.sql.js";
import { MemberAuthError, MemberConflictError } from "./types.js";
import type {
  MemberConsentRepoPort,
  MemberExternalIdentityRepoPort,
  MemberRepoPort,
  MemberSubscriptionRepoPort,
  MemberTierRepoPort,
} from "./ports.js";
import {
  toConsentRevisionRow,
  toMemberConsentRecord,
  toMemberConsentRevisionRecord,
  toMemberConsentRow,
  toMemberExternalIdentityRecord,
  toMemberExternalIdentityRow,
  toMemberRecord,
  toMemberRow,
  toMemberSubscriptionRecord,
  toMemberSubscriptionRow,
  toMemberTierRecord,
  toMemberTierRow,
  type MemberConsentsTable,
  type MemberExternalIdentitiesTable,
  type MemberRevisionsTable,
  type MembersTable,
  type MemberSubscriptionsTable,
  type MemberTiersTable,
} from "./repo.rows.js";
import type {
  ConsentPurpose,
  MemberConsentRecord,
  MemberConsentRevisionRecord,
  MemberExternalIdentityRecord,
  MemberRecord,
  MemberSubscriptionRecord,
  MemberTierRecord,
} from "./types.js";

/**
 * @file THE members repositories: one Kysely query body for every database the storage kernel drives
 * (SQLite, PGlite, Postgres). Every statement goes through `kernel.run` and is awaited.
 *
 * Saves are single-statement upserts by primary key (atomic on their own); the unique indexes
 * (`members_workspace_email_unique`, ...) are the backstop for a conflicting writer. Read-then-write
 * paths (magic-token consume) take `kernel.lockKey` inside a transaction — a violation is never
 * caught and followed by a query, because on Postgres a failed statement aborts the transaction.
 *
 * Architectural role:
 * Infrastructure adapter. It takes a schema-free storage kernel and the host's table names
 * ({@link MemberTables}); it never imports a concrete database handle. The host's SQLite binding is
 * the thin subclass the composition root builds from the content db handle.
 *
 * Now: the session and magic-link repositories are in `repo.sessions.ts` (subpath `members/repo.sessions`).
 */

/** Host-owned table names. No schema or product table defaults live in the adapter. */
export interface MemberTables {
  members: string;
  memberTiers: string;
  memberSubscriptions: string;
  memberSessions: string;
  memberMagicTokens: string;
  memberConsents: string;
  memberRevisions: string;
  memberExternalIdentities: string;
}

/** The repos' constructor object: the schema-free kernel and the host table names. */
export interface MemberSqlRequired { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: MemberTables }

/**
 * The `revoked_at` a session upsert writes on conflict (the host's one-way revocation rule: the
 * stored value when the row is already revoked, else the incoming one). Host-owned because the same
 * rule guards the host's other session table.
 */
export type KeepStoredRevocationPort = (required: { table: string }, optional?: Record<string, never>) => Expression<string | null>;

/** The session repo's constructor object: the shared SQL deps plus the revocation rule. */
export interface MemberSessionSqlRequired extends MemberSqlRequired { keepStoredRevocation: KeepStoredRevocationPort }

/** A page of members never exceeds this many rows. */
const MAX_PAGE = 100;

/** External identity persistence on the existing kernel; joins any caller transaction.
 * Reads intentionally retain unlink markers and do not decide member authentication policy.
 * Database errors propagate; a rejected conditional upsert raises MemberConflictError.
 * @complexity Indexed lookups/writes O(log n); list O(log n + p), p = this member's providers.
 * @example new SqlMemberExternalIdentityRepo({ kernel })
 */
export class SqlMemberExternalIdentityRepo implements MemberExternalIdentityRepoPort {
  private readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  private readonly tables: MemberTables;

  constructor(required: MemberSqlRequired, _options: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  /** Resolve the stable subject, including unlink markers and without using an email claim. */
  async findBySubject(required: { workspaceId: string; issuer: string; subject: string }, _options: Record<string, never> = {}): Promise<MemberExternalIdentityRecord | null> {
    const row = await this.kernel.run(db => on<MemberExternalIdentitiesTable>(db).selectFrom(this.tables.memberExternalIdentities).selectAll()
      .where("workspace_id", "=", required.workspaceId).where("issuer", "=", required.issuer)
      .where("subject", "=", required.subject).executeTakeFirst());
    return row ? toMemberExternalIdentityRecord({ row }) : null;
  }

  /** Read the member/provider reservation, even after unlink. Missing/foreign returns null. */
  async findByMemberAndProvider(required: { workspaceId: string; memberId: string; providerId: string }, _options: Record<string, never> = {}): Promise<MemberExternalIdentityRecord | null> {
    const row = await this.kernel.run(db => on<MemberExternalIdentitiesTable>(db).selectFrom(this.tables.memberExternalIdentities).selectAll()
      .where("workspace_id", "=", required.workspaceId).where("member_id", "=", required.memberId)
      .where("provider_id", "=", required.providerId).executeTakeFirst());
    return row ? toMemberExternalIdentityRecord({ row }) : null;
  }

  /** Return all reservations in deterministic order; public views filter unlinked rows. */
  async listByMember(required: { workspaceId: string; memberId: string }, _options: Record<string, never> = {}): Promise<MemberExternalIdentityRecord[]> {
    const rows = await this.kernel.run(db => on<MemberExternalIdentitiesTable>(db).selectFrom(this.tables.memberExternalIdentities).selectAll()
      .where("workspace_id", "=", required.workspaceId).where("member_id", "=", required.memberId)
      .orderBy("provider_id").orderBy("id").execute());
    return rows.map(row => toMemberExternalIdentityRecord({ row }));
  }

  /** Single-statement upsert. The predicates fence stale callbacks without a read/write race. */
  async save(record: MemberExternalIdentityRecord, { allowRelink = false }: { allowRelink?: boolean } = {}): Promise<void> {
    const row = toMemberExternalIdentityRow({ record });
    const saved = await this.kernel.run(db => on<MemberExternalIdentitiesTable>(db).insertInto(this.tables.memberExternalIdentities).values(row)
      .onConflict(oc => {
        let update = oc.column("id").doUpdateSet(withoutId(row))
          .where(`${this.tables.memberExternalIdentities}.workspace_id`, "=", record.workspaceId)
          .where(`${this.tables.memberExternalIdentities}.member_id`, "=", record.memberId)
          .where(`${this.tables.memberExternalIdentities}.provider_id`, "=", record.providerId);
        // Only the signed-in connect service may replace a subject or clear the unlink marker.
        if (!allowRelink) update = update.where(`${this.tables.memberExternalIdentities}.unlinked_at`, "is", null)
          .where(`${this.tables.memberExternalIdentities}.issuer`, "=", record.issuer)
          .where(`${this.tables.memberExternalIdentities}.subject`, "=", record.subject);
        return update;
      })
      .returning("id").executeTakeFirst());
    if (!saved) throw new MemberConflictError("member identity changed; re-read it before updating");
  }

  /** Keep the first unlink marker; repeated unlink and foreign workspaces cannot alter it. */
  async unlink(required: { workspaceId: string; memberId: string; providerId: string; unlinkedAt: string }, _options: Record<string, never> = {}): Promise<void> {
    await this.kernel.run(db => on<MemberExternalIdentitiesTable>(db).updateTable(this.tables.memberExternalIdentities).set({ unlinked_at: required.unlinkedAt })
      .where("workspace_id", "=", required.workspaceId).where("member_id", "=", required.memberId)
      .where("provider_id", "=", required.providerId).where("unlinked_at", "is", null).execute());
  }
}

export class SqlMemberRepo implements MemberRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: MemberTables;
  constructor(required: MemberSqlRequired, _options: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<MemberRecord | null> {
    const row = await this.kernel.run((db) =>
      on<MembersTable>(db)
        .selectFrom(this.tables.members)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .where("status", "<>", "trash")
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMemberRecord(row) : null;
  }

  async findByEmail(required: { workspaceId: string; email: string }): Promise<MemberRecord | null> {
    const normalized = required.email.trim().toLowerCase();
    const row = await this.kernel.run((db) =>
      on<MembersTable>(db)
        .selectFrom(this.tables.members)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("email", "=", normalized)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMemberRecord(row) : null;
  }

  /** Credential-only lookup; the hash never enters a MemberRecord. Missing/passwordless/Trash returns null. */
  async findPasswordHash(required: { workspaceId: string; memberId: string }, _options: Record<string, never> = {}): Promise<string | null> {
    const row = await this.kernel.run(db => on<MembersTable>(db).selectFrom(this.tables.members).select("password_hash")
      .where("workspace_id", "=", required.workspaceId).where("id", "=", required.memberId)
      .where("status", "<>", "trash").executeTakeFirst());
    return row?.password_hash ?? null;
  }

  /** Change only the credential column, without racing a profile upsert into erasing the hash. */
  async setPasswordHash(required: { workspaceId: string; memberId: string; passwordHash: string }, _options: Record<string, never> = {}): Promise<void> {
    const row = await this.kernel.run(db => on<MembersTable>(db).updateTable(this.tables.members).set({ password_hash: required.passwordHash })
      .where("workspace_id", "=", required.workspaceId).where("id", "=", required.memberId)
      .where("status", "<>", "trash").returning("id").executeTakeFirst());
    if (!row) throw new MemberAuthError("member was not found or is in Trash");
  }

  /**
   * Members ordered by id, one page at a time. Reads one row past the page so `nextCursor` says
   * whether more exist: a bare capped array let the 101st member silently drop off the admin list
   * and `members_list` (refactor pattern list-cursor). The cursor is a position, not a row that must
   * still exist, so a member trashed between pages cannot restart the list at page one. Page size is
   * capped at {@link MAX_PAGE}.
   *
   * @throws {ToolInputError} "invalid cursor" for a cursor this list did not issue.
   * @complexity O(limit) rows read via the workspace index; one statement.
   */
  async list(required: { workspaceId: string }, optional: { limit?: number; cursor?: string | null } = {}): Promise<ListPage<MemberRecord>> {
    const limit = Math.min(optional.limit ?? MAX_PAGE, MAX_PAGE);
    const after = optional.cursor ? decodeListCursor({ cursor: optional.cursor, shape: ['string'] }) : null;
    const rows = await this.kernel.run((db) => {
      let query = on<MembersTable>(db).selectFrom(this.tables.members).selectAll().where("workspace_id", "=", required.workspaceId)
        .where("status", "<>", "trash");
      if (after) query = query.where("id", ">", String(after[0]));
      return query.orderBy("id").limit(limit + 1).execute();
    });
    return pageFromOverfetch({ rows: rows.map(toMemberRecord), limit, positionOf: (member) => [member.id] });
  }

  async save(record: MemberRecord): Promise<void> {
    const row = toMemberRow(record);
    const result = await this.kernel.run((db) =>
      on<MembersTable>(db)
        .insertInto(this.tables.members)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(withoutId(row))
          // A stale profile/sign-in write cannot undo Trash or its credential revocation.
          .where(`${this.tables.members}.status`, "<>", "trash")
          // C058: every write saves `version + 1` of what it read, so the stored row must still be at
          // exactly that read version. `<` let a skipped-ahead version through; `<=` let a second
          // writer from the same read silently overwrite the first.
          .where(`${this.tables.members}.version`, "=", record.version - 1)
          // Even a same-version stale save must not erase a newer credential cutoff.
          .where(eb => record.credentialsRevokedAt
            ? eb.or([eb(`${this.tables.members}.credentials_revoked_at`, "is", null),
                eb(`${this.tables.members}.credentials_revoked_at`, "<=", record.credentialsRevokedAt)])
            : eb(`${this.tables.members}.credentials_revoked_at`, "is", null)))
        .executeTakeFirst()
    );
    if (Number(result.numInsertedOrUpdatedRows) === 0) {
      throw new MemberConflictError("member changed or is in Trash; re-read it before updating");
    }
  }
}

export class SqlMemberTierRepo implements MemberTierRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: MemberTables;
  constructor(required: MemberSqlRequired, _options: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<MemberTierRecord | null> {
    const row = await this.kernel.run((db) =>
      on<MemberTiersTable>(db)
        .selectFrom(this.tables.memberTiers)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMemberTierRecord(row) : null;
  }

  async findBySlug(required: { workspaceId: string; slug: string }): Promise<MemberTierRecord | null> {
    const row = await this.kernel.run((db) =>
      on<MemberTiersTable>(db)
        .selectFrom(this.tables.memberTiers)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("slug", "=", required.slug)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMemberTierRecord(row) : null;
  }

  async list(required: { workspaceId: string }): Promise<MemberTierRecord[]> {
    const rows = await this.kernel.run((db) =>
      on<MemberTiersTable>(db).selectFrom(this.tables.memberTiers).selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map(toMemberTierRecord);
  }

  /** See {@link MemberTierRepoPort.save}. @complexity O(1); one more read on a conflict. */
  async save(record: MemberTierRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const row = toMemberTierRow(record);
    const { expectedVersion } = optional;
    if (expectedVersion !== undefined) {
      // One conditional UPDATE, not read-then-write: two editors that read the same version cannot both land.
      const result = await this.kernel.run((db) => on<MemberTiersTable>(db).updateTable(this.tables.memberTiers).set(withoutId(row))
        .where("workspace_id", "=", record.workspaceId).where("id", "=", record.id)
        .where("version", "=", expectedVersion).executeTakeFirst());
      await assertVersionedWrite({ changedRows: result.numUpdatedRows, recordKind: "membership tier", recordId: record.id, expectedVersion,
        readCurrentVersion: async () => (await this.findById({ workspaceId: record.workspaceId, id: record.id }))?.version ?? null });
      return;
    }
    await this.kernel.run((db) =>
      on<MemberTiersTable>(db)
        .insertInto(this.tables.memberTiers)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(withoutId(row)))
        .execute()
    );
  }
}

export class SqlMemberSubscriptionRepo implements MemberSubscriptionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: MemberTables;
  constructor(required: MemberSqlRequired, _options: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<MemberSubscriptionRecord | null> {
    const row = await this.kernel.run((db) =>
      on<MemberSubscriptionsTable>(db)
        .selectFrom(this.tables.memberSubscriptions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMemberSubscriptionRecord(row) : null;
  }

  /** Newest `started_at` first (`id` breaks ties so the order is stable). */
  async listByMember(required: { workspaceId: string; memberId: string }): Promise<MemberSubscriptionRecord[]> {
    const rows = await this.kernel.run((db) =>
      on<MemberSubscriptionsTable>(db)
        .selectFrom(this.tables.memberSubscriptions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("member_id", "=", required.memberId)
        .orderBy("started_at", "desc")
        .orderBy("id")
        .execute()
    );
    return rows.map(toMemberSubscriptionRecord);
  }

  /** `active`/`comped` subscriptions whose period has not ended (or has no end) at `nowIso`. */
  async listActiveByMember(required: {
    workspaceId: string;
    memberId: string;
    nowIso: string;
  }): Promise<MemberSubscriptionRecord[]> {
    const rows = await this.kernel.run((db) =>
      on<MemberSubscriptionsTable>(db)
        .selectFrom(this.tables.memberSubscriptions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("member_id", "=", required.memberId)
        .where("status", "in", ["active", "comped"])
        .where((eb) => eb.or([eb("current_period_end", "is", null), eb("current_period_end", ">", required.nowIso)]))
        .execute()
    );
    return rows.map(toMemberSubscriptionRecord);
  }

  async save(record: MemberSubscriptionRecord): Promise<void> {
    const row = toMemberSubscriptionRow(record);
    await this.kernel.run((db) =>
      on<MemberSubscriptionsTable>(db)
        .insertInto(this.tables.memberSubscriptions)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(withoutId(row)))
        .execute()
    );
  }
}

/**
 * D1c consent adapter (ADR-PIPE-013 Decision §4-5). Backs both `member_consents` and the shared
 * `member_revisions` ledger (`entity_kind='consent'`). `save` is a single upsert by id, so it needs
 * no lock; the `(workspace, member, purpose)` unique index is the backstop for a second consent row.
 * `transaction` is the kernel's: `consent-service.ts` awaits repo calls inside it.
 */
export class SqlMemberConsentRepo implements MemberConsentRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: MemberTables;
  constructor(required: MemberSqlRequired, _options: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  async findByMemberAndPurpose(required: {
    workspaceId: string;
    memberId: string;
    purpose: ConsentPurpose;
  }): Promise<MemberConsentRecord | null> {
    const row = await this.kernel.run((db) =>
      on<MemberConsentsTable>(db)
        .selectFrom(this.tables.memberConsents)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("member_id", "=", required.memberId)
        .where("purpose", "=", required.purpose)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toMemberConsentRecord(row) : null;
  }

  async save(record: MemberConsentRecord): Promise<void> {
    const row = toMemberConsentRow(record);
    await this.kernel.run((db) =>
      on<MemberConsentsTable>(db)
        .insertInto(this.tables.memberConsents)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(withoutId(row)))
        .execute()
    );
  }

  /** Appends one consent revision and returns its `seq`. */
  async appendRevision(record: Omit<MemberConsentRevisionRecord, "seq">): Promise<number> {
    const inserted = await this.kernel.run((db) =>
      on<MemberRevisionsTable>(db).insertInto(this.tables.memberRevisions).values(toConsentRevisionRow(record)).returning("seq").executeTakeFirstOrThrow()
    );
    return Number(inserted.seq);
  }

  /** A member's revisions, oldest `seq` first, optionally for one purpose. */
  async listRevisions(required: {
    workspaceId: string;
    memberId: string;
    purpose?: ConsentPurpose;
  }): Promise<MemberConsentRevisionRecord[]> {
    const rows = await this.kernel.run((db) => {
      let query = on<MemberRevisionsTable>(db)
        .selectFrom(this.tables.memberRevisions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("member_id", "=", required.memberId);
      if (required.purpose !== undefined) query = query.where("purpose", "=", required.purpose);
      return query.orderBy("seq").execute();
    });
    return rows.map(toMemberConsentRevisionRecord);
  }

  async transaction<T>({ fn }: { fn: () => Promise<T> }, _optional?: Record<string, never>): Promise<T> {
    return this.kernel.transaction(fn);
  }
}
