import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
/**
 * @file THE `redirects` write chokepoint (SPEC-009 REQ-01/04/05/06/07/08/13/
 * 14/22/26; ADR-PIPE-009 C-001..C-004).
 *
 * Purpose:
 * `createRedirect`/`updateRedirect`/`tombstoneRedirect`/`importRedirects` —
 * the single manual-write entry point for redirect rules. Validates the
 * pattern (via `RedirectMatcher.validatePattern`), rejects unsafe targets —
 * absolute ones against the origin allowlist and site-relative ones against
 * the admin application's own URL space (write-path open-redirect oracle,
 * REQ-08; see `assertTargetAllowed`) — collapses/rejects
 * one-hop chains (INV-04), enforces the exact-match dedup rule
 * (behavior.spec.md §5.1), and writes the record + its revision in one
 * transaction via `ports.internal.ts`'s shared `insertRedirectAndRevision`
 * (INV-01/INV-07 — no other file writes `redirects`/`redirect_revisions`).
 *
 * Architectural role:
 * Feature logic. No Express/route code — route handlers (Phase 2) call these
 * functions directly and map thrown typed errors to HTTP codes per
 * errors.spec.md.
 */
import { type Clock as ClockPort, type IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import { assertEntityLive, type DomainEvent, type OutboxPort } from "../core/index.js";
import { callerSafeErrorMessage, type CallerSafeErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { hasForbiddenRawUrlCharacter } from "@jini-ai/http-kit/verified-origin";
import type { OriginRegistryPort, RedirectTargetContext } from "@jini-ai/http-kit/verified-origin";

import { checkSiteRelativeTarget } from "@jini-ai/http-kit/verified-origin";
import type { SiteRelativeTargetCheck } from "@jini-ai/http-kit/verified-origin";

import { insertRedirectAndRevision, type RedirectDbHandle } from "./ports.internal.js";
import type { RedirectMatcher, RedirectMutatedEvent, RedirectRepoPort } from "./ports.js";
import { isReferrerAliasLocation } from "./referrer-alias.js";
import { checkSameOriginDestination } from "./reserved-destination.js";
import {
  RedirectConflictError,
  RedirectLoopError,
  RedirectNotFoundError,
  RedirectTargetNotAllowedError,
  RedirectValidationError,
} from "./types.js";
import type {
  CreateRedirectInput,
  RedirectMatchType,
  RedirectRecord,
  RedirectRevision,
  RedirectStatus,
  RedirectStatusCode,
  UpdateRedirectInput,
} from "./types.js";

// Exported (unchanged values) so `agent-tools.ts`'s published JSON Schema can reuse the exact
// bounds this chokepoint validates against, rather than restating them — same discipline as
// `seo/write-service.ts`'s identical export note.
export const MIN_TARGET_LENGTH = 1;
export const MAX_TARGET_LENGTH = 2048;
export const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 1000;
const DEFAULT_PRIORITY = 0;
export const VALID_STATUS_CODES: readonly RedirectStatusCode[] = [301, 302, 307, 308];
const VALID_STATUSES: readonly RedirectStatus[] = ["active", "disabled"];
export const MAX_IMPORT_BATCH_SIZE = 500;

function isAbsoluteOrProtocolRelative(target: string): boolean {
  return target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/**
 * The removal primitive this domain is handed, rather than one it implements.
 *
 * Structurally typed ON PURPOSE — `features/redirects` imports nothing from `features/trash`, and
 * must not. The composition root binds the real implementation (marker flip AND Trash index row, in
 * one transaction) pre-bound to this domain's entity type. `display` is required so the two strings
 * the Trash screen shows come from columns the caller already holds.
 */
export type RemoveRedirectFn = (required: {
  workspaceId: string;
  id: string;
  display: { title: string; subtitle?: string | null };
  at: string;
  expectedVersion: number | null;
  actor: { principalId: string; pluginId?: string | null };
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }>;

export interface RedirectsWriteDeps {
  repo: RedirectRepoPort;
  /** See {@link RemoveRedirectFn}. Replaces `tombstoneRedirect`'s own `status` write. */
  remove: RemoveRedirectFn;
  /**
   * Whether this rule has a Trash index row (S7, web-high fix plan 2026-09-24) — the thing
   * `tombstoneRedirect` creates and Trash restore/purge match on, and NOT the same thing as
   * `status === "disabled"` (an ordinary toggle-off has no Trash row at all). Structurally typed,
   * same discipline as {@link RemoveRedirectFn}: this domain imports nothing from `features/trash`.
   */
  isInTrash: (required: { workspaceId: string; id: string }) => Promise<boolean>;
  /**
   * Un-trashes this rule (S7). Mirrors `TrashPort.restore`'s outcome union structurally, again
   * without importing `features/trash`. `"adapter-unavailable"` is not reachable for redirects (the
   * composition root always registers an adapter for `REDIRECT_ENTITY_TYPE`), but is part of the
   * union it mirrors.
   */
  restore: (required: {
    workspaceId: string;
    id: string;
    at: string;
    actor: { principalId: string; pluginId?: string | null };
  }) => Promise<"restored" | "not-found" | "version-changed" | "adapter-unavailable">;
  /** The shared, non-tx-opening write handle (Decision A) — used via `ports.internal.ts`. */
  db: RedirectDbHandle;
  /** Opens/commits/rolls back the chokepoint's own transaction around a write. */
  transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  matcher: RedirectMatcher;
  originRegistry: OriginRegistryPort;
  /** First path segments reserved by the composing host; no product-policy default. */
  reservedSegments: ReadonlySet<string>;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  outbox: OutboxPort;
}

function validateStatusCode(statusCode: RedirectStatusCode): void {
  if (!VALID_STATUS_CODES.includes(statusCode)) {
    throw new RedirectValidationError(`statusCode must be one of ${VALID_STATUS_CODES.join(", ")}`);
  }
}

/**
 * `RedirectStatus`'s union isn't enforced at the HTTP boundary — the admin PATCH route
 * (`routes/redirects/update.ts`) passes `body.status` straight through as a cast, so a
 * non-canonical spelling (`"Disabled"`, `"ACTIVE"`, `""`) would otherwise be stored as-is. Both
 * repo backends read only `status === "active"` rows, so a garbage value fails closed for
 * matching — but it also misses {@link isDisableOnlyUpdate}'s exact-string fast path, silently
 * routing that PATCH through the full field re-validation instead of the disable-only skip.
 */
function validateStatus(status: RedirectStatus): void {
  if (!VALID_STATUSES.includes(status)) {
    throw new RedirectValidationError(`status must be one of ${VALID_STATUSES.join(", ")}`);
  }
}

function validateToTargetLength(toTarget: string): void {
  if (toTarget.length < MIN_TARGET_LENGTH || toTarget.length > MAX_TARGET_LENGTH) {
    throw new RedirectValidationError(
      `toTarget must be ${MIN_TARGET_LENGTH}-${MAX_TARGET_LENGTH} characters (got ${toTarget.length})`
    );
  }
}

function validatePriority(priority: number): void {
  if (!Number.isInteger(priority) || priority < MIN_PRIORITY || priority > MAX_PRIORITY) {
    throw new RedirectValidationError(
      `priority must be an integer ${MIN_PRIORITY}-${MAX_PRIORITY} (got ${priority})`
    );
  }
}

/**
 * Resolve the actual target this rule should persist, applying one-hop
 * collapse (AC-16) and cycle rejection (AC-17): if `toTarget` (relative)
 * itself matches an existing active rule's `fromPattern`, collapse to that
 * rule's own target — the request path never chases more than one hop
 * (INV-04). If the collapsed target equals `fromPattern`, this create/update
 * would introduce a cycle; reject it instead of writing a self-loop.
 */
async function resolveCollapsedTarget(
  repo: RedirectRepoPort,
  workspaceId: string,
  fromPattern: string,
  toTarget: string
): Promise<string> {
  let finalTarget = toTarget;
  if (!isAbsoluteOrProtocolRelative(finalTarget)) {
    const chained = await repo.findByFromPattern({ workspaceId, fromPattern: finalTarget });
    if (chained && chained.status === "active") {
      finalTarget = chained.toTarget;
    }
  }
  if (finalTarget === fromPattern) {
    throw new RedirectLoopError(
      `redirect from '${fromPattern}' would create a cycle via '${toTarget}' (resolves back to '${fromPattern}')`
    );
  }
  // The collapse above only follows ONE hop (INV-04's own bound on what a request resolution
  // chases). But a create/update whose finalTarget lands on an EXISTING rule can still complete a
  // longer cycle through rules this call never collapses through — walk the rest of the chain (up
  // to 32 hops, matching REQ-26) so e.g. /b->/c, /c->/a, then creating /a->/b is rejected too.
  // Only a walk that reaches `fromPattern` itself is THIS write's cycle. A loop among other rules
  // (legacy data written before this walk existed) ends the walk instead: this write neither
  // creates it nor would removing this rule break it, and naming `fromPattern` would be false.
  let cur = finalTarget;
  const seen = new Set<string>();
  for (let hop = 0; hop < 32; hop++) {
    if (isAbsoluteOrProtocolRelative(cur)) break;
    if (cur === fromPattern) {
      throw new RedirectLoopError(
        `redirect from '${fromPattern}' would create a cycle via '${toTarget}' (following existing redirects leads back to '${fromPattern}')`
      );
    }
    if (seen.has(cur)) break;
    seen.add(cur);
    const rule = await repo.findByFromPattern({ workspaceId, fromPattern: cur });
    if (!rule || rule.status !== "active") break;
    cur = rule.toTarget;
  }
  return finalTarget;
}

/**
 * Why a site-relative target was refused, phrased for the operator or agent that wrote it.
 *
 * Split out of {@link assertTargetAllowed} so the refusal wording lives next to the verdict union
 * it exhausts — a new arm in `SiteRelativeTargetCheck` becomes a type error here rather than a
 * silently generic message.
 *
 * @param check - The verdict from `checkSiteRelativeTarget`, or from `checkSameOriginDestination`
 * when `assertTargetAllowed` phrases the absolute same-origin verdict (t91 B1, 2026-09-16) — its
 * arms are a subset of this parameter's, so no separate phrasing function is needed.
 * @returns The reason clause, or `null` when the target is allowed.
 * @complexity O(1).
 */
function siteRelativeRefusalReason(check: SiteRelativeTargetCheck): string | null {
  switch (check.kind) {
    case "ok":
      return null;
    case "reserved":
      return `it resolves to '/${check.surface}', which serves the authenticated admin application rather than this site's public pages`;
    case "off-origin":
      return "it looks site-relative but resolves to a different host (a URL parser reads '\\' as '/')";
    case "unparseable":
      return "it is not a parseable URL path";
    case "malformed-encoding":
      return "it contains a malformed percent-encoding";
    case "disallowed-character":
      return "it contains, or decodes to, a backslash or a control character";
  }
}

/**
 * The site-relative half of the write gate: routing's structural + reserved-path verdict, then the
 * redirect oracle's own raw-character rule. The read path hands a relative location to that oracle
 * by concatenation, so a target it refuses (a raw backslash, any whitespace) would be stored and
 * never fire; refusing it here keeps write and read agreeing. Checked SECOND so the more specific
 * routing reasons (off-origin, control character, reserved) keep their own wording — a bare
 * backslash target is `ok` to `checkSiteRelativeTarget` (on this site, `\` really does resolve to
 * `/`), so only this second check ever refuses it (t91 B2, 2026-09-16). Last, the exact target
 * `back`, which Express serves as the visitor's `Referer` instead of a path (see
 * `./referrer-alias.ts`; t91 review F1, 2026-09-16).
 *
 * Exported as THE check for any caller-chosen, site-relative `Location` (t91 open-redirect fix,
 * 2026-09-16): `routes/site/store.ts`'s `returnTo` had its own `startsWith("/") && !startsWith("//")`
 * copy, which `/\evil.example` walks straight through. A caller that needs a path-absolute value
 * still checks `startsWith("/")` itself — this function also accepts relative references (`new`,
 * `?x`), which stay on-site but resolve against the current URL.
 *
 * @param required.target - The untrusted reference exactly as received, before any `new URL()` parse. Anything
 * that is not site-relative (an absolute or protocol-relative URL, `javascript:`) is refused too.
 * @returns The reason clause, or `null` when the target is allowed.
 * @complexity O(n) in the target length.
 * @example siteRelativeTargetReason({ target: "/products", reservedSegments }, {}); // => null
 * @example siteRelativeTargetReason({ target: "/\\evil.example", reservedSegments }, {}) !== null; // => true
 */
export function siteRelativeTargetReason(
  { target, reservedSegments }: { target: string; reservedSegments: ReadonlySet<string> },
  _optional: Record<string, never> = {},
): string | null {
  const reason = siteRelativeRefusalReason(checkSiteRelativeTarget({ raw: target, reservedSegments }, {}));
  if (reason !== null) return reason;
  if (hasForbiddenRawUrlCharacter({ raw: target })) {
    return "it contains a backslash or whitespace, which the redirect origin check refuses (write a space as '%20')";
  }
  if (isReferrerAliasLocation({ location: target }, {})) {
    return "it is 'back', which the server replaces with the visitor's Referer header (a redirect to whatever page linked here)";
  }
  return null;
}

/**
 * The write-path target gate (REQ-08), in two halves that close the SAME hole from opposite sides.
 *
 * An ABSOLUTE or protocol-relative target names a host, so the question is "is that host allowed"
 * and `OriginRegistryPort` answers it. A SITE-RELATIVE target names no host, so the origin
 * allowlist has nothing to say about it — and that used to mean it was not checked at all, which
 * left the admin application's own URL space (`/admin`, `/api/...`, served by this same Express
 * app) usable as a redirect destination from a public-site rule, including through the
 * agent-callable `redirects_create`. `checkSiteRelativeTarget` is the second half; it is the same
 * rule `site-inspection`'s `published_page_fetch` applies to a caller-supplied site path, shared
 * from `platform/routing/reserved-paths.ts` rather than restated here.
 *
 * Note for a workspace that predates this gate: a stored rule whose target is now refused can
 * still be turned off with `tombstoneRedirect` (which only flips `status` and never re-validates
 * the target) or with an `updateRedirect` that changes nothing but `status -> disabled` (see
 * `isDisableOnlyUpdate`), or repointed with `updateRedirect` by supplying a new `toTarget`.
 *
 * An absolute target that names the workspace's OWN origin passes the host oracle trivially (its
 * own host is always allowed there), so it also gets the reserved-path rule — via the same
 * `checkSameOriginDestination` the read path applies to the interpolated `Location` (t91 B1,
 * 2026-09-16). Before this, `/admin`/`/api/...` written as an absolute same-origin target was
 * stored and simply never served, because only the read gate refused it.
 *
 * @throws {RedirectTargetNotAllowedError} Naming which half refused, and why.
 * @complexity O(n) in the target length, plus one or two `OriginRegistryPort`/`canonicalOrigin`
 * reads for absolute targets.
 */
async function assertTargetAllowed(
  originRegistry: OriginRegistryPort,
  workspaceId: string,
  target: string,
  reservedSegments: ReadonlySet<string>
): Promise<void> {
  if (!isAbsoluteOrProtocolRelative(target)) {
    const reason = siteRelativeTargetReason({ target, reservedSegments }, {});
    if (reason === null) return;
    throw new RedirectTargetNotAllowedError(
      `toTarget '${target}' is not an allowed redirect destination: ${reason}`
    );
  }
  const ctx: RedirectTargetContext = { workspaceId };
  const allowed = await originRegistry.isAllowedRedirectTarget({ context: ctx, url: target });
  if (!allowed) {
    throw new RedirectTargetNotAllowedError(`toTarget '${target}' is not an allowed redirect destination`);
  }
  // The host oracle only answers "is that host allowed" — a same-origin target passes it by
  // construction, so it still needs the reserved-path check. No try/catch around
  // canonicalOrigin: isAllowedRedirectTarget above only returns true once a canonical origin
  // exists, so a throw here is a real repo/infra error and must surface — the write does not
  // happen (fail closed), not get reworded as a target verdict.
  const verdict = checkSameOriginDestination({ candidate: target, canonical: await originRegistry.canonicalOrigin(ctx), reservedSegments }, {});
  const reason = siteRelativeRefusalReason(verdict);
  if (reason === null) return;
  throw new RedirectTargetNotAllowedError(`toTarget '${target}' is not an allowed redirect destination: ${reason}`);
}

async function assertNoDuplicate(
  repo: RedirectRepoPort,
  workspaceId: string,
  matchType: string,
  fromPattern: string,
  excludeId?: string
): Promise<void> {
  if (matchType !== "exact") return;
  const dup = await repo.lookupExact({ workspaceId, path: fromPattern, includeOverrideOnly: false });
  if (dup && dup.id !== excludeId) {
    throw new RedirectConflictError(`an active exact rule for '${fromPattern}' already exists`);
  }
}

/**
 * Pure precondition check mirroring every validator `createRedirect`/`updateRedirect` run, with NO
 * write — `features/redirects/publish-content.ts`'s `precheck()` reuses this so the two can never
 * drift onto different rulesets. Returns the refusal message a create/update against these exact
 * fields would throw, or `null` when nothing would block.
 *
 * @param excludeId Mirrors {@link assertNoDuplicate}'s own parameter — the destination's own row id,
 * when checking an update against itself.
 * @complexity O(n) in `toTarget`'s length, plus the repo/origin reads each check makes — identical
 * cost to `createRedirect`'s own validation pass, since this runs the exact same sequence.
 */
export async function checkRedirectFieldsWouldWrite(
  { deps, fields }: { deps: RedirectsWriteDeps; fields: {
    workspaceId: string;
    matchType: RedirectMatchType;
    fromPattern: string;
    toTarget: string;
    statusCode: RedirectStatusCode;
    priority: number;
  } },
  { excludeId }: { excludeId?: string } = {},
): Promise<string | null> {
  try {
    const patternCheck = deps.matcher.validatePattern({ matchType: fields.matchType, fromPattern: fields.fromPattern });
    if (!patternCheck.ok) throw new RedirectValidationError(patternCheck.reason);
    validateToTargetLength(fields.toTarget);
    validateStatusCode(fields.statusCode);
    validatePriority(fields.priority);
    await assertTargetAllowed(deps.originRegistry, fields.workspaceId, fields.toTarget, deps.reservedSegments);
    const finalTarget = await resolveCollapsedTarget(deps.repo, fields.workspaceId, fields.fromPattern, fields.toTarget);
    if (finalTarget !== fields.toTarget) {
      await assertTargetAllowed(deps.originRegistry, fields.workspaceId, finalTarget, deps.reservedSegments);
    }
    await assertNoDuplicate(deps.repo, fields.workspaceId, fields.matchType, fields.fromPattern, excludeId);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function enqueueMutatedEvent(
  deps: RedirectsWriteDeps,
  record: RedirectRecord,
  change: "created" | "updated" | "tombstoned"
): Promise<void> {
  const event: RedirectMutatedEvent = {
    id: deps.idGen.newId(),
    name: `redirect.${change}`,
    occurredAt: clockNowIso({ clock: deps.clock }),
    aggregateId: record.id,
    workspaceId: record.workspaceId,
    actorId: record.createdByPrincipal,
    payload: { workspaceId: record.workspaceId, redirectId: record.id, change },
  };
  // `OutboxPort.enqueue`'s `DomainEvent` parameter defaults its payload generic to
  // `Record<string, unknown>`; a named `interface` payload (as opposed to a type alias/object
  // literal) isn't automatically assignable to that without an explicit index signature — the
  // same TS quirk affects every other typed-payload event in this codebase (e.g.
  // `menu-service.ts`'s `NavMenuChangedPayload`). `ports.ts`'s `RedirectMutatedEventPayload` stays
  // unchanged (ADR-PIPE-009 says `ports.ts` is frozen), so the widening is a call-site cast.
  await deps.outbox.enqueue(event as unknown as DomainEvent);
}

export interface CreateRedirectRequired {
  deps: RedirectsWriteDeps;
  input: CreateRedirectInput;
  /**
   * Provenance to stamp on the created record (REQ-01/26). Defaults to
   * `'manual'`. `importRedirects` (C-004) passes `'import'` here — this is
   * an internal parameter, not part of `CreateRedirectInput`'s public shape
   * (an API caller never chooses their own provenance).
   */
  source?: "manual" | "import";
}

/** C-001: manual-create entry point (REQ-01). */
export async function createRedirect(required: CreateRedirectRequired, _optional: Record<string, never> = {}): Promise<{ record: RedirectRecord }> {
  const { deps, input, source = "manual" } = required;

  const patternCheck = deps.matcher.validatePattern({
    matchType: input.matchType,
    fromPattern: input.fromPattern,
  });
  if (!patternCheck.ok) throw new RedirectValidationError(patternCheck.reason);
  validateToTargetLength(input.toTarget);
  validateStatusCode(input.statusCode);
  const priority = input.priority ?? DEFAULT_PRIORITY;
  validatePriority(priority);

  await assertTargetAllowed(deps.originRegistry, input.workspaceId, input.toTarget, deps.reservedSegments);
  const finalTarget = await resolveCollapsedTarget(deps.repo, input.workspaceId, input.fromPattern, input.toTarget);
  if (finalTarget !== input.toTarget) {
    await assertTargetAllowed(deps.originRegistry, input.workspaceId, finalTarget, deps.reservedSegments);
  }
  await assertNoDuplicate(deps.repo, input.workspaceId, input.matchType, input.fromPattern);

  const now = clockNowIso({ clock: deps.clock });
  const id = deps.idGen.newId();
  const record: RedirectRecord = {
    id,
    workspaceId: input.workspaceId,
    matchType: input.matchType,
    fromPattern: input.fromPattern,
    toTarget: finalTarget,
    statusCode: input.statusCode,
    status: "active",
    override: input.override ?? false,
    priority,
    source,
    createdByPrincipal: input.actorId,
    createdByPluginId: input.pluginId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const revision: RedirectRevision = {
    redirectId: id,
    workspaceId: input.workspaceId,
    seq: 1,
    state: record,
    tombstoned: false,
    actorId: input.actorId,
    pluginId: input.pluginId,
    recordedAt: now,
  };

  await deps.transaction(async () => {
    await insertRedirectAndRevision({ db: deps.db, record, revision });
  });
  await enqueueMutatedEvent(deps, record, "created");

  return { record };
}

export interface UpdateRedirectRequired {
  deps: RedirectsWriteDeps;
  input: UpdateRedirectInput;
}

/** The PATCH-able subset of a redirect record — `updateRedirect`'s input, one field at a time,
 *  falls back to `existing`'s own value. */
type UpdatableRedirectFields = Pick<
  RedirectRecord,
  "matchType" | "fromPattern" | "toTarget" | "statusCode" | "priority" | "override" | "status"
>;

/** Merges a partial `UpdateRedirectInput` over the existing record's own values — C-002's
 *  "apply only what changed" PATCH semantics, isolated as its own defaulting decision so
 *  {@link updateRedirect} itself only has to sequence validate → write against the result. */
function resolveUpdateFields(input: UpdateRedirectInput, existing: RedirectRecord): UpdatableRedirectFields {
  return {
    matchType: input.matchType ?? existing.matchType,
    fromPattern: input.fromPattern ?? existing.fromPattern,
    toTarget: input.toTarget ?? existing.toTarget,
    statusCode: input.statusCode ?? existing.statusCode,
    priority: input.priority ?? existing.priority,
    override: input.override ?? existing.override,
    status: input.status ?? existing.status,
  };
}

/** Every PATCH-able field except `status`, for {@link isDisableOnlyUpdate}'s "nothing else changed" test. */
const NON_STATUS_UPDATABLE_FIELDS = [
  "matchType",
  "fromPattern",
  "toTarget",
  "statusCode",
  "priority",
  "override",
] as const satisfies readonly (keyof UpdatableRedirectFields)[];

/**
 * Whether this update does nothing but switch the rule OFF (t91 review F2, coordinator ruling
 * 2026-09-16). The admin Redirects screen's on/off toggle PATCHes `status` alone, and a legacy rule
 * whose stored target the gate now refuses used to fail that toggle on the target check. A disabled
 * rule is never served, so turning one off only reduces risk; re-enabling it, or changing any other
 * field, is a full update and runs every check. A field sent with the value it already has counts as
 * unchanged, so a client that PATCHes the whole record gets the same answer as one that sends only
 * `status`.
 *
 * @param fields - {@link resolveUpdateFields}'s merge of the input over `existing`.
 * @param existing - The stored record being updated.
 * @returns `true` only when `fields.status` is `disabled` and every other field equals `existing`'s.
 * @complexity O(1) — a fixed set of scalar comparisons.
 */
function isDisableOnlyUpdate(fields: UpdatableRedirectFields, existing: RedirectRecord): boolean {
  return fields.status === "disabled" && NON_STATUS_UPDATABLE_FIELDS.every((key) => fields[key] === existing[key]);
}

/**
 * Whether this update states nothing but `status: "active"` (S7, web-high fix plan 2026-09-24) — a
 * pure re-enable, which on a rule that is in the Trash means "restore it," the same intent the admin
 * Redirects screen's Enable toggle already carries for an ordinary disabled rule. Checked against
 * the INPUT actually sent, not {@link resolveUpdateFields}'s merge over `existing` — unlike
 * {@link isDisableOnlyUpdate}'s "unchanged" test, a trashed row's OWN stored fields cannot be used as
 * the comparison basis here, since nothing about being in the Trash guarantees they are still valid
 * (the whole point of the `else` branch below is that a trashed row may not be edited sight-unseen).
 *
 * @complexity O(1) — a fixed set of `undefined` checks.
 */
function isRestoreOnlyUpdate(input: UpdateRedirectInput): boolean {
  return input.status === "active" && NON_STATUS_UPDATABLE_FIELDS.every((key) => input[key] === undefined);
}

/**
 * Runs every field check a create runs against the merged update, and returns the target to store
 * (one-hop collapsed, AC-16). Split out of {@link updateRedirect} so a disable-only update can skip
 * it as one decision.
 *
 * @throws {RedirectValidationError | RedirectTargetNotAllowedError | RedirectLoopError | RedirectConflictError}
 * @complexity O(n) in the target length, plus the repo and origin reads each check makes.
 */
async function validateUpdateFields(
  deps: RedirectsWriteDeps,
  workspaceId: string,
  fields: UpdatableRedirectFields,
  existingId: string
): Promise<string> {
  const patternCheck = deps.matcher.validatePattern({ matchType: fields.matchType, fromPattern: fields.fromPattern });
  if (!patternCheck.ok) throw new RedirectValidationError(patternCheck.reason);
  validateToTargetLength(fields.toTarget);
  validateStatusCode(fields.statusCode);
  validateStatus(fields.status);
  validatePriority(fields.priority);

  await assertTargetAllowed(deps.originRegistry, workspaceId, fields.toTarget, deps.reservedSegments);
  const finalTarget = await resolveCollapsedTarget(deps.repo, workspaceId, fields.fromPattern, fields.toTarget);
  if (finalTarget !== fields.toTarget) {
    await assertTargetAllowed(deps.originRegistry, workspaceId, finalTarget, deps.reservedSegments);
  }
  await assertNoDuplicate(deps.repo, workspaceId, fields.matchType, fields.fromPattern, existingId);
  return finalTarget;
}

/**
 * C-002: symmetric chokepoint entry for updates (REQ-04). A disable-only update
 * ({@link isDisableOnlyUpdate}) writes the status change without re-validating the unchanged fields
 * — it stores the existing target as-is, with no one-hop collapse.
 *
 * S7 (web-high fix plan 2026-09-24): a rule with a Trash index row (`deps.isInTrash`, distinct from
 * `status === "disabled"` — see {@link RedirectsWriteDeps.isInTrash}'s own doc) refuses every update
 * EXCEPT a pure `status: "active"` PATCH ({@link isRestoreOnlyUpdate}), which restores it instead of
 * editing a row the caller cannot see the current shape of.
 *
 * @throws {EntityNotLiveError} On a non-restore update to a rule in the Trash.
 * @throws {RedirectConflictError} If the Trash row's version moved before the restore landed.
 */
export async function updateRedirect(required: UpdateRedirectRequired, _optional: Record<string, never> = {}): Promise<{ record: RedirectRecord }> {
  const { deps, input } = required;

  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) throw new RedirectNotFoundError(`redirect '${input.id}' was not found`);

  const inTrash = await deps.isInTrash({ workspaceId: input.workspaceId, id: input.id });
  if (inTrash) {
    if (!isRestoreOnlyUpdate(input)) {
      assertEntityLive({ entityType: "redirect", entityId: input.id, state: "trashed" });
    }

    const outcome = await deps.restore({
      workspaceId: input.workspaceId,
      id: input.id,
      at: clockNowIso({ clock: deps.clock }),
      actor: { principalId: input.actorId, pluginId: input.pluginId ?? null },
    });
    if (outcome === "not-found") throw new RedirectNotFoundError(`redirect '${input.id}' was not found`);
    if (outcome === "version-changed") {
      throw new RedirectConflictError(`redirect '${input.id}' changed while it was being restored`);
    }
    if (outcome === "adapter-unavailable") {
      throw new Error(`trash: no Trash adapter is registered for entity type 'redirect' (id '${input.id}')`);
    }

    const restored = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
    if (!restored) throw new RedirectNotFoundError(`redirect '${input.id}' was not found`);
    await enqueueMutatedEvent(deps, restored, "updated");
    return { record: restored };
  }

  const fields = resolveUpdateFields(input, existing);
  const finalTarget = isDisableOnlyUpdate(fields, existing)
    ? existing.toTarget
    : await validateUpdateFields(deps, input.workspaceId, fields, existing.id);

  const now = clockNowIso({ clock: deps.clock });
  const version = existing.version + 1;
  const record: RedirectRecord = { ...existing, ...fields, toTarget: finalTarget, updatedAt: now, version };
  const revision: RedirectRevision = {
    redirectId: existing.id,
    workspaceId: input.workspaceId,
    seq: version,
    state: record,
    tombstoned: false,
    actorId: input.actorId,
    pluginId: input.pluginId,
    recordedAt: now,
  };

  await deps.transaction(async () => {
    await insertRedirectAndRevision({ db: deps.db, record, revision });
  });
  await enqueueMutatedEvent(deps, record, "updated");

  return { record };
}

export interface TombstoneRedirectRequired {
  deps: RedirectsWriteDeps;
  input: { workspaceId: string; id: string; actorId: string; pluginId?: string };
}

/** C-003: soft-delete (REQ-05). */
export async function tombstoneRedirect(
  required: TombstoneRedirectRequired,
  _optional: Record<string, never> = {},
): Promise<{ record: RedirectRecord }> {
  const { deps, input } = required;

  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) throw new RedirectNotFoundError(`redirect '${input.id}' was not found`);

  if (existing.status === "disabled") {
    // Idempotent no-op: already tombstoned, no new revision needed.
    return { record: existing };
  }

  const now = clockNowIso({ clock: deps.clock });
  const version = existing.version + 1;
  const record: RedirectRecord = { ...existing, status: "disabled", updatedAt: now, version };
  const revision: RedirectRevision = {
    redirectId: existing.id,
    workspaceId: input.workspaceId,
    seq: version,
    state: record,
    tombstoned: true,
    actorId: input.actorId,
    pluginId: input.pluginId,
    recordedAt: now,
  };

  // The marker flip, the Trash index row and the revision append are one unit. `deps.remove` joins
  // this transaction rather than opening its own, so a tombstone can never land without its Trash
  // row (which would make the redirect unrecoverable through the UI) or vice versa.
  await deps.transaction(async () => {
    const removed = await deps.remove({
      workspaceId: input.workspaceId,
      id: input.id,
      // From columns already loaded above — no second read.
      display: { title: existing.fromPattern, subtitle: existing.toTarget },
      at: now,
      expectedVersion: existing.version,
      actor: { principalId: input.actorId, pluginId: input.pluginId ?? null },
    });
    if (!removed.ok) {
      if (removed.reason === "not-found") throw new RedirectNotFoundError(`redirect '${input.id}' was not found`);
      throw new RedirectConflictError(`redirect '${input.id}' changed while it was being tombstoned`);
    }
    await deps.db.insertRevision(revision);
  });
  await enqueueMutatedEvent(deps, record, "tombstoned");

  return { record };
}

export interface ImportRedirectsRequired {
  deps: RedirectsWriteDeps;
  input: { workspaceId: string; actorId: string; rules: CreateRedirectInput[] };
}

export interface ImportRedirectsFailure {
  index: number;
  code: string;
  message: string;
}

function errorToCode(err: unknown): string {
  if (err instanceof RedirectValidationError) return "REDIRECT_VALIDATION_ERROR";
  if (err instanceof RedirectTargetNotAllowedError) return "REDIRECT_TARGET_NOT_ALLOWED";
  if (err instanceof RedirectConflictError) return "REDIRECT_CONFLICT";
  if (err instanceof RedirectLoopError) return "REDIRECT_LOOP_DETECTED";
  return "INTERNAL_ERROR";
}

/**
 * The classes whose message a per-rule import failure may carry verbatim — the same four
 * {@link errorToCode} names (wm S16, 2026-10-04). `failed[]` is a RETURNED result (the agent tool
 * and the admin import route both hand it out as-is), so it bypasses the transport's
 * INTERNAL_ERROR redaction; before this, an infrastructure error (a driver failure quoting a file
 * path, say) put its raw message straight into the model's and the admin's view.
 */
const IMPORT_FAILURE_SAFE_RULES: readonly CallerSafeErrorRule[] = [
  { error: RedirectValidationError },
  { error: RedirectTargetNotAllowedError },
  { error: RedirectConflictError },
  { error: RedirectLoopError },
];

/**
 * C-004: batch-create reusing the same chokepoint, no bypass (REQ-26). Each
 * item is processed independently through `createRedirect` — NOT one shared
 * transaction across items (EC-08); a per-item failure does not abort
 * already-written prior items.
 */
export async function importRedirects(
  required: ImportRedirectsRequired,
  _optional: Record<string, never> = {},
): Promise<{ created: RedirectRecord[]; failed: ImportRedirectsFailure[] }> {
  const { deps, input } = required;

  if (input.rules.length < 1 || input.rules.length > MAX_IMPORT_BATCH_SIZE) {
    throw new RedirectValidationError(
      `import batch size must be 1-${MAX_IMPORT_BATCH_SIZE} (got ${input.rules.length})`
    );
  }

  const created: RedirectRecord[] = [];
  const failed: ImportRedirectsFailure[] = [];

  for (const [index, rule] of input.rules.entries()) {
    try {
      const { record } = await createRedirect({
        deps,
        input: { ...rule, workspaceId: input.workspaceId, actorId: input.actorId },
        source: "import",
      });
      created.push(record);
    } catch (err) {
      failed.push({
        index,
        code: errorToCode(err),
        message: callerSafeErrorMessage({ err, rules: IMPORT_FAILURE_SAFE_RULES, fallback: "an internal error occurred" }),
      });
    }
  }

  return { created, failed };
}
