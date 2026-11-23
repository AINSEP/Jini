import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthorizationStateCodec, OAuthTokenSet, PendingAuthorization, SealedAuthorizationState } from "@jini-ai/core/contracts/oauth";
import type { RootKeyHandle } from "@jini-ai/core/contracts/vault";
import type { LoginProvider } from "../../server/login-types.js";
import { beginOidcLogin, completeOidcLogin, sealLoginEmailContinuation, type OidcLoginDeps } from "../oidc-login.js";

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
