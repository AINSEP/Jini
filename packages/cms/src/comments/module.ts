/**
 * @file Composition factory for the Comments plugin (ADR-031, SPEC-033/SPEC-035) — wires the
 * repo, spam check, hooks, ingress policy, and write-service together given the low-level deps a
 * composition root (`server/deps.ts`/`app.ts`) already has. Both composition roots call this
 * instead of each hand-assembling the same 5-piece wiring twice.
 *
 * `entryLookup` adapts `EntryRepoPort.findById` (already on `RouteDeps`) into the narrow shape
 * `ingress.ts` expects, computing `commentsClosed` from the entry's own `status`/`publishedAt` +
 * `CommentsSettings.closeAfterDays` — this file owns that math so `ingress.ts` itself stays free of
 * any entries-feature knowledge (ADR-046 Phase 3's "narrow typed dependencies" convention).
 *
 * BUG FIX (2026-09-03, found auditing `ingress.ts` for an unrelated complexity refactor): an entry
 * that has never been published (`status: "draft"`, `publishedAt: null`) OR was explicitly
 * unpublished (`status: "unpublished"`) was previously readable as "open" — nothing anywhere in the
 * ingress path checked `EntryRecord.status` at all, only `publishedAt`. A visitor who knew or
 * guessed either entry's id could post a public, world-visible-once-moderated comment on content
 * nobody has ever been shown, or content that was deliberately retracted. Checked ADR-031/SPEC-033/
 * SPEC-035 (this file's own citations) for a deliberate "drafts/retracted entries are commentable"
 * design decision — REQ-04 says only "entry-open"; no spec anywhere defines that term against
 * publish state, names a preview/staging use case, or otherwise addresses this. Treated as spec-
 * silent, not spec-permitted: fixed as the fail-closed reading (`isEntryOpenForComments` below),
 * reusing the existing `entry-closed` rejection reason rather than adding a new one to `ports.ts`'s
 * `CommentIngressRejection` union — from a submitter's point of view "never published" and
 * "retracted" are both just "not currently open for comments." This is a deliberate BEHAVIOR
 * CHANGE with no spec mandate behind it, disclosed here and in this commit's message rather than
 * smuggled in as if it were spec-required.
 *
 * Checked for a second call site before fixing (the exact failure class a sibling session found
 * elsewhere in this campaign — a correct primitive wired into only one of several routes): grepped
 * the whole host source tree for every construction of `CommentIngressDeps.entryLookup` and
 * every call to `createCommentIngressPolicy`/`repo.create` for a comment row. There is exactly ONE
 * of each — this file's own `entryLookup` below, `createCommentsModule`'s own call to
 * `createCommentIngressPolicy`, and `ingress.ts#submit()`'s own `repo.create()` — reached by both
 * real composition roots (`server/runtime/composition/{app,deps}.ts`) through this one factory and
 * by no other path (`write-service.ts` only ever calls `applyModeration`/`purge` on an EXISTING
 * comment, never `create`). Fixing it here closes every write call site, not just the one this
 * audit started from.
 *
 * Also checked the READ side for the same class of leak (does the public read path show comments
 * on an unpublished entry, not just accept new ones on it): `CommentRepoPort.listThreadForEntry`
 * has zero route call sites anywhere in this codebase today — grepped for every reference; the only
 * hits are its own port declaration, its two adapter implementations, and `repo.contract.test.ts`.
 * There is no live public comment-read route yet (ADR-031 §10's origin-isolated widget, this file's
 * own header already cites, remains deferred — "no ADR-025 host exists yet" per SPEC-033's own
 * Scope Note). So there is nothing to fix on the read side today; flagged here as a note for
 * whoever builds that route next, not a bug in the current tree.
 *
 */
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, UUID } from "@jini-ai/core/primitives";
import { nowIso } from "@jini-ai/core/primitives";
import type { OutboxPort } from "../core/index.js";
import { createCommentHookRegistry } from "./hooks.js";
import { createCommentIngressPolicy } from "./ingress.js";
import type { CommentRateLimiter, EntryLookupResult } from "./ingress.js";
import type { CommentIngressPolicy, CommentRepoPort, SpamCheckPort } from "./ports.js";
import type { CommentsSettings } from "./types.js";
import { createCommentWriteService } from "./write-service.js";
import type { CommentTransactionRunner, CommentWriteService, ForgetRemovedCommentFn, RemoveCommentFn } from "./write-service.js";

/** The publish state and date are the only entry data the comment gate needs. */
export interface CommentEntryView { status: string; publishedAt: string | null }

export interface CommentsModuleDeps {
  commentRepo: CommentRepoPort;
  entryLookup: (required: { workspaceId: UUID; entryId: UUID }) => Promise<CommentEntryView | null>;
  getSettings: (workspaceId: UUID) => Promise<CommentsSettings>;
  rateLimiter: CommentRateLimiter;
  outbox: OutboxPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  /** Caller-chosen spam-check adapter; both real composition roots use `HeuristicSpamCheck`.
   * This module never picks one on its own, so the choice remains a real DI seam. */
  // AkismetSpamCheck deleted as unwired (owner, 2026-10-03); see development/DELETED-CODE.md.
  spamCheck: SpamCheckPort;
  /**
   * The local admin Trash's three seams, passed straight through to the moderation write-service.
   * Required, not optional: a default no-op would silently drop comments out of the Trash screen,
   * and "deleted but unrecoverable" is exactly the failure this feature exists to prevent. See
   * `write-service.ts`'s `RemoveCommentFn` for why none of them is a trash type.
   */
  remove: RemoveCommentFn;
  forgetRemoved: ForgetRemovedCommentFn;
  runInTransaction: CommentTransactionRunner;
}

export interface CommentsModule {
  commentRepo: CommentRepoPort;
  ingressPolicy: CommentIngressPolicy;
  writeService: CommentWriteService;
}

/** `closeAfterDays` age math ONLY — assumes the entry is otherwise eligible. Does not, and must
 *  not, decide publish state; see {@link isEntryOpenForComments}, which composes this with the
 *  publish-state check this file's header documents. */
function isPastCloseWindow(publishedAt: string | null, closeAfterDays: number | null, nowIso: string): boolean {
  if (closeAfterDays === null || publishedAt === null) return false;
  const publishedMs = Date.parse(publishedAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(publishedMs) || Number.isNaN(nowMs)) return false;
  const ageDays = (nowMs - publishedMs) / (1000 * 60 * 60 * 24);
  return ageDays > closeAfterDays;
}

/**
 * Whether an entry may currently receive a new public comment: it must actually be `published`
 * — not `draft` (never shown to anyone) and not `unpublished` (deliberately retracted) — AND not
 * past its `closeAfterDays` window. `status !== "published"` is checked FIRST and short-circuits:
 * `publishedAt` alone cannot distinguish "live" from "retracted", because `unpublishEntry`
 * (`@jini-ai/cms/entries` `write-service.ts#transitionEntryStatus`) deliberately does not clear
 * `publishedAt` on retraction (`publishedAt: target.status === "published" ? now : current.
 * publishedAt`) — it stays at whatever it was, so a stale `publishedAt` from before retraction
 * would otherwise still pass the age check. See this file's header for the bug this closes.
 */
function isEntryOpenForComments(entry: CommentEntryView, closeAfterDays: number | null, nowIso: string): boolean {
  if (entry.status !== "published") return false;
  return !isPastCloseWindow(entry.publishedAt, closeAfterDays, nowIso);
}

/** Wires the comment gate and moderation service using host-owned settings, rate limits and removal.
 * @returns The supplied repo plus ingress and moderation services.
 * @complexity O(1) setup; calls inherit the injected ports' costs.
 */
export function createCommentsModule(deps: CommentsModuleDeps, _optional: Record<string, never> = {}): CommentsModule {
  const hooks = createCommentHookRegistry({}, {});
  const spamCheck = deps.spamCheck;
  const entryLookup = async (required: { workspaceId: UUID; entryId: UUID }): Promise<EntryLookupResult | null> => {
    const entry = await deps.entryLookup(required);
    if (!entry) return null;
    const settings = await deps.getSettings(required.workspaceId);
    return {
      id: required.entryId,
      commentsClosed: !isEntryOpenForComments(entry, settings.closeAfterDays, nowIso({ clock: deps.clock })),
    };
  };

  const ingressPolicy = createCommentIngressPolicy({
    repo: deps.commentRepo,
    spamCheck,
    hooks,
    clock: deps.clock,
    idGen: deps.idGen,
    getSettings: deps.getSettings,
    entryLookup,
    rateLimiter: deps.rateLimiter,
    outbox: deps.outbox,
  });

  const writeService = createCommentWriteService({
    repo: deps.commentRepo,
    outbox: deps.outbox,
    hooks,
    clock: deps.clock,
    idGen: deps.idGen,
    remove: deps.remove,
    forgetRemoved: deps.forgetRemoved,
    runInTransaction: deps.runInTransaction,
  });

  return { commentRepo: deps.commentRepo, ingressPolicy, writeService };
}
