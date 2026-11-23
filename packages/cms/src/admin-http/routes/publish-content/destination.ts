import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { hasForbiddenRawUrlCharacter } from "@jini-ai/core/contracts/server/verified-origin";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { normalizePeerBaseUrl } from "../../../publish/content/peer-url.js";
import {
  authorizePublishContent, bodyRecord, rejectPublishError,
  type PublishContentPeerView, type PublishRoutePrincipal, type PublishErrorClass, type PublishErrorMapping,
} from "./transport-shared.js";

/**
 * @file Zero-setup publishing: `GET`, `POST /connect` and `POST /disconnect` under
 * `/api/admin/v1/workspaces/:workspaceId/publish-content/destination` — the one action that turns a
 * fresh install into one that can publish, without a key ever being minted, displayed or copied.
 * It lives behind the Publish button rather than on a settings screen.
 *
 * Every route is gated on `publish_content.apply`, not `.read`: connecting authorises future writes
 * to a live site, so it is gated as a write. The handshake, the grant file and the peer row are the
 * host's; each route receives them as injected collaborators.
 */

const DESTINATION_BASE = "/api/admin/v1/workspaces/:workspaceId/publish-content/destination";
const DESTINATION_ENTITY_TYPE = "publish-destination";
const NO_DESTINATION = "No live site is set up yet. Deploy this site once, then come back here.";

/** What the destination routes answer. */
export interface PublishDestinationView {
  /** `true` once this computer's grant has been written for a site. */
  readonly connected: boolean;
  /** The connected site, as the publish list already models it. `null` when there is none. */
  readonly site: PublishContentPeerView | null;
  /** Read out of the repo's deploy config — what to offer when nothing is connected yet. */
  readonly candidateUrl: string | null;
  /** One sentence describing where things stand. */
  readonly message: string;
  /** One sentence naming what the owner does next, or `null` when nothing is pending. */
  readonly nextStep: string | null;
}

/** The host's typed handshake/grant-write error classes. */
export interface PublishDestinationErrorClasses { handshake: PublishErrorClass; notSaved: PublishErrorClass }

/** The connected peer row's public identity (never its sealed credential). */
export type PublishConnectedPeer = Pick<PublishContentPeerView, "id" | "label" | "baseUrl" | "remoteWorkspaceId">;
export type PublishConnectedPeerFn = (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<PublishConnectedPeer | null>;
export type PublishCandidateFn = (required?: Record<string, never>, optional?: Record<string, never>) => Promise<string | null>;
export type PublishableTypesFn = (required?: Record<string, never>, optional?: Record<string, never>) => readonly string[];
export type PublishDestinationConnectFn = (
  required: { workspaceId: string; baseUrl: string; entityTypes: string[] }, optional?: Record<string, never>,
) => Promise<{ site: PublishContentPeerView; grant: { nextStep: string | null } }>;
export type PublishDestinationDisconnectFn = (
  required: { workspaceId: string }, optional?: Record<string, never>,
) => Promise<{ site: Pick<PublishContentPeerView, "label" | "baseUrl"> | null; changed: boolean; target: { nextStep: string | null } }>;

interface DestinationBaseDeps { workspaceId: string; destinationErrors: PublishDestinationErrorClasses; findCandidate: PublishCandidateFn }
/** The deps each destination route reads. */
export interface DestinationReadRouteDeps extends DestinationBaseDeps { findConnectedPeer: PublishConnectedPeerFn }
export interface DestinationConnectRouteDeps extends DestinationBaseDeps { listPublishableTypes: PublishableTypesFn; connectDestination: PublishDestinationConnectFn }
export interface DestinationDisconnectRouteDeps extends DestinationBaseDeps { disconnectDestination: PublishDestinationDisconnectFn }

/** Every message passed through is already written for a person (the handshake client's own rule). */
function destinationErrorMappings(classes: PublishDestinationErrorClasses, _optional: Record<string, never> = {}): readonly PublishErrorMapping[] {
  return [
    { errorClass: classes.handshake, status: 502, code: "PUBLISH_TRUST_HANDSHAKE_FAILED" },
    { errorClass: classes.notSaved, status: 500, code: "PUBLISH_TRUST_NOT_SAVED" },
  ];
}

/** Authorizes, runs `run`, and maps the destination's typed errors; refusals and unknowns pass through. */
async function guardedDestination<T>(
  { authorize, deps, run }: { authorize: Parameters<typeof authorizePublishContent>[0]["authorize"]; deps: DestinationBaseDeps; run: () => Promise<T> },
  _optional: Record<string, never> = {},
): Promise<T> {
  try {
    await authorizePublishContent({ authorize, permission: "publish_content.apply", entityType: DESTINATION_ENTITY_TYPE });
    return await run();
  } catch (err) {
    return rejectPublishError({ err, mappings: destinationErrorMappings(deps.destinationErrors) });
  }
}

/** The site host, as a label a person recognises. The address is the identity; this is the name.
 *  @complexity O(n) in the URL length. */
function siteLabelFor({ baseUrl }: { baseUrl: string }, _options: Record<string, never> = {}): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function connectedView({ site, nextStep }: { site: PublishContentPeerView; nextStep: string | null }, _o: Record<string, never> = {}): PublishDestinationView {
  return { connected: true, site, candidateUrl: null, message: `This computer publishes to ${site.label}.`, nextStep };
}

/**
 * "Connected" is a property of the peer list, not of the grant file: a grant can be present while
 * the row is gone (a repo cloned onto a second computer) and the row is what publishing needs. The
 * credential fields are fixed here, so no stored secret can ride on the answer.
 */
async function readDestination({ deps }: { deps: DestinationReadRouteDeps }, _o: Record<string, never> = {}): Promise<PublishDestinationView> {
  const match = await deps.findConnectedPeer({ workspaceId: deps.workspaceId });
  if (match) {
    const site = { id: match.id, label: match.label, baseUrl: match.baseUrl, remoteWorkspaceId: match.remoteWorkspaceId, masked: null, hasCredential: false };
    return connectedView({ site, nextStep: null });
  }
  const candidateUrl = await deps.findCandidate();
  // The empty state is a plain sentence, never an error code — a fresh install that has never
  // deployed is the ordinary first run, not a fault.
  const message = candidateUrl ? `Publish to ${siteLabelFor({ baseUrl: candidateUrl })}?` : NO_DESTINATION;
  return { connected: false, site: null, candidateUrl, message, nextStep: null };
}

async function connect({ siteUrl, deps }: { siteUrl: string | null; deps: DestinationConnectRouteDeps }, _o: Record<string, never> = {}): Promise<PublishDestinationView> {
  const raw = siteUrl ?? (await deps.findCandidate());
  if (raw === null) rejectRoute({ status: 400, error: NO_DESTINATION, code: "NO_DESTINATION" });
  const normalized = normalizePeerBaseUrl({ raw: String(raw), hasForbiddenRawUrlCharacter });
  if ("error" in normalized) rejectRoute({ status: 400, error: "That does not look like a website address.", code: "VALIDATION_ERROR" });
  // What this source may publish is its OWN registered types, not a list anyone chooses. An empty
  // grant can do nothing, so an install with no registered contributors is refused here rather
  // than connected into something that silently publishes nothing.
  const entityTypes = [...deps.listPublishableTypes()];
  if (entityTypes.length === 0) rejectRoute({ status: 409, error: "This site has nothing that can be published yet.", code: "NO_PUBLISHABLE_TYPES" });
  const { site, grant } = await deps.connectDestination({ workspaceId: deps.workspaceId, baseUrl: normalized.baseUrl, entityTypes });
  return connectedView({ site, nextStep: grant.nextStep });
}

async function disconnect({ deps }: { deps: DestinationDisconnectRouteDeps }, _o: Record<string, never> = {}): Promise<PublishDestinationView> {
  const removed = await deps.disconnectDestination({ workspaceId: deps.workspaceId });
  const site = removed.site;
  return {
    connected: false, site: null,
    candidateUrl: site?.baseUrl ?? (await deps.findCandidate()),
    message: site ? `This computer no longer publishes to ${site.label}.` : "This computer was not publishing anywhere.",
    // Takes effect on the next deploy — the destination-side deny list is the immediate one, and it
    // is a separate action on the SITE, not on this computer. `target` is always present (the
    // reversal's own), so only `changed` decides whether to show it.
    nextStep: removed.changed ? removed.target.nextStep : null,
  };
}

export const destinationReadRoute = defineJsonRoute<Record<string, never>, PublishDestinationView, DestinationReadRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: DESTINATION_BASE,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => ok({ value: await guardedDestination({ authorize, deps, run: () => readDestination({ deps }) }) }),
});

/** A blank or non-string `siteUrl` means "use the deploy-config candidate". Read after the auth
 *  check, as before: parsing refuses nothing. */
export const destinationConnectRoute = defineJsonRoute<{ siteUrl: string | null }, PublishDestinationView, DestinationConnectRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: `${DESTINATION_BASE}/connect`,
  parse: (raw) => {
    const siteUrl = bodyRecord({ body: raw.body }).siteUrl;
    return ok({ value: { siteUrl: typeof siteUrl === "string" && siteUrl.trim() !== "" ? siteUrl : null } });
  },
  handle: async ({ input, deps, authorize }) => ok({ value: await guardedDestination({ authorize, deps, run: () => connect({ siteUrl: input.siteUrl, deps }) }) }),
}, { successStatus: 201 });

export const destinationDisconnectRoute = defineJsonRoute<Record<string, never>, PublishDestinationView, DestinationDisconnectRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: `${DESTINATION_BASE}/disconnect`,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => ok({ value: await guardedDestination({ authorize, deps, run: () => disconnect({ deps }) }) }),
});
