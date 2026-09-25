import { createHash, randomBytes } from "node:crypto";

import type { ClockPort, IdGeneratorPort, ISODateTime, UUID } from "../core/ports.js";
import { resolveEffectivePermissions } from "./authorize.js";
import type { IdentityRepos, PasswordHasherPort } from "./ports.js";
import { AuthInvalidCredentialsError, type PrincipalRecord, type SessionRecord } from "./types.js";
import { normalizeUsername } from "./username.js";

/**
 * @file Login / logout / session validation (REQ-06, state.spec `LOGIN`/`LOGOUT`).
 *
 * Purpose:
 * The credential-verification + session-lifecycle surface `middleware/dev-auth.ts`
 * wires into HTTP. Session tokens are hashed with SHA-256 before storage — the
 * same technique `members/write-service.ts` uses for magic-link/member-session
 * tokens (INV-05: the raw token is never persisted). Password verification is
 * argon2id (`hasher.ts`), never a raw comparison.
 *
 * `createSessionForPrincipal` (2026-09-06) is the one session minter; `login()` calls it after
 * verifying credentials, and a host that identifies a principal by some other means (e.g. a
 * loopback-only single-use boot token, which has nothing to verify a password against) calls it
 * directly instead of re-implementing session construction. Before this export existed, a
 * downstream host had duplicated this file's private `hashToken` byte-for-byte because
 * `login()` was the only minter and hard-requires a password — this closes that fork.
 *
 * Architectural role:
 * Ordinary core functions (like `updatePost`/`membersWriteService`), not a
 * port — session/credential logic has one implementation.
 */

/** RT-004/behavior.spec §4: absolute session lifetime, fixed at creation. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthServiceDeps {
  repos: IdentityRepos;
  hasher: PasswordHasherPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
}

/** SHA-256 hex digest of a raw bearer token (mirrors `members/write-service.ts`'s `hashToken`). */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function newRawToken(): string {
  return randomBytes(32).toString("hex");
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
  input: { workspaceId: UUID; principalId: UUID; ip?: string | undefined; userAgent?: string | undefined };
}): Promise<{ session: SessionRecord; rawToken: string }> {
  const { deps, input } = required;
  const nowIso = deps.clock.nowIso();
  const rawToken = newRawToken();
  const session: SessionRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    tokenHash: hashToken(rawToken),
    createdAt: nowIso,
    expiresAt: isoPlusMs(nowIso, SESSION_TTL_MS),
    ip: input.ip,
    userAgent: input.userAgent,
  };
  await deps.repos.sessions.save(session);
  return { session, rawToken };
}

/**
 * Verify `username`+`password` for an `active` principal and mint a session
 * (AC-02, REQ-06). Constant-shaped failure: a nonexistent username, a
 * disabled principal, and a wrong password are all `AuthInvalidCredentialsError`
 * with the same message — no user-enumeration signal.
 *
 * @complexity O(1) — one username lookup, one principal lookup, one hash
 * verify, one session write (via `createSessionForPrincipal`), one `lastLoginAt` write.
 * @overallScore 100
 */
export async function login(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; username: string; password: string; ip?: string; userAgent?: string };
}): Promise<{ principal: PrincipalRecord; session: SessionRecord; rawToken: string }> {
  const { deps, input } = required;
  const username = normalizeUsername(input.username);

  if (!username || !input.password) {
    throw new AuthInvalidCredentialsError("invalid username or password");
  }

  const userRow = await deps.repos.users.findByUsername({ workspaceId: input.workspaceId, username });
  if (!userRow) {
    throw new AuthInvalidCredentialsError("invalid username or password");
  }

  const principal = await deps.repos.principals.findById({
    workspaceId: input.workspaceId,
    id: userRow.principalId,
  });
  if (!principal || principal.status !== "active") {
    throw new AuthInvalidCredentialsError("invalid username or password");
  }

  const passwordOk = await deps.hasher.verify(userRow.passwordHash, input.password);
  if (!passwordOk) {
    throw new AuthInvalidCredentialsError("invalid username or password");
  }

  const { session, rawToken } = await createSessionForPrincipal({
    deps,
    input: { workspaceId: input.workspaceId, principalId: principal.id, ip: input.ip, userAgent: input.userAgent },
  });
  // Reuses the session's own `createdAt` rather than a second `clock.nowIso()` call — both are
  // meant to be the same instant, and reading one avoids two clock reads ever disagreeing.
  await deps.repos.users.save({ ...userRow, lastLoginAt: session.createdAt });

  return { principal, session, rawToken };
}

/**
 * Resolve a session cookie's raw token to its principal, applying every
 * fail-closed check server-side (EC-02/EC-03/EC-13, AC-05/AC-20): unknown
 * token, revoked, past absolute `expiresAt`, or a disabled bound principal
 * all resolve to `null` (the caller maps that to 401 `UNAUTHENTICATED` and
 * never reaches `authorize()`).
 *
 * @complexity O(1) — one token-hash lookup, one principal lookup.
 * @overallScore 100
 */
export async function validateSession(required: {
  deps: AuthServiceDeps;
  input: { workspaceId: UUID; rawToken: string; nowIso?: ISODateTime };
}): Promise<{ principal: PrincipalRecord; session: SessionRecord } | null> {
  const { deps, input } = required;
  const nowIso = input.nowIso ?? deps.clock.nowIso();

  const session = await deps.repos.sessions.findByTokenHash({
    workspaceId: input.workspaceId,
    tokenHash: hashToken(input.rawToken),
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  // EC-13/AC-20: past absolute expiry is treated as revoked, never reaching authorize().
  if (session.expiresAt <= nowIso) return null;

  const principal = await deps.repos.principals.findById({
    workspaceId: input.workspaceId,
    id: session.principalId,
  });
  // EC-02: a disabled principal's live session stops validating immediately.
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
    tokenHash: hashToken(input.rawToken),
  });
  if (!session || session.revokedAt) return;
  await deps.repos.sessions.revoke({
    workspaceId: input.workspaceId,
    id: session.id,
    revokedAt: deps.clock.nowIso(),
  });
}

/** The introspection surface for `AUTH_ME` (REQ-07): dotted permission strings, `["*"]` for owner. */
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
