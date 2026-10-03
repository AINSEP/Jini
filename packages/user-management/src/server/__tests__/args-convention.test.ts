import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { IdentityForbiddenError, IdentityValidationError, GrantExceedsIssuerError } from "../../core/index.js";
import { Argon2PasswordHasher, type Argon2BindingPort } from "../hasher.js";
import { InMemoryPrincipalRepo, InMemorySessionRepo } from "../repo.memory.js";
import * as memory from "../repo.memory.js";
import { normalizeUsername } from "../username.js";
import { validatePasswordPolicy } from "../password-policy.js";
import { createSessionForPrincipal, validateSession, type AuthServiceDeps } from "../auth-service.js";
import { NodeSessionTokens } from "../session-tokens.js";

test("password helpers and domain errors take named arguments", () => {
  expect(normalizeUsername({ raw: "  A\u0301DMIN  " })).toBe("ádmin");
  expect(validatePasswordPolicy({ password: "" })).toBe("Password is required.");
  const cause = new Error("underlying failure");
  expect(new IdentityValidationError({ message: "invalid" }, { cause }).cause).toBe(cause);
  const denied = new IdentityForbiddenError({ message: "denied", permission: "user.manage", reason: "no_grant" });
  expect([denied.message, denied.permission, denied.reason]).toEqual(["denied", "user.manage", "no_grant"]);
  expect(new GrantExceedsIssuerError({ message: "clamped", offendingPermissions: ["role.manage"] }).offendingPermissions).toEqual(["role.manage"]);
});

test("the hasher uses the injected binding and separates cost options", async () => {
  const calls: unknown[] = [];
  const binding: Argon2BindingPort = {
    argon2id: 2,
    async hash(required, optional) { calls.push([required, optional]); return "$argon2id$fixture"; },
    async verify({ hash, password }) { return hash === "$argon2id$fixture" && password === "secret"; },
  };
  const hasher = new Argon2PasswordHasher({ loadBinding: () => binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });
  expect(await hasher.hash({ password: "secret" })).toBe("$argon2id$fixture");
  expect(calls).toEqual([[{ password: "secret" }, { type: 2, memoryCost: 8, timeCost: 1, parallelism: 1 }]]);
  expect(await hasher.verify({ hash: "$argon2id$fixture", password: "secret" })).toBe(true);
  expect(await hasher.verify({ hash: "$argon2id$fixture", password: "wrong" })).toBe(false);
  const broken = new Argon2PasswordHasher({ loadBinding: () => ({ ...binding, async verify() { throw new Error("malformed"); } }) });
  expect(await broken.verify({ hash: "foreign", password: "secret" })).toBe(false);
});

test("repository constructors separate optional seed rows and do not mutate the seed array", async () => {
  const rows = [{ id: "p", workspaceId: "ws", kind: "user" as const, displayName: "Owner", status: "active" as const, createdAt: "2026-01-01T00:00:00.000Z" }];
  const repo = new InMemoryPrincipalRepo({}, { initialRows: rows });
  await repo.save({ ...rows[0]!, id: "other" });
  expect(rows).toHaveLength(1);
  expect((await repo.list({ workspaceId: "ws" })).map(({ id }) => id)).toEqual(["p", "other"]);
  expect(await new InMemoryPrincipalRepo({}).list({ workspaceId: "ws" })).toEqual([]);
});

test("session minting uses injected token operations and optional request metadata", async () => {
  const principals = new InMemoryPrincipalRepo({}, { initialRows: [{ id: "p", workspaceId: "ws", kind: "user", displayName: "Owner", status: "active", createdAt: "2026-01-01T00:00:00.000Z" }] });
  const sessions = new InMemorySessionRepo({});
  const deps: AuthServiceDeps = {
    repos: createTransactionalInMemoryIdentityRepos({ repos: {
      principals, sessions,
      users: new memory.InMemoryUserRepo({}),
      roles: new memory.InMemoryRoleRepo({}),
      policies: new memory.InMemoryPolicyRepo({}),
      policyPermissions: new memory.InMemoryPolicyPermissionRepo({}),
      rolePolicies: new memory.InMemoryRolePolicyRepo({}),
      principalRoles: new memory.InMemoryPrincipalRoleRepo({}),
      principalPolicies: new memory.InMemoryPrincipalPolicyRepo({}),
    } }),
    hasher: { async hash() { throw new Error("session minting must not hash a password"); }, async verify() { throw new Error("session minting must not verify a password"); } },
    clock: { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z")},
    idGen: { newId: () => "session-1" },
    tokens: { newToken: () => "test-bearer", hashToken: ({ rawToken }: { rawToken: string }) => createHash("sha256").update(rawToken).digest("hex") },
  };
  const minted = await createSessionForPrincipal({ deps, input: { workspaceId: "ws", principalId: "p" } }, { ip: "127.0.0.1", userAgent: "fixture" });
  expect(minted.rawToken).toBe("test-bearer");
  expect(minted.session).toEqual({ id: "session-1", workspaceId: "ws", principalId: "p", tokenHash: createHash("sha256").update("test-bearer").digest("hex"), createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-31T00:00:00.000Z", ip: "127.0.0.1", userAgent: "fixture" });
  expect((await validateSession({ deps, input: { workspaceId: "ws", rawToken: minted.rawToken } }))?.principal.id).toBe("p");
  expect(await validateSession({ deps, input: { workspaceId: "ws", rawToken: minted.rawToken } }, { nowIso: minted.session.expiresAt })).toBeNull();
  const native = new NodeSessionTokens({});
  expect(native.hashToken({ rawToken: "test-bearer" })).toBe(minted.session.tokenHash);
  expect(native.newToken({})).toMatch(/^[a-f0-9]{64}$/);
});
