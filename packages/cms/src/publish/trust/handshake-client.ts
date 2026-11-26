import { PublishTrustHandshakeError } from "./handshake-error.js";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";

import { buildChallengeMessage } from "./challenge.js";
import { DEFAULT_PUBLISHING_CAPABILITIES, type PublishingCapability } from "./grant.js";
import { deriveInstallationId, derivePublishSigningKey } from "./keys.js";

/**
 * @file Zero-setup publishing auth — the SOURCE's half of the handshake.
 * Design note: `ADS-memory/reports/2026-09-19-publish-zero-setup-auth-design.md`.
 *
 * The mirror of `@jini-ai/cms/public-http/routes/publish-trust/handshake` (registered by the host's publish-trust composition): that file is what a
 * destination answers, this one is what a source asks. Three calls, no stored credential:
 *
 * 1. `GET /identity` — learn who the destination is. This is what removes "type your workspace id"
 *    from the flow: the source reads the destination's own answer instead of the owner reading it
 *    off a screen.
 * 2. `POST /challenge` — take a single-use nonce.
 * 3. `POST /session` — sign the nonce with the key DERIVED from this install's site key and
 *    exchange the signature for a short-lived session token.
 *
 * ## Nothing here is stored, displayed or copied
 *
 * The signing key is derived per call by {@link derivePublishSigningKey} and dies with the
 * function's stack frame; the session token lives for minutes and never leaves the process except
 * as one `Authorization` header. There is no field on any type in this file that a UI could render
 * as "your key", which is the property the whole feature exists to hold.
 *
 * ## Every message in this file is written for a person
 *
 * A refusal on this path reaches the owner in a dialog, so {@link PublishTrustHandshakeError}
 * carries a sentence, never a protocol reason. In particular the destination's own internal
 * "no accepted public key for the claimed generation" is never surfaced — the destination refuses
 * every handshake failure identically anyway, so the source cannot tell those cases apart and must
 * not pretend to. `not-connected` is the one that matters: it means "deploy once", and saying that
 * is the difference between a working flow and a support request.
 *
 * ## The host owns the wire vocabulary
 *
 * The signed message version, the name a person reads for "a peer site", and the failure class for
 * "this is not one" are a product's pinned values, so they arrive as {@link PublishTrustWire} rather
 * than being spelled here. Changing any of them is a wire change for every existing peer.
 */

/** Where the destination's handshake routes live. Must match `handshake.ts`'s own mount path. */
export const PUBLISH_TRUST_HANDSHAKE_BASE = "/api/publish-trust/v1";

/**
 * The rotation generation this source signs with.
 *
 * A constant, not a setting: rotation here is a counter, and the counter only ever moves when the
 * site key itself is regenerated — at which point the DERIVED key changes anyway, so bumping the
 * generation would buy nothing and would strand the grant that names generation 1. It exists as a
 * named constant so the grant writer and the signer cannot disagree about it.
 */
export const PUBLISH_TRUST_GENERATION = 1;

/** Per-call timeout for a handshake leg. Far shorter than a bundle upload: these are three small
 *  JSON round trips, and a wedged destination must not hold an admin request open. */
export const HANDSHAKE_TIMEOUT_MS = 15_000;

/** How much of a destination's response body an error may quote. Bounded because it is another
 *  process's output. Only ever used for the "this is not a peer site" diagnosis, never for a
 *  refusal — a refusal's wording is this file's, so it cannot leak the destination's vocabulary. */
const MAX_QUOTED_BODY = 200;

/** What a destination says about itself. Not secret — see `handshake.ts`'s header for the reasoning
 *  on each field. */
export interface DestinationIdentity {
  readonly installationId: string;
  /** The destination's OWN workspace id — what every publish URL to it is built from. */
  readonly workspaceId: string;
  /** The origin as the destination saw the request arrive on. */
  readonly origin: string;
}

/** A minted publishing session. `token` is the wire credential for exactly one publish run. */
export interface PublishSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly capabilities: readonly PublishingCapability[];
  /** Who answered. Carried out so a caller can compare it against what it connected to. */
  readonly identity: DestinationIdentity;
}

/** The one HTTP shape this file sends through. Narrow on purpose: the host passes its guarded egress
 *  client, and nothing here constructs, wraps or relaxes it. */
export interface PublishHandshakeHttpPort {
  send(
    request: HttpRequest,
    options?: { redirect?: "follow" | "error" | "manual" },
  ): Promise<HttpResponse>;
}

/** The host's pinned handshake vocabulary — see this file's header. */
export interface PublishTrustWire {
  readonly messageVersion: string;
  readonly peerSiteLabel: string;
  readonly notPeerFailure: `not-a-${string}-site`;
}

export interface HandshakeClientDeps {
  /** The guarded ADR-038 egress client — the same one peer pushes go through, so the SSRF policy
   *  is identical on both paths and there is no second HTTP seam to configure. */
  readonly httpClient: PublishHandshakeHttpPort;
  readonly protocol: PublishTrustWire;
}

/** The host part of a base URL, for a message a person reads. Falls back to the whole string when
 *  it somehow does not parse (it is normalized before it reaches here).
 *  @complexity O(n) in the URL length. */
function siteNameOf({ baseUrl }: { baseUrl: string }, _optional = {}): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** True when a destination's 503 body carries the code `handshake.ts` sends for a missing site key.
 *  Only the code is read; the destination's own wording never reaches the owner.
 *  @complexity O(n) in the body length. */
function isNoSiteKeyBody({ bodyText }: { bodyText: string }, _optional = {}): boolean {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return typeof parsed === "object" && parsed !== null && (parsed as { code?: unknown }).code === "SECRET_STORE_UNCONFIGURED";
  } catch {
    return false;
  }
}

/** The one "answered, but not a peer site" refusal, for a host already reduced to its name.
 *  @complexity O(1). */
function notAPeerSite({ site, protocol }: { site: string; protocol: PublishTrustWire }, _optional = {}): PublishTrustHandshakeError {
  return new PublishTrustHandshakeError({ message: `${site} answered, but it does not look like ${protocol.peerSiteLabel}.`, failure: protocol.notPeerFailure });
}

/** @complexity O(1). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Sends one handshake request through the guarded egress client.
 *
 * @throws {PublishTrustHandshakeError} `unreachable` when the transport itself fails.
 * @complexity O(1) plus one round trip.
 */
async function sendHandshake({ deps, request, site }: { deps: HandshakeClientDeps; request: { method: "GET" | "POST"; baseUrl: string; path: string; body?: unknown }; site: string }, _optional = {}): Promise<HttpResponse> {
  try {
    return await deps.httpClient.send({
      method: request.method,
      url: `${request.baseUrl}${PUBLISH_TRUST_HANDSHAKE_BASE}${request.path}`,
      headers: request.body === undefined ? {} : { "content-type": "application/json" },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      timeoutMs: HANDSHAKE_TIMEOUT_MS,
    });
  } catch (err) {
    throw new PublishTrustHandshakeError({ message: `${site} could not be reached: ${err instanceof Error ? err.message : String(err)}`, failure: "unreachable" });
  }
}

/**
 * The owner-facing error a non-2xx status maps to, or `null` for a 2xx.
 *
 * @complexity O(n) in the body length (only a 503 body is read).
 */
function statusError({ site, response, protocol }: { site: string; response: HttpResponse; protocol: PublishTrustWire }, _optional = {}): PublishTrustHandshakeError | null {
  if (response.status === 404) {
    return new PublishTrustHandshakeError({ message: `${site} answered, but it does not look like ${protocol.peerSiteLabel}. Check the address.`, failure: protocol.notPeerFailure });
  }
  if (response.status === 401) {
    // The destination refuses every handshake failure with one flat 401 on purpose, so this source
    // genuinely cannot tell "no grant here" from "bad signature" — and must not guess. The sentence
    // names the only action that resolves any of them.
    return new PublishTrustHandshakeError({ message: `${site} doesn't recognise this computer yet. Connect it, then deploy the site once.`, failure: "not-connected" });
  }
  if (response.status === 503 && isNoSiteKeyBody({ bodyText: response.bodyText })) {
    // `handshake.ts` answers this when the destination has no usable site key. No retry fixes it,
    // so the sentence names the fix instead of "try again".
    return new PublishTrustHandshakeError({ message: `${site} has no Site key set up yet, so it cannot accept publishes. Set one up on that site, then try again.`, failure: "refused" });
  }
  if (response.status < 200 || response.status >= 300) {
    return new PublishTrustHandshakeError({ message: `${site} refused to set up publishing right now. Try again in a moment.`, failure: "refused" });
  }
  return null;
}

/**
 * Parses a 2xx body as a JSON object.
 *
 * @throws {PublishTrustHandshakeError} the host's not-a-peer failure for non-JSON (quoting at most
 *   {@link MAX_QUOTED_BODY} characters) or for JSON that is not an object.
 * @complexity O(n) in the body length.
 */
function parseHandshakeBody({ site, bodyText, protocol }: { site: string; bodyText: string; protocol: PublishTrustWire }, _optional = {}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new PublishTrustHandshakeError({ message: `${site} answered, but it does not look like ${protocol.peerSiteLabel} (${bodyText.slice(0, MAX_QUOTED_BODY)}).`, failure: protocol.notPeerFailure });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw notAPeerSite({ site, protocol });
  return parsed as Record<string, unknown>;
}

/**
 * One handshake call, with every failure already turned into a sentence.
 *
 * @returns The parsed JSON body.
 * @throws {PublishTrustHandshakeError} for every failure — this function never lets a raw transport
 * error or a destination's own wording escape.
 * @complexity O(1) plus one round trip and one JSON parse.
 */
async function callHandshake(
  { deps, request }: {
    deps: HandshakeClientDeps;
    request: { method: "GET" | "POST"; baseUrl: string; path: string; body?: unknown };
  },
  _optional = {}
): Promise<Record<string, unknown>> {
  const site = siteNameOf({ baseUrl: request.baseUrl });
  const response = await sendHandshake({ deps, request, site });
  const refusal = statusError({ site, response, protocol: deps.protocol });
  if (refusal !== null) throw refusal;
  return parseHandshakeBody({ site, bodyText: response.bodyText, protocol: deps.protocol });
}

/**
 * Asks a destination who it is.
 *
 * This is the call that makes the flow zero-concept: `workspaceId` is the one value the old peer
 * form made a human find and retype, and the destination already knows it.
 *
 * @param input.baseUrl - A normalized `https` origin (`normalizePeerBaseUrl`'s output).
 * @throws {PublishTrustHandshakeError} `unreachable` / the host's not-a-peer failure.
 * @complexity O(1) plus one round trip.
 */
export async function fetchDestinationIdentity(
  { deps, input }: {
    deps: HandshakeClientDeps;
    input: { baseUrl: string };
  },
  _optional = {}
): Promise<DestinationIdentity> {
  const body = await callHandshake({ deps, request: { method: "GET", baseUrl: input.baseUrl, path: "/identity" } });
  const { installationId, workspaceId, origin } = body;
  if (!isNonEmptyString(installationId) || !isNonEmptyString(workspaceId)) throw notAPeerSite({ site: siteNameOf({ baseUrl: input.baseUrl }), protocol: deps.protocol });
  return { installationId, workspaceId, origin: typeof origin === "string" ? origin : input.baseUrl };
}

/**
 * Proves possession of this install's site key to a destination and takes a publishing session.
 *
 * The private half of the signing key exists only inside this call: {@link derivePublishSigningKey}
 * rebuilds it from the site key, signs one nonce, and the closure is collected. Between two
 * publishes there is nothing on disk to steal, rotate or copy.
 *
 * `targetOrigin` in the derivation is `input.baseUrl` VERBATIM, and the grant written at connect
 * time must use the same string — a signature derived for one spelling of the destination verifies
 * against no other, which is the property that stops a captured response being replayed at a
 * different site (`keys.ts`).
 *
 * @param input.baseUrl - The destination, normalized. Also the key-derivation audience.
 * @param input.workspaceId - THIS install's workspace. Never the destination's: it selects which
 * site key derives the key.
 * @throws {PublishTrustHandshakeError} — every failure, already a sentence.
 * @complexity O(1) plus three round trips, two HKDFs and one Ed25519 signature.
 */
export async function openPublishSession(
  { deps, input }: {
    deps: HandshakeClientDeps & { readonly keyring: KeyringPort };
    input: { baseUrl: string; workspaceId: string; generation?: number; backstop?: boolean };
  },
  _optional = {}
): Promise<PublishSession> {
  const generation = input.generation ?? PUBLISH_TRUST_GENERATION;
  const identity = await fetchDestinationIdentity({ deps, input });

  const challenge = await callHandshake({ deps, request: { method: "POST", baseUrl: input.baseUrl, path: "/challenge", body: {} } });
  const { nonce, targetInstallationId } = challenge;
  if (!isNonEmptyString(nonce) || !isNonEmptyString(targetInstallationId)) throw notAPeerSite({ site: siteNameOf({ baseUrl: input.baseUrl }), protocol: deps.protocol });

  const sourceInstallationId = await deriveInstallationId({ keyring: deps.keyring, workspaceId: input.workspaceId });
  const signingKey = await derivePublishSigningKey({
    keyring: deps.keyring,
    workspaceId: input.workspaceId,
    sourceInstallationId,
    targetOrigin: input.baseUrl,
    generation,
  });

  const capabilities: readonly PublishingCapability[] = input.backstop
    ? [...DEFAULT_PUBLISHING_CAPABILITIES, "publish_content.backstop"] : DEFAULT_PUBLISHING_CAPABILITIES;
  const signatureB64u = signingKey.sign({ message: buildChallengeMessage({ messageVersion: deps.protocol.messageVersion, nonce, targetInstallationId, sourceInstallationId, generation, capabilities }) });

  const minted = await callHandshake({
    deps,
    request: {
      method: "POST",
      baseUrl: input.baseUrl,
      path: "/session",
      body: { nonce, sourceInstallationId, generation, capabilities, signatureB64u },
    },
  });
  const token = minted.token;
  if (!isNonEmptyString(token)) throw notAPeerSite({ site: siteNameOf({ baseUrl: input.baseUrl }), protocol: deps.protocol });

  return sessionFrom({ token, minted, requested: capabilities, identity });
}

/**
 * Builds the session from the session leg's body: a missing expiry reads as `""`, and the
 * destination's capability list (string entries only) wins over what was requested when present.
 *
 * @complexity O(n) in the returned capability count.
 */
function sessionFrom({ token, minted, requested, identity }: {
  token: string;
  minted: Record<string, unknown>;
  requested: readonly PublishingCapability[];
  identity: DestinationIdentity;
}): PublishSession {
  return {
    token,
    expiresAt: typeof minted.expiresAt === "string" ? minted.expiresAt : "",
    capabilities: Array.isArray(minted.capabilities)
      ? (minted.capabilities.filter((c) => typeof c === "string") as PublishingCapability[])
      : requested,
    identity,
  };
}
