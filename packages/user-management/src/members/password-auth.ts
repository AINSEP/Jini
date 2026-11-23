/** Member password workflows (OPUS-REVIEW shard C); transport limits/CSRF belong to shard D. */
import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { validatePasswordPolicy } from "../server/index.js";
import type { MemberSignInResult, MembersWriteServiceDeps } from "./ports.js";
import { MemberAuthError, MemberReauthenticationRequiredError, MemberValidationError, type MemberRecord, type MemberSessionRecord } from "./types.js";
import { resolveMemberSession } from "./access-resolver.js";
import { dummyPasswordHash, issueMemberSession, memberPasswordHasher } from "./member-credentials.js";
import { consumeMemberChallenge } from "./member-challenge.js";

/** Pending and disabled members cannot obtain a password session, even with a matching hash. */
function requireActiveMember({ member }: { member: MemberRecord | null }, _options = {}): MemberRecord {
  if (!member || member.status !== "active") throw new MemberAuthError("INVALID_CREDENTIALS");
  return member;
}

/**
 * Verify exactly once for every account class, then re-read the credential after session save.
 * Missing, passwordless, pending, disabled, trashed and wrong-password accounts share one error.
 * @throws MemberAuthError("INVALID_CREDENTIALS"); adapter errors propagate.
 * @complexity O(1) indexed reads and one Argon2 verify; password bytes remain unmodified.
 * @example signInWithPassword({ deps, input: { workspaceId, email, password } })
 */
export async function signInWithPassword(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; email: string; password: string; userAgent?: string; ip?: string };
}, _options: Record<string, never> = {}): Promise<MemberSignInResult> {
  const { deps, input } = required;
  const nowIso = clockNowIso({ clock: deps.clock });
  const email = input.email.trim().toLowerCase();
  const hasher = memberPasswordHasher({ deps });
  const member = await deps.members.findByEmail({ workspaceId: input.workspaceId, email });
  const credential = member ? { workspaceId: input.workspaceId, memberId: member.id } : null;
  const hash = credential ? await deps.members.findPasswordHash(credential) : null;
  const verified = await hasher.verify({ hash: hash ?? await dummyPasswordHash({ hasher }), password: input.password });
  if (!verified || !hash) throw new MemberAuthError("INVALID_CREDENTIALS");
  const active = requireActiveMember({ member });
  // Read status again too: an administrative disable can race the expensive Argon2 verify.
  const current = await deps.members.findById({ workspaceId: input.workspaceId, id: active.id });
  const currentMember = requireActiveMember({ member: current });
  const result = await issueMemberSession({ deps, member: currentMember, nowIso }, { userAgent: input.userAgent, ip: input.ip });
  // Reset writes the hash, then revokes every session. Re-reading AFTER the save closes the race
  // without locks or clock order: an unchanged hash means a later reset's revoke-all covers it.
  const currentHash = await deps.members.findPasswordHash({ workspaceId: input.workspaceId, memberId: active.id });
  if (currentHash !== hash) {
    await deps.sessions.revoke({ workspaceId: input.workspaceId, id: result.session.id, revokedAt: nowIso });
    throw new MemberAuthError("INVALID_CREDENTIALS");
  }
  return result;
}

/** Disabled/trashed members and links issued before a credential cutoff get the generic 401. O(1). */
function resettableMember({ member, createdAt }: { member: MemberRecord | null; createdAt: string }, _options = {}): MemberRecord {
  if (!member) throw new MemberAuthError("sign-in credential is invalid");
  if (member.status === "disabled" || member.status === "trash"
    || (member.credentialsRevokedAt && member.credentialsRevokedAt >= createdAt)) {
    throw new MemberAuthError("sign-in credential is invalid");
  }
  return member;
}

/**
 * Link-only reset: consume -> hash -> locked authorization + atomic credential/session/profile write.
 * Consumption stays outside the transaction so a failed write never refunds a used challenge.
 * The cutoff invalidates outstanding links/codes, including challenges issued at the same tick.
 * @throws MemberValidationError for empty/>512-code-point passwords; generic MemberAuthError for credentials.
 * @complexity O(n + s), password length n and member sessions s; hashing cost is adapter-owned.
 * @example resetPassword({ deps, input: { workspaceId, token, password: "x" } })
 */
export async function resetPassword(required: {
  deps: MembersWriteServiceDeps; input: { workspaceId: string; token: string; password: string };
}, _options: Record<string, never> = {}): Promise<{ ok: true }> {
  const { deps, input } = required;
  const policyError = validatePasswordPolicy({ password: input.password });
  if (policyError) throw new MemberValidationError(policyError);
  const nowIso = clockNowIso({ clock: deps.clock });
  const record = await consumeMemberChallenge({ deps, input: { workspaceId: input.workspaceId, token: input.token }, purpose: "password_reset", nowIso });
  const member = resettableMember({
    member: await deps.members.findById({ workspaceId: input.workspaceId, id: record.memberId }), createdAt: record.createdAt,
  });
  await persistMemberPassword({ deps, workspaceId: input.workspaceId, memberId: member.id, password: input.password,
    authorize: async ({ member: current, nowIso: committedAt }) => {
      resettableMember({ member: current, createdAt: record.createdAt });
      if (record.expiresAt <= committedAt || current.credentialsRevokedAt !== member.credentialsRevokedAt) {
        throw new MemberAuthError("sign-in credential is invalid");
      }
    } }, { verifyInbox: true });
  return { ok: true };
}

/** /me eligibility: pending and active members may change credentials; disabled/trashed never. O(1). */
function credentialMember({ member }: { member: MemberRecord | null }, _options = {}): MemberRecord {
  if (!member || (member.status !== "active" && member.status !== "pending")) throw new MemberAuthError("INVALID_CREDENTIALS");
  return member;
}

/** One password-write lifecycle for reset and self-service; authorization and all writes share a lock/transaction.
 * @complexity O(n + s), password code points n and affected sessions s; hashing is adapter-owned.
 * @throws MemberAuthError for stale authorization/status; validation error without transactional storage.
 * Repository/hasher errors propagate; profile conflicts roll back credentials and session revocation.
 */
async function persistMemberPassword(required: {
  deps: MembersWriteServiceDeps; workspaceId: string; memberId: string; password: string;
  authorize: (required: { member: MemberRecord; nowIso: string }) => Promise<void>;
}, options: { exceptSessionId?: string | undefined; verifyInbox?: boolean } = {}): Promise<void> {
  const { deps, workspaceId, memberId, password, authorize } = required;
  const lifecycle = deps.credentialLifecycle;
  if (!lifecycle) throw new MemberValidationError("member credential transactions are unavailable");
  const passwordHash = await memberPasswordHasher({ deps }).hash({ password });
  await lifecycle.transaction(async () => {
    // Share Trash, session minting and bulk revocation's lock. Argon2 must finish BEFORE it is held.
    await lifecycle.lockKey(`trash:member:${workspaceId}:${memberId}`);
    const member = credentialMember({ member: await deps.members.findById({ workspaceId, id: memberId }) });
    const committedAt = clockNowIso({ clock: deps.clock });
    await authorize({ member, nowIso: committedAt });
    await deps.members.setPasswordHash({ workspaceId, memberId, passwordHash });
    await deps.sessions.revokeAllForMember({ workspaceId, memberId, revokedAt: committedAt }, { exceptSessionId: options.exceptSessionId });
    // The reset link proves the inbox, so it verifies the email and activates a pending member.
    const inbox = options.verifyInbox ? { emailVerifiedAt: member.emailVerifiedAt ?? committedAt, status: "active" as const } : {};
    await deps.members.save({ ...member, ...inbox, credentialsRevokedAt: committedAt, updatedAt: committedAt, version: member.version + 1 });
  });
}

/** Recheck session validity and the credential/cutoff that authorized the request after hashing.
 * Hash equality reuses the completed current-password proof without Argon2 inside the lock.
 * @throws MemberAuthError for changed authorization; reauthentication error for aged passwordless proof.
 * @complexity O(1) indexed reads, constant auxiliary space.
 */
async function revalidatePasswordSet(required: {
  deps: MembersWriteServiceDeps; workspaceId: string; sessionToken?: string | undefined; member: MemberRecord;
  expectedMember: MemberRecord; hash: string | null; sessionId: string; nowIso: string;
}, _options = {}): Promise<void> {
  const { deps, workspaceId, sessionToken, member, expectedMember, hash, sessionId, nowIso } = required;
  const session = await resolveMemberSession({ sessions: deps.sessions, workspaceId, sessionToken, nowIso });
  if (!session || session.id !== sessionId || session.memberId !== member.id
    || member.credentialsRevokedAt !== expectedMember.credentialsRevokedAt) throw new MemberAuthError("INVALID_CREDENTIALS");
  const currentHash = await deps.members.findPasswordHash({ workspaceId, memberId: member.id });
  if (currentHash !== hash) throw new MemberAuthError("INVALID_CREDENTIALS");
  if (hash === null) await authorizePasswordSet({ deps, hash, session, nowIso });
}

/** Existing credentials need proof; a passwordless account needs a recent inbox-backed session.
 * @throws MemberAuthError on missing/wrong current password; reauthentication error on stale sessions.
 * @complexity O(1) plus one adapter-owned password verification when a hash exists.
 */
async function authorizePasswordSet(required: {
  deps: MembersWriteServiceDeps; hash: string | null; currentPassword?: string | undefined;
  session: MemberSessionRecord; nowIso: string;
}, _options = {}): Promise<void> {
  const { deps, hash, currentPassword, session, nowIso } = required;
  if (hash !== null) {
    if (currentPassword === undefined) throw new MemberAuthError("INVALID_CREDENTIALS");
    const verified = await memberPasswordHasher({ deps }).verify({ hash, password: currentPassword });
    if (!verified) throw new MemberAuthError("INVALID_CREDENTIALS");
    return;
  }
  // Session issuance, not last activity, proves that the inbox was accessed recently.
  const ageMs = Date.parse(nowIso) - Date.parse(session.createdAt);
  if (!(ageMs >= 0 && ageMs <= 15 * 60_000)) {
    throw new MemberReauthenticationRequiredError("sign in again to set a password");
  }
}

/** Set/change a signed-in member's password, preserving only the presenting session.
 * @returns {ok:true}; never returns a password/hash or mints a session.
 * @throws MemberAuthError for invalid sessions/status/proof, reauthentication error when stale,
 * MemberValidationError for empty/>512-code-point passwords; adapter failures propagate.
 * @complexity O(n + s), password code points n and member sessions s.
 * @example setMemberPassword({ deps, input: { workspaceId, sessionToken, password: "x" } });
 */
export async function setMemberPassword(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; sessionToken?: string; password: string; currentPassword?: string };
}, _options: Record<string, never> = {}): Promise<{ ok: true }> {
  const { deps, input } = required;
  const nowIso = clockNowIso({ clock: deps.clock });
  const session = await resolveMemberSession({ sessions: deps.sessions, workspaceId: input.workspaceId,
    sessionToken: input.sessionToken, nowIso });
  if (!session) throw new MemberAuthError("INVALID_CREDENTIALS");
  const member = credentialMember({ member: await deps.members.findById({ workspaceId: input.workspaceId, id: session.memberId }) });
  const hash = await deps.members.findPasswordHash({ workspaceId: input.workspaceId, memberId: member.id });
  await authorizePasswordSet({ deps, hash, currentPassword: input.currentPassword, session, nowIso });
  const policyError = validatePasswordPolicy({ password: input.password });
  if (policyError) throw new MemberValidationError(policyError);
  await persistMemberPassword({ deps, workspaceId: input.workspaceId, memberId: member.id, password: input.password,
    authorize: ({ member: current, nowIso: committedAt }) => revalidatePasswordSet({
      deps, workspaceId: input.workspaceId, sessionToken: input.sessionToken, member: current,
      expectedMember: member, hash, sessionId: session.id, nowIso: committedAt,
    }) }, { exceptSessionId: session.id });
  return { ok: true };
}
