import { describe, expect, it } from "vitest";
import { resetPassword, signInWithPassword } from "../password-auth.js";
import { MemberAuthError, MemberValidationError } from "../types.js";
import { fakeHash, memberAuthHarness, memberRow, T0, WS } from "./member-auth.gap-harness.js";

const BAD = new MemberAuthError("INVALID_CREDENTIALS");
const INVALID_LINK = new MemberAuthError("sign-in credential is invalid");
const LATER = "2026-01-01T00:05:00.000Z";

async function withPassword(rows = [memberRow()], password = "pw-1") {
  const h = memberAuthHarness({ members: rows });
  await h.members.setPasswordHash({ workspaceId: WS, memberId: rows[0]!.id, passwordHash: fakeHash(password) });
  return h;
}

describe("signInWithPassword", () => {
  it("normalizes the address, verifies once and mints a session carrying the client details", async () => {
    const h = await withPassword();
    const result = await signInWithPassword({ deps: h.deps, input: { workspaceId: WS, email: "  ADA@example.com ", password: "pw-1", userAgent: "ua", ip: "10.0.0.2" } });
    expect(result.member).toEqual(memberRow());
    expect(result.session).toMatchObject({ workspaceId: WS, memberId: "m-1", createdAt: T0, userAgent: "ua", ip: "10.0.0.2" });
    expect(h.hasherCalls).toEqual([{ op: "verify", password: "pw-1", hash: fakeHash("pw-1") }]);
  });

  it("spends a verify against the dummy hash for an unknown address and still refuses", async () => {
    const h = memberAuthHarness();
    await expect(signInWithPassword({ deps: h.deps, input: { workspaceId: WS, email: "who@example.com", password: "pw-1" } })).rejects.toThrow(BAD);
    expect(h.hasherCalls.map((c) => c.op)).toEqual(["hash", "verify"]);
    expect(h.hasherCalls[1]!.hash).toBe(fakeHash(h.hasherCalls[0]!.password));
  });

  it("refuses a wrong password, a passwordless account and a pending account with the same error", async () => {
    const wrong = await withPassword();
    await expect(signInWithPassword({ deps: wrong.deps, input: { workspaceId: WS, email: "ada@example.com", password: "pw-2" } })).rejects.toThrow(BAD);
    const passwordless = memberAuthHarness({ members: [memberRow()] });
    await expect(signInWithPassword({ deps: passwordless.deps, input: { workspaceId: WS, email: "ada@example.com", password: "pw-1" } })).rejects.toThrow(BAD);
    const pending = await withPassword([memberRow({ status: "pending" })]);
    await expect(signInWithPassword({ deps: pending.deps, input: { workspaceId: WS, email: "ada@example.com", password: "pw-1" } })).rejects.toThrow(BAD);
    expect(await pending.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).toEqual([]);
  });

  it("refuses when an administrator disables the member while the hash is being verified", async () => {
    const h = await withPassword();
    h.hooks.onVerify = async () => { await h.members.save(memberRow({ status: "disabled", version: 2 })); };
    await expect(signInWithPassword({ deps: h.deps, input: { workspaceId: WS, email: "ada@example.com", password: "pw-1" } })).rejects.toThrow(BAD);
    expect(await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).toEqual([]);
  });

  it("revokes the just-minted session when a password reset lands before the credential re-read", async () => {
    const h = await withPassword();
    const realSave = h.sessions.save.bind(h.sessions);
    h.sessions.save = async (session) => {
      await realSave(session);
      await h.members.setPasswordHash({ workspaceId: WS, memberId: "m-1", passwordHash: fakeHash("pw-new") });
    };
    await expect(signInWithPassword({ deps: h.deps, input: { workspaceId: WS, email: "ada@example.com", password: "pw-1" } })).rejects.toThrow(BAD);
    const [session] = await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" });
    expect(session!.revokedAt).toBe(T0);
  });
});

describe("resetPassword", () => {
  it("rejects a policy-violating password before consuming the link", async () => {
    const h = memberAuthHarness({ members: [memberRow()] });
    await h.seedChallenge({ purpose: "password_reset", member: memberRow() });
    await expect(resetPassword({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", password: "" } }))
      .rejects.toThrow(new MemberValidationError("Password is required."));
    expect((await h.magicLinks.findById({ workspaceId: WS, id: "c-1" }))!.consumedAt).toBeUndefined();
  });

  it("writes the hash, revokes every session and verifies + activates a pending inbox owner", async () => {
    const pending = memberRow({ status: "pending" });
    const h = memberAuthHarness({ members: [pending] });
    const { session } = await h.signIn(pending);
    await h.seedChallenge({ purpose: "password_reset", member: pending });
    h.setNow(LATER);
    expect(await resetPassword({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", password: "pw-new" } })).toEqual({ ok: true });
    expect(await h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBe(fakeHash("pw-new"));
    expect(await h.members.findById({ workspaceId: WS, id: "m-1" })).toEqual({ ...pending, status: "active", emailVerifiedAt: LATER, credentialsRevokedAt: LATER, updatedAt: LATER, version: 2 });
    expect((await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).map((s) => [s.id, s.revokedAt])).toEqual([[session.id, LATER]]);
  });

  it("fails closed without a transactional credential lifecycle", async () => {
    const h = memberAuthHarness({ members: [memberRow()], lifecycle: false });
    await h.seedChallenge({ purpose: "password_reset", member: memberRow() });
    await expect(resetPassword({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", password: "pw-new" } }))
      .rejects.toThrow(new MemberValidationError("member credential transactions are unavailable"));
    expect(await h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBeNull();
  });

  it("refuses a missing member, a disabled member and a link minted at the credential cutoff", async () => {
    for (const rows of [[], [memberRow({ status: "disabled" })], [memberRow({ credentialsRevokedAt: T0 })]]) {
      const h = memberAuthHarness({ members: rows });
      await h.seedChallenge({ purpose: "password_reset", member: memberRow() });
      await expect(resetPassword({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", password: "pw-new" } })).rejects.toThrow(INVALID_LINK);
    }
  });
});

describe("resetPassword re-authorizes inside the lock", () => {
  it("refuses when the link expires while the new password is being hashed", async () => {
    const h = memberAuthHarness({ members: [memberRow()] });
    await h.seedChallenge({ purpose: "password_reset", member: memberRow() });
    h.hooks.onHash = () => { h.setNow("2026-01-01T00:15:00.000Z"); };
    await expect(resetPassword({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", password: "pw-new" } })).rejects.toThrow(INVALID_LINK);
    expect(await h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBeNull();
  });

  it("refuses when the credential cutoff moves (even to an earlier time) while hashing", async () => {
    const h = memberAuthHarness({ members: [memberRow()] });
    h.setNow(LATER);
    await h.seedChallenge({ purpose: "password_reset", member: memberRow() });
    h.hooks.onHash = async () => { await h.members.save(memberRow({ credentialsRevokedAt: T0, version: 2 })); };
    await expect(resetPassword({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", password: "pw-new" } })).rejects.toThrow(INVALID_LINK);
  });

  it("refuses with the credentials error when the member is disabled while hashing", async () => {
    const h = memberAuthHarness({ members: [memberRow()] });
    await h.seedChallenge({ purpose: "password_reset", member: memberRow() });
    h.hooks.onHash = async () => { await h.members.save(memberRow({ status: "disabled", version: 2 })); };
    await expect(resetPassword({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", password: "pw-new" } })).rejects.toThrow(BAD);
  });
});
