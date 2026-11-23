/**
 * @file Port contracts + core-service contracts for the `members` library (ADR-030).
 *
 * Purpose:
 * Dependency-inversion seams (ADR-006 rule-of-two) and the shapes of the two
 * core-code contracts that are deliberately NOT ports (single-implementation,
 * ADR-006 / ADR-021 "no PolicyPort" reasoning): the entitlement/access resolver
 * and the single write chokepoint.
 *
 * Ports declared here (each has a real second adapter in v1 → rule-of-two honest):
 *  - Member{,Tier,Subscription,Session,MagicLinkToken}RepoPort — in-memory + SQLite.
 *
 * `MailerPort` is imported from the shared `../mail` core primitive (ADR-037) — it is no
 * longer declared locally (Round-3 audit fold, TM-admin-sweep-001: the local shape here
 * predated ADR-037 and didn't match its frozen contract).
 *
 * NOT a port in v1 (ADR-006 letter — no second adapter *being built now*):
 *  - Payment/billing. It is a deferred tier-3 seam, not core code: a billing
 *    plugin writes `source='billing'` subscription rows through the core
 *    chokepoint under a capability. See ADR-030 §6. No PaymentPort here.
 *
 * Interfaces and types only — no feature logic.
 */
import type { ListPage } from "@jini-ai/core/list-page";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { PositionalMailer as MailerPort } from "@jini-ai/core/contracts/mail";
import type { MailSenderIdentityPort } from "@jini-ai/core/contracts/site/platform-mail";
import type { MailStatus } from "@jini-ai/core/contracts/mail";
import type { OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";
import type { PasswordHasherPort, PrincipalRepoPort } from "../core/index.js";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type {
  ConsentPurpose,
  MagicLinkTokenRecord,
  MemberAccessDecision,
  MemberConsentRecord,
  MemberConsentRevisionRecord,
  MemberContentAccess,
  MemberContext,
  MemberExternalIdentityRecord,
  MemberRecord,
  MemberSessionRecord,
  MemberSubscriptionRecord,
  MemberSubscriptionStatus,
  MemberTierRecord,
} from "./types.js";

/* -------------------------------------------------------------------------- */
/* Repository ports (rule-of-two: in-memory + SQLite, mirroring PostRepoPort)  */
/* -------------------------------------------------------------------------- */

export interface MemberRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<MemberRecord | null>;
  findByEmail(required: { workspaceId: UUID; email: string }): Promise<MemberRecord | null>;
  /** Credential-only read; missing, passwordless or trashed members return null. Never a profile field. */
  findPasswordHash(required: { workspaceId: UUID; memberId: UUID }, options?: Record<string, never>): Promise<string | null>;
  /** Update only the hash; reject a missing/trashed member. Profile saves never write this column. */
  setPasswordHash(required: { workspaceId: UUID; memberId: UUID; passwordHash: string }, options?: Record<string, never>): Promise<void>;
  /** Members ordered by id, at most 100 per page. `nextCursor` is null on the last page; pass it back
   *  as `cursor` for the next one. A cursor that is not one of these is refused, never read as page one. */
  list(required: { workspaceId: UUID }, optional?: { limit?: number; cursor?: string | null }): Promise<ListPage<MemberRecord>>;
  save(record: MemberRecord): Promise<void>;
}

/** Persistence only: the member-login service owns trusted claims, activation and link policy.
 * Reads include unlink markers; callers must inspect `unlinkedAt` before authenticating.
 * @example identities.findBySubject({ workspaceId, issuer, subject })
 */
export interface MemberExternalIdentityRepoPort {
  findBySubject(required: { workspaceId: UUID; issuer: string; subject: string }, options?: Record<string, never>): Promise<MemberExternalIdentityRecord | null>;
  findByMemberAndProvider(required: { workspaceId: UUID; memberId: UUID; providerId: string }, options?: Record<string, never>): Promise<MemberExternalIdentityRecord | null>;
  /** Includes unlinked rows, ordered by providerId then id. Public views must filter markers. */
  listByMember(required: { workspaceId: UUID; memberId: UUID }, options?: Record<string, never>): Promise<MemberExternalIdentityRecord[]>;
  /** Upsert by id. Ordinary saves cannot change issuer/subject or overwrite an unlink marker.
   * Only a service handling a signed-in connect may set allowRelink; reuse the existing row's id.
   * Id, workspace, member and provider ownership never change, even on explicit reconnect.
   * Natural-key collisions reject; the caller must retry the whole transaction after re-reading.
   */
  save(record: MemberExternalIdentityRecord, options?: { allowRelink?: boolean }): Promise<void>;
  /** Stamp a live association once; missing/foreign/already-unlinked rows are a no-op. */
  unlink(required: { workspaceId: UUID; memberId: UUID; providerId: string; unlinkedAt: ISODateTime }, options?: Record<string, never>): Promise<void>;
}

export interface MemberTierRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<MemberTierRecord | null>;
  findBySlug(required: { workspaceId: UUID; slug: string }): Promise<MemberTierRecord | null>;
  list(required: { workspaceId: UUID }): Promise<MemberTierRecord[]>;
  /**
   * Upsert without `expectedVersion` (create/import); with it, a compare-and-set that throws
   * `RecordVersionConflictError` (`@jini-ai/core/optimistic-concurrency`) when the stored version is
   * no longer the one the editor read — two editors never silently overwrite each other.
   */
  save(record: MemberTierRecord, optional?: { expectedVersion?: number }): Promise<void>;
}

export interface MemberSubscriptionRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<MemberSubscriptionRecord | null>;
  /** All subscriptions for a member (any status), newest first. */
  listByMember(required: { workspaceId: UUID; memberId: UUID }): Promise<MemberSubscriptionRecord[]>;
  /** Active/comped subscriptions only — the entitlement set (ADR-030 §4). */
  listActiveByMember(required: {
    workspaceId: UUID;
    memberId: UUID;
    nowIso: ISODateTime;
  }): Promise<MemberSubscriptionRecord[]>;
  save(record: MemberSubscriptionRecord): Promise<void>;
}

export interface MemberSessionRepoPort {
  findByTokenHash(required: {
    workspaceId: UUID;
    tokenHash: string;
  }): Promise<MemberSessionRecord | null>;
  listByMember(required: { workspaceId: UUID; memberId: UUID }): Promise<MemberSessionRecord[]>;
  save(record: MemberSessionRecord): Promise<void>;
  /** Server-side revocation (single session or all a member's sessions). */
  revoke(required: { workspaceId: UUID; id: UUID; revokedAt: ISODateTime }): Promise<void>;
  /** Revoke sessions; optionally preserve the presenting session. */
  revokeAllForMember(required: {
    workspaceId: UUID;
    memberId: UUID;
    revokedAt: ISODateTime;
  }, options?: { exceptSessionId?: UUID | undefined }): Promise<void>;
}

export interface MagicLinkTokenRepoPort {
  /** Challenge handle lookup for code entry, scoped to the member workspace. */
  findById(required: { workspaceId: UUID; id: UUID }, options?: Record<string, never>): Promise<MagicLinkTokenRecord | null>;
  findByTokenHash(required: {
    workspaceId: UUID;
    tokenHash: string;
  }): Promise<MagicLinkTokenRecord | null>;
  save(record: MagicLinkTokenRecord): Promise<void>;
  /**
   * Spend one code attempt BEFORE the code is verified: one conditional UPDATE increments
   * `failedAttempts` only while the challenge is unconsumed, unexpired at `nowIso` and under
   * `maxAttempts` (default 5). False when none remain, so parallel guesses cannot outrun the limit.
   */
  reserveCodeAttempt(required: { workspaceId: UUID; id: UUID; nowIso: ISODateTime }, options?: { maxAttempts?: number | undefined }): Promise<boolean>;
  /** Mark consumed (single-use); consuming an already-consumed token is denied. */
  consume(required: { workspaceId: UUID; id: UUID; consumedAt: ISODateTime }): Promise<void>;
}

/**
 * D1c consent persistence seam (ADR-PIPE-013 Decision §4, C-002). Backs the
 * `member_consents` value table plus the shared `member_revisions` ledger
 * (`entity_kind='consent'`) — mirrors `SettingsRepoPort`'s combined
 * value+revision-ledger shape (`repo.ts`/`repo.sqlite.ts` both implement one
 * port covering both tables, not two separate ports). Package-private write
 * access is enforced at `consent-service.ts`'s module boundary, not here — no
 * other module may import `repo.memory.ts`/`repo.sqlite.ts` directly.
 */
export interface MemberConsentRepoPort {
  findByMemberAndPurpose(required: {
    workspaceId: UUID;
    memberId: UUID;
    purpose: ConsentPurpose;
  }): Promise<MemberConsentRecord | null>;
  /** Upsert by `id` (mirrors every other repo port's `save` shape). */
  save(record: MemberConsentRecord): Promise<void>;
  /** Append one immutable ledger row; returns the assigned monotonic `seq`. */
  appendRevision(record: Omit<MemberConsentRevisionRecord, "seq">): Promise<number>;
  /** Read the ledger, ascending by `seq`. Mainly a test/audit seam — no shipping caller reads this yet. */
  listRevisions(required: {
    workspaceId: UUID;
    memberId: UUID;
    purpose?: ConsentPurpose;
  }): Promise<MemberConsentRevisionRecord[]>;
  /**
   * Wrap a value write + its same-tx revision append atomically (mirrors
   * `SettingsRepoPort.transaction`). The in-memory adapter's implementation is
   * a same-tick passthrough (no real rollback possible/needed); the SQLite
   * adapter uses a real `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`.
   */
  transaction<T>(required: { fn: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
}

/* -------------------------------------------------------------------------- */
/* MailerPort — imported from the shared `mail` core primitive (ADR-037).     */
/* Members' `send(email)` simplicity survives as SDK sugar (`mail.sendSimple`)*/
/* over the one shared port — one interface, one wrapper, never a second     */
/* port (ADR-037 §5). The members lib never talks to a provider SDK.         */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Core-code contracts that are NOT ports (single evaluator — ADR-006/021)     */
/* -------------------------------------------------------------------------- */

/**
 * Entitlement/content-gating resolver. This is ordinary core code called at the
 * site read chokepoint — NOT a port and NOT the ADR-021 operator RBAC
 * `authorize()`. It decides content visibility on the *entitlement* axis (tier
 * membership), exactly as ADR-021 keeps plugin capabilities on a separate axis.
 * One evaluator ⇒ no port (ADR-006, the "no PolicyPort" reasoning of ADR-021 §2).
 */
export interface MemberAccessResolver {
  /**
   * Resolve the request's membership context from a validated member session.
   * Anonymous/absent session ⇒ `{ isAuthenticated: false, activeTierIds: [] }`.
   * Never trusts a client-supplied claim.
   */
  resolveContext(required: {
    workspaceId: UUID;
    /** Raw session token from the member cookie (public origin only). */
    sessionToken?: string;
    nowIso: ISODateTime;
  }): Promise<MemberContext>;

  /**
   * Decide whether `context` may read an entry carrying `access`. Pure function
   * of the declared visibility + the context's active tiers; fail-closed on any
   * unknown visibility value (ADR-021 §8 fail-closed lineage).
   */
  decide(required: { access: MemberContentAccess; context: MemberContext }): MemberAccessDecision;
}

/**
 * The single write chokepoint for all member-domain mutations (ADR-022 §4a /
 * ADR-028 §4 discipline: authorize/entitle → validate → upsert + append revision
 * in ONE transaction → emit outbox event). Repo ports above are package-private
 * behind this service; no module writes member tables by any other path (CI
 * canary asserts it). Interface-only here; implementation is ADR-030's follow-up.
 *
 * Operator-initiated calls (tier/subscription/comp management) also flow through
 * the ADR-018 admin command gateway so they are audited + revertible; member
 * self-service calls (sign-up, profile edit) are attributed to the member
 * principal in the same revision ledger.
 */
export interface MembersWriteServiceDeps {
  /** Post-commit creation notification. Transactional callers defer it until their outer commit. */
  onMemberCreated?: (required: { workspaceId: string; memberId: string;
    creationSource: "operator" | "verified_signup" | "oidc_signup"; initialState: "pending" | "active" }, optional?: Record<string, never>) => void;
  /** Password writes require the SAME kernel as members/sessions. No non-atomic fallback.
   * Optional for compositions that only use the other member workflows.
   */
  credentialLifecycle?: Pick<StorageKernel<unknown>, "transaction" | "lockKey">;
  clock: ClockPort;
  ids: IdGeneratorPort;
  members: MemberRepoPort;
  tiers: MemberTierRepoPort;
  subscriptions: MemberSubscriptionRepoPort;
  sessions: MemberSessionRepoPort;
  magicLinks: MagicLinkTokenRepoPort;
  /** Inject the staff Argon2 adapter; omitted legacy compositions use that same adapter. */
  passwordHasher?: PasswordHasherPort;
  mailer: MailerPort;
  /** Site-wide status; checked before reading any address. */
  mailStatus?: (() => Promise<MailStatus>) | undefined;
  /**
   * The identity principal store. A member signing up gets a `kind: "member"` principal row with
   * the member's own id (`MemberRecord.id` is a principal id, ADR-021 §5), so `authorize()` can
   * reject the member AS a member: `@jini-ai/user-management`'s `principalKindMayExercisePermission`
   * bars that kind from every operator permission (OWNER DECISION 2026-10-04, F3144). Required so
   * no composition can forget it.
   */
  principals: Pick<PrincipalRepoPort, "save">;
  /**
   * ADR-040 canonical-origin registry. Sign-in refuses without trusted origin evidence.
   */
  origin?: OriginRegistryPort | undefined;
  /**
   * Resolves the sign-in email's From (`platform/mail/sender-identity.ts`). Optional so hermetic
   * compositions keep working: absent, the `no-reply@members.local` placeholder is used only while
   * `mailer` is a non-delivering one, and a delivering mailer refuses with
   * `SenderIdentityNotConfiguredError`.
   */
  senderIdentity?: MailSenderIdentityPort | undefined;
}

export type MembersWriteServiceSourceDeps = {
  clock: MembersWriteServiceDeps["clock"];
  idGen: MembersWriteServiceDeps["ids"];
  memberRepo: MembersWriteServiceDeps["members"];
  memberTierRepo: MembersWriteServiceDeps["tiers"];
  memberSubscriptionRepo: MembersWriteServiceDeps["subscriptions"];
  memberSessionRepo: MembersWriteServiceDeps["sessions"];
  magicLinkRepo: MembersWriteServiceDeps["magicLinks"];
  mailer: MembersWriteServiceDeps["mailer"];
  mailStatus?: MembersWriteServiceDeps["mailStatus"];
  originRegistry?: MembersWriteServiceDeps["origin"];
  principalRepo: MembersWriteServiceDeps["principals"];
  mailSenderIdentity?: MembersWriteServiceDeps["senderIdentity"];
};

/** Assembles the write-service bundle in the feature: importing from the HTTP admin layer would
 * invert the codebase's ports/adapters direction. @complexity O(1), object construction only. */
export function buildMembersWriteServiceDeps(
  { deps }: { deps: MembersWriteServiceSourceDeps },
  _optional: Record<string, never> = {},
): MembersWriteServiceDeps {
  return {
    clock: deps.clock,
    ids: deps.idGen,
    members: deps.memberRepo,
    tiers: deps.memberTierRepo,
    subscriptions: deps.memberSubscriptionRepo,
    sessions: deps.memberSessionRepo,
    magicLinks: deps.magicLinkRepo,
    mailer: deps.mailer,
    mailStatus: deps.mailStatus,
    origin: deps.originRegistry,
    principals: deps.principalRepo,
    senderIdentity: deps.mailSenderIdentity,
  };
}

/** Exactly one challenge credential; the link and code spend the same consumption stamp. */
export type MemberSignInInput = { workspaceId: UUID; userAgent?: string | undefined; ip?: string | undefined } & (
  | { token: string; challengeId?: never; code?: never }
  | { token?: never; challengeId: string; code: string }
);

export interface MemberSignInResult {
  /** Set only by the durable creation owner; never inferred from timestamps. */
  isNewMember?: boolean;
  member: MemberRecord;
  session: MemberSessionRecord;
  /** Cookie bearer; never persisted or included in a member profile. */
  rawSessionToken: string;
}

export interface MembersWriteService {
  /** Begin email sign-in/up: mint a shared challenge and mail its link plus code. */
  requestSignInLink(required: {
    deps: MembersWriteServiceDeps;
    input: { workspaceId: UUID; email: string; redirectPath?: string };
  }): Promise<{ delivered: boolean; challengeId: string }>;

  /** Consume a link or code: verify email, upsert member, mint a member session. */
  completeSignIn(required: {
    deps: MembersWriteServiceDeps;
    input: MemberSignInInput;
  }): Promise<MemberSignInResult>;

  /** Operator/self profile update (validated, revision-recorded). */
  updateProfile(required: {
    deps: MembersWriteServiceDeps;
    input: { workspaceId: UUID; memberId: UUID; name?: string; note?: string };
  }): Promise<{ member: MemberRecord }>;

  /** Operator: disable a member (ADR-021 §5 disable-only, never hard-delete). */
  disableMember(required: {
    deps: MembersWriteServiceDeps;
    input: { workspaceId: UUID; memberId: UUID };
  }): Promise<{ member: MemberRecord }>;

  /** Operator: grant a comp subscription (free/comped entitlement). */
  compSubscription(required: {
    deps: MembersWriteServiceDeps;
    input: { workspaceId: UUID; memberId: UUID; tierId: UUID };
  }): Promise<{ subscription: MemberSubscriptionRecord }>;

  /**
   * Change a subscription's status (cancel/expire). The `billing` source is
   * written here by the future tier-3 billing plugin via capability — core v1
   * uses this for comp lifecycle only (ADR-030 §6).
   */
  setSubscriptionStatus(required: {
    deps: MembersWriteServiceDeps;
    input: {
      workspaceId: UUID;
      subscriptionId: UUID;
      status: MemberSubscriptionStatus;
      externalRef?: string;
    };
  }): Promise<{ subscription: MemberSubscriptionRecord }>;
}
