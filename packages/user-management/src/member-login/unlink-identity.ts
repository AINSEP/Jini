import { MemberLoginError } from '../server/login-types.js';
import { prepareMemberChallenge } from '../members/member-challenge-request.js';
import { issueMemberSession } from '../members/member-credentials.js';
import type { MemberRecord, MemberSessionRecord } from '../members/types.js';
import type { MemberLoginLinkDeps } from './link-service.js';

/** Require a password or the existing mail owner's complete readiness check. Preparing never
 * persists/sends until deliver() is called; deliberately discard it here to avoid a second mail
 * availability policy that drifts from sign-in. O(1), bounded sender/status/origin reads.
 */
async function requireAlternativeSignIn({ workspaceId, links, readPasswordHash, member }: Pick<Parameters<typeof unlinkMemberIdentity>[0], 'workspaceId' | 'links' | 'readPasswordHash'> & { member: MemberRecord }, _options = {}): Promise<void> {
  const password = await readPasswordHash({ workspaceId, memberId: member.id });
  // The password owner refuses pending members even when an operator provisioned a hash.
  if (password && member.status === 'active') return;
  if (!member.emailVerifiedAt) throw new MemberLoginError({ code: 'LOGIN_BLOCKED' });
  try {
    await prepareMemberChallenge({ deps: links, input: { workspaceId, email: member.email }, purpose: 'signin' });
  } catch { throw new MemberLoginError({ code: 'LOGIN_BLOCKED' }); }
}

/** Unlink and revoke/reissue under the same locks and kernel as S2 link/Trash. Re-read session
 * after acquiring locks so concurrent unlink/disable cannot leave a replacement session usable.
 * @complexity O(s) revoked sessions; constant indexed identity/member reads, one transaction.
 */
export async function unlinkMemberIdentity(required: {
  workspaceId: string; providerId: string | undefined;
  readCurrent(required: Record<string, never>): Promise<{ member: MemberRecord; session: MemberSessionRecord } | null>;
  readProviderId(required: { providerId: string | undefined }): string;
  links: MemberLoginLinkDeps;
  readPasswordHash: MemberLoginLinkDeps['members']['findPasswordHash'];
  revokeSessions: MemberLoginLinkDeps['sessions']['revokeAllForMember'];
  saveMember: MemberLoginLinkDeps['members']['save'];
  nowIso(required: Record<string, never>): string;
  userAgent: string | undefined; ip: string;
}, _optional = {}): Promise<Awaited<ReturnType<typeof issueMemberSession>>> {
  const current = await required.readCurrent({});
  if (!current) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  const providerId = required.readProviderId({ providerId: required.providerId });
  return required.links.transaction(async () => {
    await required.links.lockKey(`members:external-identities:${required.workspaceId}`);
    await required.links.lockKey(`trash:member:${required.workspaceId}:${current.member.id}`);
    return unlinkLocked({ ...required, providerId });
  });
}

/** Locked lifecycle step; a marker prevents anonymous auto-link even for an outstanding redirect.
 * @complexity O(s) sessions, one identity lookup/update and one member save.
 */
async function unlinkLocked(required: Parameters<typeof unlinkMemberIdentity>[0] & { providerId: string }, _options = {}): Promise<Awaited<ReturnType<typeof issueMemberSession>>> {
  const current = await required.readCurrent({});
  if (!current) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  const now = required.nowIso({});
  const age = Date.parse(now) - Date.parse(current.session.createdAt);
  if (!(age >= 0 && age <= 900000)) throw new MemberLoginError({ code: 'LOGIN_BLOCKED' });
  const input = { workspaceId: required.workspaceId, memberId: current.member.id, providerId: required.providerId };
  const identity = await required.links.identities.findByMemberAndProvider(input);
  if (!identity || identity.unlinkedAt) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  await requireAlternativeSignIn({ ...required, member: current.member });
  await required.links.identities.unlink({ ...input, unlinkedAt: now });
  await required.revokeSessions({ workspaceId: input.workspaceId, memberId: input.memberId, revokedAt: now });
  const member = { ...current.member, credentialsRevokedAt: now, updatedAt: now, version: current.member.version + 1 };
  await required.saveMember(member);
  return issueMemberSession({ deps: required.links, member, nowIso: now }, { userAgent: required.userAgent, ip: required.ip });
}
