import { describe, expect, it } from "vitest";
import { resolveFederatedIdentity, type MemberLoginLinkDeps, type MemberLoginLinkInput } from "../link-service.js";
import { InMemoryMemberExternalIdentityRepo } from "../../members/repo.memory.js";
import type { MemberExternalIdentityRecord, MemberRecord } from "../../members/types.js";
import type { VerifiedLoginIdentity } from "../../server/login-types.js";
import { memberAuthHarness, memberRow, T0, WS } from "../../members/__tests__/member-auth.gap-harness.js";

const T5 = "2026-01-01T00:05:00.000Z";
const google: VerifiedLoginIdentity = { providerId: "google", issuer: "https://issuer.example", subject: "sub-1", email: "ada@example.com", emailAuthoritative: true };

function linkRow(overrides: Partial<MemberExternalIdentityRecord> = {}): MemberExternalIdentityRecord {
  return { id: "x-1", workspaceId: WS, memberId: "m-1", providerId: "google", issuer: google.issuer, subject: "sub-1", linkedAt: T0, ...overrides };
}

function harness(options: { members?: MemberRecord[]; identities?: MemberExternalIdentityRecord[] } = {}) {
  const h = memberAuthHarness({ members: options.members ?? [] });
  const identities = new InMemoryMemberExternalIdentityRepo({});
  const locks: string[] = [];
  let transactions = 0;
  const deps: MemberLoginLinkDeps = {
    ...h.deps, identities,
    transaction: async (run) => { transactions += 1; return run(); },
    lockKey: async (key: string) => { locks.push(key); },
    reportFailure: () => { throw new Error("not expected in these flows"); },
  };
  const seed = async () => { for (const row of options.identities ?? []) await identities.save(row); };
  h.setNow(T5);
  return { ...h, deps, identities, locks, seed, transactions: () => transactions };
}

const login = (deps: MemberLoginLinkDeps, overrides: Partial<MemberLoginLinkInput> = {}) =>
  resolveFederatedIdentity({ deps, input: { workspaceId: WS, identity: google, startedAt: T0, ...overrides } });

describe("resolveFederatedIdentity: create, link, sign in", () => {
  it("creates an active, verified member for a new authoritative identity and reports one oidc signup", async () => {
    const h = harness();
    const out = await login(h.deps, { userAgent: "ua", ip: "10.0.0.3" });
    if (out.kind !== "signed_in") throw new Error(`unexpected ${out.kind}`);
    expect(out.result.isNewMember).toBe(true);
    expect(out.result.member).toMatchObject({ id: "id-1", email: "ada@example.com", status: "active", emailVerifiedAt: T5, credentialsRevokedAt: T5, version: 2 });
    expect(out.result.session).toMatchObject({ memberId: "id-1", userAgent: "ua", ip: "10.0.0.3" });
    expect(await h.identities.findBySubject({ workspaceId: WS, issuer: google.issuer, subject: "sub-1" })).toEqual(
      { id: "id-2", workspaceId: WS, memberId: "id-1", providerId: "google", issuer: google.issuer, subject: "sub-1", linkedAt: T5 });
    expect(h.created).toEqual([{ workspaceId: WS, memberId: "id-1", creationSource: "oidc_signup", initialState: "active" }]);
    expect(h.locks).toEqual([`members:external-identities:${WS}`]);
  });

  it("links an existing pending member on the same address, activating it and revoking earlier sessions", async () => {
    const pending = memberRow({ status: "pending" });
    const h = harness({ members: [pending] });
    const { session: earlier } = await h.signIn(pending);
    const out = await login(h.deps);
    if (out.kind !== "signed_in") throw new Error(`unexpected ${out.kind}`);
    expect(out.result.isNewMember).toBe(false);
    expect(out.result.member).toEqual({ ...pending, status: "active", emailVerifiedAt: T5, credentialsRevokedAt: T5, updatedAt: T5, version: 2 });
    const revoked = (await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).find((s) => s.id === earlier.id);
    expect(revoked!.revokedAt).toBe(T5);
    expect(h.locks).toEqual([`members:external-identities:${WS}`, `trash:member:${WS}:m-1`]);
    expect(h.created).toEqual([]);
  });

  it("signs a linked active member straight in without rewriting the member or the link", async () => {
    const h = harness({ members: [memberRow({ email: "changed@example.com" })], identities: [linkRow()] });
    await h.seed();
    const out = await login(h.deps);
    if (out.kind !== "signed_in") throw new Error(`unexpected ${out.kind}`);
    expect(out.result.member).toEqual(memberRow({ email: "changed@example.com" }));
    expect((await h.identities.findBySubject({ workspaceId: WS, issuer: google.issuer, subject: "sub-1" }))!.linkedAt).toBe(T0);
  });

  it("re-activates a linked but pending member by rewriting its existing link row, not a new one", async () => {
    const h = harness({ members: [memberRow({ status: "pending" })], identities: [linkRow()] });
    await h.seed();
    const out = await login(h.deps);
    if (out.kind !== "signed_in") throw new Error(`unexpected ${out.kind}`);
    expect(out.result.member.status).toBe("active");
    expect(await h.identities.listByMember({ workspaceId: WS, memberId: "m-1" })).toEqual([linkRow({ linkedAt: T5 })]);
  });

  it("asks for inbox proof before linking a non-authoritative address, writing nothing", async () => {
    const h = harness({ members: [memberRow()] });
    expect(await login(h.deps, { identity: { ...google, emailAuthoritative: false } }))
      .toEqual({ kind: "email_verification_required", email: "ada@example.com", providerId: "google" });
    const fresh = harness();
    expect(await login(fresh.deps, { identity: { ...google, email: "new@example.com", emailAuthoritative: false } }))
      .toEqual({ kind: "email_verification_required", email: "new@example.com", providerId: "google" });
    expect(await h.identities.listByMember({ workspaceId: WS, memberId: "m-1" })).toEqual([]);
  });
});

describe("resolveFederatedIdentity: refusals", () => {
  it("refuses a subject whose member is gone or that was issued for another provider", async () => {
    const gone = harness({ identities: [linkRow({ memberId: "gone" })] });
    await gone.seed();
    await expect(login(gone.deps)).rejects.toMatchObject({ code: "LOGIN_CONFLICT" });
    const other = harness({ members: [memberRow()], identities: [linkRow({ providerId: "other" })] });
    await other.seed();
    await expect(login(other.deps)).rejects.toMatchObject({ code: "LOGIN_CONFLICT" });
  });

  it("refuses when the member already has a different live subject for this provider", async () => {
    const h = harness({ members: [memberRow()], identities: [linkRow({ subject: "sub-other" })] });
    await h.seed();
    await expect(login(h.deps)).rejects.toMatchObject({ code: "LOGIN_CONFLICT" });
  });

  it("blocks a disabled member, a login started before the credential cutoff and an unlinked pair", async () => {
    await expect(login(harness({ members: [memberRow({ status: "disabled" })] }).deps)).rejects.toMatchObject({ code: "LOGIN_BLOCKED" });
    await expect(login(harness({ members: [memberRow({ credentialsRevokedAt: T0 })] }).deps)).rejects.toMatchObject({ code: "LOGIN_BLOCKED" });
    const unlinked = harness({ members: [memberRow()], identities: [linkRow({ subject: "sub-old", unlinkedAt: T0 })] });
    await unlinked.seed();
    await expect(login(unlinked.deps)).rejects.toMatchObject({ code: "LOGIN_BLOCKED" });
  });

  it("rejects an unparseable start time and maps unexpected failures to LOGIN_INVALID", async () => {
    await expect(login(harness().deps, { startedAt: "not-a-date" })).rejects.toMatchObject({ code: "LOGIN_INVALID" });
    const h = harness();
    h.deps.members.findByEmail = async () => { throw new Error("db down: host=10.0.0.9"); };
    const failure = login(h.deps);
    await expect(failure).rejects.toMatchObject({ code: "LOGIN_INVALID", message: "LOGIN_INVALID" });
  });
});
