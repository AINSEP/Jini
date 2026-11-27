import { describe, expect, it } from "vitest";
import { compSubscription, disableMember, setSubscriptionStatus, updateProfile } from "../member-admin-writes.js";
import { InMemoryMemberSubscriptionRepo, InMemoryMemberTierRepo } from "../repo.memory.js";
import {
  MemberConflictError, MemberNotFoundError, MemberValidationError, type MemberSubscriptionRecord, type MemberSubscriptionStatus, type MemberTierRecord,
} from "../types.js";
import { memberAuthHarness, memberRow, T0, WS } from "./member-auth.gap-harness.js";

const T5 = "2026-01-01T00:05:00.000Z";

function tier(overrides: Partial<MemberTierRecord> = {}): MemberTierRecord {
  return { id: "t-1", workspaceId: WS, name: "Gold", slug: "gold", type: "paid", status: "active", visibleInPortal: true, createdAt: T0, updatedAt: T0, version: 1, ...overrides };
}

function subscription(overrides: Partial<MemberSubscriptionRecord> = {}): MemberSubscriptionRecord {
  return { id: "s-1", workspaceId: WS, memberId: "m-1", tierId: "t-1", status: "active", source: "comp", startedAt: T0, createdAt: T0, updatedAt: T0, version: 1, ...overrides };
}

function harness(options: { tiers?: MemberTierRecord[]; subscriptions?: MemberSubscriptionRecord[] } = {}) {
  const h = memberAuthHarness({ members: [memberRow({ name: "Ada", note: "vip" }), memberRow({ id: "m-dis", email: "d@example.com", status: "disabled" })] });
  const subscriptions = new InMemoryMemberSubscriptionRepo({}, { initialRows: options.subscriptions ?? [] });
  const deps = { ...h.deps, tiers: new InMemoryMemberTierRepo({}, { initialRows: options.tiers ?? [tier()] }), subscriptions };
  h.setNow(T5);
  return { ...h, deps, subscriptions };
}

describe("updateProfile", () => {
  it("trims the new name and note, bumps the version and persists it", async () => {
    const h = harness();
    const { member } = await updateProfile({ deps: h.deps, input: { workspaceId: WS, memberId: "m-1", name: "  Ada L ", note: " gold " } });
    expect(member).toEqual({ ...memberRow({ name: "Ada L", note: "gold" }), updatedAt: T5, version: 2 });
    expect(await h.members.findById({ workspaceId: WS, id: "m-1" })).toEqual(member);
  });

  it("keeps the existing name and note when neither is supplied", async () => {
    const { member } = await updateProfile({ deps: harness().deps, input: { workspaceId: WS, memberId: "m-1" } });
    expect([member.name, member.note, member.version]).toEqual(["Ada", "vip", 2]);
  });

  it("rejects a blank name and an unknown member", async () => {
    const h = harness();
    await expect(updateProfile({ deps: h.deps, input: { workspaceId: WS, memberId: "m-1", name: "  " } }))
      .rejects.toThrow(new MemberValidationError("name must not be blank when provided"));
    await expect(updateProfile({ deps: h.deps, input: { workspaceId: WS, memberId: "nope" } }))
      .rejects.toThrow(new MemberNotFoundError("member 'nope' was not found"));
  });
});

describe("disableMember", () => {
  it("disables, stamps the credential cutoff and revokes every live session", async () => {
    const h = harness();
    const { session } = await h.signIn(memberRow());
    const { member } = await disableMember({ deps: h.deps, input: { workspaceId: WS, memberId: "m-1" } });
    expect(member).toEqual({ ...memberRow({ name: "Ada", note: "vip" }), status: "disabled", credentialsRevokedAt: T5, updatedAt: T5, version: 2 });
    expect((await h.sessions.listByMember({ workspaceId: WS, memberId: "m-1" })).map((s) => [s.id, s.revokedAt])).toEqual([[session.id, T5]]);
  });

  it("is a no-op for an already-disabled member and refuses an unknown one", async () => {
    const h = harness();
    const { member } = await disableMember({ deps: h.deps, input: { workspaceId: WS, memberId: "m-dis" } });
    expect(member.version).toBe(1);
    await expect(disableMember({ deps: h.deps, input: { workspaceId: WS, memberId: "nope" } }))
      .rejects.toThrow(new MemberNotFoundError("member 'nope' was not found"));
  });
});

describe("compSubscription", () => {
  it("grants a comped subscription to an active tier", async () => {
    const h = harness();
    const { subscription: granted } = await compSubscription({ deps: h.deps, input: { workspaceId: WS, memberId: "m-1", tierId: "t-1" } });
    expect(granted).toEqual({ id: "id-1", workspaceId: WS, memberId: "m-1", tierId: "t-1", status: "comped", source: "comp", startedAt: T5, createdAt: T5, updatedAt: T5, version: 1 });
    expect(await h.subscriptions.findById({ workspaceId: WS, id: "id-1" })).toEqual(granted);
  });

  it("refuses an unknown member or tier, an archived tier and a duplicate entitlement", async () => {
    const h = harness({ tiers: [tier(), tier({ id: "t-old", slug: "old", status: "archived" })], subscriptions: [subscription()] });
    const comp = (memberId: string, tierId: string) => compSubscription({ deps: h.deps, input: { workspaceId: WS, memberId, tierId } });
    await expect(comp("nope", "t-1")).rejects.toThrow(new MemberNotFoundError("member 'nope' was not found"));
    await expect(comp("m-1", "t-x")).rejects.toThrow(new MemberNotFoundError("tier 't-x' was not found"));
    await expect(comp("m-1", "t-old")).rejects.toThrow(new MemberValidationError("tier 't-old' is archived and cannot accept new subscriptions"));
    await expect(comp("m-1", "t-1")).rejects.toThrow(new MemberConflictError("member 'm-1' already has an active subscription to tier 't-1'"));
  });
});

describe("setSubscriptionStatus", () => {
  it("cancels with a cancellation stamp and records a new external reference", async () => {
    const h = harness({ subscriptions: [subscription({ externalRef: "ref-1" })] });
    const { subscription: changed } = await setSubscriptionStatus({ deps: h.deps, input: { workspaceId: WS, subscriptionId: "s-1", status: "canceled", externalRef: "ref-2" } });
    expect(changed).toEqual(subscription({ status: "canceled", externalRef: "ref-2", canceledAt: T5, updatedAt: T5, version: 2 }));
  });

  it("keeps the prior reference and cancellation stamp for a non-cancel transition", async () => {
    const h = harness({ subscriptions: [subscription({ externalRef: "ref-1", canceledAt: T0 })] });
    const { subscription: changed } = await setSubscriptionStatus({ deps: h.deps, input: { workspaceId: WS, subscriptionId: "s-1", status: "expired" } });
    expect([changed.status, changed.externalRef, changed.canceledAt]).toEqual(["expired", "ref-1", T0]);
  });

  it("refuses an unknown subscription and a status outside the allowed set", async () => {
    const h = harness({ subscriptions: [subscription()] });
    await expect(setSubscriptionStatus({ deps: h.deps, input: { workspaceId: WS, subscriptionId: "nope", status: "active" } }))
      .rejects.toThrow(new MemberNotFoundError("subscription 'nope' was not found"));
    await expect(setSubscriptionStatus({ deps: h.deps, input: { workspaceId: WS, subscriptionId: "s-1", status: "paused" as MemberSubscriptionStatus } }))
      .rejects.toThrow(new MemberValidationError("'paused' is not a valid subscription status"));
  });
});
