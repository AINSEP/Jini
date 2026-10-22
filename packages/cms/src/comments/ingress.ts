/**
 * @file ADR-031 §4 — `CommentIngressPolicy`, the single core-mediated public-submission
 * boundary (mirrors ADR-027's one `MediaIngressPolicy`). Enforces, in order:
 * comments-enabled → entry-open → parent-exists → depth-cap → rate-limit → honeypot/size/link
 * caps → sanitize → hook chain (veto/transform) → spam classification → write.
 *
 * Spam is stored silently (`status: "spam"`), never rejected at the boundary — a rejection is an
 * oracle a spammer tunes against (ADR-031 §4's own explicit instruction).
 *
 * `entryLookup` is a narrow, caller-injected dependency (ADR-046 Phase 3's "narrow typed
 * dependencies" convention) rather than a direct import of the entries feature module — its
 * `commentsClosed` field is where `CommentsSettings.closeAfterDays` math against the entry's own
 * publish date belongs; this file does not duplicate that logic.
 *
 * `authorIpHash`/honeypot are read from `submission.ingressContext` (already computed/salted by
 * the HTTP route layer, per `CommentSubmission`'s own doc: "the raw IP is never stored" — this
 * file never sees it) under the fixed keys `authorIpHash` and `honeypotValue`.
 *
 * `getSettings` (SPEC-035, ADR-028 Settings Layered Ledger wiring) is a per-call RESOLVER, not a
 * boot-captured snapshot — `submit()` reads it fresh at the top of every call, so an operator's
 * settings change via the admin `PUT .../comments/settings` route (`settings.ts`) takes effect on
 * the very next submission, not only after a restart. `index.ts` builds this resolver from
 * `settingsRepo` when the composition root supplies one, falling back to a fixed snapshot
 * otherwise (hermetic tests that don't wire the ledger).
 */
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, UUID } from "@jini-ai/core/primitives";
import { nowIso } from "@jini-ai/core/primitives";
import type { OutboxPort } from "../core/index.js";
import type { RateLimiter as HttpRateLimiter } from "@jini-ai/http-kit/rate-limit";

/** Only the request check belongs to ingress; limiter construction and diagnostics are host policy. */
export type CommentRateLimiter = Pick<HttpRateLimiter, "check">;
import type { CommentHookRegistry } from "./hooks.js";
import type {
  CommentIngressPolicy,
  CommentIngressRejection,
  CommentIngressResult,
  CommentRepoPort,
  SpamCheckPort,
} from "./ports.js";
import { countLinks, sanitizeCommentBody } from "./sanitize.js";
import { COMMENTS_INGRESS_SYSTEM_PRINCIPAL_ID } from "./types.js";
import type {
  CommentRecord,
  CommentStatus,
  CommentSubmission,
  CommentsSettings,
  ModerationLogEntry,
  SpamVerdict,
} from "./types.js";

const MAX_BODY_LENGTH = 10_000;
const MAX_LINKS = 5;

export interface EntryLookupResult {
  id: UUID;
  /** True when the entry itself is closed to new comments (per-entry override or `closeAfterDays`). */
  commentsClosed: boolean;
}

export interface CommentIngressDeps {
  repo: CommentRepoPort;
  spamCheck: SpamCheckPort;
  hooks: CommentHookRegistry;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  getSettings: (workspaceId: UUID) => Promise<CommentsSettings>;
  entryLookup: (required: { workspaceId: UUID; entryId: UUID }) => Promise<EntryLookupResult | null>;
  rateLimiter: CommentRateLimiter;
  /** ADR-031 §8 — every successful submission emits `comments.submitted` (whatever status
   * resulted, including an auto-classified `spam`); a moderator's LATER explicit action is what
   * emits `comments.marked_spam` (see `write-service.ts`) — the two are deliberately distinct. */
  outbox: OutboxPort;
}

function readIngressString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A step's shared failure shape — matches `CommentIngressResult`'s own `{ ok: false, reason }`
 *  half exactly, so a caller can `return` it directly as the policy's own result. */
interface StepRejected {
  readonly ok: false;
  readonly reason: CommentIngressRejection;
}

/** entry-exists + entry-open gate (comments-enabled → entry-open, per this file's header). */
async function checkEntryGate(deps: CommentIngressDeps, submission: CommentSubmission): Promise<{ ok: true } | StepRejected> {
  const entry = await deps.entryLookup({ workspaceId: submission.workspaceId, entryId: submission.entryId });
  if (!entry) return { ok: false, reason: "entry-not-found" };
  if (entry.commentsClosed) return { ok: false, reason: "entry-closed" };
  return { ok: true };
}

interface ParentContext {
  readonly ok: true;
  readonly depth: number;
  readonly parentThreadRootId: UUID | null;
}

/**
 * Resolves the depth + thread-root a submission's optional `parentId` implies (parent-exists →
 * depth-cap, per this file's header). A top-level submission (`parentId: null`) trivially passes
 * at depth 0 with no thread root yet (the comment being created becomes its own root — see
 * `submit()`'s own `threadRootId: parentThreadRootId ?? id`).
 *
 * BUG FIX (this pass — found auditing this exact function for the complexity refactor, not
 * introduced by it): the parent lookup never checked that the found parent actually belongs to
 * the SAME entry as this submission — `CommentRepoPort.findById` is keyed only on
 * `(workspaceId, id)`, not `entryId`. A submission could supply an `entryId` for one (open,
 * comments-enabled) entry and a `parentId` that is really a comment on a completely different
 * entry, silently grafting the new comment onto that other entry's thread (wrong `threadRootId`,
 * a `depth` computed against an unrelated thread). `types.ts`'s own header says this referential
 * integrity is "validated at the write chokepoint, NOT by a DB foreign key" (i.e. here) — this was
 * the gap. Treated as `parent-not-found`, not a new rejection reason: from the submitter's point
 * of view, the parent they asked for does not exist ON THIS ENTRY. Regression:
 * `ingress.test.ts` ("a parentId belonging to a different entry...").
 */
async function resolveParentContext(
  deps: CommentIngressDeps,
  submission: CommentSubmission,
  settings: CommentsSettings,
): Promise<ParentContext | StepRejected> {
  if (!submission.parentId) return { ok: true, depth: 0, parentThreadRootId: null };

  const parent = await deps.repo.findById({ workspaceId: submission.workspaceId, id: submission.parentId });
  if (!parent || parent.entryId !== submission.entryId) return { ok: false, reason: "parent-not-found" };

  const depth = parent.depth + 1;
  if (depth > settings.maxDepth) return { ok: false, reason: "max-depth-exceeded" };
  return { ok: true, depth, parentThreadRootId: parent.threadRootId };
}

/** rate-limit → honeypot gate (per this file's header). */
async function checkRateLimitAndHoneypot(deps: CommentIngressDeps, submission: CommentSubmission): Promise<{ ok: true; authorIpHash: string | null } | StepRejected> {
  const authorIpHash = readIngressString(submission.ingressContext.authorIpHash);
  if (!(await deps.rateLimiter.check({ key: authorIpHash ?? "unknown" })).allowed) return { ok: false, reason: "rate-limited" };
  if (readIngressString(submission.ingressContext.honeypotValue)) return { ok: false, reason: "honeypot-tripped" };
  return { ok: true, authorIpHash };
}

/** size/link caps, applied to the ALREADY-sanitized body (sanitize → size/link caps is this
 *  function's own order — see this file's header — so the caps see what will actually be stored). */
function sanitizeAndCapBody(bodyRaw: string): { ok: true; sanitizedBody: string } | StepRejected {
  const sanitizedBody = sanitizeCommentBody({ raw: bodyRaw }, {});
  if (sanitizedBody.length > MAX_BODY_LENGTH) return { ok: false, reason: "body-too-large" };
  if (countLinks({ text: sanitizedBody }, {}) > MAX_LINKS) return { ok: false, reason: "too-many-links" };
  return { ok: true, sanitizedBody };
}

/** spam-classification decision (score → status), isolated so `submit()` reads as one line instead
 *  of a nested ternary (also clears the `sonarjs/no-nested-conditional` finding this line used to
 *  trip). Spam is never a rejection at this boundary — see this file's header. */
function classifyCommentStatus(verdict: SpamVerdict, settings: CommentsSettings): CommentStatus {
  if (verdict.score >= settings.spamAutoRejectScore) return "spam";
  return settings.requireModeration ? "pending" : "approved";
}

function buildCommentRecord(params: {
  readonly submission: CommentSubmission;
  readonly hookSubmission: CommentSubmission;
  readonly authorIpHash: string | null;
  readonly depth: number;
  readonly parentThreadRootId: UUID | null;
  readonly status: CommentStatus;
  readonly verdict: SpamVerdict;
  readonly id: UUID;
  readonly now: string;
}): CommentRecord {
  const { submission, hookSubmission, authorIpHash, depth, parentThreadRootId, status, verdict, id, now } = params;
  return {
    id,
    workspaceId: submission.workspaceId,
    entryId: submission.entryId,
    parentId: submission.parentId,
    threadRootId: parentThreadRootId ?? id,
    depth,
    status,
    authorPrincipalId: hookSubmission.authorPrincipalId,
    authorName: hookSubmission.authorName,
    authorEmail: hookSubmission.authorEmail,
    authorUrl: hookSubmission.authorUrl,
    authorIpHash,
    bodyText: hookSubmission.bodyRaw,
    spamScore: verdict.score,
    spamProvider: verdict.provider,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

// OQ-3 resolution (ADR-031 round-2 fold, SPEC-035): every ingress-created comment gets a `submit`
// moderation_log row, attributed to the seeded system principal — the ingress has no real operator
// principal to attribute this to (the visitor is anonymous by definition), and the
// auto-classification (pending/approved/spam) IS itself a moderation decision, just one core made
// instead of a human. `fromStatus: null` (nothing existed before this write).
function buildSubmitLogEntry(deps: CommentIngressDeps, record: CommentRecord, now: string): ModerationLogEntry {
  return {
    id: deps.idGen.newId(),
    workspaceId: record.workspaceId,
    commentId: record.id,
    actorPrincipalId: COMMENTS_INGRESS_SYSTEM_PRINCIPAL_ID,
    action: "submit",
    fromStatus: null,
    toStatus: record.status,
    at: now,
    note: null,
  };
}

async function enqueueSubmittedEvent(deps: CommentIngressDeps, record: CommentRecord, now: string): Promise<void> {
  // Inline object literal (not a `CommentDomainEvent`-typed intermediate) — matches this
  // codebase's established `outbox.enqueue()` call-site convention (e.g.
  // `features/entries/write-service.ts`): TS only infers a `Record<string, unknown>`-
  // compatible index signature for a FRESH object literal argument, not for a value already
  // typed against a concrete interface without one.
  await deps.outbox.enqueue({
    id: deps.idGen.newId(),
    name: "comments.submitted",
    occurredAt: now,
    aggregateId: record.id,
    workspaceId: record.workspaceId,
    payload: { commentId: record.id, entryId: record.entryId, status: record.status },
  });
}

export function createCommentIngressPolicy(deps: CommentIngressDeps, _optional: Record<string, never> = {}): CommentIngressPolicy {
  return {
    async submit(submission: CommentSubmission): Promise<CommentIngressResult> {
      const settings = await deps.getSettings(submission.workspaceId);
      if (!settings.enabled) return { ok: false, reason: "comments-disabled" };

      const entryGate = await checkEntryGate(deps, submission);
      if (!entryGate.ok) return entryGate;

      const parentContext = await resolveParentContext(deps, submission, settings);
      if (!parentContext.ok) return parentContext;

      const rateGate = await checkRateLimitAndHoneypot(deps, submission);
      if (!rateGate.ok) return rateGate;

      const bodyResult = sanitizeAndCapBody(submission.bodyRaw);
      if (!bodyResult.ok) return bodyResult;

      const sanitizedSubmission: CommentSubmission = { ...submission, bodyRaw: bodyResult.sanitizedBody };
      const hookResult = await deps.hooks.runBeforeSubmitChain(sanitizedSubmission);
      if ("reject" in hookResult) return { ok: false, reason: hookResult.reject };

      const verdict = await deps.spamCheck.check(hookResult.submission);
      const status = classifyCommentStatus(verdict, settings);

      const id = deps.idGen.newId();
      const now = nowIso({ clock: deps.clock });
      const record = buildCommentRecord({
        submission,
        hookSubmission: hookResult.submission,
        authorIpHash: rateGate.authorIpHash,
        depth: parentContext.depth,
        parentThreadRootId: parentContext.parentThreadRootId,
        status,
        verdict,
        id,
        now,
      });

      await deps.repo.create({ record }, { submitLog: buildSubmitLogEntry(deps, record, now) });
      await enqueueSubmittedEvent(deps, record, now);

      return { ok: true, comment: record, autoClassified: status };
    },
  };
}
