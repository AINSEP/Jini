import assert from "node:assert/strict";
import { test } from "vitest";

import type { PublishTrustGrant } from "../grant.js";
import { PUBLISH_TRUST_GRANT_VERSION } from "../grant.js";
import { resolvePublishTrust } from "../provisioning.js";
import type { PublishTrustRevocation } from "../revocations.js";
import {
  admitPublish,
  createInMemoryRevocations,
  isRevoked,
  MAX_REVOCATIONS,
  parseRevocationDocument,
} from "../revocations.js";

/**
 * @file Proofs that disconnecting a computer works without a deploy, and cannot be undone by one.
 *
 * The property the whole file exists for: **committed config can only grant, this store can only
 * deny, and deny wins.** Everything else follows — a disconnect takes effect on the next request, a
 * rollback to an older commit cannot resurrect a disconnected computer, and neither action needs a
 * provider console.
 *
 * The second property, and the one that is easy to get backwards: a revocation list that cannot be
 * READ must refuse everybody. `provisioning.ts` fails closed by admitting nobody when the GRANT
 * document is broken; this file has to fail closed in the opposite direction, by treating everybody
 * as disconnected when the DENY document is broken.
 */

const NOW = "2026-09-19T12:00:00.000Z";

function grantFor(sourceInstallationId: string, overrides: Partial<PublishTrustGrant> = {}): PublishTrustGrant {
  return {
    version: PUBLISH_TRUST_GRANT_VERSION,
    sourceInstallationId,
    publicKeys: [{ publicKeyB64u: `pk-${sourceInstallationId}`, generation: 0 }],
    workspaceId: "ws-1",
    entityTypes: ["post"],
    capabilities: ["publish_content.read", "publish_content.apply"],
    notAfter: "2027-09-19T12:00:00.000Z",
    ...overrides,
  };
}

function siteCarrying(...grants: readonly PublishTrustGrant[]) {
  return resolvePublishTrust({ envValue: undefined, fileContents: JSON.stringify(grants) });
}

function ask(input: {
  grants: readonly PublishTrustGrant[];
  revocations: readonly PublishTrustRevocation[] | null;
  sourceInstallationId?: string;
  publicKeyB64u?: string;
}) {
  return admitPublish({
    resolution: siteCarrying(...input.grants),
    revocations: input.revocations,
    sourceInstallationId: input.sourceInstallationId ?? "laptop",
    publicKeyB64u: input.publicKeyB64u ?? "pk-laptop",
    siteLabel: "example.com",
    nowIso: NOW,
  });
}

const REVOKED_LAPTOP: PublishTrustRevocation = {
  sourceInstallationId: "laptop",
  revokedAt: NOW,
  note: "sold it",
};

// ---------------------------------------------------------------------------
// Deny wins, and a deploy cannot undo it
// ---------------------------------------------------------------------------

test("a connected computer publishes", () => {
  const admission = ask({ grants: [grantFor("laptop")], revocations: [] });
  assert.equal(admission.allowed, true);
  assert.equal(admission.allowed && admission.grant.sourceInstallationId, "laptop");
});

test("a disconnected computer is refused even though committed config still grants it", () => {
  // This is the whole point: the grant is unchanged and still in the repo, and the answer is no.
  const admission = ask({ grants: [grantFor("laptop")], revocations: [REVOKED_LAPTOP] });
  assert.equal(admission.allowed, false);
  assert.equal(admission.allowed === false && admission.refusal, "disconnected");
});

test("redeploying the same committed config does not reconnect a disconnected computer", () => {
  // A deploy replaces the image, which is where grants live. Denials live on the volume, so the
  // redeploy -- and equally a ROLLBACK to an older commit -- changes nothing here.
  const beforeDeploy = ask({ grants: [grantFor("laptop")], revocations: [REVOKED_LAPTOP] });
  const afterRollbackToOlderCommit = ask({
    grants: [grantFor("laptop", { notAfter: "2030-01-01T00:00:00.000Z" })],
    revocations: [REVOKED_LAPTOP],
  });

  assert.equal(beforeDeploy.allowed, false);
  assert.equal(afterRollbackToOlderCommit.allowed, false);
});

test("disconnecting one computer leaves the others publishing", () => {
  const grants = [grantFor("laptop"), grantFor("desktop")];
  assert.equal(ask({ grants, revocations: [REVOKED_LAPTOP] }).allowed, false);
  assert.equal(
    ask({ grants, revocations: [REVOKED_LAPTOP], sourceInstallationId: "desktop", publicKeyB64u: "pk-desktop" }).allowed,
    true
  );
});

test("a disconnect outranks a broken grant document rather than depending on it", () => {
  const admission = admitPublish({
    resolution: resolvePublishTrust({ envValue: undefined, fileContents: "{ not json" }),
    revocations: [REVOKED_LAPTOP],
    sourceInstallationId: "laptop",
    publicKeyB64u: "pk-laptop",
    siteLabel: "example.com",
    nowIso: NOW,
  });
  assert.equal(admission.allowed === false && admission.refusal, "disconnected");
});

// ---------------------------------------------------------------------------
// Fail-closed in the deny direction
// ---------------------------------------------------------------------------

test("an unreadable revocation list refuses everybody", () => {
  const admission = ask({ grants: [grantFor("laptop")], revocations: null });
  assert.equal(admission.allowed, false);
  assert.equal(admission.allowed === false && admission.refusal, "revocations-unreadable");
});

test("a corrupt revocation document reads as unreadable, not as empty", () => {
  const read = parseRevocationDocument({ text: "{ not json" });

  assert.equal(read.ok, false, "an empty read here would silently reconnect every disconnected computer");
});

test("a revocation list that is not an array is refused", () => {
  assert.equal(parseRevocationDocument({ text: '{"sourceInstallationId":"laptop"}' }).ok, false);
});

test("a revocation document accepts 16384 bytes and refuses anything larger", () => {
  const atLimit = JSON.stringify([REVOKED_LAPTOP]).padEnd(16_384, " ");
  assert.deepEqual(parseRevocationDocument({ text: atLimit }), { ok: true, revocations: [REVOKED_LAPTOP] });
  assert.deepEqual(parseRevocationDocument({ text: `${atLimit} ` }), {
    ok: false, reason: "revocation list exceeds 16384 bytes",
  });
});

test("a stored revocation list refuses more than 64 records", () => {
  const full = Array.from({ length: MAX_REVOCATIONS }, (_, i) => ({ ...REVOKED_LAPTOP, sourceInstallationId: `m${i}` }));
  assert.deepEqual(parseRevocationDocument({ text: JSON.stringify(full) }), { ok: true, revocations: full });
  assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([...full, REVOKED_LAPTOP]) }), {
    ok: false, reason: "revocation list holds more than 64 records",
  });
});

test("a revocation entry must be an object", () => {
  for (const entry of [null, 7]) {
    assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([entry]) }), {
      ok: false, reason: "each revocation must be an object",
    });
  }
});

// F4.4: all other fields remain valid so another validation guard cannot mask an omission.
test("a revocation needs a non-empty source installation id", () => {
  assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([{ ...REVOKED_LAPTOP, sourceInstallationId: "" }]) }), {
    ok: false, reason: "each revocation needs a 'sourceInstallationId'",
  });
});

test("a revocation needs a parseable revocation date", () => {
  assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([{ ...REVOKED_LAPTOP, revokedAt: "not-a-date" }]) }), {
    ok: false, reason: "each revocation needs an ISO-8601 'revokedAt'",
  });
});

test("a revocation note must be a non-empty string when present", () => {
  assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([{ ...REVOKED_LAPTOP, note: 42 }]) }), {
    ok: false, reason: "a revocation 'note' must be a non-empty string when present",
  });
});

// ---------------------------------------------------------------------------
// The refusals a person actually reads
// ---------------------------------------------------------------------------

test("an unconfigured site explains that publishing has not been set up", () => {
  const admission = ask({ grants: [], revocations: [] });
  assert.deepEqual(admission, {
    allowed: false,
    refusal: "site-not-configured",
    message: "example.com isn't set up to accept published changes yet.",
  });
});

test("no refusal ever shows key vocabulary or an error code", () => {
  const admissions = [
    ask({ grants: [], revocations: [] }),
    ask({ grants: [grantFor("desktop")], revocations: [] }),
    ask({ grants: [grantFor("laptop")], revocations: [REVOKED_LAPTOP] }),
    ask({ grants: [grantFor("laptop", { notAfter: "2026-01-01T00:00:00.000Z" })], revocations: [] }),
    ask({ grants: [grantFor("laptop")], revocations: [], publicKeyB64u: "pk-rotated" }),
    ask({ grants: [grantFor("laptop")], revocations: null }),
  ];

  for (const admission of admissions) {
    assert.equal(admission.allowed, false);
    const message = admission.allowed === false ? admission.message : "";
    assert.doesNotMatch(message, /public key|generation|installation|principal|credential|token id/i, message);
    assert.doesNotMatch(message, /[A-Z_]{6,}/, message);
    assert.match(message, /example\.com/, "every refusal names the site the person was publishing to");
  }
});

test("the never-connected refusal says what to do, in ordinary words", () => {
  const admission = ask({ grants: [grantFor("desktop")], revocations: [] });
  assert.equal(admission.allowed === false && admission.refusal, "not-connected");
  assert.match(admission.allowed === false ? admission.message : "", /doesn't recognise this computer yet/);
  assert.match(admission.allowed === false ? admission.message : "", /nothing to copy and no key to keep/);
});

test("a rotated Site key is explained as a rotation, not as a mystery", () => {
  const admission = ask({ grants: [grantFor("laptop")], revocations: [], publicKeyB64u: "pk-after-regenerate" });
  assert.equal(admission.allowed === false && admission.refusal, "superseded-key");
  assert.match(admission.allowed === false ? admission.message : "", /Site key is regenerated/);
});

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

test("disconnecting takes effect on the next read, with no deploy in between", async () => {
  const port = createInMemoryRevocations();
  const grants = [grantFor("laptop")];

  const before = await port.list();
  assert.equal(ask({ grants, revocations: before.ok ? before.revocations : null }).allowed, true);

  await port.revoke({ sourceInstallationId: "laptop", nowIso: NOW, note: "stolen" });

  const after = await port.list();
  assert.equal(ask({ grants, revocations: after.ok ? after.revocations : null }).allowed, false);
});

test("reconnecting is an explicit act that restores publishing", async () => {
  const port = createInMemoryRevocations();
  await port.revoke({ sourceInstallationId: "laptop", nowIso: NOW });

  await port.revoke({ sourceInstallationId: "desktop", nowIso: NOW, note: "keep disconnected" });
  const restored = await port.restore({ sourceInstallationId: "laptop" });
  assert.equal(restored.ok && restored.changed, true);
  const read = await port.list();
  assert.deepEqual(read.ok ? read.revocations : null, [
    { sourceInstallationId: "desktop", revokedAt: NOW, note: "keep disconnected" },
  ]);
  assert.equal(ask({ grants: [grantFor("laptop")], revocations: read.ok ? read.revocations : null }).allowed, true);
  assert.equal(ask({ grants: [grantFor("laptop")], revocations: restored.ok ? restored.revocations : null }).allowed, true);
});

test("disconnecting the same computer twice is a no-op, and keeps the first timestamp", async () => {
  const port = createInMemoryRevocations();
  await port.revoke({ sourceInstallationId: "laptop", nowIso: NOW, note: "first" });
  const again = await port.revoke({ sourceInstallationId: "laptop", nowIso: "2026-12-25T00:00:00.000Z", note: "second" });

  assert.equal(again.ok, true);
  assert.equal(again.ok && again.changed, false);
  assert.equal(again.ok ? again.revocations[0]!.revokedAt : "", NOW);
  assert.equal(again.ok ? again.revocations[0]!.note : "", "first");
});

test("reconnecting a computer that was never disconnected is a no-op, not an error", async () => {
  const port = createInMemoryRevocations();
  const restored = await port.restore({ sourceInstallationId: "never-seen" });

  assert.equal(restored.ok, true);
  assert.equal(restored.ok && restored.changed, false);
  assert.deepEqual(await port.list(), { ok: true, revocations: [] });
});

test("a stored disconnect survives a reread, notes and all", async () => {
  const port = createInMemoryRevocations();
  await port.revoke({ sourceInstallationId: "laptop", nowIso: NOW, note: "left it on a train" });

  const read = await port.list();
  assert.deepEqual(read.ok ? read.revocations : null, [
    { sourceInstallationId: "laptop", revokedAt: NOW, note: "left it on a train" },
  ]);
  assert.equal(isRevoked({ revocations: read.ok ? read.revocations : [], sourceInstallationId: "laptop" }), true);
});

test("the in-memory store revokes, restores, preserves idempotency and refuses overflow", async () => {
  const port = createInMemoryRevocations();
  const grants = [grantFor("laptop")];
  assert.deepEqual(await port.list(), { ok: true, revocations: [] });
  assert.equal(ask({ grants, revocations: [] }).allowed, true);
  assert.equal((await port.revoke({ sourceInstallationId: "laptop", nowIso: NOW, note: "first" })).ok, true);
  const denial = [{ sourceInstallationId: "laptop", revokedAt: NOW, note: "first" }];
  assert.deepEqual(await port.list(), { ok: true, revocations: denial });
  const revoked = await port.list();
  assert.equal(ask({ grants, revocations: revoked.ok ? revoked.revocations : null }).allowed, false);
  assert.deepEqual(await port.revoke({ sourceInstallationId: "laptop", nowIso: "2026-12-25T00:00:00.000Z", note: "second" }),
    { ok: true, changed: false, revocations: denial });
  assert.deepEqual(await port.restore({ sourceInstallationId: "never-seen" }), { ok: true, changed: false, revocations: denial });
  assert.deepEqual(await port.restore({ sourceInstallationId: "laptop" }), { ok: true, changed: true, revocations: [] });
  const restored = await port.list();
  assert.equal(ask({ grants, revocations: restored.ok ? restored.revocations : null }).allowed, true);
  const full = Array.from({ length: MAX_REVOCATIONS }, (_, i) => ({ sourceInstallationId: `m${i}`, revokedAt: NOW, note: null }));
  for (const row of full) assert.equal((await port.revoke({ sourceInstallationId: row.sourceInstallationId, nowIso: NOW })).ok, true);
  assert.deepEqual(await port.list(), { ok: true, revocations: full });
  const overflow = await port.revoke({ sourceInstallationId: "one-too-many", nowIso: NOW });
  assert.equal(overflow.ok, false);
  assert.deepEqual(await port.list(), { ok: true, revocations: full });
});

test("whitespace-only revocation documents represent no disconnected computers", () => {
  assert.deepEqual(parseRevocationDocument({ text: " \n\t " }), { ok: true, revocations: [] });
});

for (const [field, values, reason] of [
  ["sourceInstallationId", [42, "x".repeat(513)], "each revocation needs a 'sourceInstallationId'"],
  ["revokedAt", [42, "", "x".repeat(513)], "each revocation needs an ISO-8601 'revokedAt'"],
  ["note", ["", "x".repeat(513)], "a revocation 'note' must be a non-empty string when present"],
] as const) {
  for (const value of values) {
    test(`revocation ${field} refuses ${typeof value === "number" ? "a number" : value.length === 0 ? "an empty string" : "more than 512 characters"}`, () => {
      assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([{ ...REVOKED_LAPTOP, [field]: value }]) }), { ok: false, reason });
    });
  }
}

for (const note of [undefined, null]) {
  test(`a ${note === undefined ? "missing" : "null"} revocation note is normalized to null`, () => {
    assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([{ ...REVOKED_LAPTOP, note }]) }), {
      ok: true, revocations: [{ sourceInstallationId: "laptop", revokedAt: NOW, note: null }],
    });
  });
}

test("revocation fields accept exactly 512 characters", () => {
  const entry = { sourceInstallationId: "s".repeat(512), revokedAt: NOW, note: "n".repeat(512) };
  assert.deepEqual(parseRevocationDocument({ text: JSON.stringify([entry]) }), { ok: true, revocations: [entry] });
});
