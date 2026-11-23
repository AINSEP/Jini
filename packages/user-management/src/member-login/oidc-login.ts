/** Member-only OIDC facade. Jini owns PKCE, state expiry/bindings, exchange and JWT validation.
 * The host injects the OAuth operations, the AAD formatter and its client identity through
 * `OidcLoginDeps`; this module imports only `@jini-ai/core` and this package.
 */
import { createHash } from "node:crypto";
import { nowIso, type Clock } from "@jini-ai/core/primitives";
import type { OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";
import type { AuthorizationCallbackParams, AuthorizationStateCodec, OAuthAppOptions, OAuthClient, OAuthFlowOperations, OAuthHttpPorts,
  OAuthProviderDescriptor, OAuthRandomBytes, OAuthTokenSet, OidcIdTokenClaims, OidcSigningAlgorithm } from "@jini-ai/core/contracts/oauth";
import type { KeyringPort, SecretSealerPort } from "@jini-ai/core/contracts/vault";
import { MemberLoginError, type LoginProvider, type VerifiedLoginIdentity } from "../server/login-types.js";

/** Structural slice of the sealer-state codec factory this module calls (no core owner); stock value: `@jini-ai/oauth` `createSealerStateCodec`. */
export type CreateSealerStateCodec = (ports: {
  readonly sealer: Pick<SecretSealerPort, "seal" | "open">; readonly keyring: Pick<KeyringPort, "activeKey">; readonly aad: string;
}) => AuthorizationStateCodec;

/** Structural slice of OIDC ID-token validation this module calls (no core owner); stock value: `@jini-ai/oauth` `validateOidcIdToken`. */
export type ValidateOidcIdToken = (required: OAuthHttpPorts & {
  readonly clock: Clock; readonly tokens: OAuthTokenSet; readonly issuer: string; readonly jwksUri: string;
  readonly clientId: string; readonly expectedNonce: string | null;
}, optional?: { readonly signingAlgorithm?: OidcSigningAlgorithm; readonly timeoutMs?: number }) => Promise<OidcIdTokenClaims>;

/** Structural slice of the context-AAD formatter (no core owner); stock value: `@jini-ai/platform/secrets` `formatAad`. */
export type FormatAad = (input: { kind: string; version: string; parts: readonly string[] }) => string;

export interface OidcLoginDeps {
  readonly clock: Clock;
  readonly randomBytesFn: OAuthRandomBytes;
  readonly httpPorts: OAuthHttpPorts;
  readonly sealer: SecretSealerPort;
  readonly keyring: KeyringPort;
  readonly origin: OriginRegistryPort;
  /** Fresh activation + bundle-pinned preset lookup. Missing/disabled returns null. */
  readonly resolveProvider: (input: { workspaceId: string; providerId: string }) => Promise<LoginProvider | null>;
  readonly resolveClient: (input: { workspaceId: string; provider: LoginProvider }) => Promise<OAuthClient>;
  /** The host's OAuth client identity sent with authorization requests; there is no library default. */
  readonly appIdentity: Pick<OAuthAppOptions, "clientDisplayName" | "softwareId">;
  readonly beginAuthorizationCode: OAuthFlowOperations["beginAuthorizationCode"];
  readonly completeAuthorizationCode: OAuthFlowOperations["completeAuthorizationCode"];
  readonly createSealedAuthorizationState: OAuthFlowOperations["createSealedAuthorizationState"];
  readonly createSealerStateCodec: CreateSealerStateCodec;
  readonly validateOidcIdToken: ValidateOidcIdToken;
  readonly formatAad: FormatAad;
}

export interface LoginContext {
  readonly workspaceId: string;
  readonly providerId: string;
  /** Only a currently authenticated member session may supply this, on both legs. */
  readonly connectMemberId?: string;
}

export interface CompletedOidcLogin {
  readonly identity: VerifiedLoginIdentity;
  readonly connectMemberId?: string;
  readonly returnPath: "/account";
  readonly authenticatedAt: string;
  readonly startedAt: string;
}

function hash({ value }: { value: string }, _optional = {}): string {
  return createHash("sha256").update(value).digest("base64url");
}

function bindingContext({ input, binding }: { input: LoginContext; binding: string }, _optional = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new MemberLoginError({ code: "LOGIN_INVALID" });
  return { ownerKey: input.connectMemberId ? `member-connect:v1:${input.connectMemberId}:${binding}` : `member-login:v1:${binding}`,
    nonce: hash({ value: `nonce:${binding}` }) };
}

/** Canonical registry evidence only; URL API preserves base paths on Windows and Unix alike.
 * @throws LOGIN_UNAVAILABLE without configured origin evidence. No request headers are accepted.
 * @complexity O(1), one canonical-origin lookup.
 */
export async function memberLoginCallbackUrl(required: {
  origin: OriginRegistryPort; workspaceId: string; providerId: string;
}, _options = {}): Promise<string> {
  const origin = await required.origin.canonicalOrigin({ workspaceId: required.workspaceId });
  const base = new URL(`${origin.scheme}://${origin.host}`);
  if (origin.port) base.port = String(origin.port);
  base.pathname = origin.basePath ?? "/";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(`api/members/v1/workspaces/${encodeURIComponent(required.workspaceId)}/oidc/${encodeURIComponent(required.providerId)}/callback`, base).href;
}

function protocolProvider(provider: LoginProvider): OAuthProviderDescriptor {
  return { providerId: provider.id, label: provider.label, supportedGrants: ["authorization_code"],
    authorizationEndpoint: provider.authorizationEndpoint, tokenEndpoint: provider.tokenEndpoint,
    defaultScopes: provider.scopes, usesPkce: true, clientAuth: provider.clientAuthentication };
}

async function configuration(deps: OidcLoginDeps, input: LoginContext) {
  const provider = await deps.resolveProvider({ workspaceId: input.workspaceId, providerId: input.providerId });
  if (!provider || provider.id !== input.providerId) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  const client = await deps.resolveClient({ workspaceId: input.workspaceId, provider });
  if (client.authMethod !== provider.clientAuthentication || !client.clientId || !client.clientSecret) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  const redirectUri = await memberLoginCallbackUrl({ origin: deps.origin, ...input });
  // Bind client rotation as well as the bundled preset: old redirects cannot use replacement keys.
  const version = hash({ value: JSON.stringify([provider.configurationVersion, client.clientId, client.clientSecret, client.authMethod]) });
  return { provider, client, redirectUri, version };
}

async function sealState(required: { deps: OidcLoginDeps; plaintext: string; aad: string }, _options = {}) {
  const { deps, plaintext, aad } = required;
  const sealed = await deps.sealer.seal({ plaintext, key: await deps.keyring.activeKey({}), aad });
  return Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url");
}

/** The host's sealer, keyring and `aad` bound to the injected `createSealerStateCodec`; every open error becomes LOGIN_INVALID in the callers. */
function stateCodec({ deps, aad }: { deps: OidcLoginDeps; aad: string }, _optional = {}) {
  return deps.createSealerStateCodec({ sealer: deps.sealer, keyring: deps.keyring, aad });
}

function redirectState({ deps, input, version }: { deps: OidcLoginDeps; input: LoginContext; version: string }, _optional = {}) {
  const serverId = `${input.providerId}:${version}`;
  const aad = deps.formatAad({ kind: "member-login-state", version: "v1", parts: [JSON.stringify([input.workspaceId, serverId])] });
  return deps.createSealedAuthorizationState({ clock: deps.clock, workspaceId: input.workspaceId, serverId, codec: stateCodec({ deps, aad }) });
}

/** Begin a ten-minute redirect. HTTP owns setting the returned binding in its callback-scoped
 * HttpOnly Secure SameSite=Lax cookie; never put binding in the authorization URL.
 * @returns Authorization URL, expiry, binding and the fixed return path. Never a client secret.
 * @throws A fixed LOGIN_UNAVAILABLE code; upstream diagnostics are intentionally discarded.
 * @complexity O(1), fresh provider/client/origin reads and one site-key seal, no attempt table.
 */
export async function beginOidcLogin(required: { deps: OidcLoginDeps; input: LoginContext }, _options = {}) {
  try {
    const { deps, input } = required;
    const config = await configuration(deps, input);
    const bytes = deps.randomBytesFn({ byteLength: 32 });
    if (bytes.length !== 32) throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
    const browserBinding = Buffer.from(bytes).toString("base64url");
    const { ownerKey, nonce } = bindingContext({ input, binding: browserBinding });
    const started = await deps.beginAuthorizationCode({ provider: protocolProvider(config.provider), client: config.client,
      stateless: redirectState({ deps, input, version: config.version }), guard: deps.httpPorts.guard, randomBytesFn: deps.randomBytesFn,
      options: { clientDisplayName: deps.appIdentity.clientDisplayName, softwareId: deps.appIdentity.softwareId, redirectUris: [config.redirectUri] },
      ownerKey, redirectUri: config.redirectUri }, { scopes: config.provider.scopes, extraAuthorizationParams: { nonce } });
    return { authorizationUrl: started.authorizationUrl, expiresAt: started.expiresAt, browserBinding, returnPath: "/account" as const };
  } catch {
    throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  }
}

function authoritativeEmail({ provider, claims, domain }: { provider: LoginProvider; claims: OidcIdTokenClaims; domain: string }, _optional = {}): boolean {
  const hosted = provider.hostedDomainClaim ? claims[provider.hostedDomainClaim] : undefined;
  // The pinned issuer's hosted-domain claim establishes mailbox authority, including Workspace
  // aliases whose email domain can differ from the organization's primary hosted domain.
  return Boolean(provider.authoritativeEmailDomains?.includes(domain))
    || (typeof hosted === "string" && hosted.trim().length > 0);
}

function validEmail({ email }: { email: string }, _optional = {}): boolean {
  if (email.length > 320 || /\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0]) return false;
  const domain = parts[1];
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

function verifiedIdentity({ provider, claims, clock }: { provider: LoginProvider; claims: OidcIdTokenClaims; clock: Clock }, _optional = {}): VerifiedLoginIdentity {
  if (claims.email_verified !== true || typeof claims.email !== "string") throw new MemberLoginError({ code: "LOGIN_INVALID" });
  const email = claims.email.trim().toLowerCase();
  if (!validEmail({ email })) throw new MemberLoginError({ code: "LOGIN_INVALID" });
  if (!claims.sub || claims.sub.length > 255) throw new MemberLoginError({ code: "LOGIN_INVALID" });
  if (claims.iat > Math.floor(clock.nowMs() / 1000)) throw new MemberLoginError({ code: "LOGIN_INVALID" });
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return { providerId: provider.id, issuer: provider.issuer, subject: claims.sub, email,
    emailAuthoritative: authoritativeEmail({ provider, claims, domain }) };
}

/** Complete with independent cookie proof; Jini validates the sealed context before exchange.
 * Provider/client changes are rechecked after exchange before identity can reach member storage.
 * Tokens remain local to this call; the single-use provider code fences state replay.
 * @returns Validated identity and trusted intent, never claims/tokens/verifiers/state.
 * @throws LOGIN_INVALID for every protocol/claim/config failure, without retaining upstream causes.
 * @complexity O(1), bounded token/JWKS HTTP requests (15 seconds each) and two config reads.
 */
export async function completeOidcLogin(required: {
  deps: OidcLoginDeps; input: LoginContext & { browserBinding: string; params: AuthorizationCallbackParams };
}, _options = {}): Promise<CompletedOidcLogin> {
  try {
    const { deps, input } = required;
    const { ownerKey, nonce } = bindingContext({ input, binding: input.browserBinding });
    const config = await configuration(deps, input);
    const stateless = redirectState({ deps, input, version: config.version });
    // Preserve the validated issuance time so Trash/restore cannot revive an outstanding redirect.
    const pending = await stateless.open({ state: input.params.state, ownerKey, providerId: config.provider.id, redirectUri: config.redirectUri });
    const tokens = await deps.completeAuthorizationCode({ ...deps.httpPorts, clock: deps.clock, provider: protocolProvider(config.provider),
      client: config.client, stateless, redirectUri: config.redirectUri,
      ownerKey, params: input.params }, { timeoutMs: 15000 });
    const claims = await deps.validateOidcIdToken({ ...deps.httpPorts, clock: deps.clock, tokens, issuer: config.provider.issuer,
      jwksUri: config.provider.jwksUri, clientId: config.client.clientId, expectedNonce: nonce },
    { signingAlgorithm: config.provider.signingAlgorithm, timeoutMs: 15000 });
    const current = await configuration(deps, input);
    if (current.version !== config.version || current.redirectUri !== config.redirectUri) throw new MemberLoginError({ code: "LOGIN_INVALID" });
    // Omit an absent intent so the sealed email-code continuation round-trips the same shape.
    return { identity: verifiedIdentity({ provider: config.provider, claims, clock: deps.clock }),
      ...(input.connectMemberId === undefined ? {} : { connectMemberId: input.connectMemberId }),
      returnPath: "/account", authenticatedAt: nowIso({ clock: deps.clock }), startedAt: pending.createdAt };
  } catch {
    throw new MemberLoginError({ code: "LOGIN_INVALID" });
  }
}

function continuationAad({ deps, input, version }: { deps: OidcLoginDeps; input: LoginContext & { browserBinding: string }; version: string }, _optional = {}) {
  const { ownerKey } = bindingContext({ input, binding: input.browserBinding });
  return deps.formatAad({ kind: "member-login-email-proof", version: "v1", parts: [JSON.stringify([input.workspaceId, input.providerId, version, hash({ value: ownerKey })])] });
}

function continuationCodec({ deps, input, version }: { deps: OidcLoginDeps; input: LoginContext & { browserBinding: string }; version: string }, _optional = {}) {
  return stateCodec({ deps, aad: continuationAad({ deps, input, version }) });
}

/** Seal only the verified normalized identity for the emailed-code continuation. The callback
 * keeps its independent binding in an HttpOnly cookie scoped to the proof submission route.
 * @returns An opaque continuation; contains no OAuth tokens and needs no login-attempt table.
 * @throws LOGIN_INVALID; callers must pass only a completeOidcLogin result as `login`.
 * @complexity O(1) bounded payload seal and fresh configuration lookup.
 */
export async function sealLoginEmailContinuation(required: {
  deps: OidcLoginDeps; input: LoginContext & { browserBinding: string }; login: CompletedOidcLogin;
}, _options = {}): Promise<string> {
  try {
    const { deps, input, login } = required;
    const config = await configuration(deps, input);
    if (login.identity.providerId !== input.providerId || login.identity.issuer !== config.provider.issuer
      || login.connectMemberId !== input.connectMemberId) throw new MemberLoginError({ code: "LOGIN_INVALID" });
    const expiresAt = Date.parse(login.startedAt) + 600000;
    if (!Number.isFinite(expiresAt) || expiresAt <= deps.clock.nowMs()) throw new MemberLoginError({ code: "LOGIN_INVALID" });
    // Seal directly with the visible continuation aad so a host seal-aad check can verify this call site.
    return await sealState({ deps, plaintext: JSON.stringify({ login, expiresAt }), aad: continuationAad({ deps, input, version: config.version }) });
  } catch {
    throw new MemberLoginError({ code: "LOGIN_INVALID" });
  }
}

/** Reopen a browser/intent/configuration-bound continuation before consuming its emailed code.
 * The existing single-use challenge fences replay. Disable/client rotation invalidates this too.
 * @returns The authenticated server-issued login input; visitors cannot supply identity claims.
 * @throws LOGIN_INVALID uniformly for missing/wrong binding, tampering, expiry or changed config.
 * @complexity O(1) bounded payload open and fresh configuration lookup.
 */
export async function openLoginEmailContinuation(required: {
  deps: OidcLoginDeps; input: LoginContext & { browserBinding: string; continuation: string };
}, _options = {}): Promise<CompletedOidcLogin> {
  try {
    const { deps, input } = required;
    if (input.continuation.length > 8192) throw new MemberLoginError({ code: "LOGIN_INVALID" });
    const config = await configuration(deps, input);
    const value = JSON.parse(await continuationCodec({ deps, input, version: config.version }).open({ state: input.continuation }));
    if (!Number.isFinite(value.expiresAt) || value.expiresAt <= deps.clock.nowMs()) throw new MemberLoginError({ code: "LOGIN_INVALID" });
    if (value.expiresAt !== Date.parse(value.login.startedAt) + 600000) throw new MemberLoginError({ code: "LOGIN_INVALID" });
    if (value.login.identity.providerId !== input.providerId || value.login.identity.issuer !== config.provider.issuer
      || value.login.connectMemberId !== input.connectMemberId) throw new MemberLoginError({ code: "LOGIN_INVALID" });
    return value.login;
  } catch {
    throw new MemberLoginError({ code: "LOGIN_INVALID" });
  }
}
