import { describe, expect, it } from "vitest";
import {
  asChallengeResponse,
  publishTrustChallengeRoute,
  publishTrustIdentityRoute,
  publishTrustSessionRoute,
  type PublishTrustChallengeRouteDeps,
  type PublishTrustHandshakeCopy,
  type PublishTrustIdentityRouteDeps,
  type PublishTrustSessionRouteDeps,
} from "../handshake.js";

/** @file The three unauthenticated publish-trust handshake specs: gate order, fixed refusals, the 429 with
 * `Retry-After`, the host-logged 500 and the origin rebuilt from the request facts. */

const signal = new AbortController().signal;
const noAuthorize = async () => { throw new Error("the handshake never authorizes"); };
const COPY: PublishTrustHandshakeCopy = {
  refused: { error: "refused-copy", code: "UNAUTHENTICATED" },
  noSiteKey: { error: "no-key-copy", code: "SECRET_STORE_UNCONFIGURED" },
  failed: { error: "failed-copy", code: "INTERNAL_ERROR" },
};
const FACTS = { clientAddress: "10.0.0.1", host: "dest.example", protocol: "https" };
const GOOD_BODY = { nonce: "n", sourceInstallationId: "src-1", generation: 1, capabilities: ["publish_content.apply"], signatureB64u: "s" };
const GRANT = { sourceInstallationId: "src-1" };

type Logged = { method: string; path: string; error: unknown };

/** A limiter that admits `allowed` calls and records every key. */
function limiter({ allowed = true }: { allowed?: boolean } = {}) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 60 }; } };
}

function base({ id = "dest-1" as string | null } = {}) {
  const logged: Logged[] = [];
  return { logged, installationId: async () => id, copy: COPY, logFailure: (entry: Logged) => void logged.push(entry) };
}

function identityDeps(overrides: Partial<PublishTrustIdentityRouteDeps> = {}) {
  const b = base();
  return { logged: b.logged, deps: { ...b, workspaceId: "w-1", ...overrides } as PublishTrustIdentityRouteDeps };
}

function challengeDeps(overrides: Partial<PublishTrustChallengeRouteDeps> = {}) {
  const b = base();
  const issued: string[] = [];
  const deps: PublishTrustChallengeRouteDeps = {
    ...b, limiter: limiter(),
    issueChallenge: async ({ targetInstallationId }) => { issued.push(targetInstallationId); return { nonce: "nonce-1", targetInstallationId, expiresAtIso: "2026-09-26T00:01:00.000Z" }; },
    ...overrides,
  };
  return { logged: b.logged, issued, deps };
}

function sessionDeps(overrides: Partial<PublishTrustSessionRouteDeps> = {}) {
  const b = base();
  const steps: string[] = [];
  const deps: PublishTrustSessionRouteDeps = {
    ...b, limiter: limiter(),
    findGrant: async ({ sourceInstallationId }) => { steps.push(`find:${sourceInstallationId}`); return GRANT; },
    isGrantActive: () => { steps.push("active"); return true; },
    verifyResponse: async ({ targetInstallationId }) => { steps.push(`verify:${targetInstallationId}`); return { ok: true, verified: { sourceInstallationId: "src-1", capabilities: ["publish_content.apply"], generation: 1 } }; },
    mintSession: async ({ targetInstallationId }) => { steps.push(`mint:${targetInstallationId}`); return { token: "tok", payload: { expiresAtIso: "2026-09-26T00:05:00.000Z", capabilities: ["publish_content.apply"] } }; },
    ...overrides,
  };
  return { logged: b.logged, steps, deps };
}

async function run<D>(route: { parse: (raw: never) => unknown; handle: (...args: never[]) => unknown }, deps: D, { body = {} as unknown, facts = FACTS as unknown } = {}) {
  const parsed = (route.parse as (raw: unknown) => { ok: true; value: unknown })({ params: {}, query: {}, body, facts });
  const result = await (route.handle as (a: unknown, b: unknown) => Promise<{ ok: true; value: unknown }>)({ input: parsed.value, deps, context: undefined, authorize: noAuthorize }, { signal });
  return result.value;
}

describe("publish-trust handshake specs", () => {
  it("keep their methods, paths, default status and the request-facts opt-in", () => {
    expect([publishTrustIdentityRoute.method, publishTrustIdentityRoute.path]).toEqual(["get", "/api/publish-trust/v1/identity"]);
    expect([publishTrustChallengeRoute.method, publishTrustChallengeRoute.path]).toEqual(["post", "/api/publish-trust/v1/challenge"]);
    expect([publishTrustSessionRoute.method, publishTrustSessionRoute.path]).toEqual(["post", "/api/publish-trust/v1/session"]);
    for (const route of [publishTrustIdentityRoute, publishTrustChallengeRoute, publishTrustSessionRoute]) {
      expect(route.requestFacts).toBe(true);
      expect(route.successStatus).toBeUndefined();
      expect(route.maxBodyBytes).toBeUndefined();
    }
  });

  it("refuse to parse without the host's request facts (a wiring bug, never an anonymous rate-limit key)", () => {
    expect(() => publishTrustSessionRoute.parse({ params: {}, query: {}, body: {} })).toThrow(/request facts/);
  });

  it("identity answers the id, workspace and origin, and an empty origin without a Host", async () => {
    const { deps } = identityDeps();
    expect(await run(publishTrustIdentityRoute, deps)).toEqual({ status: 200, body: { installationId: "dest-1", workspaceId: "w-1", origin: "https://dest.example" } });
    expect(await run(publishTrustIdentityRoute, deps, { facts: { clientAddress: "1", protocol: "https" } })).toEqual({ status: 200, body: { installationId: "dest-1", workspaceId: "w-1", origin: "" } });
  });

  it("every route answers the injected 503 on a keyless install", async () => {
    const keyless = base({ id: null });
    expect(await run(publishTrustIdentityRoute, { ...keyless, workspaceId: "w-1" })).toEqual({ status: 503, body: COPY.noSiteKey });
    const challenge = challengeDeps({ installationId: async () => null });
    expect(await run(publishTrustChallengeRoute, challenge.deps)).toEqual({ status: 503, body: COPY.noSiteKey });
    expect(challenge.issued).toEqual([]);
    const session = sessionDeps({ installationId: async () => null });
    expect(await run(publishTrustSessionRoute, session.deps, { body: GOOD_BODY })).toEqual({ status: 503, body: COPY.noSiteKey });
    expect(session.steps).toEqual([]);
  });

  it("challenge rate-limits per client address before minting, with Retry-After", async () => {
    const limited = limiter({ allowed: false });
    const { deps, issued } = challengeDeps({ limiter: limited });
    expect(await run(publishTrustChallengeRoute, deps)).toEqual({
      status: 429,
      body: { error: "too many publishing handshake attempts", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 60 } },
      headers: { "Retry-After": "60" },
    });
    expect(limited.keys).toEqual(["10.0.0.1"]);
    expect(issued).toEqual([]);
  });

  it("challenge issues a nonce bound to this install", async () => {
    const { deps, issued } = challengeDeps();
    expect(await run(publishTrustChallengeRoute, deps)).toEqual({ status: 200, body: { nonce: "nonce-1", targetInstallationId: "dest-1", expiresAt: "2026-09-26T00:01:00.000Z" } });
    expect(issued).toEqual(["dest-1"]);
  });

  it("session rate-limits before reading the body", async () => {
    const { deps, steps } = sessionDeps({ limiter: limiter({ allowed: false }) });
    expect(((await run(publishTrustSessionRoute, deps, { body: null })) as { status: number }).status).toBe(429);
    expect(steps).toEqual([]);
  });

  it.each([null, { nonce: "n" }, { ...GOOD_BODY, generation: 1.5 }, { ...GOOD_BODY, capabilities: [1] }, { ...GOOD_BODY, signatureB64u: 4 }])(
    "session refuses the malformed body %j before the install id or grant lookup", async (body) => {
      const { deps, steps } = sessionDeps({ installationId: async () => { throw new Error("must not be read"); } });
      expect(await run(publishTrustSessionRoute, deps, { body })).toEqual({ status: 401, body: COPY.refused });
      expect(steps).toEqual([]);
    });

  it.each([
    ["no grant", { findGrant: async () => null }],
    ["an expired grant", { isGrantActive: () => false }],
    ["a failed verification", { verifyResponse: async () => ({ ok: false as const }) }],
  ] as const)("session answers the one fixed refusal for %s", async (_name, overrides) => {
    const { deps } = sessionDeps(overrides as Partial<PublishTrustSessionRouteDeps>);
    expect(await run(publishTrustSessionRoute, deps, { body: GOOD_BODY })).toEqual({ status: 401, body: COPY.refused });
  });

  it("session verifies then mints in order and answers the token", async () => {
    const { deps, steps } = sessionDeps();
    expect(await run(publishTrustSessionRoute, deps, { body: GOOD_BODY })).toEqual({ status: 200, body: { token: "tok", expiresAt: "2026-09-26T00:05:00.000Z", capabilities: ["publish_content.apply"] } });
    expect(steps).toEqual(["find:src-1", "active", "verify:dest-1", "mint:dest-1"]);
  });

  it("any handler failure is logged through the host logger once and answers the injected 500", async () => {
    const boom = new Error("grant store exploded");
    const { deps, logged } = sessionDeps({ findGrant: async () => { throw boom; } });
    expect(await run(publishTrustSessionRoute, deps, { body: GOOD_BODY })).toEqual({ status: 500, body: COPY.failed });
    expect(logged).toEqual([{ method: "POST", path: "/api/publish-trust/v1/session", error: boom }]);
    const identity = identityDeps({ installationId: async () => { throw boom; } });
    expect(await run(publishTrustIdentityRoute, identity.deps)).toEqual({ status: 500, body: COPY.failed });
    expect(identity.logged).toEqual([{ method: "GET", path: "/api/publish-trust/v1/identity", error: boom }]);
  });

  it("asChallengeResponse narrows only a fully well-typed body", () => {
    expect(asChallengeResponse({ body: { ...GOOD_BODY, extra: 1 } })).toEqual(GOOD_BODY);
    expect(asChallengeResponse({ body: "x" })).toBeNull();
    expect(asChallengeResponse({ body: { ...GOOD_BODY, sourceInstallationId: 1 } })).toBeNull();
    expect(asChallengeResponse({ body: { ...GOOD_BODY, generation: "1" } })).toBeNull();
    expect(asChallengeResponse({ body: { ...GOOD_BODY, capabilities: "x" } })).toBeNull();
  });
});
