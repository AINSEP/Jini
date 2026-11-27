import { describe, expect, it } from "vitest";
import { Argon2PasswordHasher } from "../../server/hasher.js";
import { consumeMemberChallenge, memberChallengeStore } from "../member-challenge.js";
import { memberPasswordHasher } from "../member-credentials.js";
import { completeSignIn } from "../member-sign-in.js";
import type { MembersWriteServiceDeps } from "../ports.js";
import { InMemoryMagicLinkTokenRepo } from "../repo.memory.js";
import { MemberAuthError } from "../types.js";
import { fakeHash, memberAuthHarness, memberRow, T0, WS } from "./member-auth.gap-harness.js";

const INVALID = new MemberAuthError("sign-in credential is invalid");
const challenge = { id: "c-1", workspaceId: WS, purpose: "signin", tokenHash: "th", codeHash: null, failedAttempts: 0, expiresAt: "2026-01-01T00:15:00.000Z" };

describe("memberChallengeStore", () => {
  it("refuses issuance without member identity or for a non-member realm, storing nothing", async () => {
    const repo = new InMemoryMagicLinkTokenRepo();
    await expect(memberChallengeStore({ repo }).save({ ...challenge, realm: "member" }))
      .rejects.toThrow("Member challenge issuance requires member identity");
    await expect(memberChallengeStore({ repo, identity: { memberId: "m-1", createdAt: T0 } }).save({ ...challenge, realm: "staff" }))
      .rejects.toThrow("Member challenge issuance requires member identity");
    expect(await repo.findById({ workspaceId: WS, id: "c-1" })).toBeNull();
  });

  it("persists a code hash and consumption stamp verbatim and omits them when null", async () => {
    const repo = new InMemoryMagicLinkTokenRepo();
    const store = memberChallengeStore({ repo, identity: { memberId: "m-1", createdAt: T0 } });
    await store.save({ ...challenge, realm: "member", codeHash: "ch", consumedAt: T0 });
    await store.save({ ...challenge, id: "c-2", tokenHash: "th-2", realm: "member", consumedAt: null });
    expect(await repo.findById({ workspaceId: WS, id: "c-1" })).toMatchObject({ memberId: "m-1", codeHash: "ch", consumedAt: T0 });
    const second = await repo.findById({ workspaceId: WS, id: "c-2" });
    expect([second!.codeHash, second!.consumedAt]).toEqual([undefined, undefined]);
  });

  it("normalizes a legacy link-only row to a null code hash and zero spent attempts", async () => {
    const repo = new InMemoryMagicLinkTokenRepo({}, { initialRows: [
      { id: "c-1", workspaceId: WS, memberId: "m-1", tokenHash: "th", purpose: "signin", createdAt: T0, expiresAt: challenge.expiresAt },
    ] });
    expect(await memberChallengeStore({ repo }).findByTokenHash({ workspaceId: WS, realm: "member", purpose: "signin", tokenHash: "th" })).toEqual({
      id: "c-1", workspaceId: WS, memberId: "m-1", tokenHash: "th", purpose: "signin", createdAt: T0, expiresAt: challenge.expiresAt,
      realm: "member", codeHash: null, failedAttempts: 0,
    });
    expect(await memberChallengeStore({ repo }).findById({ workspaceId: WS, realm: "member", purpose: "signin", id: "missing" })).toBeNull();
  });
});

describe("consumeMemberChallenge", () => {
  it("refuses a code once the attempt budget is spent, even when the code is right", async () => {
    const h = memberAuthHarness({ members: [memberRow()] });
    await h.seedChallenge({ purpose: "signin", member: memberRow(), code: "123456" });
    h.magicLinks.reserveCodeAttempt = async () => false;
    await expect(consumeMemberChallenge({ deps: h.deps, input: { workspaceId: WS, challengeId: "c-1", code: "123456" }, purpose: "signin", nowIso: T0 }))
      .rejects.toThrow(INVALID);
    expect(h.hasherCalls).toEqual([]);
  });

  it("refuses when another request consumes the challenge first (lost CAS race)", async () => {
    const h = memberAuthHarness({ members: [memberRow()] });
    await h.seedChallenge({ purpose: "signin", member: memberRow() });
    await h.magicLinks.consume({ workspaceId: WS, id: "c-1", consumedAt: T0 });
    const record = await h.magicLinks.findById({ workspaceId: WS, id: "c-1" });
    // Simulate the race: the lookup still sees the unconsumed row, the CAS then loses.
    h.magicLinks.findByTokenHash = async () => ({ ...record!, consumedAt: undefined });
    await expect(consumeMemberChallenge({ deps: h.deps, input: { workspaceId: WS, token: "raw-link" }, purpose: "signin", nowIso: T0 }))
      .rejects.toThrow(INVALID);
  });

  it("spends a dummy verify for an unknown code handle so timing matches a real one", async () => {
    const h = memberAuthHarness();
    await expect(consumeMemberChallenge({ deps: h.deps, input: { workspaceId: WS, challengeId: "nope", code: "123456" }, purpose: "signin", nowIso: T0 }))
      .rejects.toThrow(INVALID);
    expect(h.hasherCalls.map((c) => c.op)).toEqual(["hash", "verify"]);
    expect(h.hasherCalls[1]).toEqual({ op: "verify", password: "123456", hash: fakeHash(h.hasherCalls[0]!.password) });
  });

  it("refuses a new-address link whose address has since been trashed", async () => {
    const h = memberAuthHarness({ members: [memberRow({ email: "t@example.com", status: "trash" })] });
    await h.seedChallenge({ purpose: "signin", member: null, email: "t@example.com" });
    await expect(completeSignIn({ deps: h.deps, input: { workspaceId: WS, token: "raw-link" } })).rejects.toThrow(INVALID);
    expect(h.principalSaves).toEqual([]);
  });
});

describe("completeSignIn for a new-address link after the account appeared", () => {
  it("signs into the account created since issuance instead of creating a second one", async () => {
    const h = memberAuthHarness({ members: [memberRow({ email: "late@example.com", status: "pending" })] });
    await h.seedChallenge({ purpose: "signin", member: null, email: "late@example.com" });
    const result = await completeSignIn({ deps: h.deps, input: { workspaceId: WS, token: "raw-link" } });
    expect([result.isNewMember, result.member.id, result.member.status]).toEqual([false, "m-1", "active"]);
    expect(h.principalSaves).toEqual([]);
  });
});

describe("memberPasswordHasher", () => {
  it("prefers the injected hasher and otherwise returns one shared Argon2 adapter", () => {
    const injected = { hash: async () => "x", verify: async () => false };
    expect(memberPasswordHasher({ deps: { passwordHasher: injected } as unknown as MembersWriteServiceDeps })).toBe(injected);
    const legacy = memberPasswordHasher({ deps: {} as MembersWriteServiceDeps });
    expect(legacy).toBeInstanceOf(Argon2PasswordHasher);
    expect(memberPasswordHasher({ deps: {} as MembersWriteServiceDeps })).toBe(legacy);
  });
});
