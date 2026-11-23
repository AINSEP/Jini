import { Argon2PasswordHasher, loadArgon2Binding } from "../server/hasher.js";
import { NodeSessionTokens } from "../server/session-tokens.js";
import type { PasswordHasherPort } from "../core/index.js";
import type { MemberSignInResult, MembersWriteServiceDeps } from "./ports.js";
import type { MemberRecord, MemberSessionRecord } from "./types.js";

/**
 * No session lifetime is specified by ADR-030; 30 days is a reasonable default
 * "remember me" duration for a passwordless member portal (Ghost's own default is
 * comparable). Revisit if the ADR pins a value later.
 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const memberSessionTokens = new NodeSessionTokens({});
const legacyPasswordHasher = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding });

/** Legacy compositions stay additive; new compositions inject the existing staff hasher. O(1). */
export function memberPasswordHasher({ deps }: { deps: MembersWriteServiceDeps }, _options: Record<string, never> = {}): PasswordHasherPort {
  return deps.passwordHasher ?? legacyPasswordHasher;
}

// Cache per adapter: tests and alternate hosts must never verify a hash made by another hasher.
const dummyHashes = new WeakMap<PasswordHasherPort, Promise<string>>();

/** One cached, unguessable dummy credential per hasher, so a miss costs the same verify as a hit. */
export function dummyPasswordHash({ hasher }: { hasher: PasswordHasherPort }, _options: Record<string, never> = {}): Promise<string> {
  let hash = dummyHashes.get(hasher);
  if (!hash) {
    hash = hasher.hash({ password: newRawToken() });
    dummyHashes.set(hasher, hash);
  }
  return hash;
}

/** High-entropy session/link digest; low-entropy codes use Jini's Argon2 helper instead. */
export function hashToken({ rawToken }: { rawToken: string }, _optional: Record<string, never> = {}): string {
  return memberSessionTokens.hashToken({ rawToken });
}

function newRawToken(): string {
  return memberSessionTokens.newToken({});
}

export function isoPlusMs({ nowIso, ms }: { nowIso: string; ms: number }, _optional: Record<string, never> = {}): string {
  return new Date(new Date(nowIso).getTime() + ms).toISOString();
}

/**
 * The sole member session minter, reused by password, link and code sign-in.
 * Persists only the bearer digest and returns the raw token for the HTTP cookie adapter.
 * @complexity O(1), one session write.
 */
export async function issueMemberSession(required: {
  deps: MembersWriteServiceDeps; member: MemberRecord; nowIso: string;
}, options: { userAgent?: string | undefined; ip?: string | undefined } = {}): Promise<MemberSignInResult> {
  const { deps, member, nowIso } = required;
  const rawSessionToken = newRawToken();
  const session: MemberSessionRecord = {
    id: deps.ids.newId(),
    workspaceId: member.workspaceId,
    memberId: member.id,
    tokenHash: hashToken({ rawToken: rawSessionToken }),
    createdAt: nowIso,
    expiresAt: isoPlusMs({ nowIso, ms: SESSION_TTL_MS }),
    userAgent: options.userAgent,
    ip: options.ip,
  };
  await deps.sessions.save(session);

  return { member, session, rawSessionToken };
}
