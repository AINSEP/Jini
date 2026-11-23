import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import type { MemberSignInInput, MemberSignInResult, MembersWriteServiceDeps } from "./ports.js";
import { MemberAuthError, MemberConflictError, MemberValidationError, type MagicLinkTokenRecord, type MemberRecord } from "./types.js";
import { issueMemberSession } from "./member-credentials.js";
import { consumeMemberChallenge, INVALID_SIGN_IN_CREDENTIAL } from "./member-challenge.js";
import { assertValidEmail } from "./member-validation.js";

/**
 * Resolves or creates a pending member for operator creation or a consumed email challenge.
 * Public sign-in requests never call this owner: unverified addresses must not create accounts.
 * Returns null for a disabled/trashed address. Principal creation precedes the member save.
 * @complexity O(1) — one lookup and at most two saves.
 */
async function resolveOrCreateSignInMember(required: {
  deps: MembersWriteServiceDeps;
  workspaceId: string;
  email: string;
  nowIso: string;
}, optional: { name?: string | undefined; memberId?: string | undefined; creationSource?: "operator" | "verified_signup"; deferCreatedNotification?: boolean | undefined } = {}): Promise<{ member: MemberRecord | null; isNewMember: boolean }> {
  const { deps, workspaceId, email, nowIso } = required;
  const existing = await deps.members.findByEmail({ workspaceId, email });
  if (existing) {
    return { member: existing.status === "disabled" || existing.status === "trash" ? null : existing, isNewMember: false };
  }

  const member: MemberRecord = {
    id: optional.memberId ?? deps.ids.newId(),
    workspaceId,
    email,
    status: "pending",
    ...(optional.name !== undefined ? { name: optional.name } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  };
  // The member's principal row comes first, so a member row never exists without one. Its kind is
  // what makes `authorize()` deny every operator permission to this member (F3144); a principal
  // left behind by a failed member save is inert for the same reason. The display name is not the
  // email, so no second copy of the address lives outside the members tables.
  await deps.principals.save({
    id: member.id,
    workspaceId,
    kind: "member",
    displayName: "Site member",
    status: "active",
    createdAt: nowIso,
  });
  await deps.members.save(member);
  if (!optional.deferCreatedNotification) notifyMemberCreated({ deps, member, creationSource: optional.creationSource ?? "operator", initialState: "pending" });
  return { member, isNewMember: true };
}

/**
 * Creates an operator-requested pending member through the sign-up creation owner.
 * The principal remains kind member; no email verification, consent, token or session is granted.
 * @param required - Injected service ports and workspace-scoped email.
 * @param optional - Optional nonblank display name.
 * @returns The pending member, without a sign-in token or mail side effect.
 * @throws MemberValidationError for malformed input; MemberConflictError for an existing email.
 * @complexity O(1), two indexed email lookups and at most two saves.
 * @example createMember({ deps, input: { workspaceId: "ws", email: "ada@example.com" } }, { name: "Ada" })
 */
export async function createMember(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; email: string };
}, optional: { name?: string | undefined; deferCreatedNotification?: boolean | undefined } = {}): Promise<{ member: MemberRecord }> {
  const { deps, input } = required;
  const email = assertValidEmail({ email: input.email });
  const name = optional.name?.trim();
  if (name !== undefined && !name) throw new MemberValidationError("name must not be blank when provided");
  const existing = await deps.members.findByEmail({ workspaceId: input.workspaceId, email });
  if (existing?.status === "trash") {
    throw new MemberConflictError(`member with email '${email}' is in Trash; restore it from the admin Trash screen`);
  }
  if (existing) {
    throw new MemberConflictError(`member with email '${email}' already exists`);
  }
  const { member } = await resolveOrCreateSignInMember({ deps, workspaceId: input.workspaceId, email, nowIso: clockNowIso({ clock: deps.clock }) }, { name, deferCreatedNotification: optional.deferCreatedNotification });
  if (!member) throw new MemberConflictError(`member with email '${email}' already exists`);
  return { member };
}

/**
 * Resolves legacy member-bound links or creates the account for a consumed new-address link.
 * Rechecking email handles two outstanding signup links and accounts created since issuance.
 * @throws MemberAuthError for an ineligible address or a lost legacy member.
 * @complexity O(1), one lookup and at most two saves through the existing creation owner.
 */
async function resolveConsumedSignInMember(required: {
  deps: MembersWriteServiceDeps; tokenRecord: MagicLinkTokenRecord; nowIso: string;
}, _options: Record<string, never> = {}): Promise<{ member: MemberRecord; isNewMember: boolean }> {
  const { deps, tokenRecord, nowIso } = required;
  if (tokenRecord.email !== undefined) {
    const resolved = await resolveOrCreateSignInMember({
      deps, workspaceId: tokenRecord.workspaceId, email: tokenRecord.email, nowIso,
    }, { memberId: tokenRecord.memberId, creationSource: "verified_signup" });
    if (!resolved.member) throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
    return { member: resolved.member, isNewMember: resolved.isNewMember };
  }
  const member = await deps.members.findById({ workspaceId: tokenRecord.workspaceId, id: tokenRecord.memberId });
  if (!member) throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
  return { member, isNewMember: false };
}

/**
 * Consume a link or code: create/resolve the member, verify email, promote to active,
 * and mint a member session. The raw bearer is returned only for setting the member cookie.
 *
 * @complexity O(1) — one token lookup/consume, one member read/write, one session write.
 * @overallScore 100
 */
export async function completeSignIn(required: {
  deps: MembersWriteServiceDeps;
  input: MemberSignInInput;
}, _options: Record<string, never> = {}): Promise<MemberSignInResult> {
  const { deps, input } = required;
  const nowIso = clockNowIso({ clock: deps.clock });
  const tokenRecord = await consumeMemberChallenge({ deps, input, purpose: "signin", nowIso });

  const { member: existingMember, isNewMember } = await resolveConsumedSignInMember({ deps, tokenRecord, nowIso });
  if (existingMember.status === "disabled" || existingMember.status === "trash") {
    throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
  }
  // A link minted before Trash/restore (including a request racing credential revocation) must
  // not sign the restored account back in. Profile edits and other sign-ins keep links valid.
  if (existingMember.credentialsRevokedAt && existingMember.credentialsRevokedAt >= tokenRecord.createdAt) {
    throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
  }

  const member: MemberRecord = {
    ...existingMember,
    status: existingMember.status === "pending" ? "active" : existingMember.status,
    emailVerifiedAt: existingMember.emailVerifiedAt ?? nowIso,
    updatedAt: nowIso,
    version: existingMember.version + 1,
  };
  await deps.members.save(member);

  return { ...await issueMemberSession({ deps, member, nowIso }, { userAgent: input.userAgent, ip: input.ip }), isNewMember };
}

/** Notify only an actually written member. Observers cannot change durable identity or auth outcomes.
 * @complexity O(1). */
export function notifyMemberCreated(
  { deps, member, creationSource, initialState }: { deps: MembersWriteServiceDeps; member: MemberRecord;
    creationSource: "operator" | "verified_signup" | "oidc_signup"; initialState: "pending" | "active" },
  _optional: Record<string, never> = {},
): void {
  /* Optional product analytics cannot alter a committed member. */
  orFallbackSync({ work: () => { deps.onMemberCreated?.({ workspaceId: member.workspaceId, memberId: member.id, creationSource, initialState }); }, fallback: undefined, step: "members.on-member-created" });
}
