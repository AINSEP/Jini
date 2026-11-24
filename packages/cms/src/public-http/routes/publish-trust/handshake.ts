import { defineJsonRoute, ok, routeReply, type JsonRouteSpec, type RateLimiter, type Result, type RouteInputContext, type RouteReply } from "@jini-ai/core/contracts/server";

/**
 * @file Zero-setup publishing auth — the destination's three unauthenticated handshake routes
 * (`GET /identity`, `POST /challenge`, `POST /session` under `/api/publish-trust/v1`).
 *
 * These sit OUTSIDE `/api/admin`, and therefore outside any admin session, because a source that has
 * not yet proved anything has no credential to present. `/identity` discloses this install's id, its
 * workspace and the origin the caller reached — nothing about any grant, so the route cannot be used
 * to enumerate who may publish here or to tell a paired site from an unpaired one.
 *
 * ## Flood resistance
 *
 * `challenge` mints state for an unauthenticated caller, so it is rate limited per client address.
 * `session` is limited on the same key: it runs an Ed25519 verification, which is cheap but not
 * free, and an unbounded caller should not be able to choose how much of it this process does.
 *
 * The trust decisions (grant lookup, grant expiry, signature verification, minting) are the host's
 * own collaborators; this file owns their ORDER and the fixed answers. Every refusal body is host
 * copy (K3); every unexpected failure is logged by the host's logger and answered with the host's
 * fixed 500, never the raw error.
 */

/** A flat `{ error, code }` answer; the host supplies each one's wording. */
export interface PublishTrustHandshakeBody { readonly error: string; readonly code: string }

/** The host's fixed answers. `refused` is identical for every rejection on purpose: "unknown nonce"
 *  and "expired nonce" must not be distinguishable, and neither must "no grant configured" and "a
 *  grant that is not yours". `noSiteKey` says nothing about any grant, like `/identity`. */
export interface PublishTrustHandshakeCopy {
  readonly refused: PublishTrustHandshakeBody;
  readonly noSiteKey: PublishTrustHandshakeBody;
  readonly failed: PublishTrustHandshakeBody;
}

/** What every handshake route reads. `installationId` answers this install's own derived id, or
 *  `null` when the site has no usable key; the host resolves it once per registration. */
export interface PublishTrustHandshakeBaseDeps {
  readonly installationId: () => Promise<string | null>;
  readonly copy: PublishTrustHandshakeCopy;
  /** The host's redacting log of an unexpected failure (the real reason never reaches the caller). */
  readonly logFailure: (entry: { method: string; path: string; error: unknown }) => void;
}

/** The host's per-client limiter, shared by challenge and session (one key, one budget). */
export type PublishTrustHandshakeLimiter = Pick<RateLimiter, "check">;

/** The deps `GET /identity` reads. */
export interface PublishTrustIdentityRouteDeps extends PublishTrustHandshakeBaseDeps { readonly workspaceId: string }

/** The deps `POST /challenge` reads. */
export interface PublishTrustChallengeRouteDeps extends PublishTrustHandshakeBaseDeps {
  readonly limiter: PublishTrustHandshakeLimiter;
  issueChallenge(args: { targetInstallationId: string }): Promise<{ nonce: string; targetInstallationId: string; expiresAtIso: string }>;
}

/** A signed challenge response, narrowed from the untrusted body by {@link asChallengeResponse}. */
export interface PublishTrustChallengeResponse {
  readonly nonce: string;
  readonly sourceInstallationId: string;
  readonly generation: number;
  readonly capabilities: readonly string[];
  readonly signatureB64u: string;
}

/** The host's grant, opaque here: the spec only hands it back to the host's own checks. */
export interface PublishTrustGrantHandle { readonly sourceInstallationId: string }

/** The verified claims a session is minted from. */
export interface PublishTrustVerifiedResponse { readonly sourceInstallationId: string; readonly capabilities: readonly string[]; readonly generation: number }

/** The deps `POST /session` reads. Method syntax: the host's narrower grant/capability types bind directly. */
export interface PublishTrustSessionRouteDeps extends PublishTrustHandshakeBaseDeps {
  readonly limiter: PublishTrustHandshakeLimiter;
  findGrant(args: { sourceInstallationId: string }): Promise<PublishTrustGrantHandle | null>;
  isGrantActive(args: { grant: PublishTrustGrantHandle }): boolean;
  verifyResponse(args: { grant: PublishTrustGrantHandle; targetInstallationId: string; response: PublishTrustChallengeResponse }): Promise<{ ok: true; verified: PublishTrustVerifiedResponse } | { ok: false }>;
  mintSession(args: PublishTrustVerifiedResponse & { targetInstallationId: string }): Promise<{ token: string; payload: { expiresAtIso: string; capabilities: readonly string[] } }>;
}

/** What `parse` hands every handler: the request facts it needs, and the untrusted body. */
export interface PublishTrustHandshakeInput { readonly clientAddress: string; readonly origin: string; readonly body: unknown }

type HandshakeResult = Result<RouteReply<unknown>>;

const IDENTITY_PATH = "/api/publish-trust/v1/identity";
const CHALLENGE_PATH = "/api/publish-trust/v1/challenge";
const SESSION_PATH = "/api/publish-trust/v1/session";

/** True for an array whose every element is a string. */
function isStringArray({ value }: { value: unknown }, _optional: Record<string, never> = {}): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Narrows an untrusted request body to the challenge-response shape.
 *
 * Shape only — nothing here is a trust decision. The host's verifier re-checks every field
 * against the grant and the signature, and is fail-closed on all of them; this exists so a body
 * with a wrong-typed field produces a refusal rather than reaching the verifier as `undefined`.
 *
 * @complexity O(1).
 */
export function asChallengeResponse({ body }: { body: unknown }, _optional: Record<string, never> = {}): PublishTrustChallengeResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.nonce !== "string") return null;
  if (typeof candidate.sourceInstallationId !== "string") return null;
  if (typeof candidate.generation !== "number" || !Number.isInteger(candidate.generation)) return null;
  if (!isStringArray({ value: candidate.capabilities })) return null;
  if (typeof candidate.signatureB64u !== "string") return null;
  return {
    nonce: candidate.nonce,
    sourceInstallationId: candidate.sourceInstallationId,
    generation: candidate.generation,
    capabilities: candidate.capabilities as readonly string[],
    signatureB64u: candidate.signatureB64u,
  };
}

/** The request facts every handshake needs. This site's own origin is built from the request rather
 *  than configured, so a site behind one hostname in dev and another in production needs no second
 *  setting; no Host header means an empty origin.
 * @throws When the host mounted the spec without its request facts — a wiring bug, refused rather
 *   than rate limiting every caller under one anonymous key.
 * @complexity O(1). */
function parseHandshake(raw: RouteInputContext): Result<PublishTrustHandshakeInput> {
  const facts = raw.facts;
  if (!facts) throw new Error("publish-trust handshake: the host mounted this route without its request facts");
  const host = facts.host ?? "";
  return ok({ value: { clientAddress: facts.clientAddress, origin: host === "" ? "" : `${facts.protocol ?? ""}://${host}`, body: raw.body } });
}

/** Every handler answers instead of throwing: the real error goes to the host's log only, the
 *  caller sees the host's fixed 500. @complexity O(1) plus `run`. */
async function answered(
  { deps, method, path, run }: { deps: PublishTrustHandshakeBaseDeps; method: string; path: string; run: () => Promise<RouteReply<unknown>> },
  _optional: Record<string, never> = {},
): Promise<HandshakeResult> {
  try {
    return ok({ value: await run() });
  } catch (error) {
    deps.logFailure({ method, path, error });
    return ok({ value: routeReply<unknown>({ status: 500, body: deps.copy.failed }) });
  }
}

/** The 429 (with `Retry-After`) when this caller is over its per-address ceiling, else `null`. */
async function rateLimited({ limiter, clientAddress }: { limiter: PublishTrustHandshakeLimiter; clientAddress: string }, _optional: Record<string, never> = {}): Promise<RouteReply<unknown> | null> {
  const result = await limiter.check({ key: clientAddress });
  if (result.allowed) return null;
  return routeReply<unknown>({
    status: 429,
    body: { error: "too many publishing handshake attempts", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: result.retryAfterSeconds } },
    headers: { "Retry-After": String(result.retryAfterSeconds) },
  });
}

const reply = (status: number, body: unknown): RouteReply<unknown> => routeReply<unknown>({ status, body });

/** `GET /identity` — this install's id, workspace and origin. */
export const publishTrustIdentityRoute: JsonRouteSpec<PublishTrustHandshakeInput, RouteReply<unknown>, PublishTrustIdentityRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<PublishTrustHandshakeInput, RouteReply<unknown>, PublishTrustIdentityRouteDeps>({
    method: "get",
    path: IDENTITY_PATH,
    parse: parseHandshake,
    handle: ({ input, deps }) => answered({ deps, method: "GET", path: IDENTITY_PATH, run: async () => {
      const installationId = await deps.installationId();
      if (installationId === null) return reply(503, deps.copy.noSiteKey);
      return reply(200, { installationId, workspaceId: deps.workspaceId, origin: input.origin });
    } }),
  }),
  requestFacts: true,
};

/** `POST /challenge` — issue a nonce bound to this install's audience. */
export const publishTrustChallengeRoute: JsonRouteSpec<PublishTrustHandshakeInput, RouteReply<unknown>, PublishTrustChallengeRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<PublishTrustHandshakeInput, RouteReply<unknown>, PublishTrustChallengeRouteDeps>({
    method: "post",
    path: CHALLENGE_PATH,
    parse: parseHandshake,
    handle: ({ input, deps }) => answered({ deps, method: "POST", path: CHALLENGE_PATH, run: async () => {
      const limited = await rateLimited({ limiter: deps.limiter, clientAddress: input.clientAddress });
      if (limited) return limited;
      const targetInstallationId = await deps.installationId();
      if (targetInstallationId === null) return reply(503, deps.copy.noSiteKey);
      const record = await deps.issueChallenge({ targetInstallationId });
      // The audience travels with the nonce so the source can build the canonical string without a
      // second round trip. It is not a secret and is the same value `/identity` already states.
      return reply(200, { nonce: record.nonce, targetInstallationId: record.targetInstallationId, expiresAt: record.expiresAtIso });
    } }),
  }),
  requestFacts: true,
};

/** Grant lookup, expiry, verification and minting, in that order, for a well-shaped response.
 * @complexity O(1) plus the host's collaborators. */
async function openSession(
  { deps, response, targetInstallationId }: { deps: PublishTrustSessionRouteDeps; response: PublishTrustChallengeResponse; targetInstallationId: string },
  _optional: Record<string, never> = {},
): Promise<RouteReply<unknown>> {
  const grant = await deps.findGrant({ sourceInstallationId: response.sourceInstallationId });
  // An absent grant is the ordinary state of a site nobody has paired with, not an error. It is
  // answered with the same refusal as a bad signature so this route cannot be used to ask
  // "has anyone provisioned publishing here yet?" — nor, by naming installation ids one at a
  // time, "is THIS publisher allowed here?".
  if (!grant || !deps.isGrantActive({ grant })) return reply(401, deps.copy.refused);
  const verification = await deps.verifyResponse({ grant, targetInstallationId, response });
  if (!verification.ok) return reply(401, deps.copy.refused);
  const { sourceInstallationId, capabilities, generation } = verification.verified;
  const { token, payload } = await deps.mintSession({ sourceInstallationId, targetInstallationId, capabilities, generation });
  return reply(200, { token, expiresAt: payload.expiresAtIso, capabilities: payload.capabilities });
}

/** `POST /session` — verify the signed challenge response and mint a short-lived session token. */
export const publishTrustSessionRoute: JsonRouteSpec<PublishTrustHandshakeInput, RouteReply<unknown>, PublishTrustSessionRouteDeps> & { readonly requestFacts: true } = {
  ...defineJsonRoute<PublishTrustHandshakeInput, RouteReply<unknown>, PublishTrustSessionRouteDeps>({
    method: "post",
    path: SESSION_PATH,
    parse: parseHandshake,
    handle: ({ input, deps }) => answered({ deps, method: "POST", path: SESSION_PATH, run: async () => {
      const limited = await rateLimited({ limiter: deps.limiter, clientAddress: input.clientAddress });
      if (limited) return limited;
      const response = asChallengeResponse({ body: input.body });
      if (!response) return reply(401, deps.copy.refused);
      // Before the grant lookup: a keyless site answers 503 whatever the source, so the status cannot
      // tell a prober which installation ids hold a grant.
      const targetInstallationId = await deps.installationId();
      if (targetInstallationId === null) return reply(503, deps.copy.noSiteKey);
      return openSession({ deps, response, targetInstallationId });
    } }),
  }),
  requestFacts: true,
};
