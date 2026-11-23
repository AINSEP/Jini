/**
 * @file T024 — failing-first tests for `unsubscribe.ts` (REQ-14/15/30/32, INV-04/INV-09,
 * AC-18/19/20/39, EC-03).
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { buildUnsubscribeLink, processUnsubscribe, type UnsubscribeDeps, type UnsubscribeTokenClaims } from "../unsubscribe.js";
import { NewsletterUnsubscribeTokenInvalidError } from "../errors.js";
import { InMemoryNewsletterSubscriptionRepo } from "../repo.memory.js";
import type { MembersConsentCapability } from "../ports.js";
import type { SubscriptionRow } from "../types.js";

const WS = "ws-1";
const NOW = "2026-07-13T00:00:00.000Z";
const clock = { nowIso: () => NOW };

// Deterministic fake keyring: HKDF-like, but simple and reproducible for tests.
const keyring = {
  activeKey: async () => ({ keyId: "k1" }),
  deriveSigningSecret: async () => new Uint8Array(32),
  derive: async (input: { workspaceId: string; purpose: string; info: string }) =>
    new TextEncoder().encode(`${input.workspaceId}:${input.purpose}:${input.info}`),
};

const originRegistry = {
  canonicalOrigin: async () => ({ scheme: "https" as const, host: "acme.test", verifiedAt: "2026-07-13T00:00:00.000Z", source: "workspace-setting" as const }),
  isAllowedRedirectTarget: async () => true,
  isAllowedEgressTarget: async () => true,
};

function baseSubscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub-1",
    workspaceId: WS,
    listId: "list-1",
    subscriberId: "subscriber-1",
    status: "subscribed",
    source: "admin",
    consentRevisionIdAtSubscribe: "rev-1",
    subscribedAt: NOW,
    unsubscribedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

let revokedCalls: { workspaceId: string; subscriberId: string }[] = [];
function makeDeps(subscription: SubscriptionRow, withCapability = true): { deps: UnsubscribeDeps; repo: InMemoryNewsletterSubscriptionRepo } {
  revokedCalls = [];
  const capability: MembersConsentCapability = {
    request: async () => ({ requested: true }),
    confirm: async () => ({ status: "granted", consentRevisionId: "rev-1" }),
    revoke: async (input) => {
      revokedCalls.push({ workspaceId: input.workspaceId, subscriberId: input.subscriberId });
      return { status: "revoked" };
    },
  };
  const repo = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: [subscription] });
  return {
    repo,
    deps: { subscriptionRepo: repo, keyring, originRegistry, consentCapability: withCapability ? capability : null, clock },
  };
}

async function tokenFor(deps: UnsubscribeDeps, consentRevisionId: string): Promise<string> {
  const claims: UnsubscribeTokenClaims = {
    workspaceId: WS,
    subscriberId: "subscriber-1",
    listId: "list-1",
    campaignId: null,
    consentRevisionId,
  };
  const link = await buildUnsubscribeLink({ deps, claims });
  return new URL(link).searchParams.get("token")!;
}

test("processUnsubscribe: a stale-revision token (from a re-subscribe under a new consent grant) is REJECTED (AC-18)", async () => {
  const { deps } = makeDeps(baseSubscription({ consentRevisionIdAtSubscribe: "rev-2" })); // subscription has moved to rev-2
  const staleToken = await tokenFor(deps, "rev-1"); // token was minted against the OLD rev-1

  await assert.rejects(processUnsubscribe({ deps, input: { rawToken: staleToken } }), (err: unknown) => {
    assert.ok(err instanceof NewsletterUnsubscribeTokenInvalidError);
    assert.equal(err.reason, "consent_revision_mismatch");
    return true;
  });
});

test("processUnsubscribe: a current-revision token succeeds and calls MembersConsentCapability.revoke (AC-19)", async () => {
  const { deps, repo } = makeDeps(baseSubscription({ consentRevisionIdAtSubscribe: "rev-1" }));
  const token = await tokenFor(deps, "rev-1");

  const result = await processUnsubscribe({ deps, input: { rawToken: token } });
  assert.equal(result.outcome, "unsubscribed");
  assert.deepEqual(revokedCalls, [{ workspaceId: WS, subscriberId: "subscriber-1" }]);

  const updated = await repo.findById({ workspaceId: WS, id: "sub-1" });
  assert.equal(updated?.status, "unsubscribed");
  assert.ok(updated?.unsubscribedAt);
});

test("processUnsubscribe: a repeat of the SAME now-processed token is idempotent success, not rejected (AC-20/EC-03)", async () => {
  const { deps } = makeDeps(baseSubscription({ consentRevisionIdAtSubscribe: "rev-1" }));
  const token = await tokenFor(deps, "rev-1");

  const first = await processUnsubscribe({ deps, input: { rawToken: token } });
  assert.equal(first.outcome, "unsubscribed");

  const second = await processUnsubscribe({ deps, input: { rawToken: token } });
  assert.equal(second.outcome, "already-unsubscribed", "a repeat is idempotent success, never rejected");
  assert.equal(revokedCalls.length, 1, "revoke is not called a second time for an already-processed token");
});

test("processUnsubscribe: the EC-03 carve-out does not swallow INV-04 — a stale token can never reach idempotent-success, even for an already-unsubscribed row", async () => {
  const row = baseSubscription({ status: "unsubscribed", unsubscribedAt: NOW, consentRevisionIdAtSubscribe: "rev-2" });
  const { deps, repo } = makeDeps(row);
  const staleToken = await tokenFor(deps, "rev-1");

  await assert.rejects(processUnsubscribe({ deps, input: { rawToken: staleToken } }), (err: unknown) => {
    assert.ok(err instanceof NewsletterUnsubscribeTokenInvalidError);
    assert.equal(err.reason, "consent_revision_mismatch");
    return true;
  });
  assert.deepEqual(await repo.findById({ workspaceId: WS, id: row.id }), row);
  assert.deepEqual(revokedCalls, []);
});

test("processUnsubscribe: a tampered token (bad signature) is rejected", async () => {
  const { deps } = makeDeps(baseSubscription());
  const token = await tokenFor(deps, "rev-1");
  const tampered = token.slice(0, -2) + "00";
  await assert.rejects(processUnsubscribe({ deps, input: { rawToken: tampered } }), (err: unknown) => {
    assert.ok(err instanceof NewsletterUnsubscribeTokenInvalidError);
    assert.equal(err.reason, "signature_invalid");
    return true;
  });
});

test("processUnsubscribe: unknown subscription is rejected as not_found", async () => {
  const { deps } = makeDeps(baseSubscription({ subscriberId: "someone-else" }));
  const token = await tokenFor(deps, "rev-1");
  await assert.rejects(processUnsubscribe({ deps, input: { rawToken: token } }), (err: unknown) => {
    assert.ok(err instanceof NewsletterUnsubscribeTokenInvalidError);
    assert.equal(err.reason, "not_found");
    return true;
  });
});

test("buildUnsubscribeLink: links are built ONLY via OriginRegistryPort.canonicalOrigin — never a raw Host header (REQ-30/INV-09/AC-39)", async () => {
  const { deps } = makeDeps(baseSubscription());
  const link = await buildUnsubscribeLink({
    deps,
    claims: { workspaceId: WS, subscriberId: "subscriber-1", listId: "list-1", campaignId: null, consentRevisionId: "rev-1" },
  });
  // No code path here ever reads a Host header — the origin comes exclusively from `originRegistry`.
  assert.ok(link.startsWith("https://acme.test/newsletter/unsubscribe?token="));
});

test("buildUnsubscribeLink: a non-default port on the verified origin is included in the link", async () => {
  const { deps } = makeDeps(baseSubscription());
  deps.originRegistry = {
    canonicalOrigin: async () => ({ scheme: "https" as const, host: "acme.test", port: 8443, verifiedAt: NOW, source: "workspace-setting" as const }),
    isAllowedRedirectTarget: async () => true,
    isAllowedEgressTarget: async () => true,
  };
  const link = await buildUnsubscribeLink({
    deps,
    claims: { workspaceId: WS, subscriberId: "subscriber-1", listId: "list-1", campaignId: null, consentRevisionId: "rev-1" },
  });
  assert.ok(link.startsWith("https://acme.test:8443/newsletter/unsubscribe?token="), `expected a port-qualified URL, got: ${link}`);
});

test("processUnsubscribe: a token derived with a non-null campaignId round-trips correctly (derivationInfo's ?? branch)", async () => {
  const { deps, repo } = makeDeps(baseSubscription({ consentRevisionIdAtSubscribe: "rev-1" }));
  const claims: UnsubscribeTokenClaims = { workspaceId: WS, subscriberId: "subscriber-1", listId: "list-1", campaignId: "camp-42", consentRevisionId: "rev-1" };
  const link = await buildUnsubscribeLink({ deps, claims });
  const token = new URL(link).searchParams.get("token")!;

  const result = await processUnsubscribe({ deps, input: { rawToken: token } });
  assert.equal(result.outcome, "unsubscribed");
  const updated = await repo.findById({ workspaceId: WS, id: "sub-1" });
  assert.equal(updated?.status, "unsubscribed");
});

test("processUnsubscribe: a malformed (non-JSON) claims payload is rejected as signature_invalid, not a crash", async () => {
  const { deps } = makeDeps(baseSubscription());
  const bogusEncoded = Buffer.from("not valid json", "utf8").toString("base64url");
  const rawToken = `${bogusEncoded}.deadbeef`;
  await assert.rejects(processUnsubscribe({ deps, input: { rawToken } }), (err: unknown) => {
    assert.ok(err instanceof NewsletterUnsubscribeTokenInvalidError);
    assert.equal(err.message, "malformed unsubscribe token");
    assert.equal(err.reason, "signature_invalid");
    return true;
  });
});

test("processUnsubscribe: a signature of the WRONG LENGTH is rejected without reaching the timing-safe compare", async () => {
  const { deps } = makeDeps(baseSubscription());
  const token = await tokenFor(deps, "rev-1");
  const [encoded] = token.split(".");
  const shortSigToken = `${encoded}.ab`; // valid encoded claims, signature far too short
  await assert.rejects(processUnsubscribe({ deps, input: { rawToken: shortSigToken } }), (err: unknown) => {
    assert.ok(err instanceof NewsletterUnsubscribeTokenInvalidError);
    assert.equal(err.reason, "signature_invalid");
    return true;
  });
});

test("processUnsubscribe: changing any signed claim with the original signature is rejected before lookup or mutation", async () => {
  for (const [field, value] of Object.entries({
    workspaceId: "ws-2",
    subscriberId: "subscriber-2",
    listId: "list-2",
    consentRevisionId: "rev-2",
    campaignId: "camp-2",
  })) {
    const row = baseSubscription();
    const { deps, repo } = makeDeps(row);
    const token = await tokenFor(deps, "rev-1");
    const [encoded, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...claims, [field]: value })).toString("base64url");
    repo.findBySubscriberAndList = async () => assert.fail("signature verification must precede subscription lookup");
    await assert.rejects(processUnsubscribe({ deps, input: { rawToken: `${forged}.${signature}` } }), (err: unknown) => {
      assert.ok(err instanceof NewsletterUnsubscribeTokenInvalidError);
      assert.equal(err.reason, "signature_invalid", field);
      return true;
    });
    assert.deepEqual(await repo.findById({ workspaceId: WS, id: row.id }), row);
    assert.deepEqual(revokedCalls, []);
  }
});

test("processUnsubscribe: an unbound consent capability still persists the self-service unsubscribe", async () => {
  const { deps, repo } = makeDeps(baseSubscription(), false);
  const token = await tokenFor(deps, "rev-1");
  assert.deepEqual(await processUnsubscribe({ deps, input: { rawToken: token } }), { outcome: "unsubscribed" });
  const row = await repo.findById({ workspaceId: WS, id: "sub-1" });
  assert.equal(row?.status, "unsubscribed");
  assert.equal(row?.unsubscribedAt, NOW);
  assert.equal(row?.updatedAt, NOW);
  assert.deepEqual(revokedCalls, []);
});

test("processUnsubscribe rejects missing token parts before looking up or changing consent", async () => {
  for (const rawToken of ["", ".signature", "claims", "claims."]) {
    const original = baseSubscription();
    const { deps, repo } = makeDeps(original);
    await assert.rejects(processUnsubscribe({ deps, input: { rawToken } }), (error: unknown) => {
      assert.ok(error instanceof NewsletterUnsubscribeTokenInvalidError);
      assert.equal(error.reason, "signature_invalid");
      assert.equal(error.message, "malformed unsubscribe token");
      return true;
    });
    assert.deepEqual(await repo.findById({ workspaceId: WS, id: original.id }), original);
    assert.deepEqual(revokedCalls, []);
  }
});

test("buildUnsubscribeLink preserves the verified base path and omits only the scheme's default port", async () => {
  for (const [scheme, port, authority] of [
    ["https", 443, "https://acme.test"],
    ["http", 80, "http://acme.test"],
    ["http", 443, "http://acme.test:443"],
    ["https", 80, "https://acme.test:80"],
  ] as const) {
    const { deps } = makeDeps(baseSubscription());
    deps.originRegistry = { ...originRegistry, canonicalOrigin: async () => ({
      scheme, port, host: "acme.test", basePath: "/tenant", verifiedAt: NOW, source: "workspace-setting" as const,
    }) };
    const claims: UnsubscribeTokenClaims = { workspaceId: WS, subscriberId: "subscriber-1", listId: "list-1", campaignId: null, consentRevisionId: "rev-1" };
    const link = await buildUnsubscribeLink({ deps, claims });
    assert.equal(link.slice(0, link.indexOf("?")), `${authority}/tenant/newsletter/unsubscribe`);
    assert.deepEqual(await processUnsubscribe({ deps, input: { rawToken: new URL(link).searchParams.get("token")! } }), { outcome: "unsubscribed" });
  }
});
