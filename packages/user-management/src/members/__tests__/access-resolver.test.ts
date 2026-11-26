import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import { createMemberAccessResolver, DefaultMemberAccessResolver, resolvePostMemberAccess } from "../access-resolver.js";
import {
  InMemoryMemberSessionRepo,
  InMemoryMemberSubscriptionRepo,
  InMemoryMemberTierRepo,
} from "../repo.memory.js";
import type { MemberContentAccess, MemberContext } from "../types.js";

const WORKSPACE_ID = "ws-1";
const NOW = "2026-07-10T00:00:00.000Z";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function anonymousContext(): MemberContext {
  return { isAuthenticated: false, activeTierIds: [], isPaid: false };
}

function authenticatedContext(activeTierIds: string[], isPaid: boolean): MemberContext {
  return { isAuthenticated: true, memberId: "member-1", activeTierIds, isPaid };
}

test("resolvePostMemberAccess: ungated values are public, valid JSON round-trips, and malformed JSON fails closed", () => {
  for (const raw of [null, undefined, ""]) assert.deepEqual(resolvePostMemberAccess({ raw }), { visibility: "public" });
  assert.deepEqual(resolvePostMemberAccess({ raw: '{"visibility":"tiers","tierIds":["gold"]}' }), { visibility: "tiers", tierIds: ["gold"] });
  const resolver = new DefaultMemberAccessResolver({ sessions: new InMemoryMemberSessionRepo(), subscriptions: new InMemoryMemberSubscriptionRepo(), tiers: new InMemoryMemberTierRepo() });
  assert.deepEqual(resolver.decide({ access: resolvePostMemberAccess({ raw: "{not json" }), context: authenticatedContext(["gold"], true) }),
    { allowed: false, visibility: "malformed_member_access_json", reason: "unknown_visibility", teaser: false });
});

test("decide: public visibility always allows, authenticated or not", () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });
  const access: MemberContentAccess = { visibility: "public" };

  const anonDecision = resolver.decide({ access, context: anonymousContext() });
  assert.equal(anonDecision.allowed, true);
  assert.equal(anonDecision.teaser, false);

  const memberDecision = resolver.decide({ access, context: authenticatedContext([], false) });
  assert.equal(memberDecision.allowed, true);
});

test("decide: members visibility requires isAuthenticated, offers a teaser when denied", () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });
  const access: MemberContentAccess = { visibility: "members" };

  const deniedDecision = resolver.decide({ access, context: anonymousContext() });
  assert.equal(deniedDecision.allowed, false);
  assert.equal(deniedDecision.teaser, true);

  const allowedDecision = resolver.decide({ access, context: authenticatedContext([], false) });
  assert.equal(allowedDecision.allowed, true);
});

test("decide: paid visibility requires isAuthenticated AND isPaid", () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });
  const access: MemberContentAccess = { visibility: "paid" };

  assert.equal(resolver.decide({ access, context: anonymousContext() }).allowed, false);
  assert.equal(resolver.decide({ access, context: authenticatedContext([], false) }).allowed, false);
  assert.equal(resolver.decide({ access, context: authenticatedContext(["tier-1"], true) }).allowed, true);
});

test("decide: tiers visibility requires overlap between context.activeTierIds and access.tierIds", () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });
  const access: MemberContentAccess = { visibility: "tiers", tierIds: ["tier-gold", "tier-silver"] };

  assert.equal(
    resolver.decide({ access, context: authenticatedContext(["tier-bronze"], false) }).allowed,
    false,
    "no overlap should deny"
  );
  assert.equal(
    resolver.decide({ access, context: authenticatedContext(["tier-gold"], false) }).allowed,
    true,
    "overlap should allow"
  );
  assert.equal(
    resolver.decide({ access, context: anonymousContext() }).allowed,
    false,
    "anonymous is always denied even if tierIds happened to overlap"
  );
});

test("decide: tiers visibility with no tierIds listed entitles nobody, even a paid member", () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });
  const access: MemberContentAccess = { visibility: "tiers" };

  assert.deepEqual(resolver.decide({ access, context: authenticatedContext(["tier-gold"], true) }), {
    allowed: false,
    visibility: "tiers",
    reason: "upgrade_required",
    teaser: true,
  });
  assert.equal(resolver.decide({ access, context: anonymousContext() }).reason, "sign_in_required");
});

test("decide: an unknown/unparseable visibility value fails closed with no teaser", () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });
  // Simulates corrupt/unvalidated data reaching the decision (bypassing the
  // compile-time union) — the fail-closed contract must hold at runtime too.
  const access = { visibility: "vip-secret-club" } as unknown as MemberContentAccess;

  const decision = resolver.decide({ access, context: authenticatedContext(["tier-gold"], true) });
  assert.equal(decision.allowed, false);
  assert.equal(decision.teaser, false, "an unknown visibility must not offer a teaser");
  assert.equal(decision.reason, "unknown_visibility");
});

/**
 * Truth table for `decide()` — enumerates every (visibility, member-state) combination this
 * function's `access.tierIds: ["tier-gold"]` fixture can produce, and asserts each cell against
 * what the fail-closed contract SHOULD produce (ADR-021 §8 lineage doc in `access-resolver.ts`),
 * not against whatever the implementation currently returns. Written per the batch-D refactor
 * brief's explicit instruction to check for a combination that falls through to allow (an
 * under-restrictive cell) or wrongly denies an entitled member (an over-restrictive cell).
 */
test("decide: truth table over every (visibility, member-state) combination", () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });

  const REQUIRED_TIER_ACCESS: MemberContentAccess = { visibility: "tiers", tierIds: ["tier-gold"] };
  const UNKNOWN_ACCESS = { visibility: "vip-secret-club" } as unknown as MemberContentAccess;

  const anonymous = anonymousContext();
  const authFreeNoTiers = authenticatedContext([], false);
  const authPaid = authenticatedContext([], true);
  const authWithRequiredTier = authenticatedContext(["tier-gold"], false);
  const authWithOtherTier = authenticatedContext(["tier-silver"], false);

  interface Row {
    label: string;
    access: MemberContentAccess;
    context: MemberContext;
    allowed: boolean;
    reason: string;
    teaser: boolean;
  }

  const rows: Row[] = [
    // visibility: "public" — always allowed, regardless of member state.
    { label: "public + anonymous", access: { visibility: "public" }, context: anonymous, allowed: true, reason: "public", teaser: false },
    { label: "public + authenticated free", access: { visibility: "public" }, context: authFreeNoTiers, allowed: true, reason: "public", teaser: false },
    { label: "public + authenticated paid", access: { visibility: "public" }, context: authPaid, allowed: true, reason: "public", teaser: false },

    // visibility: "members" — any authenticated member, paid or not; anonymous denied.
    { label: "members + anonymous", access: { visibility: "members" }, context: anonymous, allowed: false, reason: "sign_in_required", teaser: true },
    { label: "members + authenticated free", access: { visibility: "members" }, context: authFreeNoTiers, allowed: true, reason: "entitled", teaser: false },
    { label: "members + authenticated paid", access: { visibility: "members" }, context: authPaid, allowed: true, reason: "entitled", teaser: false },

    // visibility: "paid" — only an authenticated + isPaid member; anonymous vs. free member get
    // different denial reasons (an enumeration-safe distinction, both still deny).
    { label: "paid + anonymous", access: { visibility: "paid" }, context: anonymous, allowed: false, reason: "sign_in_required", teaser: true },
    { label: "paid + authenticated free (not paid)", access: { visibility: "paid" }, context: authFreeNoTiers, allowed: false, reason: "upgrade_required", teaser: true },
    { label: "paid + authenticated paid", access: { visibility: "paid" }, context: authPaid, allowed: true, reason: "entitled", teaser: false },

    // visibility: "tiers" (tierIds: ["tier-gold"]) — only an authenticated member holding the
    // required tier; anonymous, no-tier, and wrong-tier members must all deny.
    { label: "tiers + anonymous", access: REQUIRED_TIER_ACCESS, context: anonymous, allowed: false, reason: "sign_in_required", teaser: true },
    { label: "tiers + authenticated, no tiers", access: REQUIRED_TIER_ACCESS, context: authFreeNoTiers, allowed: false, reason: "upgrade_required", teaser: true },
    { label: "tiers + authenticated, wrong tier", access: REQUIRED_TIER_ACCESS, context: authWithOtherTier, allowed: false, reason: "upgrade_required", teaser: true },
    { label: "tiers + authenticated, required tier", access: REQUIRED_TIER_ACCESS, context: authWithRequiredTier, allowed: true, reason: "entitled", teaser: false },

    // visibility: unknown/unparseable — fails closed for every member state, no teaser (a teaser
    // would leak that gated content exists behind an entitlement the reader can never resolve).
    { label: "unknown + anonymous", access: UNKNOWN_ACCESS, context: anonymous, allowed: false, reason: "unknown_visibility", teaser: false },
    { label: "unknown + authenticated paid + required tier", access: UNKNOWN_ACCESS, context: authenticatedContext(["tier-gold"], true), allowed: false, reason: "unknown_visibility", teaser: false },
  ];

  for (const row of rows) {
    const decision = resolver.decide({ access: row.access, context: row.context });
    assert.equal(decision.allowed, row.allowed, `${row.label}: allowed`);
    assert.equal(decision.reason, row.reason, `${row.label}: reason`);
    assert.equal(decision.teaser, row.teaser, `${row.label}: teaser`);
  }
});

test("resolveContext returns the anonymous context when no session token is supplied", async () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });

  const context = await resolver.resolveContext({ workspaceId: WORKSPACE_ID, nowIso: NOW });
  assert.deepEqual(context, anonymousContext());
});

test("resolveContext returns the anonymous context for an unknown token", async () => {
  const resolver = new DefaultMemberAccessResolver({
    sessions: new InMemoryMemberSessionRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });

  const context = await resolver.resolveContext({
    workspaceId: WORKSPACE_ID,
    sessionToken: "never-issued-token",
    nowIso: NOW,
  });
  assert.deepEqual(context, anonymousContext());
});

test("resolveContext returns the anonymous context for a revoked or expired session", async () => {
  const sessions = new InMemoryMemberSessionRepo({}, { initialRows: [
    {
      id: "session-revoked",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tokenHash: hashToken("revoked-token"),
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      revokedAt: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "session-expired",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tokenHash: hashToken("expired-token"),
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "session-expires-now",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tokenHash: hashToken("expires-now-token"),
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: NOW,
    },
  ] });
  const resolver = new DefaultMemberAccessResolver({
    sessions,
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    tiers: new InMemoryMemberTierRepo(),
  });

  const revokedContext = await resolver.resolveContext({
    workspaceId: WORKSPACE_ID,
    sessionToken: "revoked-token",
    nowIso: NOW,
  });
  assert.deepEqual(revokedContext, anonymousContext());

  const expiredContext = await resolver.resolveContext({
    workspaceId: WORKSPACE_ID,
    sessionToken: "expired-token",
    nowIso: NOW,
  });
  assert.deepEqual(expiredContext, anonymousContext());
  const boundaryContext = await resolver.resolveContext({ workspaceId: WORKSPACE_ID, sessionToken: "expires-now-token", nowIso: NOW });
  assert.deepEqual(boundaryContext, anonymousContext(), "a session is expired at its exact expiry timestamp");
});

test("resolveContext returns an authenticated context with activeTierIds + isPaid for a valid session", async () => {
  const sessions = new InMemoryMemberSessionRepo({}, { initialRows: [
    {
      id: "session-valid",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tokenHash: hashToken("valid-token"),
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    },
  ] });
  const tiers = new InMemoryMemberTierRepo({}, { initialRows: [
    {
      id: "tier-gold",
      workspaceId: WORKSPACE_ID,
      name: "Gold",
      slug: "gold",
      type: "paid",
      status: "active",
      visibleInPortal: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ] });
  const subscriptions = new InMemoryMemberSubscriptionRepo({}, { initialRows: [
    {
      id: "sub-1",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tierId: "tier-gold",
      status: "active",
      source: "signup",
      startedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ] });
  const resolver = new DefaultMemberAccessResolver({ sessions, subscriptions, tiers });

  const context = await resolver.resolveContext({
    workspaceId: WORKSPACE_ID,
    sessionToken: "valid-token",
    nowIso: NOW,
  });

  assert.equal(context.isAuthenticated, true);
  assert.equal(context.memberId, "member-1");
  assert.deepEqual(context.activeTierIds, ["tier-gold"]);
  assert.equal(context.isPaid, true);
});

test("resolveContext: a valid session with an active subscription to a NON-paid tier reports isPaid:false", async () => {
  const sessions = new InMemoryMemberSessionRepo({}, { initialRows: [
    {
      id: "session-free",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tokenHash: hashToken("free-token"),
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    },
  ] });
  const tiers = new InMemoryMemberTierRepo({}, { initialRows: [
    {
      id: "tier-free",
      workspaceId: WORKSPACE_ID,
      name: "Free",
      slug: "free",
      type: "free",
      status: "active",
      visibleInPortal: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ] });
  const subscriptions = new InMemoryMemberSubscriptionRepo({}, { initialRows: [
    {
      id: "sub-free",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tierId: "tier-free",
      status: "active",
      source: "signup",
      startedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ] });
  const resolver = new DefaultMemberAccessResolver({ sessions, subscriptions, tiers });

  const context = await resolver.resolveContext({
    workspaceId: WORKSPACE_ID,
    sessionToken: "free-token",
    nowIso: NOW,
  });

  assert.deepEqual(context.activeTierIds, ["tier-free"]);
  assert.equal(context.isPaid, false, "a resolved tier that is not type 'paid' must not flip isPaid");
});

for (const activeTierIds of [[], ["tier-free", "tier-paid"]]) {
  test(`resolveContext: valid session with ${activeTierIds.length ? "free first and paid second" : "no subscriptions"}`, async () => {
    const sessions = new InMemoryMemberSessionRepo({}, { initialRows: [{
      id: "session-multiple", workspaceId: WORKSPACE_ID, memberId: "member-1",
      tokenHash: hashToken("multiple-token"), createdAt: NOW, expiresAt: "2027-01-01T00:00:00.000Z",
    }] });
    const tiers = new InMemoryMemberTierRepo({}, { initialRows: (["free", "paid"] as const).map((type) => ({
      id: `tier-${type}`, workspaceId: WORKSPACE_ID, name: type, slug: type, type,
      status: "active" as const, visibleInPortal: true, createdAt: NOW, updatedAt: NOW, version: 1,
    })) });
    const subscriptions = new InMemoryMemberSubscriptionRepo({}, { initialRows: activeTierIds.map((tierId, index) => ({
      id: `sub-${index}`, workspaceId: WORKSPACE_ID, memberId: "member-1", tierId,
      status: "active" as const, source: "signup" as const, startedAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
    })) });
    const resolver = new DefaultMemberAccessResolver({ sessions, subscriptions, tiers });
    const context = await resolver.resolveContext({ workspaceId: WORKSPACE_ID, sessionToken: "multiple-token", nowIso: NOW });
    assert.deepEqual(context, authenticatedContext(activeTierIds, activeTierIds.length > 0));
  });
}

test('shared route resolver factory creates independent resolvers using the injected member ports', async () => {
  const deps = { memberSessionRepo: new InMemoryMemberSessionRepo(), memberSubscriptionRepo: new InMemoryMemberSubscriptionRepo(), memberTierRepo: new InMemoryMemberTierRepo() };
  const first = createMemberAccessResolver({ deps });
  const second = createMemberAccessResolver({ deps });
  assert.notEqual(first, second);
  assert.ok(first instanceof DefaultMemberAccessResolver);
  assert.deepEqual(await first.resolveContext({ workspaceId: WORKSPACE_ID, nowIso: NOW }), { isAuthenticated: false, activeTierIds: [], isPaid: false });
});


test("activeMemberFromSession refuses sessions older than the member credential cutoff", async () => {
  const { activeMemberFromSession } = await import('../access-resolver.js');
  const sessions = new InMemoryMemberSessionRepo();
  await sessions.save({ id: 'session', workspaceId: WORKSPACE_ID, memberId: 'member', tokenHash: hashToken('token'), createdAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-08-01T00:00:00.000Z' });
  const member = { id: 'member', workspaceId: WORKSPACE_ID, email: 'm@example.test', status: 'active' as const, credentialsRevokedAt: '2026-07-02T00:00:00.000Z', createdAt: NOW, updatedAt: NOW, version: 1 };
  assert.equal(await activeMemberFromSession({ deps: { memberSessionRepo: sessions, memberRepo: { findById: async () => member }, workspaceId: WORKSPACE_ID, sessionToken: () => 'token', nowIso: () => NOW } }), null);
  assert.equal(await activeMemberFromSession({ deps: { memberSessionRepo: sessions, memberRepo: { findById: async () => ({ ...member, credentialsRevokedAt: '2026-06-01T00:00:00.000Z' }) }, workspaceId: WORKSPACE_ID, sessionToken: () => 'token', nowIso: () => NOW } }), 'member');
});
