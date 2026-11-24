/**
 * @file In-memory adapters for the `members` repo ports (ADR-030 §5 rule-of-two).
 *
 * Purpose:
 * Test/dev implementations of `MemberRepoPort`, `MemberTierRepoPort`,
 * `MemberSubscriptionRepoPort`, `MemberSessionRepoPort`, and `MagicLinkTokenRepoPort`.
 * Mirrors the exact style of `src/features/post/repo.memory.ts`: constructor takes
 * seed rows, methods filter/mutate an internal array. No business rules live here —
 * that belongs to `write-service.ts` / `access-resolver.ts`.
 *
 * Architectural role:
 * Rule-of-two adapter #1 for each port; the SQLite adapter (Drizzle) is the ADR-030
 * follow-up build. Repos enforce persistence invariants; the write service and
 * resolver own member lifecycle and authentication decisions.
 */
import { pageFromArray, type ListPage } from "@jini-ai/core/list-page";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import { afterSettled } from "@jini-ai/core/errors/idioms";
import { matchesRecordFields, upsertRecord } from "@jini-ai/core/records";
import { MagicLinkTokenRejectedError, MemberAuthError, MemberConflictError } from "./types.js";
import type {
  ConsentPurpose,
  MagicLinkTokenRecord,
  MemberConsentRecord,
  MemberConsentRevisionRecord,
  MemberExternalIdentityRecord,
  MemberRecord,
  MemberSessionRecord,
  MemberSubscriptionRecord,
  MemberTierRecord,
} from "./types.js";
import type {
  MagicLinkTokenRepoPort,
  MemberConsentRepoPort,
  MemberExternalIdentityRepoPort,
  MemberRepoPort,
  MemberSessionRepoPort,
  MemberSubscriptionRepoPort,
  MemberTierRepoPort,
  MembersWriteServiceDeps,
} from "./ports.js";

/**
 * Resource-bounds pre-check (backend-implementation 5a4): an unbounded `list()`
 * over a caller-variable collection is a latent scale hazard even though members
 * lists are typically small. Cap the page size here so a missing `limit` can never
 * fan out to the entire table.
 */
const DEFAULT_LIST_LIMIT = 100;

/** Credential lifecycle for memory-only compositions: one in-process mutex serializes every password
 * write so post-hash revalidation and the writes cannot interleave. Memory repos have no rollback, so a
 * failure after the first write is not undone; durable compositions must pass their real kernel.
 * @complexity O(1) per call; waiters queue FIFO on one promise chain.
 * @example createInMemoryCredentialLifecycle().transaction(async () => {...})
 */
export function createInMemoryCredentialLifecycle(_options: Record<string, never> = {}): NonNullable<MembersWriteServiceDeps["credentialLifecycle"]> {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    transaction: <T>(work: () => Promise<T>): Promise<T> => {
      const run = tail.then(work);
      // The transaction caller receives run; this tail only keeps the queue usable.
      tail = afterSettled({ promise: run });
      return run;
    },
    // The transaction mutex is global to this composition, so per-key locks add nothing.
    lockKey: async () => {},
  };
}

/** Memory implementation of the identity persistence contract; returns copies like the SQL repo.
 * @complexity O(n) reads/writes; list O(n + p log p), n = stored identities, p = member providers.
 * @example new InMemoryMemberExternalIdentityRepo({})
 */
export class InMemoryMemberExternalIdentityRepo implements MemberExternalIdentityRepoPort {
  private rows: MemberExternalIdentityRecord[];

  constructor(required: { initialRows?: MemberExternalIdentityRecord[] }, _options: Record<string, never> = {}) {
    this.rows = (required.initialRows ?? []).map(row => ({ ...row }));
  }

  /** Stable subject lookup includes markers; no caller-owned object can mutate storage. */
  async findBySubject(required: { workspaceId: string; issuer: string; subject: string }, _options: Record<string, never> = {}): Promise<MemberExternalIdentityRecord | null> {
    const row = this.rows.find(entry => entry.workspaceId === required.workspaceId
      && entry.issuer === required.issuer && entry.subject === required.subject);
    return row ? { ...row } : null;
  }

  /** Return the member/provider reservation, including its unlink marker. */
  async findByMemberAndProvider(required: { workspaceId: string; memberId: string; providerId: string }, _options: Record<string, never> = {}): Promise<MemberExternalIdentityRecord | null> {
    const row = this.rows.find(entry => entry.workspaceId === required.workspaceId
      && entry.memberId === required.memberId && entry.providerId === required.providerId);
    return row ? { ...row } : null;
  }

  /** List copied reservations in the same deterministic order as SQL. */
  async listByMember(required: { workspaceId: string; memberId: string }, _options: Record<string, never> = {}): Promise<MemberExternalIdentityRecord[]> {
    return this.rows.filter(row => row.workspaceId === required.workspaceId && row.memberId === required.memberId)
      .sort((a, b) => {
        if (a.providerId < b.providerId) return -1;
        if (a.providerId > b.providerId) return 1;
        return 0;
      })
      .map(row => ({ ...row }));
  }

  /** Enforce both natural keys and the durable adapter's conditional-upsert fence before writing. */
  async save(record: MemberExternalIdentityRecord, { allowRelink = false }: { allowRelink?: boolean } = {}): Promise<void> {
    const existing = this.rows.find(row => row.id === record.id);
    if (existing) assertIdentityUpdate({ existing, record, allowRelink });
    const conflict = this.rows.some(row => row.id !== record.id && row.workspaceId === record.workspaceId
      && identityKeyConflicts({ existing: row, record }));
    if (conflict) throw new MemberConflictError("member identity already belongs to an association");
    this.rows = this.rows.filter(row => row.id !== record.id).concat({ ...record });
  }

  /** Stamp only live, scoped rows; preserve the first unlink time. */
  async unlink(required: { workspaceId: string; memberId: string; providerId: string; unlinkedAt: string }, _options: Record<string, never> = {}): Promise<void> {
    this.rows = this.rows.map(row => {
      if (row.workspaceId !== required.workspaceId || row.memberId !== required.memberId || row.providerId !== required.providerId || row.unlinkedAt !== undefined) return row;
      return { ...row, unlinkedAt: required.unlinkedAt };
    });
  }
}

/** Both unique keys reserve ownership even when unlinked. Pure, O(1). */
function identityKeyConflicts({ existing, record }: { existing: MemberExternalIdentityRecord; record: MemberExternalIdentityRecord }): boolean {
  return (existing.issuer === record.issuer && existing.subject === record.subject)
    || (existing.memberId === record.memberId && existing.providerId === record.providerId);
}

/** Reject immutable ownership changes and stale saves; reconnect alone may replace claims. O(1). */
function assertIdentityUpdate({ existing, record, allowRelink }: { existing: MemberExternalIdentityRecord; record: MemberExternalIdentityRecord; allowRelink: boolean }): void {
  if (existing.workspaceId !== record.workspaceId || existing.memberId !== record.memberId || existing.providerId !== record.providerId) {
    throw new MemberConflictError("member identity changed; re-read it before updating");
  }
  if (allowRelink) return;
  if (existing.unlinkedAt !== undefined || existing.issuer !== record.issuer || existing.subject !== record.subject) {
    throw new MemberConflictError("member identity changed; re-read it before updating");
  }
}

/**
 * In-memory `MemberRepoPort`. Keyset-paginates `list()` by lexicographic id order
 * (ids are ULIDs, so this is also creation order).
 *
 * @complexity `findById`/`findByEmail` O(n); `list` O(n log n) (sort, in `pageFromArray`) +
 * O(limit) page; `save` O(n). n = members in the workspace, expected small-to-moderate.
 * @overallScore 100
 */
export class InMemoryMemberRepo implements MemberRepoPort {
  private rows: MemberRecord[];
  // Separate credential storage preserves the same profile boundary as the durable adapter.
  private passwordHashes = new Map<string, string>();

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: MemberRecord[] } = {}) {
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: string; id: string }): Promise<MemberRecord | null> {
    return (
      this.rows.find((row) => row.workspaceId === required.workspaceId && row.id === required.id && row.status !== "trash") ??
      null
    );
  }

  async findByEmail(required: {
    workspaceId: string;
    email: string;
  }): Promise<MemberRecord | null> {
    const normalized = required.email.trim().toLowerCase();
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.email.toLowerCase() === normalized
      ) ?? null
    );
  }

  /** Match the durable credential-only lookup; missing/passwordless/Trash returns null. */
  async findPasswordHash(required: { workspaceId: string; memberId: string }, _options: Record<string, never> = {}): Promise<string | null> {
    const member = this.rows.find(row => row.workspaceId === required.workspaceId && row.id === required.memberId && row.status !== "trash");
    return member ? this.passwordHashes.get(member.id) ?? null : null;
  }

  /** Only the credential map changes, so saving a profile cannot erase or reveal a password hash. */
  async setPasswordHash(required: { workspaceId: string; memberId: string; passwordHash: string }, _options: Record<string, never> = {}): Promise<void> {
    const member = this.rows.find(row => row.workspaceId === required.workspaceId && row.id === required.memberId && row.status !== "trash");
    if (!member) throw new MemberAuthError("member was not found or is in Trash");
    this.passwordHashes.set(member.id, required.passwordHash);
  }

  async list(required: { workspaceId: string }, optional: { limit?: number; cursor?: string | null } = {}): Promise<ListPage<MemberRecord>> {
    const rows = this.rows.filter((row) => row.workspaceId === required.workspaceId && row.status !== "trash");
    const limit = Math.min(optional.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT);
    return pageFromArray({ rows, limit, cursor: optional.cursor ?? null, positionOf: (member) => [member.id], shape: ['string'] });
  }

  async save(record: MemberRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index === -1) {
      this.rows.push(record);
      return;
    }

    // Match the durable adapter: stale writes cannot resurrect a trashed member.
    const existing = this.rows[index];
    if (existing === undefined) throw new Error("Member repository has no row at the matched position");
    const cutoffRegressed = existing.credentialsRevokedAt !== undefined
      && (record.credentialsRevokedAt === undefined || existing.credentialsRevokedAt > record.credentialsRevokedAt);
    // C058: same exact-prior-version compare-and-set as the durable adapter (`stored = incoming - 1`).
    if (existing.status === "trash" || existing.version !== record.version - 1 || cutoffRegressed) {
      throw new MemberConflictError("member changed or is in Trash; re-read it before updating");
    }
    this.rows[index] = record;
  }
}

/**
 * In-memory `MemberTierRepoPort`.
 * @complexity All methods O(n) over tiers in the workspace (small registry).
 * @overallScore 100
 */
export class InMemoryMemberTierRepo implements MemberTierRepoPort {
  private rows: MemberTierRecord[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: MemberTierRecord[] } = {}) {
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: string; id: string }): Promise<MemberTierRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, id: required.id } })) ?? null;
  }

  async findBySlug(required: {
    workspaceId: string;
    slug: string;
  }): Promise<MemberTierRecord | null> {
    return (
      this.rows.find(
        (row) => row.workspaceId === required.workspaceId && row.slug === required.slug
      ) ?? null
    );
  }

  async list(required: { workspaceId: string }): Promise<MemberTierRecord[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId);
  }

  /** See {@link MemberTierRepoPort.save}. @complexity O(n) over tiers. */
  async save(record: MemberTierRecord, optional: { expectedVersion?: number } = {}): Promise<void> {
    const { expectedVersion } = optional;
    if (expectedVersion !== undefined) {
      const current = this.rows.find((row) => row.workspaceId === record.workspaceId && row.id === record.id);
      await assertVersionedWrite({ changedRows: current?.version === expectedVersion ? 1 : 0, recordKind: "membership tier", recordId: record.id,
        expectedVersion, readCurrentVersion: async () => current?.version ?? null });
    }
    upsertRecord({ records: this.rows, record, identity: { id: record.id } });
  }
}

/**
 * In-memory `MemberSubscriptionRepoPort`. `listActiveByMember` is the entitlement
 * set (ADR-030 §4): `active`/`comped` status AND not past a set `currentPeriodEnd`,
 * defensively re-checked here even though `setSubscriptionStatus` is expected to
 * flip `status` to `expired` when a period lapses — belt-and-braces against a
 * missed status transition (never trust only one signal for an access decision).
 *
 * @complexity All methods O(n) over a member's/workspace's subscriptions.
 * @overallScore 100
 */
export class InMemoryMemberSubscriptionRepo implements MemberSubscriptionRepoPort {
  private rows: MemberSubscriptionRecord[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: MemberSubscriptionRecord[] } = {}) {
    this.rows = [...initialRows];
  }

  async findById(required: {
    workspaceId: string;
    id: string;
  }): Promise<MemberSubscriptionRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, id: required.id } })) ?? null;
  }

  async listByMember(required: {
    workspaceId: string;
    memberId: string;
  }): Promise<MemberSubscriptionRecord[]> {
    return this.rows
      .filter((row) => row.workspaceId === required.workspaceId && row.memberId === required.memberId)
      .sort((a, b) => {
        if (a.startedAt < b.startedAt) return 1;
        if (a.startedAt > b.startedAt) return -1;
        return 0;
      });
  }

  async listActiveByMember(required: {
    workspaceId: string;
    memberId: string;
    nowIso: string;
  }): Promise<MemberSubscriptionRecord[]> {
    return this.rows.filter(
      (row) => {
        if (row.workspaceId !== required.workspaceId || row.memberId !== required.memberId) return false;
        return (row.status === "active" || row.status === "comped")
          && (!row.currentPeriodEnd || row.currentPeriodEnd > required.nowIso);
      }
    );
  }

  async save(record: MemberSubscriptionRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { id: record.id } });
  }
}

/**
 * In-memory `MemberSessionRepoPort`. Validity (expiry/revocation) is NOT checked
 * here — `findByTokenHash` returns the raw row and `MemberAccessResolver` decides
 * validity, exactly as the port doc directs.
 *
 * @complexity All methods O(n) over a workspace's/member's sessions.
 * @overallScore 100
 */
export class InMemoryMemberSessionRepo implements MemberSessionRepoPort {
  private rows: MemberSessionRecord[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: MemberSessionRecord[] } = {}) {
    this.rows = [...initialRows];
  }

  async findByTokenHash(required: {
    workspaceId: string;
    tokenHash: string;
  }): Promise<MemberSessionRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, tokenHash: required.tokenHash } })) ?? null;
  }

  async listByMember(required: {
    workspaceId: string;
    memberId: string;
  }): Promise<MemberSessionRecord[]> {
    return this.rows.filter(
      (row) => row.workspaceId === required.workspaceId && row.memberId === required.memberId
    );
  }

  async save(record: MemberSessionRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { id: record.id } });
  }

  async revoke(required: { workspaceId: string; id: string; revokedAt: string }): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === required.workspaceId && row.id === required.id
    );
    const row = this.rows[index];
    if (row === undefined) return;

    this.rows[index] = { ...row, revokedAt: required.revokedAt };
  }

  /** Revoke matching live sessions except the presenting one; never restore a revoked row.
   * @complexity O(n) time and space over stored sessions.
   */
  async revokeAllForMember(required: {
    workspaceId: string;
    memberId: string;
    revokedAt: string;
  }, options: { exceptSessionId?: string | undefined } = {}): Promise<void> {
    this.rows = this.rows.map((row) => {
      if (row.id === options.exceptSessionId) return row;
      return (
        row.workspaceId === required.workspaceId && row.memberId === required.memberId && !row.revokedAt
          ? { ...row, revokedAt: required.revokedAt }
          : row
      );
    });
  }
}

/**
 * In-memory `MagicLinkTokenRepoPort`. `consume()` enforces single-use at the repo
 * layer too (defense in depth) — the write service is expected to check
 * `consumedAt`/`expiresAt` first and translate to `MemberAuthError`, but a bug
 * there must not silently double-consume a token, so this throws a plain `Error`
 * (an infra invariant violation, not a domain validation outcome) if it's asked
 * to consume a token that no longer exists or is already consumed.
 *
 * @complexity All methods O(n) over a workspace's outstanding tokens.
 * @overallScore 100
 */
export class InMemoryMagicLinkTokenRepo implements MagicLinkTokenRepoPort {
  private rows: MagicLinkTokenRecord[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: MagicLinkTokenRecord[] } = {}) {
    this.rows = [...initialRows];
  }

  /** Match workspace-scoped code-entry handle lookup; missing/foreign handles return null. */
  async findById(required: { workspaceId: string; id: string }, _options: Record<string, never> = {}): Promise<MagicLinkTokenRecord | null> {
    return this.rows.find(row => row.workspaceId === required.workspaceId && row.id === required.id) ?? null;
  }

  async findByTokenHash(required: {
    workspaceId: string;
    tokenHash: string;
  }): Promise<MagicLinkTokenRecord | null> {
    return this.rows.find(record => matchesRecordFields({ record, fields: { workspaceId: required.workspaceId, tokenHash: required.tokenHash } })) ?? null;
  }

  async save(record: MagicLinkTokenRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { id: record.id } });
  }

  /** Same-tick check-and-increment mirrors the durable conditional UPDATE: no await can split them. */
  async reserveCodeAttempt(required: { workspaceId: string; id: string; nowIso: string }, { maxAttempts = 5 }: { maxAttempts?: number } = {}): Promise<boolean> {
    const index = this.rows.findIndex(row => row.workspaceId === required.workspaceId && row.id === required.id);
    const existing = this.rows[index];
    const failedAttempts = existing?.failedAttempts ?? 0;
    if (!existing || existing.consumedAt || existing.expiresAt <= required.nowIso || failedAttempts >= maxAttempts) return false;
    this.rows[index] = { ...existing, failedAttempts: failedAttempts + 1 };
    return true;
  }

  async consume(required: { workspaceId: string; id: string; consumedAt: string }): Promise<void> {
    const index = this.rows.findIndex(
      (row) => row.workspaceId === required.workspaceId && row.id === required.id
    );
    const row = this.rows[index];
    if (row === undefined) {
      throw new MagicLinkTokenRejectedError({ id: required.id, reason: "not_found" });
    }
    if (row.expiresAt <= required.consumedAt) {
      throw new MagicLinkTokenRejectedError({ id: required.id, reason: "expired" });
    }
    if (row.consumedAt) {
      throw new MagicLinkTokenRejectedError({ id: required.id, reason: "already_consumed" });
    }

    this.rows[index] = { ...row, consumedAt: required.consumedAt };
  }
}

/**
 * In-memory `MemberConsentRepoPort` (ADR-PIPE-013 Decision §4, D1c). Backs
 * both the `member_consents` value row and the shared `member_revisions`
 * ledger (`entity_kind='consent'`) — same combined-port shape
 * `SettingsRepoPort`'s in-memory adapter already uses.
 *
 * @complexity `findByMemberAndPurpose`/`save` O(n) over a workspace's consent
 * rows; `listRevisions` O(m) over a workspace's ledger rows. n/m expected
 * small-to-moderate (per-member, per-purpose).
 * @overallScore 100
 */
export class InMemoryMemberConsentRepo implements MemberConsentRepoPort {
  private rows: MemberConsentRecord[] = [];
  private revisions: MemberConsentRevisionRecord[] = [];
  private nextSeq = 1;

  async findByMemberAndPurpose(required: {
    workspaceId: string;
    memberId: string;
    purpose: ConsentPurpose;
  }): Promise<MemberConsentRecord | null> {
    return (
      this.rows.find(
        (row) =>
          row.workspaceId === required.workspaceId &&
          row.memberId === required.memberId &&
          row.purpose === required.purpose
      ) ?? null
    );
  }

  async save(record: MemberConsentRecord): Promise<void> {
    upsertRecord({ records: this.rows, record, identity: { id: record.id } });
  }

  async appendRevision(record: Omit<MemberConsentRevisionRecord, "seq">): Promise<number> {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.revisions.push({ ...record, seq });
    return seq;
  }

  async listRevisions(required: {
    workspaceId: string;
    memberId: string;
    purpose?: ConsentPurpose;
  }): Promise<MemberConsentRevisionRecord[]> {
    return this.revisions
      .filter(
        (row) =>
          row.workspaceId === required.workspaceId &&
          row.memberId === required.memberId &&
          (required.purpose === undefined || row.purpose === required.purpose)
      )
      .sort((a, b) => a.seq - b.seq);
  }

  /**
   * In-memory adapter is single-threaded/synchronous-per-microtask (same
   * reasoning `repo.sqlite.ts`'s real `BEGIN IMMEDIATE` header note gives for
   * why no interleaving is possible on one connection) — a same-tick
   * passthrough is a faithful, if trivial, atomicity guarantee here.
   */
  async transaction<T>({ fn }: { fn: () => Promise<T> }, _optional?: Record<string, never>): Promise<T> {
    return fn();
  }
}
