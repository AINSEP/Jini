import { expect, it, vi } from "vitest";
import { unlinkMemberIdentity } from "../unlink-identity.js";
import type { MemberLoginLinkDeps } from "../link-service.js";
import { issueMemberSession } from "../../members/member-credentials.js";
import { prepareMemberChallenge } from "../../members/member-challenge-request.js";
import type { MemberRecord, MemberSessionRecord } from "../../members/types.js";

vi.mock("../../members/member-credentials.js", () => ({ issueMemberSession: vi.fn() }));
vi.mock("../../members/member-challenge-request.js", () => ({ prepareMemberChallenge: vi.fn() }));

const member: MemberRecord = { id: "m", workspaceId: "w", email: "m@example.com", status: "active", emailVerifiedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 };
const session: MemberSessionRecord = { id: "s", memberId: "m", workspaceId: "w", tokenHash: "h", createdAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" };

it("re-reads the session after both locks and rolls back identity/session changes if issuance fails", async () => {
  const calls: string[] = [];
  let changed = false;
  const links = { transaction: async (work: () => Promise<unknown>) => { try { return await work(); } catch (error) { changed = false; throw error; } }, lockKey: async (key: string) => { calls.push(key); }, identities: { findByMemberAndProvider: async () => ({ id: "i" }), unlink: async () => { changed = true; calls.push("unlink"); } } } as unknown as MemberLoginLinkDeps;
  const readCurrent = vi.fn(async () => { calls.push("current"); return { member, session }; });
  const revokeSessions = vi.fn(async () => { calls.push("revoke"); });
  const saveMember = vi.fn(async () => { calls.push("save"); });
  vi.mocked(issueMemberSession).mockImplementation(async () => { calls.push("issue"); throw new Error("issue failed"); });
  await expect(unlinkMemberIdentity({ workspaceId: "w", providerId: "p", readCurrent, readProviderId: ({ providerId }) => providerId ?? "", links, readPasswordHash: async () => "hash", revokeSessions, saveMember, nowIso: () => "2026-01-01T00:01:00Z", userAgent: undefined, ip: "ip" })).rejects.toThrow("issue failed");
  expect(calls).toEqual(["current", "members:external-identities:w", "trash:member:w:m", "current", "unlink", "revoke", "save", "issue"]);
  expect(changed).toBe(false);
  expect(issueMemberSession).toHaveBeenCalledWith(expect.objectContaining({ deps: links, member: expect.objectContaining({ version: 2 }) }), { userAgent: undefined, ip: "ip" });
});

it("rejects stale and future sessions and requires mail readiness for a pending password without delivery", async () => {
  const links = { transaction: async (work: () => Promise<unknown>) => work(), lockKey: async () => {}, identities: { findByMemberAndProvider: async () => ({ id: "i" }), unlink: vi.fn(async () => {}) } } as unknown as MemberLoginLinkDeps;
  const deliver = vi.fn(async () => ({ delivered: true, challengeId: "c" }));
  vi.mocked(prepareMemberChallenge).mockResolvedValue({ challengeId: "c", deliver });
  vi.mocked(issueMemberSession).mockResolvedValue({ member, session, rawSessionToken: "token" });
  const input = { workspaceId: "w", providerId: "p", readCurrent: async () => ({ member: { ...member, status: "pending" as const }, session }), readProviderId: () => "p", links, readPasswordHash: async () => "hash", revokeSessions: async () => {}, saveMember: async () => {}, nowIso: () => "2026-01-01T00:01:00Z", userAgent: undefined, ip: "ip" };
  for (const now of ["2025-12-31T23:59:59Z", "2026-01-01T00:15:01Z"]) await expect(unlinkMemberIdentity({ ...input, nowIso: () => now })).rejects.toMatchObject({ code: "LOGIN_BLOCKED" });
  await unlinkMemberIdentity(input);
  expect(prepareMemberChallenge).toHaveBeenCalledWith({ deps: links, input: { workspaceId: "w", email: member.email }, purpose: "signin" });
  expect(deliver).not.toHaveBeenCalled();
});

it("refuses unlinking the last sign-in method before any identity or session write", async () => {
  const unlink = vi.fn(async () => {});
  const revokeSessions = vi.fn(async () => {});
  const saveMember = vi.fn(async () => {});
  const links = { transaction: async (work: () => Promise<unknown>) => work(), lockKey: async () => {}, identities: { findByMemberAndProvider: async () => ({ id: 'identity' }), unlink } } as unknown as MemberLoginLinkDeps;
  vi.mocked(prepareMemberChallenge).mockRejectedValueOnce(new Error('mail unavailable'));
  await expect(unlinkMemberIdentity({ workspaceId: 'w', providerId: 'provider', readCurrent: async () => ({ member, session }), readProviderId: () => 'provider', links, readPasswordHash: async () => null, revokeSessions, saveMember, nowIso: () => '2026-01-01T00:01:00Z', userAgent: undefined, ip: 'ip' })).rejects.toMatchObject({ code: 'LOGIN_BLOCKED' });
  expect(unlink).not.toHaveBeenCalled();
  expect(revokeSessions).not.toHaveBeenCalled();
  expect(saveMember).not.toHaveBeenCalled();
});

function unlinkInput(overrides: Partial<Parameters<typeof unlinkMemberIdentity>[0]> & { found?: unknown } = {}) {
  const unlink = vi.fn(async () => {});
  const lockKey = vi.fn(async () => {});
  const links = { transaction: async (work: () => Promise<unknown>) => work(), lockKey,
    identities: { findByMemberAndProvider: async () => overrides.found, unlink } } as unknown as MemberLoginLinkDeps;
  const { found: _found, ...rest } = overrides;
  return { unlink, lockKey, input: { workspaceId: "w", providerId: "p", readCurrent: async () => ({ member, session }), readProviderId: () => "p", links,
    readPasswordHash: async () => "hash", revokeSessions: vi.fn(async () => {}), saveMember: vi.fn(async () => {}), nowIso: () => "2026-01-01T00:01:00Z",
    userAgent: undefined, ip: "ip", ...rest } };
}

it("refuses without a current session before taking any lock, and when the session vanishes once the locks are held", async () => {
  const absent = unlinkInput({ readCurrent: async () => null, found: { id: "i" } });
  await expect(unlinkMemberIdentity(absent.input)).rejects.toMatchObject({ code: "LOGIN_INVALID" });
  expect(absent.lockKey).not.toHaveBeenCalled();
  let reads = 0;
  const raced = unlinkInput({ readCurrent: async () => (++reads === 1 ? { member, session } : null), found: { id: "i" } });
  await expect(unlinkMemberIdentity(raced.input)).rejects.toMatchObject({ code: "LOGIN_INVALID" });
  expect(raced.lockKey.mock.calls).toEqual([["members:external-identities:w"], ["trash:member:w:m"]]);
  expect(raced.unlink).not.toHaveBeenCalled();
});

it("refuses a provider the member has no live link to: never linked or already unlinked", async () => {
  for (const found of [undefined, null, { id: "i", unlinkedAt: "2025-12-01T00:00:00Z" }]) {
    const run = unlinkInput({ found });
    await expect(unlinkMemberIdentity(run.input)).rejects.toMatchObject({ code: "LOGIN_INVALID" });
    expect(run.unlink).not.toHaveBeenCalled();
    expect(run.input.revokeSessions).not.toHaveBeenCalled();
  }
});

it("refuses a member without a password and an unverified email without asking mail readiness", async () => {
  vi.mocked(prepareMemberChallenge).mockClear();
  const { emailVerifiedAt: _verified, ...unverified } = member;
  const run = unlinkInput({ found: { id: "i" }, readPasswordHash: async () => null, readCurrent: async () => ({ member: unverified, session }) });
  await expect(unlinkMemberIdentity(run.input)).rejects.toMatchObject({ code: "LOGIN_BLOCKED" });
  expect(prepareMemberChallenge).not.toHaveBeenCalled();
  expect(run.unlink).not.toHaveBeenCalled();
});
