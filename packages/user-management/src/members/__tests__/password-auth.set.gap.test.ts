import { describe, expect, it } from "vitest";
import { setMemberPassword } from "../password-auth.js";
import { MemberAuthError, MemberReauthenticationRequiredError, MemberValidationError } from "../types.js";
import { fakeHash, memberAuthHarness, memberRow, WS } from "./member-auth.gap-harness.js";

const BAD = new MemberAuthError("INVALID_CREDENTIALS");
const T5 = "2026-01-01T00:05:00.000Z";

async function signedIn(options: { status?: "active" | "pending" | "disabled"; password?: string } = {}) {
  const member = memberRow({ status: options.status ?? "active" });
  const h = memberAuthHarness({ members: [member] });
  if (options.password) await h.members.setPasswordHash({ workspaceId: WS, memberId: "m-1", passwordHash: fakeHash(options.password) });
  const presenting = await h.signIn(member);
  const other = await h.signIn(member);
  return { h, member, token: presenting.rawSessionToken, presentingId: presenting.session.id, otherId: other.session.id };
}

async function revokedAtById(h: ReturnType<typeof memberAuthHarness>) {
  return Object.fromEntries((await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).map((s) => [s.id, s.revokedAt ?? null]));
}

describe("setMemberPassword proof", () => {
  it("refuses without a usable session and for a disabled member", async () => {
    const { h } = await signedIn();
    await expect(setMemberPassword({ deps: h.deps, input: { workspaceId: WS, password: "pw-2" } })).rejects.toThrow(BAD);
    await expect(setMemberPassword({ deps: h.deps, input: { workspaceId: WS, sessionToken: "not-a-session", password: "pw-2" } })).rejects.toThrow(BAD);
    const disabled = await signedIn({ status: "disabled" });
    await expect(setMemberPassword({ deps: disabled.h.deps, input: { workspaceId: WS, sessionToken: disabled.token, password: "pw-2" } })).rejects.toThrow(BAD);
  });

  it("requires the correct current password when one is set", async () => {
    const { h, token } = await signedIn({ password: "pw-1" });
    await expect(setMemberPassword({ deps: h.deps, input: { workspaceId: WS, sessionToken: token, password: "pw-2" } })).rejects.toThrow(BAD);
    await expect(setMemberPassword({ deps: h.deps, input: { workspaceId: WS, sessionToken: token, password: "pw-2", currentPassword: "nope" } })).rejects.toThrow(BAD);
    expect(await h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBe(fakeHash("pw-1"));
  });

  it("changes the password, keeps only the presenting session and stamps the cutoff without touching status", async () => {
    const { h, member, token, presentingId, otherId } = await signedIn({ password: "pw-1", status: "pending" });
    h.setNow(T5);
    expect(await setMemberPassword({ deps: h.deps, input: { workspaceId: WS, sessionToken: token, password: "pw-2", currentPassword: "pw-1" } })).toEqual({ ok: true });
    expect(await h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBe(fakeHash("pw-2"));
    expect(await revokedAtById(h)).toEqual({ [presentingId]: null, [otherId]: T5 });
    expect(await h.members.findById({ workspaceId: WS, id: "m-1" })).toEqual({ ...member, credentialsRevokedAt: T5, updatedAt: T5, version: 2 });
  });

  it("rejects a policy-violating password only after the proof succeeds", async () => {
    const { h, token } = await signedIn({ password: "pw-1" });
    await expect(setMemberPassword({ deps: h.deps, input: { workspaceId: WS, sessionToken: token, password: "", currentPassword: "pw-1" } }))
      .rejects.toThrow(new MemberValidationError("Password is required."));
  });
});

describe("setMemberPassword for a passwordless account", () => {
  it("accepts a session issued within the last 15 minutes and refuses an older one", async () => {
    const fresh = await signedIn();
    fresh.h.setNow("2026-01-01T00:15:00.000Z");
    await expect(setMemberPassword({ deps: fresh.h.deps, input: { workspaceId: WS, sessionToken: fresh.token, password: "pw-2" } })).resolves.toEqual({ ok: true });
    const stale = await signedIn();
    stale.h.setNow("2026-01-01T00:15:00.001Z");
    const attempt = setMemberPassword({ deps: stale.h.deps, input: { workspaceId: WS, sessionToken: stale.token, password: "pw-2" } });
    await expect(attempt).rejects.toBeInstanceOf(MemberReauthenticationRequiredError);
    await expect(attempt).rejects.toThrow("sign in again to set a password");
  });

  it("re-checks session age inside the lock when hashing crosses the 15-minute window", async () => {
    const { h, token } = await signedIn();
    h.hooks.onHash = () => { h.setNow("2026-01-01T00:16:00.000Z"); };
    await expect(setMemberPassword({ deps: h.deps, input: { workspaceId: WS, sessionToken: token, password: "pw-2" } }))
      .rejects.toBeInstanceOf(MemberReauthenticationRequiredError);
    expect(await h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBeNull();
  });
});

describe("setMemberPassword revalidates after hashing", () => {
  it("refuses when another password lands while hashing", async () => {
    const { h, token } = await signedIn();
    h.hooks.onHash = async () => { await h.members.setPasswordHash({ workspaceId: WS, memberId: "m-1", passwordHash: fakeHash("pw-x") }); };
    await expect(setMemberPassword({ deps: h.deps, input: { workspaceId: WS, sessionToken: token, password: "pw-2" } })).rejects.toThrow(BAD);
    expect(await h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBe(fakeHash("pw-x"));
  });

  it("refuses when the presenting session is revoked or the credential cutoff moves while hashing", async () => {
    const revoked = await signedIn();
    revoked.h.hooks.onHash = async () => { await revoked.h.sessions.revoke({ workspaceId: WS, id: revoked.presentingId, revokedAt: T5 }); };
    await expect(setMemberPassword({ deps: revoked.h.deps, input: { workspaceId: WS, sessionToken: revoked.token, password: "pw-2" } })).rejects.toThrow(BAD);
    const cut = await signedIn();
    cut.h.hooks.onHash = async () => { await cut.h.members.save({ ...cut.member, credentialsRevokedAt: T5, version: 2 }); };
    await expect(setMemberPassword({ deps: cut.h.deps, input: { workspaceId: WS, sessionToken: cut.token, password: "pw-2" } })).rejects.toThrow(BAD);
    expect(await cut.h.members.findPasswordHash({ workspaceId: WS, memberId: "m-1" })).toBeNull();
  });
});
