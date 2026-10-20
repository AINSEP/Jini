import { describe, expect, test } from "vitest";

import { createSessionForPrincipal, login, logout, validateSession, type AuthServiceDeps } from "../auth-service.js";
import { AuthInvalidCredentialsError, type PrincipalStatus } from "../../core/types.js";
import type { UserManagementMessages } from "../messages.js";
import { buildTraceHarness, WORKSPACE, type TraceHarness } from "./identity-call-trace.fixture.js";

/**
 * @file Characterization pins for `auth-service.ts` (L118b), written against the pre-refactor code.
 *
 * Every refusal branch of `login` is pinned with its exact error class + message AND the exact
 * port-call trace, so a refactor that reorders a lookup, short-circuits differently, or leaks a
 * different message per failure (a user-enumeration signal) fails here.
 */

const CUSTOM: UserManagementMessages = { invalidCredentials: "custom-bad-creds", invalidSessionTtl: "custom-bad-ttl" };

function depsOf(h: TraceHarness): AuthServiceDeps {
  return { repos: h.repos, hasher: h.hasher, clock: h.clock, idGen: h.idGen, tokens: h.tokens };
}

async function addUser(h: TraceHarness, options: { status?: PrincipalStatus; withPrincipal?: boolean } = {}): Promise<void> {
  if (options.withPrincipal !== false) {
    await h.repos.principals.save({
      id: "p-1",
      workspaceId: WORKSPACE,
      kind: "user",
      displayName: "Ed",
      status: options.status ?? "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  await h.repos.users.save({ principalId: "p-1", workspaceId: WORKSPACE, username: "ed", passwordHash: "hash:pw" });
  h.calls.length = 0;
}

async function loginRefusal(
  h: TraceHarness,
  input: { username: string; password: string },
  optional: { messages?: UserManagementMessages } = {},
): Promise<unknown> {
  return login({ deps: depsOf(h), input: { workspaceId: WORKSPACE, ...input } }, optional).then(
    () => "resolved",
    (error: unknown) => error,
  );
}

describe("login refusals", () => {
  const cases: Array<{ name: string; setup: { status?: PrincipalStatus; withPrincipal?: boolean } | null; input: { username: string; password: string }; trace: string[] }> = [
    { name: "blank username (whitespace only)", setup: {}, input: { username: "   ", password: "pw" }, trace: [] },
    { name: "empty password", setup: {}, input: { username: "ed", password: "" }, trace: [] },
    { name: "unknown username", setup: null, input: { username: "ed", password: "pw" }, trace: ["users.findByUsername"] },
    { name: "user row with no principal", setup: { withPrincipal: false }, input: { username: "ed", password: "pw" }, trace: ["users.findByUsername", "principals.findById"] },
    { name: "disabled principal (password correct)", setup: { status: "disabled" }, input: { username: "ed", password: "pw" }, trace: ["users.findByUsername", "principals.findById"] },
    { name: "wrong password", setup: {}, input: { username: "ed", password: "nope" }, trace: ["users.findByUsername", "principals.findById", "hasher.verify"] },
  ];

  for (const c of cases) {
    test(`${c.name}: default message, exact trace, no session written`, async () => {
      const h = buildTraceHarness();
      if (c.setup) await addUser(h, c.setup);
      const error = await loginRefusal(h, c.input);
      expect(error).toBeInstanceOf(AuthInvalidCredentialsError);
      expect((error as Error).message).toBe("invalid username or password");
      expect(h.calls).toEqual(c.trace);
    });

    test(`${c.name}: host-supplied message is used`, async () => {
      const h = buildTraceHarness();
      if (c.setup) await addUser(h, c.setup);
      const error = await loginRefusal(h, c.input, { messages: CUSTOM });
      expect(error).toBeInstanceOf(AuthInvalidCredentialsError);
      expect((error as Error).message).toBe("custom-bad-creds");
    });
  }
});

describe("login success", () => {
  test("normalizes the username, mints one session, stamps lastLoginAt with the session's createdAt", async () => {
    const h = buildTraceHarness("2026-07-10T00:00:00.000Z");
    await addUser(h);
    const result = await login(
      { deps: depsOf(h), input: { workspaceId: WORKSPACE, username: "  ED ", password: "pw" } },
      { ip: "10.0.0.1", userAgent: "ua", sessionTtlMs: 1000 },
    );
    expect(h.calls).toEqual([
      "users.findByUsername",
      "principals.findById",
      "hasher.verify",
      "tokens.newToken",
      "tokens.hashToken",
      "sessions.save",
      "users.save",
    ]);
    expect(result.rawToken).toBe("tok-1");
    expect(result.principal.id).toBe("p-1");
    expect(result.session).toEqual({
      id: "id-1",
      workspaceId: WORKSPACE,
      principalId: "p-1",
      tokenHash: "th:tok-1",
      createdAt: "2026-07-10T00:00:00.000Z",
      expiresAt: "2026-07-10T00:00:01.000Z",
      ip: "10.0.0.1",
      userAgent: "ua",
    });
    const user = await h.repos.users.findByUsername({ workspaceId: WORKSPACE, username: "ed" });
    expect(user?.lastLoginAt).toBe("2026-07-10T00:00:00.000Z");
  });

  test("an invalid sessionTtlMs refuses AFTER credentials verify and before any session write", async () => {
    const h = buildTraceHarness();
    await addUser(h);
    const error = await login({ deps: depsOf(h), input: { workspaceId: WORKSPACE, username: "ed", password: "pw" } }, { sessionTtlMs: 0, messages: CUSTOM }).then(
      () => "resolved",
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toBe("custom-bad-ttl");
    expect(h.calls).toEqual(["users.findByUsername", "principals.findById", "hasher.verify"]);
  });
});

describe("createSessionForPrincipal", () => {
  for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    test(`refuses sessionTtlMs=${ttl} with the default message and writes nothing`, async () => {
      const h = buildTraceHarness();
      await expect(createSessionForPrincipal({ deps: depsOf(h), input: { workspaceId: WORKSPACE, principalId: "p-1" } }, { sessionTtlMs: ttl })).rejects.toThrow(
        new RangeError("sessionTtlMs must be positive and finite"),
      );
      expect(h.calls).toEqual([]);
    });
  }

  test("defaults to a 30-day absolute lifetime", async () => {
    const h = buildTraceHarness("2026-07-10T00:00:00.000Z");
    const { session } = await createSessionForPrincipal({ deps: depsOf(h), input: { workspaceId: WORKSPACE, principalId: "p-1" } });
    expect(session.expiresAt).toBe("2026-08-09T00:00:00.000Z");
    expect(session.ip).toBeUndefined();
  });
});

describe("validateSession", () => {
  async function withSession(h: TraceHarness, status: PrincipalStatus = "active"): Promise<string> {
    await addUser(h, { status });
    const { rawToken } = await createSessionForPrincipal({ deps: depsOf(h), input: { workspaceId: WORKSPACE, principalId: "p-1" } }, { sessionTtlMs: 1000 });
    return rawToken;
  }

  test("unknown token resolves null", async () => {
    const h = buildTraceHarness();
    expect(await validateSession({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken: "nope" } })).toBeNull();
  });

  test("revoked session resolves null", async () => {
    const h = buildTraceHarness();
    const rawToken = await withSession(h);
    await logout({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } });
    expect(await validateSession({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } })).toBeNull();
  });

  test("expiry is exclusive: valid 1ms before expiresAt, null exactly at it", async () => {
    const h = buildTraceHarness("2026-07-10T00:00:00.000Z");
    const rawToken = await withSession(h);
    const before = await validateSession({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } }, { nowIso: "2026-07-10T00:00:00.999Z" });
    expect(before?.principal.id).toBe("p-1");
    expect(await validateSession({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } }, { nowIso: "2026-07-10T00:00:01.000Z" })).toBeNull();
  });

  test("uses the clock when nowIso is omitted", async () => {
    const h = buildTraceHarness("2026-07-10T00:00:00.000Z");
    const rawToken = await withSession(h);
    h.setNow("2026-07-10T00:00:05.000Z");
    expect(await validateSession({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } })).toBeNull();
  });

  test("a disabled bound principal resolves null", async () => {
    const h = buildTraceHarness();
    const rawToken = await withSession(h, "disabled");
    expect(await validateSession({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } }, { nowIso: "2026-07-10T00:00:00.500Z" })).toBeNull();
  });

  test("a missing bound principal resolves null", async () => {
    const h = buildTraceHarness();
    const { rawToken } = await createSessionForPrincipal({ deps: depsOf(h), input: { workspaceId: WORKSPACE, principalId: "ghost" } }, { sessionTtlMs: 1000 });
    expect(await validateSession({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } }, { nowIso: "2026-07-10T00:00:00.500Z" })).toBeNull();
  });
});

describe("logout", () => {
  test("unknown token is a no-op (no revoke call)", async () => {
    const h = buildTraceHarness();
    await logout({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken: "nope" } });
    expect(h.calls).toEqual(["tokens.hashToken", "sessions.findByTokenHash"]);
  });

  test("already-revoked session is not revoked again", async () => {
    const h = buildTraceHarness();
    const { rawToken } = await createSessionForPrincipal({ deps: depsOf(h), input: { workspaceId: WORKSPACE, principalId: "p-1" } });
    await logout({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } });
    h.calls.length = 0;
    await logout({ deps: depsOf(h), input: { workspaceId: WORKSPACE, rawToken } });
    expect(h.calls).toEqual(["tokens.hashToken", "sessions.findByTokenHash"]);
  });
});
