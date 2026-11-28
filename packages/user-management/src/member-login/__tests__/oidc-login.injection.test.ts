import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthorizationStateCodec, OAuthTokenSet, PendingAuthorization, SealedAuthorizationState } from "@jini-ai/core/contracts/oauth";
import type { RootKeyHandle } from "@jini-ai/core/contracts/vault";
import type { LoginProvider } from "../../server/login-types.js";
import { beginOidcLogin, completeOidcLogin, memberLoginCallbackUrl, openLoginEmailContinuation, sealLoginEmailContinuation,
  type OidcLoginDeps } from "../oidc-login.js";

/** Structural fakes only: these tests pin that every OAuth/AAD effect goes through the injected
 * deps (no hidden runtime import). The real OAuth behaviour is covered by the host's suite that
 * wires the stock `@jini-ai/oauth` and `@jini-ai/platform/secrets` implementations. */
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const CALLBACK = "https://site.example/api/members/v1/workspaces/ws/oidc/google/callback";
const provider: LoginProvider = { id: "google", label: "Google", pluginId: "google-login", configurationVersion: "preset-v1",
  issuer: "https://issuer.example", authorizationEndpoint: "https://issuer.example/auth", tokenEndpoint: "https://issuer.example/token",
  jwksUri: "https://issuer.example/jwks", scopes: ["openid", "email"], signingAlgorithm: "RS256", clientAuthentication: "client_secret_post",
  pkce: "S256", credentialLabel: "label", credentialCardTarget: "target", authoritativeEmailDomains: ["example.com"] };
const pending: PendingAuthorization = { state: "sealed-state", ownerKey: "owner", providerId: "google", codeVerifier: "verifier",
  redirectUri: CALLBACK, scopes: ["openid"], createdAt: "2026-10-24T11:59:00.000Z", expiresAt: "2026-10-24T12:09:00.000Z" };
const tokens: OAuthTokenSet = { accessToken: "access", idToken: "id-token", refreshToken: null, tokenType: "Bearer", scopes: [], expiresAt: null };

function fixture() {
  const calls = { formatAad: [] as unknown[], codec: [] as unknown[], sealedState: [] as unknown[], begin: [] as unknown[],
    complete: [] as unknown[], validate: [] as unknown[], activeKey: [] as unknown[], seal: [] as unknown[] };
  const key: RootKeyHandle = { keyId: "active" };
  const codec: AuthorizationStateCodec = { seal: async () => "sealed", open: async () => "{}" };
  const stateless: SealedAuthorizationState = { seal: async () => pending, open: async () => pending };
  const guard = { assertSafeUrl: ({ raw }: { raw: string }) => new URL(raw) };
  const deps: OidcLoginDeps = {
    clock: { nowMs: () => NOW },
    randomBytesFn: ({ byteLength }) => new Uint8Array(byteLength).fill(7),
    httpPorts: { guard, fetchFn: async () => { throw new Error("no network in injection tests"); } },
    sealer: { seal: async (input) => { calls.seal.push(input); return { sealed: true } as never; }, open: async () => "{}" },
    keyring: { activeKey: async (input) => { calls.activeKey.push(input); return key; },
      deriveSigningSecret: async () => new Uint8Array(), derive: async () => new Uint8Array() },
    origin: { canonicalOrigin: async () => ({ scheme: "https", host: "site.example", verifiedAt: "2026-10-24T12:00:00.000Z", source: "workspace-setting" }),
      isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false },
    resolveProvider: async () => provider,
    resolveClient: async () => ({ clientId: "client", clientSecret: "secret", authMethod: "client_secret_post" }),
    appIdentity: { clientDisplayName: "Example members", softwareId: "example-member-login" },
    formatAad: (input) => { calls.formatAad.push(input); return `aad:${input.kind}`; },
    createSealerStateCodec: (ports) => { calls.codec.push(ports); return codec; },
    createSealedAuthorizationState: (required) => { calls.sealedState.push(required); return stateless; },
    beginAuthorizationCode: async (required, optional) => {
      calls.begin.push({ required, optional });
      return { authorizationUrl: "https://issuer.example/auth?state=sealed-state", state: "sealed-state", expiresAt: pending.expiresAt };
    },
    completeAuthorizationCode: async (required, optional) => { calls.complete.push({ required, optional }); return tokens; },
    validateOidcIdToken: async (required, optional) => {
      calls.validate.push({ required, optional });
      return { iss: provider.issuer, sub: "subject", aud: "client", iat: NOW / 1000 - 1, exp: NOW / 1000 + 300,
        email: "Person@Example.com", email_verified: true };
    },
  };
  return { deps, calls, key, codec, stateless, guard };
}

describe("member OIDC login uses only injected implementations", () => {
  it("beginOidcLogin hands the injected app identity, guard and state AAD to the injected OAuth operations", async () => {
    const f = fixture();
    const result = await beginOidcLogin({ deps: f.deps, input: { workspaceId: "ws", providerId: "google" } });
    assert.equal(result.authorizationUrl, "https://issuer.example/auth?state=sealed-state");
    assert.equal(result.returnPath, "/account");
    assert.match(result.browserBinding, /^[A-Za-z0-9_-]{43}$/);
    const [aad] = f.calls.formatAad as [{ kind: string; version: string; parts: string[] }];
    assert.equal(aad.kind, "member-login-state");
    assert.equal(aad.version, "v1");
    assert.ok(aad.parts[0]?.startsWith('["ws","google:'));
    assert.deepEqual(f.calls.codec, [{ sealer: f.deps.sealer, keyring: f.deps.keyring, aad: "aad:member-login-state" }]);
    const [sealed] = f.calls.sealedState as [{ clock: unknown; workspaceId: string; codec: unknown }];
    assert.equal(sealed.clock, f.deps.clock);
    assert.equal(sealed.workspaceId, "ws");
    assert.equal(sealed.codec, f.codec);
    const [begin] = f.calls.begin as [{ required: Record<string, unknown>; optional: Record<string, unknown> }];
    assert.deepEqual(begin.required.options, { clientDisplayName: "Example members", softwareId: "example-member-login", redirectUris: [CALLBACK] });
    assert.equal(begin.required.stateless, f.stateless);
    assert.equal(begin.required.guard, f.guard);
    assert.equal(begin.required.redirectUri, CALLBACK);
    assert.deepEqual(begin.optional.scopes, ["openid", "email"]);
  });

  it("completeOidcLogin exchanges and validates through the injected operations", async () => {
    const f = fixture();
    const result = await completeOidcLogin({ deps: f.deps, input: { workspaceId: "ws", providerId: "google",
      browserBinding: "a".repeat(43), params: { state: "sealed-state", code: "code" } } });
    assert.deepEqual(result, { identity: { providerId: "google", issuer: provider.issuer, subject: "subject", email: "person@example.com",
      emailAuthoritative: true }, returnPath: "/account", authenticatedAt: new Date(NOW).toISOString(), startedAt: pending.createdAt });
    const [complete] = f.calls.complete as [{ required: Record<string, unknown>; optional: unknown }];
    assert.equal(complete.required.stateless, f.stateless);
    assert.equal(complete.required.redirectUri, CALLBACK);
    assert.deepEqual(complete.optional, { timeoutMs: 15000 });
    const [validate] = f.calls.validate as [{ required: Record<string, unknown>; optional: unknown }];
    assert.equal(validate.required.tokens, tokens);
    assert.equal(validate.required.issuer, provider.issuer);
    assert.equal(validate.required.jwksUri, provider.jwksUri);
    assert.match(String(validate.required.expectedNonce), /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(validate.optional, { signingAlgorithm: "RS256", timeoutMs: 15000 });
  });

  it("sealLoginEmailContinuation seals under the injected email-proof AAD with the keyring's active key", async () => {
    const f = fixture();
    const login = { identity: { providerId: "google", issuer: provider.issuer, subject: "subject", email: "person@example.com",
      emailAuthoritative: true }, returnPath: "/account" as const, authenticatedAt: pending.createdAt, startedAt: pending.createdAt };
    const sealed = await sealLoginEmailContinuation({ deps: f.deps, input: { workspaceId: "ws", providerId: "google",
      browserBinding: "a".repeat(43) }, login });
    assert.equal(Buffer.from(sealed, "base64url").toString("utf8"), '{"sealed":true}');
    assert.deepEqual(f.calls.activeKey, [{}]);
    const [seal] = f.calls.seal as [{ key: unknown; aad: string; plaintext: string }];
    assert.equal(seal.key, f.key);
    assert.equal(seal.aad, "aad:member-login-email-proof");
    assert.equal(JSON.parse(seal.plaintext).expiresAt, Date.parse(pending.createdAt) + 600000);
    assert.equal((f.calls.formatAad as [{ kind: string }])[0].kind, "member-login-email-proof");
  });
});

/** Strict sealing fakes for the refusal/continuation cases: the AAD names every bound part, the
 * sealer records it next to the plaintext, and the codec opens only under the identical AAD. */
function boundFixture() {
  const f = fixture();
  let nowMs = NOW;
  const providerReads: string[] = [];
  const deps: OidcLoginDeps = { ...f.deps,
    clock: { nowMs: () => nowMs },
    resolveProvider: async (input) => { providerReads.push(input.providerId); return provider; },
    formatAad: (input) => JSON.stringify(input),
    sealer: { ...f.deps.sealer, seal: async ({ plaintext, key, aad }) =>
      ({ keyId: key.keyId, ciphertext: Buffer.from(plaintext, "utf8").toString("base64"), nonce: aad, alg: "fake" }) },
    createSealerStateCodec: ({ aad }) => ({ seal: async () => "unused", open: async ({ state }) => {
      const sealed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { ciphertext: string; nonce: string };
      if (sealed.nonce !== aad) throw new Error("aad mismatch");
      return Buffer.from(sealed.ciphertext, "base64").toString("utf8");
    } }),
  };
  const input = { workspaceId: "ws", providerId: "google", browserBinding: "a".repeat(43) };
  const login = { identity: { providerId: "google", issuer: provider.issuer, subject: "subject", email: "person@example.com",
    emailAuthoritative: true }, returnPath: "/account" as const, authenticatedAt: pending.createdAt, startedAt: pending.createdAt };
  /** Re-seal an arbitrary payload under the AAD a genuine continuation for `input` used. */
  async function craft(payload: unknown): Promise<string> {
    const genuine = await sealLoginEmailContinuation({ deps, input, login });
    const { nonce } = JSON.parse(Buffer.from(genuine, "base64url").toString("utf8")) as { nonce: string };
    const sealed = await deps.sealer.seal({ plaintext: JSON.stringify(payload), key: f.key, aad: nonce });
    return Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url");
  }
  return { ...f, deps, input, login, craft, providerReads, setNow: (ms: number) => { nowMs = ms; } };
}

const invalid = { name: "MemberLoginError", code: "LOGIN_INVALID" };
const unavailable = { name: "MemberLoginError", code: "LOGIN_UNAVAILABLE" };

describe("memberLoginCallbackUrl", () => {
  const origin = (extra: { port?: number; basePath?: string }) => ({ ...fixture().deps.origin,
    canonicalOrigin: async () => ({ scheme: "https" as const, host: "site.example", verifiedAt: "x", source: "workspace-setting" as const, ...extra }) });
  it("keeps an explicit port and the base path, adding the trailing slash only when it is missing", async () => {
    assert.equal(await memberLoginCallbackUrl({ origin: origin({ port: 8443, basePath: "/sub" }), workspaceId: "w s", providerId: "g/x" }),
      "https://site.example:8443/sub/api/members/v1/workspaces/w%20s/oidc/g%2Fx/callback");
    assert.equal(await memberLoginCallbackUrl({ origin: origin({ basePath: "/sub/" }), workspaceId: "ws", providerId: "google" }),
      "https://site.example/sub/api/members/v1/workspaces/ws/oidc/google/callback");
  });
});

describe("beginOidcLogin refusals collapse to LOGIN_UNAVAILABLE", () => {
  const cases: Array<[string, (deps: OidcLoginDeps) => OidcLoginDeps]> = [
    ["the provider is not active", (d) => ({ ...d, resolveProvider: async () => null })],
    ["the resolved provider is a different one", (d) => ({ ...d, resolveProvider: async () => ({ ...provider, id: "other" }) })],
    ["the client uses another auth method", (d) => ({ ...d, resolveClient: async () => ({ clientId: "client", clientSecret: "secret", authMethod: "client_secret_basic" }) })],
    ["the client id is blank", (d) => ({ ...d, resolveClient: async () => ({ clientId: "", clientSecret: "secret", authMethod: "client_secret_post" }) })],
    ["the client secret is missing", (d) => ({ ...d, resolveClient: async () => ({ clientId: "client", clientSecret: "", authMethod: "client_secret_post" }) })],
    ["the random source returns a short buffer", (d) => ({ ...d, randomBytesFn: () => new Uint8Array(31) })],
    ["the OAuth begin operation fails upstream", (d) => ({ ...d, beginAuthorizationCode: async () => { throw new Error("upstream detail"); } })],
  ];
  it.each(cases)("refuses when %s, before any authorization request leaks", async (_name, change) => {
    const f = fixture();
    const deps = change(f.deps);
    await assert.rejects(beginOidcLogin({ deps, input: { workspaceId: "ws", providerId: "google" } }), { ...unavailable, message: "LOGIN_UNAVAILABLE" });
    assert.deepEqual(f.calls.begin, []);
  });

  it("binds a connect leg to the member and a sign-in leg to the browser only", async () => {
    const f = fixture();
    await beginOidcLogin({ deps: f.deps, input: { workspaceId: "ws", providerId: "google", connectMemberId: "m1" } });
    await beginOidcLogin({ deps: f.deps, input: { workspaceId: "ws", providerId: "google" } });
    const binding = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");
    const owners = (f.calls.begin as Array<{ required: { ownerKey: string } }>).map(call => call.required.ownerKey);
    assert.deepEqual(owners, [`member-connect:v1:m1:${binding}`, `member-login:v1:${binding}`]);
  });
});

type Claims = Awaited<ReturnType<OidcLoginDeps["validateOidcIdToken"]>>;
const goodClaims: Claims = { iss: provider.issuer, sub: "subject", aud: "client", iat: NOW / 1000 - 1, exp: NOW / 1000 + 300,
  email: "Person@Example.com", email_verified: true };
const callbackInput = { workspaceId: "ws", providerId: "google", browserBinding: "a".repeat(43), params: { state: "sealed-state", code: "code" } };

async function completeWith(claims: Claims, change: (deps: OidcLoginDeps) => OidcLoginDeps = (d) => d) {
  const f = fixture();
  return completeOidcLogin({ deps: change({ ...f.deps, validateOidcIdToken: async () => claims }), input: callbackInput });
}

describe("completeOidcLogin refuses unverifiable identities with LOGIN_INVALID", () => {
  const refused: Array<[string, Claims]> = [
    ["an unverified email", { ...goodClaims, email_verified: false }],
    ["a non-string email", { ...goodClaims, email: 42 }],
    ["an email with whitespace", { ...goodClaims, email: "a b@example.com" }],
    ["an email over 320 characters", { ...goodClaims, email: `${"a".repeat(310)}@example.com` }],
    ["an email with two @", { ...goodClaims, email: "a@b@example.com" }],
    ["an email with an empty local part", { ...goodClaims, email: "@example.com" }],
    ["a domain without a dot", { ...goodClaims, email: "a@localhost" }],
    ["a domain ending in a dot", { ...goodClaims, email: "a@example." }],
    ["an empty subject", { ...goodClaims, sub: "" }],
    ["a subject over 255 characters", { ...goodClaims, sub: "s".repeat(256) }],
    ["a token issued in the future", { ...goodClaims, iat: NOW / 1000 + 1 }],
  ];
  it.each(refused)("refuses %s", async (_name, claims) => {
    await assert.rejects(completeWith(claims), invalid);
  });

  it("refuses a malformed browser binding before any provider read", async () => {
    const f = fixture();
    let reads = 0;
    const deps = { ...f.deps, resolveProvider: async () => { reads += 1; return provider; } };
    await assert.rejects(completeOidcLogin({ deps, input: { ...callbackInput, browserBinding: "short" } }), invalid);
    assert.equal(reads, 0);
  });

  it("refuses when the client rotates or the canonical origin moves between the exchange and the recheck", async () => {
    let clientReads = 0;
    await assert.rejects(completeWith(goodClaims, (d) => ({ ...d, resolveClient: async () => {
      clientReads += 1;
      return { clientId: "client", clientSecret: clientReads === 1 ? "secret" : "rotated", authMethod: "client_secret_post" };
    } })), invalid);
    assert.equal(clientReads, 2);
    let originReads = 0;
    await assert.rejects(completeWith(goodClaims, (d) => ({ ...d, origin: { ...d.origin, canonicalOrigin: async () => {
      originReads += 1;
      return { scheme: "https", host: originReads === 1 ? "site.example" : "moved.example", verifiedAt: "x", source: "workspace-setting" };
    } } })), invalid);
    assert.equal(originReads, 2);
  });
});

describe("completeOidcLogin email authority and intent", () => {
  it("treats an unlisted domain as non-authoritative unless the hosted-domain claim is non-blank", async () => {
    const other = { ...goodClaims, email: "a@other.example" };
    const { authoritativeEmailDomains: _listed, ...noListedDomains } = provider;
    assert.equal((await completeWith(other)).identity.emailAuthoritative, false);
    const hosted = (claim: unknown) => completeWith({ ...other, hd: claim }, (d) => ({ ...d,
      resolveProvider: async () => ({ ...noListedDomains, hostedDomainClaim: "hd" }) }));
    assert.equal((await hosted("other.example")).identity.emailAuthoritative, true);
    assert.equal((await hosted("   ")).identity.emailAuthoritative, false);
    assert.equal((await hosted(undefined)).identity.emailAuthoritative, false);
  });

  it("carries a connect intent through to the completed login", async () => {
    const f = fixture();
    const result = await completeOidcLogin({ deps: f.deps, input: { ...callbackInput, connectMemberId: "m1" } });
    assert.equal(result.connectMemberId, "m1");
    assert.equal(result.identity.subject, "subject");
  });
});

describe("email continuation seal and open", () => {
  it("round-trips the exact login for the same browser, intent and configuration", async () => {
    const f = boundFixture();
    const continuation = await sealLoginEmailContinuation({ deps: f.deps, input: f.input, login: f.login });
    assert.deepEqual(await openLoginEmailContinuation({ deps: f.deps, input: { ...f.input, continuation } }), f.login);
  });

  it("refuses to open under another browser binding, another intent, after expiry or when oversized", async () => {
    const f = boundFixture();
    const continuation = await sealLoginEmailContinuation({ deps: f.deps, input: f.input, login: f.login });
    await assert.rejects(openLoginEmailContinuation({ deps: f.deps, input: { ...f.input, browserBinding: "b".repeat(43), continuation } }), invalid);
    await assert.rejects(openLoginEmailContinuation({ deps: f.deps, input: { ...f.input, connectMemberId: "m1", continuation } }), invalid);
    f.providerReads.length = 0;
    await assert.rejects(openLoginEmailContinuation({ deps: f.deps, input: { ...f.input, continuation: "x".repeat(8193) } }), invalid);
    assert.deepEqual(f.providerReads, []);
    f.setNow(Date.parse(pending.createdAt) + 600000);
    await assert.rejects(openLoginEmailContinuation({ deps: f.deps, input: { ...f.input, continuation } }), invalid);
  });

  it("refuses a sealed payload whose expiry, provider, issuer or intent does not match", async () => {
    const f = boundFixture();
    const expiresAt = Date.parse(pending.createdAt) + 600000;
    const open = async (payload: unknown) => openLoginEmailContinuation({ deps: f.deps, input: { ...f.input, continuation: await f.craft(payload) } });
    assert.deepEqual(await open({ login: f.login, expiresAt }), f.login);
    await assert.rejects(open({ login: f.login, expiresAt: null }), invalid);
    await assert.rejects(open({ login: f.login, expiresAt: expiresAt + 1 }), invalid);
    await assert.rejects(open({ login: { ...f.login, identity: { ...f.login.identity, providerId: "other" } }, expiresAt }), invalid);
    await assert.rejects(open({ login: { ...f.login, identity: { ...f.login.identity, issuer: "https://evil.example" } }, expiresAt }), invalid);
    await assert.rejects(open({ login: { ...f.login, connectMemberId: "m1" }, expiresAt }), invalid);
  });

  it("refuses to seal a login for another provider, issuer or intent, or one older than ten minutes", async () => {
    const f = boundFixture();
    const seal = (login: typeof f.login & { connectMemberId?: string }) => sealLoginEmailContinuation({ deps: f.deps, input: f.input, login });
    await assert.rejects(seal({ ...f.login, identity: { ...f.login.identity, providerId: "other" } }), invalid);
    await assert.rejects(seal({ ...f.login, identity: { ...f.login.identity, issuer: "https://evil.example" } }), invalid);
    await assert.rejects(seal({ ...f.login, connectMemberId: "m1" }), invalid);
    await assert.rejects(seal({ ...f.login, startedAt: "not a date" }), invalid);
    f.setNow(Date.parse(pending.createdAt) + 600000);
    await assert.rejects(seal(f.login), invalid);
  });
});
