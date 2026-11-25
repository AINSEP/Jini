import type { PeerCallDeps } from "../../../publish/content/peer-transport.js";
import type { PublishScope } from "../../../publish/content/ui.js";
import { readOverwriteEntityKeys } from "./import.js";
import { defineJsonRoute, ok, routeReply } from "@jini-ai/core/contracts/server";
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
