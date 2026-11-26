import { PublishContentPeerTransportError } from '../../../publish/content/peer-transport-error.js';
import { PublishContentPeerCredentialMissingError, PublishContentPeerNotFoundError, PublishContentPeerSecretStoreUnconfiguredError } from '../../../publish/content/peers.js';
import { PublishTrustHandshakeError } from '../../../publish/trust/handshake-error.js';
import { mappedErrorResponse, type MappedErrorClass, type RouteRefusal } from './route-helpers.js';
import type { PeerCallDeps } from "../../../publish/content/peer-transport.js";
import type { PublishScope } from "../../../publish/content/ui/contract.js";
import { readOverwriteEntityKeys } from "./import.js";
import { defineJsonRoute, ok, routeReply, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { authorizePublishContent, routeParam, bodyRecord, type PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Task 10 of the publish-content (Publish Content) feature — the PULL half of the operator-facing
 * peer transport: `POST /api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/pull`
 * fetches the peer's export and stages it HERE, answering a local `bundleId` that this instance's own
 * `/import/plan|confirm|execute` then drives. One importer, two directions.
 *
 * The route takes a `peerId`, never a raw URL and never a credential: the host resolves both from the
 * peer row for the lifetime of one request (`pullAndStage`). On a PULL the safety properties live
 * HERE, in the existing `/import/*` ceremony — which is exactly why this route stops at staging
 * rather than planning: a second entry point into the planner would be a second place the gate could
 * be forgotten. The host injects the pull-and-stage work and its typed-error mapping
 * (`peerActionRefusal`); this spec owns the authorization, the refusal mapping and the 201.
 */

const PEER_ENTITY_TYPE = "publish-content-peer";

/** The status-and-body pair the host maps one of its typed peer-action errors to. */
export interface PeerActionRouteRefusal { status: number; body: Record<string, unknown> }

/** The host's typed-error mapping; `undefined` leaves the error to the mount's redacted 500. */
export type PeerActionRefusalFn = (required: { error: unknown }) => PeerActionRouteRefusal | undefined;

/** The pull spec's deps. */
export interface PeerPullRouteDeps {
  workspaceId: string;
  peerActionRefusal: PeerActionRefusalFn;
  /** Opens the peer's credential, fetches its export and stages it as a local bundle. */
  pullAndStage(required: { peerId: string; principalId: string }): Promise<unknown>;
}

/** The principal, or a fail-closed wiring error. @complexity O(1). */
function principalOf({ context }: { context: PublishRoutePrincipal | undefined }, _optional: Record<string, never> = {}): PublishRoutePrincipal {
  if (!context) throw new Error("publish-content admin route has no authenticated principal");
  return context;
}

/** Runs `work`, turning a host-mapped typed error into its refusal; anything else is rethrown. @complexity O(1). */
async function mapPeerActionErrors<T>({ deps, work }: { deps: Pick<PeerPullRouteDeps, "peerActionRefusal">; work: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RouteRefusalError) throw error;
    const refusal = deps.peerActionRefusal({ error });
    if (refusal) throw new RouteRefusalError(refusal);
    throw error;
  }
}

/** `POST .../peers/:peerId/pull` — stages the peer's export here (201). */
export const peerPullRoute = defineJsonRoute<{ peerId: string }, unknown, PeerPullRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/pull",
  parse: (raw) => ok({ value: { peerId: routeParam({ params: raw.params, name: "peerId" }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = principalOf({ context });
    await authorizePublishContent({ authorize, permission: "publish_content.apply", entityType: PEER_ENTITY_TYPE });
    const staged = await mapPeerActionErrors({ deps, work: () => deps.pullAndStage({ peerId: input.peerId, principalId: principal.id }) });
    return ok({ value: staged });
  },
}, { successStatus: 201 });

/** Distinguishes "the body carried a malformed selection" (a 400) from "the body carried none"
 *  (`null`, publish everything) — two outcomes a bare `null` return could not tell apart. */
const INVALID_SELECTION = Symbol("invalid-selection");

/**
 * Reads `push/plan`'s optional per-row selection: the `entityKey` strings
 * (`planner.ts`'s `${entityType}:${entityId}`) the operator left checked in the dialog.
 *
 * Absent means "publish everything", which is what every caller before the checkbox column sent and
 * what the dialog still sends when nothing was unchecked — the common path stays a bodyless POST.
 * An empty ARRAY is a real, different answer ("the operator unchecked everything") and is honoured
 * as such: it stages an empty bundle and plans to zero rows rather than quietly publishing the lot.
 *
 * @complexity O(n) in the submitted key count.
 */
function readSelectedEntityKeys({ body }: { body: unknown }, _options: Record<string, never> = {}): readonly string[] | null | typeof INVALID_SELECTION {
  const raw = bodyRecord({ body });
  if (raw.selectedEntityKeys === undefined || raw.selectedEntityKeys === null) return null;
  if (!Array.isArray(raw.selectedEntityKeys)) return INVALID_SELECTION;
  if (!raw.selectedEntityKeys.every((key): key is string => typeof key === "string")) return INVALID_SELECTION;
  return raw.selectedEntityKeys;
}

/** `scope`'s per-field cap, matching `readOverwriteEntityKeys`'s 1000-entry bound (`@jini-ai/cms/admin-http/routes/publish-content/import`). */
const MAX_SCOPE_ARRAY_LENGTH = 1000;

/** @complexity O(1). */
function isNonEmptyStringArrayField(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_SCOPE_ARRAY_LENGTH && value.every((v) => typeof v === "string");
}

/**
 * Reads `push/plan`'s optional `scope` (`plan-publish-sections-2026-09-25.md` §1) — the section (or
 * section-plus-rows) this plan is about, applied BEFORE `selectedEntityKeys` narrows further (this
 * file's own `push/plan` handler). Absent/`null` means "publish everything", the same "absent, not an
 * empty real answer" contract every other optional array field on this route reads by.
 *
 * A present `entityTypes` or `entityKeys` must be a non-empty array of strings (at most
 * {@link MAX_SCOPE_ARRAY_LENGTH} entries): an empty array is refused rather than silently treated as
 * "everything" or "nothing", since `selectedEntityKeys` already uses an empty array for "nothing" and
 * a caller sending `scope: {entityTypes: []}` almost certainly meant something else.
 *
 * @returns `{scope: null}` when the body carries no `scope`, `{scope}` (the validated
 *   {@link PublishScope}) when it is well-formed, or `{invalidField}` naming which field was wrong
 *   (`"scope"` itself when it is not an object or names neither field — never read as "everything").
 * @complexity O(n) in the submitted array lengths.
 */
function readPublishScope({ body }: { body: unknown }, _options: Record<string, never> = {}): { scope: PublishScope | null } | { invalidField: ScopeInvalidField } {
  const raw = bodyRecord({ body });
  if (raw.scope === undefined || raw.scope === null) return { scope: null };
  if (typeof raw.scope !== "object" || Array.isArray(raw.scope)) return { invalidField: "scope" };
  const scopeBody = raw.scope as Record<string, unknown>;
  // A present scope naming neither field (`{}`, or a typo like `{types: [...]}`) would otherwise
  // narrow nothing — silently widening a one-section dialog to "publish everything". Refused.
  if (scopeBody.entityTypes === undefined && scopeBody.entityKeys === undefined) return { invalidField: "scope" };
  const entityTypes = scopeBody.entityTypes;
  const entityKeys = scopeBody.entityKeys;
  if (entityTypes !== undefined && !isNonEmptyStringArrayField(entityTypes)) return { invalidField: "entityTypes" };
  if (entityKeys !== undefined && !isNonEmptyStringArrayField(entityKeys)) return { invalidField: "entityKeys" };
  return { scope: { ...(entityTypes === undefined ? {} : { entityTypes }), ...(entityKeys === undefined ? {} : { entityKeys }) } };
}

const SCOPE_FIELDS = ["entityTypes", "entityKeys"] as const;
type ScopeInvalidField = "scope" | (typeof SCOPE_FIELDS)[number];

/** The 400 message for a malformed `scope`. @complexity O(1). */
function scopeErrorMessage(invalidField: ScopeInvalidField): string {
  return invalidField === "scope"
    ? "'scope' must be an object with 'entityTypes' and/or 'entityKeys'"
    : `'scope.${invalidField}' must be a non-empty array of strings`;
}

/**
 * Reads `push/plan`'s two narrowing fields: `selectedEntityKeys` first, then `scope`.
 * @returns the 400 message for the first malformed one, or both read values.
 * @complexity O(n) in the submitted array lengths.
 */
function readPushPlanNarrowing({ body }: { body: unknown }, _options: Record<string, never> = {}): { error: string } | { scope: PublishScope | null; selectedEntityKeys: readonly string[] | null } {
  const selectedEntityKeys = readSelectedEntityKeys({ body });
  if (selectedEntityKeys === INVALID_SELECTION) return { error: "'selectedEntityKeys' must be an array of strings" };
  const scopeResult = readPublishScope({ body });
  if ("invalidField" in scopeResult) return { error: scopeErrorMessage(scopeResult.invalidField) };
  return { scope: scopeResult.scope, selectedEntityKeys };
}


export const peerPushPlanRoute = defineJsonRoute<{ peerId: string; body: unknown }, unknown, {
  requireOverwriteSession(required: Record<string, never>): void;
  openPeer(required: { peerId: string }): Promise<PeerCallDeps<string>>;
  plan(required: { peer: PeerCallDeps<string>; principalId: string; scope: PublishScope | null; selectedEntityKeys: readonly string[] | null; overwriteEntityKeys: readonly string[] | null }): Promise<unknown>;
}, PublishRoutePrincipal>({
  method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/push/plan',
  parse: raw => ok({ value: { peerId: routeParam({ params: raw.params, name: 'peerId' }), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = principalOf({ context });
    if (!authorize) throw new Error('publish-content admin route has no authorizer');
    await authorize({ permission: 'publish_content.apply' });
    const narrowing = readPushPlanNarrowing({ body: input.body });
    if ('error' in narrowing) return ok({ value: routeReply({ status: 400, body: { error: narrowing.error, code: 'VALIDATION_ERROR' } }) });
    const overwriteEntityKeys = readOverwriteEntityKeys({ overwriteEntityKeys: bodyRecord({ body: input.body }).overwriteEntityKeys });
    if (overwriteEntityKeys === 'invalid') return ok({ value: routeReply({ status: 400, body: { error: "'overwriteEntityKeys' must be an array of strings", code: 'VALIDATION_ERROR' } }) });
    if (overwriteEntityKeys && overwriteEntityKeys.length > 0) deps.requireOverwriteSession({});
    const peer = await deps.openPeer({ peerId: input.peerId });
    return ok({ value: await deps.plan({ peer, principalId: principal.id, scope: narrowing.scope, selectedEntityKeys: narrowing.selectedEntityKeys, overwriteEntityKeys }) });
  },
});

export const peerPushConfirmRoute = defineJsonRoute<{ peerId: string; body: unknown }, unknown, {
  openPeer(required: { peerId: string }): Promise<PeerCallDeps<string>>;
  confirm(required: { peer: PeerCallDeps<string>; planId: string; planHash: string }): Promise<unknown>;
}, PublishRoutePrincipal>({
  method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/push/confirm',
  parse: raw => ok({ value: { peerId: routeParam({ params: raw.params, name: 'peerId' }), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    principalOf({ context });
    if (!authorize) throw new Error('publish-content admin route has no authorizer');
    await authorize({ permission: 'publish_content.apply' });
    const { planId, planHash } = bodyRecord({ body: input.body });
    if (typeof planId !== 'string' || typeof planHash !== 'string') return ok({ value: routeReply({ status: 400, body: { error: "'planId' and 'planHash' (strings) are required", code: 'VALIDATION_ERROR' } }) });
    const peer = await deps.openPeer({ peerId: input.peerId });
    return ok({ value: await deps.confirm({ peer, planId, planHash }) });
  },
});

export const peerPushExecuteRoute = defineJsonRoute<{ peerId: string; body: unknown }, unknown, {
  openPeer(required: { peerId: string }): Promise<PeerCallDeps<string>>;
  requireOverwriteSession(required: Record<string, never>): void;
  execute(required: { peer: PeerCallDeps<string>; bundleId: string; confirmationToken: string; overwriteEntityKeys?: readonly string[] }): Promise<unknown>;
}, PublishRoutePrincipal>({
  method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/publish-content/peers/:peerId/push/execute',
  parse: raw => ok({ value: { peerId: routeParam({ params: raw.params, name: 'peerId' }), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    principalOf({ context });
    if (!authorize) throw new Error('publish-content admin route has no authorizer');
    await authorize({ permission: 'publish_content.apply' });
    const body = bodyRecord({ body: input.body });
    const { bundleId, confirmationToken } = body;
    if (typeof bundleId !== 'string' || typeof confirmationToken !== 'string') return ok({ value: routeReply({ status: 400, body: { error: "'bundleId' and 'confirmationToken' (strings) are required", code: 'VALIDATION_ERROR' } }) });
    const overwriteEntityKeys = readOverwriteEntityKeys({ overwriteEntityKeys: body.overwriteEntityKeys });
    if (overwriteEntityKeys === 'invalid') return ok({ value: routeReply({ status: 400, body: { error: "'overwriteEntityKeys' must be an array of strings", code: 'VALIDATION_ERROR' } }) });
    if (overwriteEntityKeys && overwriteEntityKeys.length > 0) deps.requireOverwriteSession({});
    const peer = await deps.openPeer({ peerId: input.peerId });
    return ok({ value: await deps.execute({ peer, bundleId, confirmationToken, ...(overwriteEntityKeys === null ? {} : { overwriteEntityKeys }) }) });
  },
});

/** The typed errors a peer action answers with their own message. */
export const PEER_ACTION_ERRORS: readonly MappedErrorClass[] = [
  [PublishContentPeerNotFoundError, 404, "PEER_NOT_FOUND"],
  // A connected destination's handshake. 502 for the same reason a transport error is: this
  // instance is fine and the request was well-formed — the far side (or the path to it) is what
  // failed, and the message is already the sentence the owner needs to act on.
  [PublishTrustHandshakeError, 502, "PUBLISH_TRUST_HANDSHAKE_FAILED"],
  [PublishContentPeerCredentialMissingError, 409, "PEER_CREDENTIAL_MISSING"],
  [PublishContentPeerSecretStoreUnconfiguredError, 503, "SECRET_STORE_UNCONFIGURED"],
];

/** A peer action's typed failure as its refusal, or `undefined` for the redacted 500. Manual
 *  publishing (`modules/publish-content-backstop.ts`) maps its failures through this too.
 *  @complexity O(t) in the table length. */
export function knownPeerActionRefusal({ err }: { err: unknown }, _options: Record<string, never> = {}): RouteRefusal | undefined {
  if (err instanceof PublishContentPeerTransportError) {
    // 502: this instance is fine and the request was well-formed; the PEER (or the path to it) is
    // what failed. A 500 here would send an operator looking in the wrong server's logs — and for
    // `EGRESS_REFUSED` specifically, the message is the `devHostAllowlist` diagnosis, which is only
    // actionable if it reaches them intact.
    return { status: 502, body: { error: err.message, code: err.code } };
  }
  const match = PEER_ACTION_ERRORS.find(([errorClass]) => err instanceof errorClass);
  return match ? { status: match[1], body: { error: (err as Error).message, code: match[2] } } : undefined;
}

/** Returned by {@link acceptOverwriteEntityKeys} when it has already sent a 400 or 403. */
export const OVERWRITE_REFUSED = Symbol("overwrite-refused");

/** A route's own "who may tick overwrite" rule; on `false` it has already sent its 403. */
export type OverwriteRule = (required: { res: { status(code: number): { json(body: unknown): unknown } }; overwriteEntityKeys: readonly string[] | null }, optional?: Record<string, never>) => boolean;

/**
 * Reads `overwriteEntityKeys` (Jini's parser answers the `"invalid"` sentinel for a malformed set,
 * which this adapter turns into the relay's 400) and applies the route's own "who may tick overwrite" rule.
 * @returns the ticks (`null` = force nothing), or {@link OVERWRITE_REFUSED} once the 400 (malformed)
 *   or the rule's own 403 has been sent.
 * @complexity O(n) in the submitted key count.
 */
export function acceptOverwriteEntityKeys({ res, raw, mayOverwrite }: { res: { status(code: number): { json(body: unknown): unknown } }; raw: unknown; mayOverwrite: OverwriteRule }, _options: Record<string, never> = {}): readonly string[] | null | typeof OVERWRITE_REFUSED {
  const keys = readOverwriteEntityKeys({ overwriteEntityKeys: raw });
  if (keys === "invalid") {
    res.status(400).json({ error: "'overwriteEntityKeys' must be an array of strings", code: "VALIDATION_ERROR" });
    return OVERWRITE_REFUSED;
  }
  return mayOverwrite({ res, overwriteEntityKeys: keys }) ? keys : OVERWRITE_REFUSED;
}

/** Answers a peer action's failure. Manual publishing (`backstop.ts`) reuses it, so a live-site
 *  failure reaches the owner there as the same actionable answer; `message` names its private 500.
 *  @complexity O(1). */
export function respondWithPeerActionError(required: Omit<Parameters<typeof mappedErrorResponse>[0], "table"> & {
  json: (body: unknown, status: number) => void;
}, optional: Parameters<typeof mappedErrorResponse>[1] = {}): void {
  const known = knownPeerActionRefusal({ err: required.err });
  if (known) { required.json(known.body, known.status); return; }
  // The mapper needs the registered template to distinguish preparation from an uncertain send.
  // Concrete request paths and mounted base URLs can contain private IDs and never enter copy.
  const refusal = mappedErrorResponse({ ...required, table: PEER_ACTION_ERRORS }, optional);
  required.json(refusal.body, refusal.status);
}

/** The per-request transport bag: the guarded client plus the opened credential.
 * @complexity O(1) plus one repo read and one AEAD open. */
export function createPeerCallResolver(required: {
  workspaceId: string;
  resolveCredential: (required: { workspaceId: string; id: string }) => Promise<PeerCallDeps<string>["credential"]>;
  httpClient: PeerCallDeps<string>["httpClient"];
  publishHistory: Pick<NonNullable<PeerCallDeps<string>["publishHistory"]>, "store" | "clock">;
}, _optional = {}) {
  return async ({ peerId }: { peerId: string }, _optional = {}): Promise<PeerCallDeps<string>> => {
    const credential = await required.resolveCredential({ workspaceId: required.workspaceId, id: peerId });
    return { credential, httpClient: required.httpClient, publishHistory: { store: required.publishHistory.store, workspaceId: required.workspaceId, clock: required.publishHistory.clock } };
  };
}

/** The three push routes, in their registered order; the pull spec follows them. */
export function registerPublishContentPeerPushRoutes(required: {
  mount<Input, Output, Deps>(required: {
    spec: JsonRouteSpec<Input, Output, Deps, PublishRoutePrincipal>;
    preflight: { readHeaders: readonly []; check: () => RouteRefusal | undefined };
    /** The host supplies the request-scoped overwrite gate; routes that never overwrite ignore it. */
    requestDeps: (facts: { requireOverwriteSession(required: Record<string, never>): void }) => Deps;
    failure: (facts: Pick<Parameters<typeof respondWithPeerActionError>[0], "err" | "json" | "incident" | "discloseDetails" | "method" | "route">) => void;
  }): void;
  openPeer: Parameters<typeof peerPushPlanRoute.handle>[0]["deps"]["openPeer"];
  plan: Parameters<typeof peerPushPlanRoute.handle>[0]["deps"]["plan"];
  confirm: Parameters<typeof peerPushConfirmRoute.handle>[0]["deps"]["confirm"];
  execute: Parameters<typeof peerPushExecuteRoute.handle>[0]["deps"]["execute"];
  canPublishToLive: () => boolean; liveSiteRefusal: RouteRefusal; operation: string;
}, _optional = {}): void {
  const preflight = { readHeaders: [] as const, check: () => required.canPublishToLive() ? undefined : required.liveSiteRefusal };
  required.mount({ spec: peerPushPlanRoute, preflight,
    requestDeps: facts => ({ openPeer: required.openPeer, plan: required.plan, requireOverwriteSession: facts.requireOverwriteSession }),
    failure: facts => respondWithPeerActionError({ ...facts, operation: required.operation }),
  });
  required.mount({ spec: peerPushConfirmRoute, preflight,
    requestDeps: () => ({ openPeer: required.openPeer, confirm: required.confirm }),
    failure: facts => respondWithPeerActionError({ ...facts, operation: required.operation }),
  });
  required.mount({ spec: peerPushExecuteRoute, preflight,
    requestDeps: facts => ({ openPeer: required.openPeer, execute: required.execute, requireOverwriteSession: facts.requireOverwriteSession }),
    failure: facts => respondWithPeerActionError({ ...facts, operation: required.operation }),
  });
}
