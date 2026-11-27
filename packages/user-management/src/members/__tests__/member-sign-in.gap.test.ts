import { describe, expect, it } from "vitest";
import { completeSignIn, createMember } from "../member-sign-in.js";
import { MemberAuthError, MemberConflictError, MemberValidationError } from "../types.js";
import { memberAuthHarness, memberRow, T0, WS } from "./member-auth.gap-harness.js";

const INVALID = "sign-in credential is invalid";
const LATER = "2026-01-01T00:05:00.000Z";

describe("createMember", () => {
  it("saves the member principal first, then a pending member with the trimmed name, and notifies once", async () => {
    const h = memberAuthHarness();
    const { member } = await createMember({ deps: h.deps, input: { workspaceId: WS, email: "  Ada@Example.COM " } }, { name: "  Ada " });
    expect(member).toEqual({ id: "id-1", workspaceId: WS, email: "ada@example.com", status: "pending", name: "Ada", createdAt: T0, updatedAt: T0, version: 1 });
    expect(h.principalSaves).toEqual([{ id: "id-1", workspaceId: WS, kind: "member", displayName: "Site member", status: "active", createdAt: T0 }]);
    expect(h.order).toEqual(["principal", "member:pending", "created-event"]);
    expect(h.created).toEqual([{ workspaceId: WS, memberId: "id-1", creationSource: "operator", initialState: "pending" }]);
    expect(await h.members.findByEmail({ workspaceId: WS, email: "ada@example.com" })).toEqual(member);
  });

  it("omits the name key when none is given and defers the notification when asked", async () => {
    const h = memberAuthHarness();
    const { member } = await createMember({ deps: h.deps, input: { workspaceId: WS, email: "bo@example.com" } }, { deferCreatedNotification: true });
    expect("name" in member).toBe(false);
    expect(h.created).toEqual([]);
  });

  it("rejects a blank name and a malformed address before touching storage", async () => {
    const h = memberAuthHarness();
    await expect(createMember({ deps: h.deps, input: { workspaceId: WS, email: "a@example.com" } }, { name: "   " }))
      .rejects.toThrow(new MemberValidationError("name must not be blank when provided"));
    await expect(createMember({ deps: h.deps, input: { workspaceId: WS, email: "not-an-email" } }))
      .rejects.toThrow(new MemberValidationError("'not-an-email' is not a valid email address"));
    expect(h.order).toEqual([]);
  });

  it("refuses an address that already exists, pointing a trashed one at the Trash screen", async () => {
    const h = memberAuthHarness({ members: [memberRow(), memberRow({ id: "m-2", email: "old@example.com", status: "trash" })] });
    await expect(createMember({ deps: h.deps, input: { workspaceId: WS, email: "ada@example.com" } }))
      .rejects.toThrow(new MemberConflictError("member with email 'ada@example.com' already exists"));
    await expect(createMember({ deps: h.deps, input: { workspaceId: WS, email: "old@example.com" } }))
      .rejects.toThrow(new MemberConflictError("member with email 'old@example.com' is in Trash; restore it from the admin Trash screen"));
    expect(h.principalSaves).toEqual([]);
  });

  it("treats a disabled member appearing between the two lookups as a conflict, not a new account", async () => {
    const h = memberAuthHarness({ members: [memberRow({ status: "disabled" })] });
    const realFind = h.members.findByEmail.bind(h.members);
    let calls = 0;
    h.members.findByEmail = async (input) => (++calls === 1 ? null : realFind(input));
    await expect(createMember({ deps: h.deps, input: { workspaceId: WS, email: "ada@example.com" } }))
      .rejects.toThrow(new MemberConflictError("member with email 'ada@example.com' already exists"));
    expect(h.principalSaves).toEqual([]);
  });
});

describe("completeSignIn by link", () => {
  it("creates the account for a new-address link with the challenge's member id, verified and active", async () => {
    const h = memberAuthHarness();
    await h.seedChallenge({ purpose: "signin", member: null, email: "new@example.com" });
    h.setNow(LATER);
    const result = await completeSignIn({ deps: h.deps, input: { workspaceId: WS, token: "raw-link", userAgent: "ua-1", ip: "10.0.0.1" } });
    expect(result.isNewMember).toBe(true);
    expect(result.member).toEqual({ id: "id-1", workspaceId: WS, email: "new@example.com", status: "active", emailVerifiedAt: LATER, createdAt: LATER, updatedAt: LATER, version: 2 });
    expect(h.created).toEqual([{ workspaceId: WS, memberId: "id-1", creationSource: "verified_signup", initialState: "pending" }]);
    expect(result.session).toMatchObject({ workspaceId: WS, memberId: "id-1", createdAt: LATER, userAgent: "ua-1", ip: "10.0.0.1" });
    expect(await h.sessions.listByMember({ workspaceId: WS, memberId: "id-1" })).toEqual([result.session]);
  });

  it("signs a legacy member-bound link into the existing member, keeping an earlier verification date", async () => {
    const existing = memberRow({ emailVerifiedAt: "2025-06-01T00:00:00.000Z" });
    const h = memberAuthHarness({ members: [existing] });
    await h.seedChallenge({ purpose: "signin", member: existing });
    h.setNow(LATER);
    const result = await completeSignIn({ deps: h.deps, input: { workspaceId: WS, token: "raw-link" } });
    expect(result.isNewMember).toBe(false);
    expect(result.member).toEqual({ ...existing, emailVerifiedAt: "2025-06-01T00:00:00.000Z", updatedAt: LATER, version: 2 });
    expect(h.created).toEqual([]);
  });

  it("refuses a legacy link whose member no longer exists, and a link for an address now disabled", async () => {
    const h = memberAuthHarness({ members: [memberRow({ id: "m-dis", email: "dis@example.com", status: "disabled" })] });
    await h.seedChallenge({ purpose: "signin", member: memberRow({ id: "gone" }) });
    await expect(completeSignIn({ deps: h.deps, input: { workspaceId: WS, token: "raw-link" } })).rejects.toThrow(new MemberAuthError(INVALID));
    await h.seedChallenge({ purpose: "signin", member: null, email: "dis@example.com", challengeId: "c-2", rawToken: "raw-2" });
    await expect(completeSignIn({ deps: h.deps, input: { workspaceId: WS, token: "raw-2" } })).rejects.toThrow(new MemberAuthError(INVALID));
    expect(h.principalSaves).toEqual([]);
  });

  it("refuses a disabled member reached through a legacy member-bound link", async () => {
    const disabled = memberRow({ status: "disabled" });
    const h = memberAuthHarness({ members: [disabled] });
    await h.seedChallenge({ purpose: "signin", member: disabled });
    await expect(completeSignIn({ deps: h.deps, input: { workspaceId: WS, token: "raw-link" } })).rejects.toThrow(new MemberAuthError(INVALID));
    expect(await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).toEqual([]);
  });

  it("refuses a link minted at or before the credential cutoff but honours one minted after it", async () => {
    const atCutoff = memberAuthHarness({ members: [memberRow({ credentialsRevokedAt: T0 })] });
    await atCutoff.seedChallenge({ purpose: "signin", member: memberRow() });
    await expect(completeSignIn({ deps: atCutoff.deps, input: { workspaceId: WS, token: "raw-link" } })).rejects.toThrow(new MemberAuthError(INVALID));

    const after = memberAuthHarness({ members: [memberRow({ credentialsRevokedAt: T0 })] });
    after.setNow(LATER);
    await after.seedChallenge({ purpose: "signin", member: memberRow() });
    const result = await completeSignIn({ deps: after.deps, input: { workspaceId: WS, token: "raw-link" } });
    expect(result.member.version).toBe(2);
  });
});

describe("completeSignIn by code", () => {
  it("accepts the right six-digit code once and refuses it on reuse", async () => {
    const h = memberAuthHarness({ members: [memberRow({ status: "pending" })] });
    await h.seedChallenge({ purpose: "signin", member: memberRow(), code: "123456" });
    const result = await completeSignIn({ deps: h.deps, input: { workspaceId: WS, challengeId: "c-1", code: "123456" } });
    expect(result.member.status).toBe("active");
    expect(result.member.emailVerifiedAt).toBe(T0);
    await expect(completeSignIn({ deps: h.deps, input: { workspaceId: WS, challengeId: "c-1", code: "123456" } }))
      .rejects.toThrow(new MemberAuthError(INVALID));
  });

  it("refuses a wrong code and a code for a purpose the challenge was not issued for", async () => {
    const h = memberAuthHarness({ members: [memberRow()] });
    await h.seedChallenge({ purpose: "password_reset", member: memberRow(), code: "123456" });
    await expect(completeSignIn({ deps: h.deps, input: { workspaceId: WS, challengeId: "c-1", code: "123456" } }))
      .rejects.toThrow(new MemberAuthError(INVALID));
    await h.seedChallenge({ purpose: "signin", member: memberRow(), challengeId: "c-2", rawToken: "raw-2", code: "123456" });
    await expect(completeSignIn({ deps: h.deps, input: { workspaceId: WS, challengeId: "c-2", code: "654321" } }))
      .rejects.toThrow(new MemberAuthError(INVALID));
    expect(await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).toEqual([]);
  });
});
