import { defaultUserManagementMessages, type UserManagementMessages } from "./messages.js";
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import type { SessionTokenPort } from "../core/runtime-ports.js";

import type { Clock, IdGenerator, ISODateTime, UUID } from "@jini-ai/core/primitives";
import { resolveEffectivePermissions } from "./authorize.js";
import type { IdentityRepos, PasswordHasherPort } from "../core/ports.js";
import { AuthInvalidCredentialsError, type PrincipalRecord, type SessionRecord } from "../core/types.js";
import { normalizeUsername } from "./username.js";

/**
 * @file Login / logout / session validation (state.spec `LOGIN`/`LOGOUT`).
 *
 * Purpose:
 * The credential-verification + session-lifecycle surface `middleware/dev-auth.ts`
 * wires into HTTP. Session tokens are hashed with SHA-256 before storage — the
 * same technique `members/write-service.ts` uses for magic-link/member-session
 * tokens (: the raw token is never persisted). Password verification is
 * argon2id (`hasher.ts`), never a raw comparison.
 *
 * `createSessionForPrincipal` (2026-09-06) is the one session minter; `login` calls it after
 * verifying credentials, and a host that identifies a principal by some other means (e.g. a
 * loopback-only single-use boot token, which has nothing to verify a password against) calls it
 * directly instead of re-implementing session construction. Before this export existed, a
 * downstream host had duplicated this file's private `hashToken` byte-for-byte because
 * `login` was the only minter and hard-requires a password — this closes that fork.
 *
 * Architectural role:
 * Ordinary core functions (like `updatePost`/`membersWriteService`), not a
 * port — session/credential logic has one implementation.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */

/** /behavior.spec §4: absolute session lifetime, fixed at creation; defaults to 30 days and is host-configurable. See docs/decisions/DR-001-identity-and-session-boundary.md. */
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthServiceDeps {
  repos: IdentityRepos;
  hasher: PasswordHasherPort;
  clock: Clock;
  idGen: IdGenerator;
  tokens: SessionTokenPort;
}

function isoPlusMs(nowIso: ISODateTime, ms: number): ISODateTime {
  return new Date(new Date(nowIso).getTime() + ms).toISOString();
}

/**
 * Mint and persist a session for a principal the caller has ALREADY identified by some means
 * other than this function (password verification in `login()` below, or a caller-specific proof
 * such as a loopback-only single-use boot token). Factored out of `login()`'s former inline
 * session-construction block (2026-09-06) so both paths share one minter — a host with no
 * password to verify no longer has to hand-roll its own token hashing (and risk drifting from
 * this file's private `hashToken`) just to mint a session for a principal it has already proven
 * by other means.
 *
 * @complexity O(1) — one session write.
 * @overallScore 100
 */
export async function createSessionForPrincipal(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; principalId: UUID; };
}, optional: { ip?: string | undefined; userAgent?: string | undefined; sessionTtlMs?: number | undefined; messages?: UserManagementMessages | undefined } = {}): Promise<{ session: SessionRecord; rawToken: string }> {
  const { deps } = required;
  const input = { ...required.input, ...optional };
  const nowIso = kernelNowIso({ clock: deps.clock });
  const sessionTtlMs = optional.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) throw new RangeError((optional.messages ?? defaultUserManagementMessages).invalidSessionTtl);
  const rawToken = deps.tokens.newToken({});
  const session: SessionRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    tokenHash: deps.tokens.hashToken({ rawToken }),
    createdAt: nowIso,
    expiresAt: isoPlusMs(nowIso, sessionTtlMs),
    ip: input.ip,
    userAgent: input.userAgent,
  };
  await deps.repos.sessions.save(session);
  return { session, rawToken };
}

/**
 * Verify `username`+`password` for an `active` principal and mint a session
 * Constant-shaped failure: a nonexistent username, a
 * disabled principal, and a wrong password are all `AuthInvalidCredentialsError`
 * with the same message — no user-enumeration signal.
 *
 * @complexity O(1) — one username lookup, one principal lookup, one hash
 * verify, one session write (via `createSessionForPrincipal`), one `lastLoginAt` write.
 * @overallScore 100
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export async function login(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; username: string; password: string; };
}, optional: { ip?: string; userAgent?: string; sessionTtlMs?: number; messages?: UserManagementMessages } = {}): Promise<{ principal: PrincipalRecord; session: SessionRecord; rawToken: string }> {
  const { deps } = required;
  const input = { ...required.input, ...optional };
  const username = normalizeUsername({ raw: input.username });

  if (!username || !input.password) {
    throw new AuthInvalidCredentialsError({ message: (optional.messages ?? defaultUserManagementMessages).invalidCredentials });
  }

  const userRow = await deps.repos.users.findByUsername({ workspaceId: input.workspaceId, username });
  if (!userRow) {
    throw new AuthInvalidCredentialsError({ message: (optional.messages ?? defaultUserManagementMessages).invalidCredentials });
  }

  const principal = await deps.repos.principals.findById({
    workspaceId: input.workspaceId,
    id: userRow.principalId,
  });
  if (!principal || principal.status !== "active") {
    throw new AuthInvalidCredentialsError({ message: (optional.messages ?? defaultUserManagementMessages).invalidCredentials });
  }

  const passwordOk = await deps.hasher.verify({ hash: userRow.passwordHash, password: input.password });
  if (!passwordOk) {
    throw new AuthInvalidCredentialsError({ message: (optional.messages ?? defaultUserManagementMessages).invalidCredentials });
  }

  const { session, rawToken } = await createSessionForPrincipal({ deps, input: { workspaceId: input.workspaceId, principalId: principal.id } }, { ip: input.ip, userAgent: input.userAgent, sessionTtlMs: optional.sessionTtlMs, messages: optional.messages });
  // Reuses the session's own `createdAt` rather than a second `kernelNowIso({ clock: clock })` call — both are
  // meant to be the same instant, and reading one avoids two clock reads ever disagreeing.
  await deps.repos.users.save({ ...userRow, lastLoginAt: session.createdAt });

  return { principal, session, rawToken };
}

/**
 * Resolve a session cookie's raw token to its principal, applying every
 * fail-closed check server-side : unknown
 * token, revoked, past absolute `expiresAt`, or a disabled bound principal
 * all resolve to `null` (the caller maps that to 401 `UNAUTHENTICATED` and
 * never reaches `authorize`).
 *
 * @complexity O(1) — one token-hash lookup, one principal lookup.
 * @overallScore 100
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */
export async function validateSession(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; rawToken: string; };
}, optional: { nowIso?: ISODateTime } = {}): Promise<{ principal: PrincipalRecord; session: SessionRecord } | null> {
  const { deps } = required;
  const input = { ...required.input, ...optional };
  const nowIso = input.nowIso ?? kernelNowIso({ clock: deps.clock });

  const session = await deps.repos.sessions.findByTokenHash({
    workspaceId: input.workspaceId,
    tokenHash: deps.tokens.hashToken({ rawToken: input.rawToken }),
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  // past absolute expiry is treated as revoked, never reaching authorize. See docs/decisions/DR-001-identity-and-session-boundary.md.
  if (session.expiresAt <= nowIso) return null;

  const principal = await deps.repos.principals.findById({
    workspaceId: input.workspaceId,
    id: session.principalId,
  });
  // a disabled principal's live session stops validating immediately. See docs/decisions/DR-001-identity-and-session-boundary.md.
  if (!principal || principal.status !== "active") return null;

  return { principal, session };
}

/** Revoke the session bound to `rawToken`. Idempotent — already-revoked/unknown is a no-op. */
export async function logout(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; rawToken: string };
}): Promise<void> {
  const { deps, input } = required;
  const session = await deps.repos.sessions.findByTokenHash({
    workspaceId: input.workspaceId,
    tokenHash: deps.tokens.hashToken({ rawToken: input.rawToken }),
  });
  if (!session || session.revokedAt) return;
  await deps.repos.sessions.revoke({
    workspaceId: input.workspaceId,
    id: session.id,
    revokedAt: kernelNowIso({ clock: deps.clock }),
  });
}

/** The introspection surface for `AUTH_ME` : dotted permission strings, `["*"]` for owner. See docs/decisions/DR-001-identity-and-session-boundary.md. */
export async function getEffectivePermissions(required: {
  deps: IdentityRepos;
  input: { workspaceId: UUID; principalId: UUID };
}): Promise<string[]> {
  const rows = await resolveEffectivePermissions({
    deps: {
      principals: required.deps.principals,
      principalRoles: required.deps.principalRoles,
      rolePolicies: required.deps.rolePolicies,
      principalPolicies: required.deps.principalPolicies,
      policyPermissions: required.deps.policyPermissions,
    },
    principalId: required.input.principalId,
    workspaceId: required.input.workspaceId,
  });
  return [...new Set(rows.map((row) => row.permission))];
}
