import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type {
  PublishContentPeerListDto, PublishContentPeerResponseDto, PublishContentPeerView,
} from "@jini-ai/core/contracts/site/cms-publish-content";

import {
  authorizePublishContent, bodyRecord, rejectPublishError, routeParam,
  type PublishRoutePrincipal, type PublishErrorClass, type PublishErrorMapping,
} from "./transport-shared.js";

/**
 * @file Task 10 of the publish-content (Publish Content) feature — CRUD for `publish_content_peers`
 * under `/api/admin/v1/workspaces/:workspaceId/publish-content/peers`.
 *
 * ## FROZEN CONTRACT (the admin UI is built against it)
 *
 * `GET .../peers` answers `{peers: [{id, label, baseUrl, remoteWorkspaceId, masked, hasCredential}]}`.
 * `masked` and `hasCredential` are the ONLY credential-shaped fields that ever leave the server —
 * no `sealedCiphertext`, `sealedNonce`, `sealedKeyId` or `sealedAlg` in any response body, log line
 * or error message, ever. That is enforced by construction rather than by review: every body below
 * is built from {@link PublishContentPeerView} (Core's wire DTO), a type with no field capable of carrying sealed
 * material, and these specs never touch a stored peer record.
 *
 * ## Permissions
 *
 * `publish_content.read` to list; `publish_content.apply` to create, update or delete. Deliberately
 * NOT `content.read`/`content.write`: those are a broader pre-existing pair, and reusing them here
 * would silently widen who can point this workspace's content at an external URL.
 *
 * The peer store, its sealing and its typed errors are the host's: each route receives them as
 * injected collaborators bound to the request's own repos.
 */

const PEER_BASE = "/api/admin/v1/workspaces/:workspaceId/publish-content/peers";
const PEER_ENTITY_TYPE = "publish-content-peer";

/** The host's typed peer-store error classes; the spec owns which status/code each answers with. */
export interface PublishPeerErrorClasses {
  validation: PublishErrorClass;
  duplicateLabel: PublishErrorClass;
  notFound: PublishErrorClass;
  secretStoreUnconfigured: PublishErrorClass;
}

/** Maps the feature's typed store errors to HTTP. Every case is a specific status — a validation
 *  refusal must never read as a server fault, and a duplicate label must never read as a validation
 *  error the operator can fix by retyping the same value. Anything else is rethrown, so a raw
 *  driver error falls through to the host's approved request wording rather than being echoed. */
function peerErrorMappings({ classes }: { classes: PublishPeerErrorClasses }, _optional: Record<string, never> = {}): readonly PublishErrorMapping[] {
  return [
    { errorClass: classes.validation, status: 400, code: "VALIDATION_ERROR" },
    { errorClass: classes.duplicateLabel, status: 409, code: "DUPLICATE_LABEL" },
    { errorClass: classes.notFound, status: 404, code: "PEER_NOT_FOUND" },
    // The site key is unset/misconfigured. Operator-actionable and NOT a leak: the message names the
    // configuration failure, never the plaintext that failed to seal.
    { errorClass: classes.secretStoreUnconfigured, status: 503, code: "SECRET_STORE_UNCONFIGURED" },
  ];
}

const PEER_FIELDS = ["label", "baseUrl", "remoteWorkspaceId", "apiKey"] as const;
/** The editable peer fields, each forwarded as submitted (the host store validates them). */
export type PublishPeerFields = Partial<Record<(typeof PEER_FIELDS)[number], unknown>>;

/** Keys are forwarded only when PRESENT — an absent key means "leave this field alone", which
 *  is what lets the UI rename a peer without re-collecting its credential. Spreading
 *  `undefined` in instead would make every PATCH a full replace.
 *  @complexity O(1) — four fixed fields. */
function presentPeerFields({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): PublishPeerFields {
  return Object.fromEntries(PEER_FIELDS.filter((field) => field in body).map((field) => [field, body[field]]));
}

/** Host collaborators (bound per request to the workspace's peer repo, sealer and keyring). */
export type PublishPeerListFn = (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<readonly PublishContentPeerView[]>;
export type PublishPeerCreateFn = (required: { workspaceId: string; label: unknown; baseUrl: unknown; remoteWorkspaceId: unknown; apiKey: unknown }, optional?: Record<string, never>) => Promise<PublishContentPeerView>;
export type PublishPeerUpdateFn = (required: { workspaceId: string; id: string } & PublishPeerFields, optional?: Record<string, never>) => Promise<PublishContentPeerView>;
export type PublishPeerDeleteFn = (required: { workspaceId: string; id: string }, optional?: Record<string, never>) => Promise<void>;

/** The deps each peer route reads. */
export interface PeerListRouteDeps { workspaceId: string; peerErrors: PublishPeerErrorClasses; listPeers: PublishPeerListFn }
export interface PeerCreateRouteDeps { workspaceId: string; peerErrors: PublishPeerErrorClasses; createPeer: PublishPeerCreateFn }
export interface PeerUpdateRouteDeps { workspaceId: string; peerErrors: PublishPeerErrorClasses; updatePeer: PublishPeerUpdateFn }
export interface PeerDeleteRouteDeps { workspaceId: string; peerErrors: PublishPeerErrorClasses; deletePeer: PublishPeerDeleteFn }

/** Runs one store call after the permission check, mapping its typed errors. @complexity O(1) plus `run`. */
async function guardedPeerCall<T>(
  { authorize, permission, peerErrors, run }: {
    authorize: Parameters<typeof authorizePublishContent>[0]["authorize"]; permission: string; peerErrors: PublishPeerErrorClasses; run: () => Promise<T>;
  },
  _optional: Record<string, never> = {},
): Promise<T> {
  await authorizePublishContent({ authorize, permission, entityType: PEER_ENTITY_TYPE });
  try {
    return await run();
  } catch (err) {
    return rejectPublishError({ err, mappings: peerErrorMappings({ classes: peerErrors }) });
  }
}

export const peerListRoute = defineJsonRoute<Record<string, never>, PublishContentPeerListDto, PeerListRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: PEER_BASE,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    const peers = await guardedPeerCall({ authorize, permission: "publish_content.read", peerErrors: deps.peerErrors,
      run: () => deps.listPeers({ workspaceId: deps.workspaceId }) });
    return ok({ value: { peers } });
  },
});

export const peerCreateRoute = defineJsonRoute<{ body: Record<string, unknown> }, PublishContentPeerResponseDto, PeerCreateRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: PEER_BASE,
  parse: (raw) => ok({ value: { body: bodyRecord({ body: raw.body }) } }),
  handle: async ({ input: { body }, deps, authorize }) => {
    const peer = await guardedPeerCall({ authorize, permission: "publish_content.apply", peerErrors: deps.peerErrors,
      run: () => deps.createPeer({ workspaceId: deps.workspaceId, label: body.label, baseUrl: body.baseUrl, remoteWorkspaceId: body.remoteWorkspaceId, apiKey: body.apiKey }) });
    return ok({ value: { peer } });
  },
}, { successStatus: 201 });

export const peerUpdateRoute = defineJsonRoute<{ peerId: string; fields: PublishPeerFields }, PublishContentPeerResponseDto, PeerUpdateRouteDeps, PublishRoutePrincipal>({
  method: "patch",
  path: `${PEER_BASE}/:peerId`,
  parse: (raw) => ok({ value: { peerId: routeParam({ params: raw.params, name: "peerId" }), fields: presentPeerFields({ body: bodyRecord({ body: raw.body }) }) } }),
  handle: async ({ input, deps, authorize }) => {
    const peer = await guardedPeerCall({ authorize, permission: "publish_content.apply", peerErrors: deps.peerErrors,
      run: () => deps.updatePeer({ workspaceId: deps.workspaceId, id: input.peerId, ...input.fields }) });
    return ok({ value: { peer } });
  },
});

/** Idempotent 204, matching this codebase's other credential DELETE routes: deleting an
 *  already-absent peer is a success, not a 404. */
export const peerDeleteRoute = defineJsonRoute<{ peerId: string }, undefined, PeerDeleteRouteDeps, PublishRoutePrincipal>({
  method: "delete",
  path: `${PEER_BASE}/:peerId`,
  parse: (raw) => ok({ value: { peerId: routeParam({ params: raw.params, name: "peerId" }) } }),
  handle: async ({ input, deps, authorize }) => {
    await guardedPeerCall({ authorize, permission: "publish_content.apply", peerErrors: deps.peerErrors,
      run: () => deps.deletePeer({ workspaceId: deps.workspaceId, id: input.peerId }) });
    return ok({ value: undefined });
  },
}, { successStatus: 204 });
