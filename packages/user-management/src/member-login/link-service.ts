/** Transactional member adapter; protocol validation happens before this service is called. */
import { nowIso } from "@jini-ai/core/primitives";
import { isUniqueViolation, type StorageKernel } from "@jini-ai/core/contracts/storage";
import type { MemberExternalIdentityRepoPort, MemberSignInResult, MembersWriteServiceDeps } from "../members/ports.js";
import { completeSignIn, createMember, notifyMemberCreated } from "../members/member-sign-in.js";
import { issueMemberSession } from "../members/member-credentials.js";
import { requestSignInLink } from "../members/member-challenge-request.js";
import type { MemberExternalIdentityRecord, MemberRecord } from "../members/types.js";
import { decideMemberLogin } from "../server/link-policy.js";
import { MemberLoginError, type VerifiedLoginIdentity } from "../server/login-types.js";

export interface MemberLoginLinkDeps extends MembersWriteServiceDeps {
  readonly identities: MemberExternalIdentityRepoPort;
  /** Bind both to the SAME kernel as all member/principal/session/identity adapters. */
  readonly transaction: StorageKernel<unknown>["transaction"];
  readonly lockKey: StorageKernel<unknown>["lockKey"];
  readonly reportFailure: MemberLoginFailureReporter;
}

/** The host's private failure log. The visitor only ever sees a fixed LOGIN_* code, so this is the
 * one place the original cause (a mail-adapter or origin failure) is kept; it may carry provider
 * detail, so it never reaches the thrown error or the HTTP reply. Must not throw.
 */
export type MemberLoginFailureReporter = (input: { readonly operation: string; readonly error: unknown }) => void;

export interface MemberLoginLinkInput {
  readonly workspaceId: string;
  readonly identity: VerifiedLoginIdentity;
  /** Sealed-state issuance time from completeOidcLogin, never a request timestamp. */
  readonly startedAt: string;
  /** Present only for the signed-in intent returned by completeOidcLogin. */
  readonly connectMemberId?: string;
  /** Consume through the existing inbox challenge owner; never trust a boolean from HTTP. */
  readonly emailProof?: { readonly challengeId: string; readonly code: string };
  readonly userAgent?: string;
  readonly ip?: string;
}

export type MemberLoginLinkResult = { kind: "signed_in"; result: MemberSignInResult }
  | { kind: "email_verification_required"; email: string; providerId: string };

type InboxProof = MemberRecord & { isNewMember?: boolean | undefined };

interface LoginTarget {
  subject: MemberExternalIdentityRecord | null;
  member: MemberRecord | null;
  pair: MemberExternalIdentityRecord | null;
}

function assertSubjectOwner(target: LoginTarget, input: MemberLoginLinkInput) {
  if (target.subject && (!target.member || target.subject.providerId !== input.identity.providerId)) throw new MemberLoginError({ code: "LOGIN_CONFLICT" });
  if (target.pair && !target.pair.unlinkedAt && target.pair.subject !== input.identity.subject) throw new MemberLoginError({ code: "LOGIN_CONFLICT" });
}

async function resolveTarget(deps: MemberLoginLinkDeps, input: MemberLoginLinkInput) {
  const subject = await deps.identities.findBySubject({ workspaceId: input.workspaceId, issuer: input.identity.issuer, subject: input.identity.subject });
  const memberId = subject?.memberId ?? input.connectMemberId;
  const member = memberId ? await deps.members.findById({ workspaceId: input.workspaceId, id: memberId })
    : await deps.members.findByEmail({ workspaceId: input.workspaceId, email: input.identity.email });
  const pair = member ? await deps.identities.findByMemberAndProvider({ workspaceId: input.workspaceId, memberId: member.id, providerId: input.identity.providerId }) : null;
  const target = { subject, member, pair };
  assertSubjectOwner(target, input);
  return target;
}

function assertEligible({ member, input }: { member: MemberRecord | null; input: MemberLoginLinkInput }, _optional = {}) {
  if (!Number.isFinite(Date.parse(input.startedAt))) throw new MemberLoginError({ code: "LOGIN_INVALID" });
  if (member?.credentialsRevokedAt && member.credentialsRevokedAt >= input.startedAt) throw new MemberLoginError({ code: "LOGIN_BLOCKED" });
}

function proofMatchesTarget({ target, input, proof }: { target: LoginTarget; input: MemberLoginLinkInput; proof: InboxProof | null }, _optional = {}) {
  if (!proof) return;
  if (proof.email !== (target.member?.email ?? input.identity.email)) throw new MemberLoginError({ code: "LOGIN_INVALID" });
  if (target.member && proof.id !== target.member.id) throw new MemberLoginError({ code: "LOGIN_INVALID" });
}

function decisionFor({ target, input, proof }: { target: LoginTarget; input: MemberLoginLinkInput; proof: InboxProof | null }, _optional = {}) {
  return decideMemberLogin({ identity: input.identity, member: target.member, subjectLinked: Boolean(target.subject && !target.subject.unlinkedAt),
    emailProofVerified: proof !== null, unlinked: Boolean(target.pair?.unlinkedAt),
    ...(input.connectMemberId === undefined ? {} : { connectMemberId: input.connectMemberId }) });
}

async function verifyInbox(deps: MemberLoginLinkDeps, input: MemberLoginLinkInput) {
  if (!input.emailProof) return null;
  // Verify outside the link transaction: a wrong code MUST retain its reserved failed attempt.
  // Rollback of the link transaction must never refund the challenge's brute-force budget.
  const proof = await completeSignIn({ deps, input: { workspaceId: input.workspaceId, ...input.emailProof } });
  // The existing owner also mints a session; it is never exposed and must not remain usable.
  await deps.sessions.revoke({ workspaceId: input.workspaceId, id: proof.session.id, revokedAt: nowIso({ clock: deps.clock }) });
  return { ...proof.member, isNewMember: proof.isNewMember };
}

async function activateAndLink({ deps, input, member, pair, now, proof }: {
  deps: MemberLoginLinkDeps; input: MemberLoginLinkInput; member: MemberRecord; pair: MemberExternalIdentityRecord | null; now: string; proof: InboxProof | null;
}, _optional = {}): Promise<MemberRecord> {
  // Only a verified match on the member's own address (or its emailed code) proves that inbox; a
  // connect with a different Google address links the subject without verifying the member email.
  const inbox = proof !== null || member.email === input.identity.email
    ? { status: "active" as const, emailVerifiedAt: member.emailVerifiedAt ?? now } : {};
  const active: MemberRecord = { ...member, ...inbox, credentialsRevokedAt: now, updatedAt: now, version: member.version + 1 };
  await deps.identities.save({ id: pair?.id ?? deps.ids.newId(), workspaceId: input.workspaceId, memberId: member.id,
    providerId: input.identity.providerId, issuer: input.identity.issuer, subject: input.identity.subject, linkedAt: now },
  { allowRelink: Boolean(input.connectMemberId) });
  // Pending accounts may carry operator-created or pre-verification credentials. Inbox proof
  // activates them but must not leave an earlier session alive.
  await deps.sessions.revokeAllForMember({ workspaceId: input.workspaceId, memberId: member.id, revokedAt: now });
  await deps.members.save(active);
  return active;
}

async function linkInTransaction({ deps, input, proof }: { deps: MemberLoginLinkDeps; input: MemberLoginLinkInput; proof: InboxProof | null }, _optional = {}): Promise<MemberLoginLinkResult> {
  // One workspace key serializes new-email and subject races. The member lifecycle lock also
  // fences Trash/restore; S3 unlink must take these same locks in this order.
  await deps.lockKey(`members:external-identities:${input.workspaceId}`);
  let target = await resolveTarget(deps, input);
  if (target.member) await deps.lockKey(`trash:member:${input.workspaceId}:${target.member.id}`);
  target = await resolveTarget(deps, input);
  assertEligible({ member: target.member, input });
  proofMatchesTarget({ target, input, proof });
  const decision = decisionFor({ target, input, proof });
  if (decision === "blocked" || decision === "conflict") throw new MemberLoginError({ code: "LOGIN_BLOCKED" });
  if (decision === "email_verification_required") {
    return { kind: "email_verification_required", email: target.member?.email ?? input.identity.email, providerId: input.identity.providerId };
  }
  return finishLogin({ deps, input, target, proof, subjectLinked: decision === "sign_in" });
}

async function finishLogin({ deps, input, target, proof, subjectLinked }: {
  deps: MemberLoginLinkDeps; input: MemberLoginLinkInput; target: LoginTarget; proof: InboxProof | null; subjectLinked: boolean;
}, _optional = {}): Promise<MemberLoginLinkResult> {
  const now = nowIso({ clock: deps.clock });
  let member = target.member;
  if (!member) member = (await createMember({ deps, input: { workspaceId: input.workspaceId, email: input.identity.email } }, { deferCreatedNotification: true })).member;
  if (!subjectLinked || member.status === "pending") member = await activateAndLink({ deps, input, member, pair: target.pair, now, proof });
  const result = await issueMemberSession({ deps, member, nowIso: now }, { userAgent: input.userAgent, ip: input.ip });
  return { kind: "signed_in", result: { ...result, isNewMember: !target.member || proof?.isNewMember === true } };
}

/** Resolve/link/activate and mint the member session in one kernel transaction. A uniqueness
 * race retries the WHOLE transaction once, never a query inside aborted PostgreSQL state.
 * @returns An internal inbox-proof request without linking, or the existing session owner's result.
 * @throws Fixed LOGIN_* errors; challenge attempts/consumption survive a failed link transaction.
 * @complexity O(1) indexed lookups/writes plus session revocation; at most two transactions.
 */
export async function resolveFederatedIdentity(required: {
  deps: MemberLoginLinkDeps; input: MemberLoginLinkInput;
}, _options: Record<string, never> = {}): Promise<MemberLoginLinkResult> {
  const { deps, input } = required;
  try {
    const proof = await verifyInbox(deps, input);
    const linked = await retryLink({ deps, input, proof });
    if (linked.kind === "signed_in" && linked.result.isNewMember && !proof?.isNewMember) {
      notifyMemberCreated({ deps, member: linked.result.member, creationSource: "oidc_signup", initialState: "active" });
    }
    return linked;
  } catch (error) {
    if (error instanceof MemberLoginError) throw error;
    throw new MemberLoginError({ code: "LOGIN_INVALID" });
  }
}

async function retryLink({ deps, input, proof }: { deps: MemberLoginLinkDeps; input: MemberLoginLinkInput; proof: InboxProof | null }, _optional = {}) {
  try {
    return await deps.transaction(async () => linkInTransaction({ deps, input, proof }));
  } catch (error) {
    if (!isUniqueViolation({ err: error })) throw error;
    return deps.transaction(async () => linkInTransaction({ deps, input, proof }));
  }
}

/** Reuse the existing mail/challenge lifecycle after S3 has retained the verified continuation.
 * @returns The existing enumeration-safe challenge handle. No new login-attempt table.
 * @complexity O(1) challenge issuance plus existing provider-owned email delivery.
 */
export async function requestLoginEmailProof(required: {
  deps: MembersWriteServiceDeps & Pick<MemberLoginLinkDeps, "reportFailure">; input: { workspaceId: string; email: string };
}, _options: Record<string, never> = {}) {
  try {
    return await requestSignInLink(required);
  } catch (error) {
    required.deps.reportFailure({ operation: "member-login:request-email-proof", error });
    throw new MemberLoginError({ code: "LOGIN_UNAVAILABLE" });
  }
}
