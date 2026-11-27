import { describe, expect, it } from "vitest";
import { resolveFederatedIdentity, type MemberLoginLinkDeps, type MemberLoginLinkInput } from "../link-service.js";
import { InMemoryMemberExternalIdentityRepo } from "../../members/repo.memory.js";
import type { MemberExternalIdentityRecord, MemberRecord } from "../../members/types.js";
import type { VerifiedLoginIdentity } from "../../server/login-types.js";
import { memberAuthHarness, memberRow, T0, WS } from "../../members/__tests__/member-auth.gap-harness.js";

const T5 = "2026-01-01T00:05:00.000Z";
const relaxed: VerifiedLoginIdentity = { providerId: "google", issuer: "https://issuer.example", subject: "sub-1", email: "ada@example.com", emailAuthoritative: false };

function harness(options: { members?: MemberRecord[]; transaction?: MemberLoginLinkDeps["transaction"] } = {}) {
  const h = memberAuthHarness({ members: options.members ?? [] });
  const identities = new InMemoryMemberExternalIdentityRepo({});
  const deps: MemberLoginLinkDeps = {
    ...h.deps, identities,
    transaction: options.transaction ?? (async (run) => run()),
    lockKey: async () => undefined,
    reportFailure: () => { throw new Error("not expected in these flows"); },
  };
  return { ...h, deps, identities };
}

const login = (deps: MemberLoginLinkDeps, overrides: Partial<MemberLoginLinkInput> = {}) =>
  resolveFederatedIdentity({ deps, input: { workspaceId: WS, identity: relaxed, startedAt: T0, ...overrides } });

describe("resolveFederatedIdentity with an emailed inbox proof", () => {
  it("links after a correct code and revokes the session the challenge owner minted for the proof", async () => {
    const h = harness({ members: [memberRow()] });
    await h.seedChallenge({ purpose: "signin", member: memberRow(), code: "123456" });
    h.setNow(T5);
    const out = await login(h.deps, { emailProof: { challengeId: "c-1", code: "123456" } });
    if (out.kind !== "signed_in") throw new Error(`unexpected ${out.kind}`);
    const sessions = await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" });
    expect(sessions.map((s) => [s.id === out.result.session.id, s.revokedAt ?? null])).toEqual([[false, T5], [true, null]]);
    expect(await h.identities.listByMember({ workspaceId: WS, memberId: "m-1" })).toHaveLength(1);
  });

  it("reports a proof-created account as new without a second (oidc) creation event", async () => {
    const h = harness();
    await h.seedChallenge({ purpose: "signin", member: null, email: "ada@example.com", code: "123456" });
    const out = await login(h.deps, { emailProof: { challengeId: "c-1", code: "123456" } });
    if (out.kind !== "signed_in") throw new Error(`unexpected ${out.kind}`);
    expect(out.result.isNewMember).toBe(true);
    expect(h.created).toEqual([{ workspaceId: WS, memberId: "id-1", creationSource: "verified_signup", initialState: "pending" }]);
  });

  it("refuses a proof for a different address and a wrong code, both as LOGIN_INVALID", async () => {
    const h = harness({ members: [memberRow(), memberRow({ id: "m-2", email: "bo@example.com" })] });
    await h.seedChallenge({ purpose: "signin", member: memberRow({ id: "m-2", email: "bo@example.com" }), code: "123456" });
    await expect(login(h.deps, { emailProof: { challengeId: "c-1", code: "123456" } })).rejects.toMatchObject({ code: "LOGIN_INVALID" });
    expect(await h.identities.listByMember({ workspaceId: WS, memberId: "m-1" })).toEqual([]);
    await h.seedChallenge({ purpose: "signin", member: memberRow(), challengeId: "c-2", rawToken: "raw-2", code: "123456" });
    await expect(login(h.deps, { emailProof: { challengeId: "c-2", code: "999999" } })).rejects.toMatchObject({ code: "LOGIN_INVALID" });
  });
});

describe("resolveFederatedIdentity connect and retry", () => {
  it("connects a different provider address to the signed-in member without verifying the member email", async () => {
    const member = memberRow({ status: "pending" });
    const h = harness({ members: [member] });
    h.setNow(T5);
    const out = await login(h.deps, { connectMemberId: "m-1", identity: { ...relaxed, email: "other@example.com" } });
    if (out.kind !== "signed_in") throw new Error(`unexpected ${out.kind}`);
    expect(out.result.member).toEqual({ ...member, credentialsRevokedAt: T5, updatedAt: T5, version: 2 });
  });

  it("refuses a connect whose signed-in member differs from the subject's owner", async () => {
    const h = harness({ members: [memberRow(), memberRow({ id: "m-2", email: "bo@example.com" })] });
    const link: MemberExternalIdentityRecord = { id: "x-1", workspaceId: WS, memberId: "m-2", providerId: "google", issuer: relaxed.issuer, subject: "sub-1", linkedAt: T0 };
    await h.identities.save(link);
    await expect(login(h.deps, { connectMemberId: "m-1" })).rejects.toMatchObject({ code: "LOGIN_BLOCKED" });
  });

  it("retries the whole transaction once after a uniqueness race, and not after other errors", async () => {
    let calls = 0;
    const racing = harness({ members: [memberRow()], transaction: async (run) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return run();
    } });
    const out = await login(racing.deps, { identity: { ...relaxed, emailAuthoritative: true } });
    expect([out.kind, calls]).toEqual(["signed_in", 2]);

    let failing = 0;
    const broken = harness({ members: [memberRow()], transaction: async () => { failing += 1; throw new Error("disk full"); } });
    await expect(login(broken.deps, { identity: { ...relaxed, emailAuthoritative: true } })).rejects.toMatchObject({ code: "LOGIN_INVALID" });
    expect(failing).toBe(1);
  });
});
