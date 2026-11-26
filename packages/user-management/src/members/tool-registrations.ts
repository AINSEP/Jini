import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import { trashMember } from "@jini-ai/user-management/members/trash-member";
import { toolMetadata } from '@jini-ai/core/tool-metadata/members';
import { nowIso, type Clock } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize } from "@jini-ai/core";
/**
 * @file Members' half of ADR-049 Decision 4 (ADR-030/ADR-PIPE-013): maps `agent-tools.ts`'s six
 * catalog entries onto the member roster reads and the `write-service.ts` transitions the admin
 * routes expose, as `ToolRegistration`s. The entire catalog is wired.
 *
 * Authorization shape: `members/ports.ts`'s `MembersWriteServiceDeps` has no `authorize` field at
 * all — the domain functions carry no gate to inherit, and the admin routes check inline. Every
 * handler here therefore performs that same check itself via the kit's `requireToolPermission`,
 * which is ADR-021 §2's single evaluation for these tools, located where the real route locates it.
 */
import { buildDomainRegistrations, indexCatalogById, optionalString, readToolLimit, requireInputRecord, requireString, resolveHostReadRefs, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { requireToolPermission } from "@jini-ai/core";
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import { ToolInputError } from "@jini-ai/core";
import { encodeListCursor, listPageForModel } from "@jini-ai/core/list-page";

import type { ToolContributor } from "@jini-ai/core";
import { ToolPermissionDeniedError as ForbiddenError } from "@jini-ai/core";
import { forbiddenRule } from "@jini-ai/core/model-facing-tool-errors";
import { withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { membersAgentToolCatalog } from "@jini-ai/user-management/members/agent-tools";
import type { HostReadVocabulary } from "@jini-ai/core";
import { buildMembersWriteServiceDeps } from "@jini-ai/user-management/members/ports";
import type {
  MagicLinkTokenRepoPort,
  MemberRepoPort,
  MemberSessionRepoPort,
  MemberSubscriptionRepoPort,
  MemberTierRepoPort,
  MembersWriteServiceDeps,
} from "@jini-ai/user-management/members/ports";
import { MemberSignInUnavailableError, MemberConflictError, MemberNotFoundError, MemberValidationError, type MemberRecord } from "@jini-ai/user-management/members/types";
import { createMember } from "@jini-ai/user-management/members/member-sign-in";
import { disableMember, updateProfile } from "@jini-ai/user-management/members/member-admin-writes";
import { requestSignInLink } from "@jini-ai/user-management/members/member-challenge-request";

const MEMBER_MANAGE_PERMISSION = "member.manage" as const;

const DURABLE_MUTATION = "mutates-durable-state" as const;

/**
 * @file The Members agent-tool catalog (ADR-030/ADR-PIPE-013), instantiating SPEC-016 REQ-22's
 * naming/callability convention for this domain — the same shape `forms/agent-tools.ts` and
 * `Jini packages/user-management/src/server/agent-tools.ts` use, including the `inputSchema` contract.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each carries. Every entry maps 1:1 onto a real operation the admin HTTP surface
 * (`server/routes/admin/members/*.ts`) already exposes to a human operator — not merely onto a
 * `write-service.ts` export. That distinction matters here specifically: see the deliberate
 * absences below.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * Owner 2026-10-09 supersedes the profile/create exclusion below for this CRUD pass;
 * billing and authentication exclusions remain binding. Historical rationale is retained.
 * - `updateProfile`, `compSubscription`, `setSubscriptionStatus` (`write-service.ts`) have NO
 *   admin HTTP route at all today — `host src/server/runtime/composition/modules/members.ts` wires exactly 4 admin registrars
 *   (list/get/disable/request-magic-link) plus 2 public sign-in routes, nothing else. Wiring an
 *   agent tool for a write-service function the admin UI does not yet expose would give the
 *   assistant MORE capability than a human clicking through the admin screens has today — the
 *   opposite of this pattern's own premise (the tool is gated by "the SAME gate the human admin
 *   routes use," which presupposes a human admin route exists to share a gate with). Promoting
 *   these three to tools is a decision for whoever ships their admin routes, not this pass.
 * - `requestConsent`/`confirmConsent`/`revokeConsent`/`checkConsent` (`consent-service.ts`) are
 *   excluded for the same "no admin route" reason, with extra weight: these are the INV-NEW-02
 *   consent-ledger chokepoint (the ONLY path that may ever assert `status: 'granted'`), and the
 *   dispatch directive for this pass explicitly calls out consent/unsubscribe operations in
 *   Members as deserving "the same scrutiny as Identity's password reset." No admin surface
 *   reviews or exposes them today, so an agent must not gain a capability with no human-reachable
 *   equivalent to compare it against.
 * - `completeSignIn` is the MEMBER's own self-service session-mint (consumes a magic-link token,
 *   authenticates as that member) — never an operator action, and has no admin route. A tool that
 *   let an assistant complete a sign-in "on behalf of" a member would let it authenticate as an
 *   arbitrary member, which is an account-access primitive in the same family Identity's
 *   `resetUserPassword` exclusion warns about, just reached from the other side (session-minting
 *   instead of password-setting).
 * - No `members_comp_subscription`/`members_set_subscription_status`: see the write-service
 *   bullet above — these two also touch billing/entitlement state with no admin UI review path.
 *
 * How it relates to the project:
 * `assistant/tool-registrations.ts` maps these entries into `@jini-ai/core` `ToolRegistration`s.
 * Members' own `write-service.ts` does NOT call `authorize()` internally — `MembersWriteServiceDeps`
 * has no `authorize` field at all, and every admin route (`disable.ts`/`list.ts`/`get-by-id.ts`/
 * `request-magic-link.ts`) calls `deps.authorize()` itself, directly, before calling into the
 * write-service or repo. `tool-registrations.ts`'s handlers mirror that exact sequence rather than
 * relying on a self-enforcing domain function the way Forms/Identity do — see that file's Members
 * section header for the full disclosure.
 *
 * Architectural role:
 * `members` domain declaration. Performs no I/O and no enforcement itself.
 */
// Now: the catalog lives in `@jini-ai/user-management/members/agent-tools`; its model-facing text names the
// member read as `{{read:member}}`, and the host binds `contentReadVocabulary` here so the model keeps seeing
// `content_read.member` (pinned by `__tests__/host-read-wording.test.ts`).


/**
 * The rate-limiter shape `members_request_magic_link` actually calls (`await limiter.check({ key })`), declared
 * structurally instead of importing `core/rate-limit/rate-limit`'s nominal `RateLimiter` type.
 *
 * This is the one field in this file that would otherwise cost Members its whole architectural win:
 * unlike every other domain wired here, Members has no OTHER file that reaches into `server/*`
 * today, so importing `RateLimiter` from there — even though that specific type carries no Express
 * coupling itself — would single-handedly reintroduce the `members <-> server` module cycle this
 * narrowing exists to remove. `createRateLimiter()`'s real return value already has exactly this
 * shape, so it satisfies this structurally with no adapter needed.
 */
export interface MagicLinkRateLimiter {
  check(required: { key: string }): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
}

/**
 * The exact slice of the route-deps bag Members' tool handlers read. Declared structurally (rather
 * than importing `server/routes/types`'s `RouteDeps`, or `host src/server/inbound/admin-http/routes/members/deps.ts`'s
 * `MembersRouteDeps`, which itself extends `RouteDeps`) so this module carries no back-edge into the
 * composition root. `server/routes/*` satisfies this structurally by passing its existing
 * `MembersRouteDeps` object; nothing there changes.
 */
export interface MembersToolDeps {
  catalog: typeof membersAgentToolCatalog;
  hostReads: HostReadVocabulary;
  mailTransport: MembersWriteServiceDeps["mailTransport"];
  tracker?: Tracker;
  removeMember?: import("@jini-ai/core/contracts/site/plugins-host").RemoveEntity;
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: Clock;
  idGen: { newId(): string };
  memberRepo: MemberRepoPort;
  memberTierRepo: MemberTierRepoPort;
  memberSubscriptionRepo: MemberSubscriptionRepoPort;
  memberSessionRepo: MemberSessionRepoPort;
  magicLinkRepo: MagicLinkTokenRepoPort;
  mailer: MembersWriteServiceDeps["mailer"];
  originRegistry?: MembersWriteServiceDeps["origin"];
  mailStatus?: MembersWriteServiceDeps["mailStatus"];
  /** See `MembersWriteServiceDeps.principals` — sign-up writes the member's `kind: "member"` principal here. */
  principalRepo: MembersWriteServiceDeps["principals"];
  /** Resolves configuration independently of sending; production supplies this so disabled
   * members (which skip sends) cannot be distinguished during a lazy driver swap. */
  settleMailer?: () => Promise<void>;
  /** The site's system-email From resolver — see `MembersWriteServiceDeps.senderIdentity`. */
  mailSenderIdentity?: MembersWriteServiceDeps["senderIdentity"];
  magicLinkPerEmailLimiter: MagicLinkRateLimiter;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const membersDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> memberRepo.list: read only.
  ["members_list", "none"],
  // -> memberRepo.findById: read only.
  ["members_get_by_id", "none"],
  // Existing member creation and profile chokepoints, without auth tokens or entitlements.
  ["members_create", DURABLE_MUTATION],
  ["members_update_profile", DURABLE_MUTATION],
  // -> disableMember (write-service.ts): status flip + revokes every live session.
  ["members_disable", DURABLE_MUTATION],
  ["members_delete", DURABLE_MUTATION],
  // -> requestSignInLink (write-service.ts): saves a new-address challenge without creating a member, saves a magic-link
  //    token row, and sends mail; settleMailer refreshes configuration without sending.
  ["members_request_magic_link", DURABLE_MUTATION],
]);

/**
 * Projects a `MemberRecord` into the model-facing shape used by every Members tool — mirrors
 * `@jini-ai/cms/admin-http/http/members`'s own `toAdminMemberResponse` field set (so a tool sees exactly what the
 * admin UI already shows a human) MINUS `workspaceId` (the agent is already scoped to one
 * workspace it cannot change, the same reasoning content-types'/Forms' `to*View` apply) and MINUS
 * `note`/`fields` (the admin response itself already withholds the operator-only note and the raw
 * extension bag — this view does not re-expose what the human-facing response hides).
 *
 * @complexity O(1).
 * @overallScore 100
 */
function toMemberToolView(member: MemberRecord) {
  const view: {
    id: string;
    email: string;
    status: MemberRecord["status"];
    name?: string;
    emailVerifiedAt?: string;
    createdAt: string;
    updatedAt: string;
    version: number;
  } = {
    id: member.id,
    email: member.email,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    version: member.version,
  };
  if (member.name) view.name = member.name;
  if (member.emailVerifiedAt) view.emailVerifiedAt = member.emailVerifiedAt;
  return view;
}

/**
 * The Members errors that reach the model with their real reason instead of a redacted
 * `INTERNAL_ERROR` — see `contracts/core/model-facing-tool-errors.ts` for the mechanism and for why
 * this list is an ALLOWLIST rather than a blanket unwrap.
 *
 * Every message here is built from the caller's OWN input (`member '<id>' was not found`,
 * `'<email>' is not a valid email address`) plus this domain's vocabulary. None carries a member's
 * stored record, another workspace's data, a token, or an internal path: `types.ts`'s typed errors
 * are all constructed at `write-service.ts` call sites that interpolate ids and the submitted email
 * only. `MemberAuthError` is deliberately ABSENT — it is thrown on the magic-link REDEMPTION path
 * (`consumeSignInLink`), which no tool here calls, and its messages ("sign-in link was already
 * used", "this account has been disabled") answer a question about a token holder rather than about
 * the caller's own request. If a redemption tool is ever wired, that class needs its own decision,
 * not this list's by default.
 */
const MEMBERS_MODEL_FACING_ERRORS: readonly ModelFacingErrorRule[] = [
  forbiddenRule({ domainPrefix: "MEMBERS", error: ForbiddenError }),
  { error: MemberNotFoundError, code: "MEMBERS_NOT_FOUND" },
  { error: MemberValidationError, code: "MEMBERS_VALIDATION_FAILED" },
  { error: MemberConflictError, code: "MEMBERS_CONFLICT" },
  { error: MemberSignInUnavailableError, code: "MEMBERS_SIGN_IN_UNAVAILABLE" },
];

/** `members_list`'s schema cap (`agent-tools.ts`), which is also the repo's own page size. */
const MEMBERS_LIST_MAX_LIMIT = 100;

function memberProfileHandlers(deps: MembersToolDeps): Record<string, ToolHandler> {
  return {
    /** Operator creation shares sign-up persistence while withholding tokens and mail. */
    members_create: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MEMBER_MANAGE_PERMISSION }, { entityType: "member" });
      ctx.signal.throwIfAborted();
      const { member } = await createMember({ deps: { ...buildMembersWriteServiceDeps({ deps: { ...deps, orFallbackSync } }), onMemberCreated: ({ workspaceId, memberId, creationSource, initialState }) => {
        void deps.tracker?.capture({ name: "member_registered", userId: ctx.principal.id }, { properties: {
          eventId: `member-registered:${workspaceId}:${memberId}`, creationSource, initialState,
        } });
      } }, input: { workspaceId: deps.workspaceId, email: requireString({ input, key: "email" }) } }, { name: optionalString({ input, key: "name" }) });
      return { member: toMemberToolView(member) };
    },
    /** Changes the public profile only; operator notes and extension fields stay private. */
    members_update_profile: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const memberId = requireString({ input, key: "memberId" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MEMBER_MANAGE_PERMISSION }, { entityType: "member", entityId: memberId });
      ctx.signal.throwIfAborted();
      const { member } = await updateProfile({ deps: buildMembersWriteServiceDeps({ deps: { ...deps, orFallbackSync } }), input: { workspaceId: deps.workspaceId, memberId, name: requireString({ input, key: "name" }) } });
      return { member: toMemberToolView(member) };
    },
  };
}

function memberReadHandlers(deps: MembersToolDeps): Record<string, ToolHandler> {
  return {
    members_list: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });

      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MEMBER_MANAGE_PERMISSION }, { entityType: "member" });

      const afterId = optionalString({ input, key: "afterId" });
      const cursor = optionalString({ input, key: "cursor" });
      if (afterId !== undefined && cursor !== undefined) throw new ToolInputError({ message: "pass cursor or afterId, not both" });
      const limit = readToolLimit({ input, max: MEMBERS_LIST_MAX_LIMIT, fallback: MEMBERS_LIST_MAX_LIMIT });
      // The repo pages by position, so an afterId naming no member would quietly page from wherever
      // that id sorts; a model that passed one meant a real member, so a miss is its mistake to hear about.
      if (afterId !== undefined && !(await deps.memberRepo.findById({ workspaceId: deps.workspaceId, id: afterId }))) {
        throw new ToolInputError({ message: `unknown afterId '${afterId}'` });
      }
      const page = await deps.memberRepo.list({ workspaceId: deps.workspaceId }, {
        limit, cursor: afterId === undefined ? cursor ?? null : encodeListCursor({ position: [afterId] }),
      });
      // `members` keeps the key the description and callers already use; `more` tells the model the
      // list is incomplete (a capped array alone read as "all members").
      const { items, ...paging } = listPageForModel({ page, toolId: "members_list" });
      return { members: items.map(toMemberToolView), ...paging };
    },

    members_get_by_id: async (ctx) => {
      const memberId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "memberId" });

      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MEMBER_MANAGE_PERMISSION }, { entityType: "member", entityId: memberId });

      const member = await deps.memberRepo.findById({ workspaceId: deps.workspaceId, id: memberId });
      if (!member) throw new MemberNotFoundError(`member '${memberId}' was not found`);
      return { member: toMemberToolView(member) };
    },

  };
}

function memberRemovalHandlers(deps: MembersToolDeps): Record<string, ToolHandler> {
  return {
    members_delete: async (ctx) => {
      const memberId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "memberId" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MEMBER_MANAGE_PERMISSION }, { entityType: "member", entityId: memberId });
      ctx.signal.throwIfAborted();
      return trashMember({ workspaceId: deps.workspaceId, memberId, actor: { principalId: ctx.principal.id } },
        { members: deps.memberRepo, ...(deps.removeMember === undefined ? {} : { remove: deps.removeMember }), clock: { nowIso: () => nowIso({ clock: deps.clock }) } });
    },

    members_disable: async (ctx) => {
      const memberId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "memberId" });

      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MEMBER_MANAGE_PERMISSION }, { entityType: "member", entityId: memberId });

      ctx.signal.throwIfAborted();
      const { member } = await disableMember({ deps: buildMembersWriteServiceDeps({ deps: { ...deps, orFallbackSync } }), input: { workspaceId: deps.workspaceId, memberId } });
      return { member: toMemberToolView(member) };
    },

  };
}

function memberSignInHandlers(deps: MembersToolDeps): Record<string, ToolHandler> {
  return {
    members_request_magic_link: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const email = requireString({ input: input, key: "email" });

      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MEMBER_MANAGE_PERMISSION }, { entityType: "member" });

      // INV-NEW-03: the shared per-email rate limit is consulted strictly AFTER authorize() —
      // mirrors `request-magic-link.ts`'s own ordering, so an unauthorized caller can never spend
      // rate-limit budget for a target email as a side channel.
      const emailKey = email.trim().toLowerCase();
      // Preserve model-facing validation instead of passing an empty key to the limiter.
      if (!emailKey) throw new MemberValidationError(`'${email}' is not a valid email address`);
      const rateLimitResult = await deps.magicLinkPerEmailLimiter.check({ key: emailKey });
      if (!rateLimitResult.allowed) {
        // A `ToolInputError`, not a bare `Error`: that marker is the ONLY thing `@jini-ai/daemon`'s
        // `ToolExecutor` reads to keep a rejection out of the `errorKind: 'internal'` bucket the
        // delegated-tool transport SEC-005-redacts, and "you are rate limited, retry after Ns" is
        // precisely the reason a model needs in order to back off instead of hammering the same
        // call. Thrown directly rather than routed through `MEMBERS_MODEL_FACING_ERRORS` because
        // this is THIS wiring layer's own check against an injected limiter, not a domain error
        // class `write-service.ts` raises — the same shape `features/forms/tool-registrations.ts`'s
        // `requireSubmissionsLimit` uses for its own ad-hoc check.
        throw new ToolInputError({ message: `MEMBERS_RATE_LIMITED: too many sign-in requests for '${email}' — retry after ${rateLimitResult.retryAfterSeconds}s` });
      }

      await deps.settleMailer?.();
      const result = await requestSignInLink({
        deps: buildMembersWriteServiceDeps({ deps: { ...deps, orFallbackSync, mailTransport: deps.mailTransport } }),
        input: {
          workspaceId: deps.workspaceId,
          email,
          ...(typeof input.redirectPath === "string" ? { redirectPath: input.redirectPath } : {}),
        },
      });
      // requestSignInLink refuses (MEMBERS_SIGN_IN_UNAVAILABLE) when mail is off, so reaching
      // here means delivery is available; the privileged operator gets the actual send result.
      return { delivered: result.delivered, mailDeliveryAvailable: true };
    },
  };
}

export function buildMembersRegistrations(deps: MembersToolDeps): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog: resolveHostReadRefs({ value: deps.catalog }, { hostReads: deps.hostReads }) });
  const handlers: Record<string, ToolHandler> = {
    ...memberProfileHandlers(deps),
    ...memberReadHandlers(deps),
    ...memberRemovalHandlers(deps),
    ...memberSignInHandlers(deps),
  };

  // No `unwiredToolIds`: Members wires its ENTIRE catalog, same tripwire discipline as Forms.
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "members",
    catalogModule: "members/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    // The whole map at once, so no handler can be the one that forgot — see
    // `withModelFacingErrors`' own doc for why a per-call-site reshape is the defect this avoids.
    handlers: withModelFacingErrors({ handlers: handlers, rules: MEMBERS_MODEL_FACING_ERRORS }),
    derivedRisk: membersDerivedRisk,
  });
}

/**
 * Contributes Members' AI tools to the assistant's catalog — called once by
 * `host src/server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`, not by importing this
 * module. `assistant/tool-registrations.ts` no longer imports `buildMembersRegistrations`/
 * `membersDerivedRisk` by name; this is the seam that replaced it (2026-08-17, Stage 2 of the
 * rollout — no sibling domain still statically wired through `assistant` imports `members`, so this
 * one-directional `members -> assistant` call closes no new cycle).
 */
export function contributeMembersTools(): ToolContributor<MembersToolDeps, unknown> {
  return { domain: "members", build: buildMembersRegistrations, risk: membersDerivedRisk };
}
