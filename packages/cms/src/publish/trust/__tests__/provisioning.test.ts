import assert from "node:assert/strict";
import { test } from "vitest";

import type { PublishTrustGrant } from "../grant.js";
import { PUBLISH_TRUST_GRANT_VERSION } from "../grant.js";
import type { ProvisioningEvent, ProvisioningFileIo, PublishTrustResolution } from "../provisioning.js";
import {
  COMMITTED_JSON_CODEC,
  createFileProvisioning,
  findGrantForSource,
  grantNotAfterFrom,
  MAX_PROVISIONED_GRANTS,
  mergeGrant,
  parseGrantDocument,
  removeGrant,
  resolvePublishTrust,
  serializeGrantDocument,
} from "../provisioning.js";
import { describeConnection, describePublishTrustState } from "../provisioning-status.js";

/** The host owns the override setting's name; any name proves it is forwarded, not assumed. */
const SETTING_NAME = "PUBLISH_TRUST_SETTING";

/**
 * @file Proofs for how a grant reaches the destination.
 *
 * Three properties carry this feature, and each maps to a question the owner will actually ask:
 *
 * 1. **Connecting a second computer must not disconnect the first.** The document is a list keyed
 *    by `sourceInstallationId`, and provisioning merges into it.
 * 2. **A stale grant must be visible as stale.** Matching is on the PUBLIC KEY, not the generation,
 *    because regenerating the site key changes the key while leaving the generation alone.
 * 3. **Revoking publishing and revoking provider access are independent.** Two unrelated inputs can
 *    each switch publishing off on their own, and neither read path touches a provider credential.
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

function memoryIo(seed: Record<string, string> = {}): ProvisioningFileIo & { files: Record<string, string> } {
  const files = { ...seed };
  return {
    files,
    read: async ({ path }) => files[path] ?? null,
    write: async ({ path, contents }) => {
      files[path] = contents;
    },
  };
}

// ---------------------------------------------------------------------------
// The document is a list, so a second computer adds rather than replaces
// ---------------------------------------------------------------------------

test("a single grant object is accepted, but is re-serialised as a list", () => {
  const parsed = parseGrantDocument({ text: JSON.stringify(grantFor("laptop")) });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.grants.length, 1);

  const written = serializeGrantDocument({ grants: parsed.ok ? parsed.grants : [], options: { pretty: true } });
  assert.equal(JSON.parse(written).length, 1, "a one-grant document still writes as an array");
});

test("connecting a second computer keeps the first one connected", async () => {
  const io = memoryIo();
  const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path: "/repo/deploy/publish-trust.json" });

  await port.connect({ grant: grantFor("laptop") });
  await port.connect({ grant: grantFor("desktop") });

  const read = await port.readProvisioned();
  assert.equal(read.ok, true);
  assert.deepEqual(
    read.ok ? read.grants.map((g) => g.sourceInstallationId) : [],
    ["laptop", "desktop"],
    "the desktop must be appended, not substituted for the laptop"
  );
});

test("reconnecting the same computer replaces its entry in place", () => {
  const rotated = grantFor("laptop", { publicKeys: [{ publicKeyB64u: "pk-new", generation: 1 }] });
  const merged = mergeGrant({ existing: [grantFor("laptop"), grantFor("desktop")], incoming: rotated });

  assert.equal(merged.ok, true);
  assert.equal(merged.ok && merged.grants.length, 2);
  assert.equal(merged.ok && merged.grants[0]!.publicKeys[0]!.publicKeyB64u, "pk-new");
  assert.equal(merged.ok && merged.grants[1]!.sourceInstallationId, "desktop");
});

test("an unchanged reconnect reports changed:false so there is nothing to commit", async () => {
  const io = memoryIo();
  const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path: "/repo/deploy/publish-trust.json" });

  await port.connect({ grant: grantFor("laptop") });
  const again = await port.connect({ grant: grantFor("laptop") });

  assert.equal(again.ok, true);
  assert.equal(again.ok && again.changed, false);
  const read = await port.readProvisioned();
  assert.deepEqual(read.ok ? read.grants : null, [grantFor("laptop")]);
});

test("the grant list is bounded", () => {
  const full = Array.from({ length: MAX_PROVISIONED_GRANTS }, (_, i) => grantFor(`m${i}`));
  const overflow = mergeGrant({ existing: full, incoming: grantFor("one-too-many") });
  assert.equal(overflow.ok, false);
  assert.match(overflow.ok ? "" : overflow.reason, /disconnect one first/);
});

test("a document repeating one source is refused, not de-duplicated", () => {
  const parsed = parseGrantDocument({ text: JSON.stringify([grantFor("laptop"), grantFor("laptop")]) });
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? "" : parsed.reason, /repeats source installation laptop/);
});

test("a document whose grant would widen authority is refused whole", () => {
  const hostile = { ...grantFor("laptop"), capabilities: ["content.write"] };
  const parsed = parseGrantDocument({ text: JSON.stringify([grantFor("desktop"), hostile]) });
  assert.equal(parsed.ok, false, "one bad element must reject the document, not yield the good half");
});

// ---------------------------------------------------------------------------
// The destination's boot read, and the empty state
// ---------------------------------------------------------------------------

test("an install that has never been published to says so in a sentence", () => {
  const res = resolvePublishTrust({ envValue: undefined, fileContents: null });
  assert.equal(res.state, "absent");
  assert.equal(res.origin, "none");
  assert.deepEqual(res.grants, []);
  assert.match(describePublishTrustState({ res, settingName: SETTING_NAME }), /^No computer is connected to this site for publishing yet\./);
  assert.doesNotMatch(describePublishTrustState({ res, settingName: SETTING_NAME }), /[A-Z_]{6,}/, "the empty state must not surface an error code");
});

test("an empty committed trust file is absent rather than revoked", () => {
  for (const fileContents of ["", " \t\n"]) {
    assert.deepEqual(resolvePublishTrust({ envValue: undefined, fileContents }), {
      state: "absent",
      origin: "file",
      grants: [],
      reason: null,
    });
  }
});

test("a malformed grant document disables publishing without pretending to be configured", () => {
  const res = resolvePublishTrust({ envValue: undefined, fileContents: "{ not json" });
  assert.equal(res.state, "invalid");
  assert.deepEqual(res.grants, [], "an unreadable document must never yield a usable grant");
  assert.equal(findGrantForSource({ res, sourceInstallationId: "laptop" }), null);
});

test("findGrantForSource refuses every state but configured", () => {
  const revoked = resolvePublishTrust({ envValue: "", fileContents: JSON.stringify([grantFor("laptop")]) });
  assert.equal(revoked.state, "revoked");
  assert.equal(findGrantForSource({ res: revoked, sourceInstallationId: "laptop" }), null);
});

test("a hand-built resolution cannot smuggle grants past a non-configured state", () => {
  // resolvePublishTrust can never produce this, but a middleware or a test double can — and a
  // leftover grants array beside a state that says "do not trust me" must still be refused.
  const smuggled: PublishTrustResolution = {
    state: "invalid",
    origin: "env",
    grants: [grantFor("laptop")],
    reason: "held over from a previous read",
  };
  assert.equal(findGrantForSource({ res: smuggled, sourceInstallationId: "laptop" }), null);
});

test("a configured install resolves the right source's grant and only that one", () => {
  const res = resolvePublishTrust({
    envValue: undefined,
    fileContents: JSON.stringify([grantFor("laptop"), grantFor("desktop")]),
  });
  assert.equal(res.state, "configured");
  assert.equal(findGrantForSource({ res, sourceInstallationId: "desktop" })?.publicKeys[0]!.publicKeyB64u, "pk-desktop");
  assert.equal(findGrantForSource({ res, sourceInstallationId: "phone" }), null);
});

// ---------------------------------------------------------------------------
// Revocation: two independent paths, neither needing the other
// ---------------------------------------------------------------------------

test("an operator with only the provider console can switch publishing off", () => {
  const committed = JSON.stringify([grantFor("laptop")]);
  const res = resolvePublishTrust({ envValue: "", fileContents: committed });

  assert.equal(res.state, "revoked", "the env var must override the committed file, or there is no kill switch");
  assert.equal(res.origin, "env");
  assert.match(describePublishTrustState({ res, settingName: SETTING_NAME }), new RegExp(SETTING_NAME));
});

test("an operator with only the repository can switch publishing off", () => {
  const res = resolvePublishTrust({ envValue: undefined, fileContents: "[]" });
  assert.equal(res.state, "revoked");
  assert.equal(res.origin, "file");
});

test("an unset env var is not a revocation — only an empty one is", () => {
  const committed = JSON.stringify([grantFor("laptop")]);
  assert.equal(resolvePublishTrust({ envValue: undefined, fileContents: committed }).state, "configured");
  assert.equal(resolvePublishTrust({ envValue: "", fileContents: committed }).state, "revoked");
});

test("disconnecting one computer leaves the others publishing", async () => {
  const io = memoryIo();
  const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path: "/repo/deploy/publish-trust.json" });
  await port.connect({ grant: grantFor("laptop") });
  await port.connect({ grant: grantFor("desktop") });

  const removed = await port.disconnect({ sourceInstallationId: "laptop" });
  assert.equal(removed.ok && removed.changed, true);
  assert.deepEqual(removed.ok ? removed.grants.map((g) => g.sourceInstallationId) : [], ["desktop"]);
  const reopened = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path: "/repo/deploy/publish-trust.json" });
  const read = await reopened.readProvisioned();
  assert.deepEqual(read.ok ? read.grants : null, [grantFor("desktop")]);
});

test("disconnecting a computer that was never connected is a no-op, not an error", () => {
  const edit = removeGrant({ existing: [grantFor("desktop")], sourceInstallationId: "laptop" });
  assert.equal(edit.ok && edit.changed, false);
  assert.equal(edit.ok && edit.grants.length, 1);
});

// ---------------------------------------------------------------------------
// Staleness: a rotation the destination has not been redeployed for
// ---------------------------------------------------------------------------

test("a Site key regeneration is reported as a stale key, not as connected", () => {
  // The generation is unchanged — only the derived key moved. A generation comparison would call
  // this current and leave the owner debugging a refusal the source insisted could not happen.
  const res = resolvePublishTrust({ envValue: undefined, fileContents: JSON.stringify([grantFor("laptop")]) });
  const status = describeConnection({ settingName: SETTING_NAME,
    resolution: res,
    sourceInstallationId: "laptop",
    publicKeyB64u: "pk-laptop-after-regenerating-the-site-key",
    siteLabel: "example.com",
    nowIso: NOW,
  });

  assert.equal(status.verdict, "superseded-key");
  assert.match(status.message, /older key/);
  assert.match(status.message, /deploy/i);
});

test("a rotation overlap window reads as connected for both keys", () => {
  const overlapping = grantFor("laptop", {
    publicKeys: [
      { publicKeyB64u: "pk-old", generation: 0 },
      { publicKeyB64u: "pk-new", generation: 1 },
    ],
  });
  const res = resolvePublishTrust({ envValue: undefined, fileContents: JSON.stringify([overlapping]) });
  const ask = (publicKeyB64u: string) =>
    describeConnection({ settingName: SETTING_NAME, resolution: res, sourceInstallationId: "laptop", publicKeyB64u, siteLabel: "example.com", nowIso: NOW })
      .verdict;

  assert.equal(ask("pk-old"), "connected");
  assert.equal(ask("pk-new"), "connected");
});

test("a computer the site has never seen is told what to do, in plain words", () => {
  const res = resolvePublishTrust({ envValue: undefined, fileContents: JSON.stringify([grantFor("laptop")]) });
  const status = describeConnection({ settingName: SETTING_NAME,
    resolution: res,
    sourceInstallationId: "desktop",
    publicKeyB64u: "pk-desktop",
    siteLabel: "example.com",
    nowIso: NOW,
  });

  assert.equal(status.verdict, "not-connected");
  assert.match(status.message, /does not recognise this computer yet/);
  assert.doesNotMatch(status.message, /[A-Z_]{6,}/);
});

test("an expired grant is expired, and a soon-to-expire one warns before it bites", () => {
  const ask = (notAfter: string) => {
    const res = resolvePublishTrust({
      envValue: undefined,
      fileContents: JSON.stringify([grantFor("laptop", { notAfter })]),
    });
    return describeConnection({ settingName: SETTING_NAME,
      resolution: res,
      sourceInstallationId: "laptop",
      publicKeyB64u: "pk-laptop",
      siteLabel: "example.com",
      nowIso: NOW,
    });
  };

  assert.equal(ask("2026-09-18T12:00:00.000Z").verdict, "expired");
  assert.equal(ask("2026-10-04T12:00:00.000Z").verdict, "expiring-soon");
  assert.equal(ask("2027-09-19T12:00:00.000Z").verdict, "connected");
});

test("a freshly written grant is dated from now, not from a fixed calendar point", () => {
  const notAfter = grantNotAfterFrom({ nowIso: NOW }, { lifetimeDays: 30 });
  assert.equal(notAfter, "2026-10-19T12:00:00.000Z");
});

test("a destination whose config cannot be read tells the source that, not 'not connected'", () => {
  const res = resolvePublishTrust({ envValue: "{ not json", fileContents: null });
  const status = describeConnection({ settingName: SETTING_NAME,
    resolution: res,
    sourceInstallationId: "laptop",
    publicKeyB64u: "pk-laptop",
    siteLabel: "example.com",
    nowIso: NOW,
  });
  assert.equal(status.verdict, "unavailable");
});

// ---------------------------------------------------------------------------
// The port's own behaviour
// ---------------------------------------------------------------------------

test("provisioning refuses to edit a config file it cannot parse", async () => {
  const io = memoryIo({ "/repo/deploy/publish-trust.json": "{ not json" });
  const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path: "/repo/deploy/publish-trust.json" });

  const written = await port.connect({ grant: grantFor("laptop") });
  assert.equal(written.ok, false);
  assert.equal(io.files["/repo/deploy/publish-trust.json"], "{ not json", "a refused write must not overwrite");
});

test("the port announces its I/O so the composition root can log it", async () => {
  const events: ProvisioningEvent[] = [];
  const io = memoryIo();
  const port = createFileProvisioning({
    io,
    codec: COMMITTED_JSON_CODEC,
    path: "/repo/deploy/publish-trust.json",
    onEvent: (event) => events.push(event),
  });

  await port.connect({ grant: grantFor("laptop") });
  await port.readProvisioned();

  assert.deepEqual(
    events.map((e) => e.kind),
    ["write", "read"]
  );
});

test("the port names where the grant went and what to do next", () => {
  const io = memoryIo();
  const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path: "/repo/deploy/publish-trust.json" });

  assert.equal(port.target.kind, "committed-json");
  assert.equal(port.target.path, "/repo/deploy/publish-trust.json");
  assert.match(port.target.nextStep, /nothing secret/i);
});

test("an oversized document is refused before it is parsed", () => {
  const parsed = parseGrantDocument({ text: JSON.stringify([grantFor("laptop", { entityTypes: ["x".repeat(400)] })]).padEnd(20_000, " ") });
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? "" : parsed.reason, /exceeds/);
});


test("an over-limit connect refuses without overwriting the stored grants", async () => {
  const path = "/repo/deploy/publish-trust.json";
  const original = JSON.stringify(Array.from({ length: MAX_PROVISIONED_GRANTS }, (_, i) => grantFor(`m${i}`)));
  const io = memoryIo({ [path]: original });
  const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path });
  const result = await port.connect({ grant: grantFor("one-too-many") });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /disconnect one first/);
  assert.equal(io.files[path], original);
});

test("a codec encode refusal leaves the stored document untouched", async () => {
  const path = "/repo/deploy/publish-trust.json";
  const original = JSON.stringify([grantFor("desktop")]);
  const io = memoryIo({ [path]: original });
  const codec = {
    ...COMMITTED_JSON_CODEC,
    encode: () => ({ ok: false as const, reason: "config is read-only" }),
  };
  const port = createFileProvisioning({ io, codec, path });
  assert.deepEqual(await port.connect({ grant: grantFor("laptop") }), { ok: false, reason: "config is read-only" });
  assert.equal(io.files[path], original);
});

test("whitespace documents are empty and an overfull document is refused whole", () => {
  assert.deepEqual(parseGrantDocument({ text: " \t\n" }), { ok: true, grants: [] });
  const grants = Array.from({ length: MAX_PROVISIONED_GRANTS + 1 }, (_, i) => grantFor(`source-${i}`));
  assert.deepEqual(parseGrantDocument({ text: JSON.stringify(grants) }), {
    ok: false, reason: "grant document holds more than 8 grants",
  });
});

test("compact serialization round-trips without the committed file's whitespace", () => {
  const grants = [grantFor("laptop"), grantFor("desktop")];
  const text = serializeGrantDocument({ grants, options: { pretty: false } });
  assert.equal(text.includes("\n"), false);
  assert.deepEqual(parseGrantDocument({ text }), { ok: true, grants });
});

test("an env grant configures the running install in preference to the committed file", () => {
  const grant = grantFor("desktop");
  assert.deepEqual(resolvePublishTrust({ envValue: JSON.stringify([grant]), fileContents: "not JSON" }), {
    state: "configured", origin: "env", grants: [grant], reason: null,
  });
  assert.deepEqual(resolvePublishTrust({ envValue: "[]", fileContents: JSON.stringify([grant]) }), {
    state: "revoked", origin: "env", grants: [], reason: null,
  });
});

test("destination status messages distinguish one computer, several, revocation and invalid settings", () => {
  assert.equal(describePublishTrustState({ res: { state: "configured", origin: "file", grants: [grantFor("one")], reason: null }, settingName: SETTING_NAME }),
    "1 computer can publish to this site.");
  assert.equal(describePublishTrustState({ res: { state: "configured", origin: "file", grants: [grantFor("one"), grantFor("two")], reason: null }, settingName: SETTING_NAME }),
    "2 computers can publish to this site.");
  assert.equal(describePublishTrustState({ res: { state: "revoked", origin: "file", grants: [], reason: null }, settingName: SETTING_NAME }),
    "Publishing to this site is switched off. No computer is connected.");
  for (const reason of [null, "Bad version."]) {
    assert.equal(describePublishTrustState({ res: { state: "invalid", origin: "file", grants: [], reason }, settingName: SETTING_NAME }),
      "This site's publishing settings could not be read, so nobody can publish to it." + (reason ? ` ${reason}` : ""));
  }
});

test("expiry uses the default lifetime when options or lifetimeDays are omitted and honors zero", () => {
  assert.equal(grantNotAfterFrom({ nowIso: NOW }), "2027-09-19T12:00:00.000Z");
  assert.equal(grantNotAfterFrom({ nowIso: NOW }, {}), "2027-09-19T12:00:00.000Z");
  assert.equal(grantNotAfterFrom({ nowIso: NOW }, { lifetimeDays: 0 }), NOW);
});

test("connection renewal warnings include the boundary and singular day wording", () => {
  for (const [notAfter, verdict, message] of [
    ["2026-09-20T12:00:00.000Z", "expiring-soon", "This computer can publish to example.test for 1 more day. Reconnecting and deploying renews it."],
    ["2026-10-19T12:00:00.000Z", "expiring-soon", "This computer can publish to example.test for 30 more days. Reconnecting and deploying renews it."],
    ["2026-10-20T12:00:00.000Z", "connected", "This computer can publish to example.test."],
  ] as const) {
    assert.deepEqual(describeConnection({ settingName: SETTING_NAME,
      resolution: { state: "configured", origin: "file", grants: [grantFor("laptop", { notAfter })], reason: null },
      sourceInstallationId: "laptop", publicKeyB64u: "pk-laptop", siteLabel: "example.test", nowIso: NOW,
    }), { verdict, message });
  }
});

test("provisioning reports parse failures on reads without exposing a usable partial grant list", async () => {
  const path = "/repo/deploy/publish-trust.json";
  const original = JSON.stringify([grantFor("laptop"), { version: 999 }]);
  for (const observed of [false, true]) {
    const events: ProvisioningEvent[] = [];
    const io = memoryIo({ [path]: original });
    const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path,
      ...(observed ? { onEvent: (event: ProvisioningEvent) => events.push(event) } : {}),
    });
    const expected = { ok: false, reason: "unsupported grant version 999; this install implements version 1" };
    assert.deepEqual(await port.readProvisioned(), expected);
    assert.deepEqual(await port.disconnect({ sourceInstallationId: "laptop" }), expected);
    assert.equal(io.files[path], original);
    assert.deepEqual(events, observed ? [
      { kind: "error", target: port.target, reason: expected.reason },
      { kind: "error", target: port.target, reason: expected.reason },
    ] : []);
  }
});

test("provisioning announces unchanged edits and refusal reasons without writing", async () => {
  const path = "/repo/deploy/publish-trust.json";
  const full = Array.from({ length: MAX_PROVISIONED_GRANTS }, (_, i) => grantFor(`m${i}`));
  const original = JSON.stringify(full);
  const events: ProvisioningEvent[] = [];
  const io = memoryIo({ [path]: original });
  const port = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path, onEvent: event => events.push(event) });
  assert.deepEqual(await port.connect({ grant: full[0]! }), { ok: true, grants: full, changed: false, target: port.target });
  const refused = await port.connect({ grant: grantFor("extra") });
  assert.deepEqual(refused, { ok: false, reason: "this site already accepts 8 computers; disconnect one first" });
  assert.deepEqual(events, [
    { kind: "write", target: port.target, grants: 8, changed: false },
    { kind: "error", target: port.target, reason: "this site already accepts 8 computers; disconnect one first" },
  ]);
  assert.equal(io.files[path], original);
});

test("a codec refusal is observable through the event port and never becomes a write", async () => {
  const io = memoryIo();
  const events: ProvisioningEvent[] = [];
  const port = createFileProvisioning({ io, path: "/repo/config", onEvent: event => events.push(event), codec: {
    ...COMMITTED_JSON_CODEC, encode: () => ({ ok: false, reason: "cannot preserve config" }),
  } });
  assert.deepEqual(await port.readProvisioned(), { ok: true, grants: [] });
  assert.deepEqual(await port.connect({ grant: grantFor("laptop") }), { ok: false, reason: "cannot preserve config" });
  assert.deepEqual(io.files, {});
  assert.deepEqual(events, [
    { kind: "read", target: port.target, grants: 0 },
    { kind: "error", target: port.target, reason: "cannot preserve config" },
  ]);
});

test("fail-closed: an env value set to the empty string revokes publishing even when the committed file grants a source", () => {
  // An operator with only provider access turns publishing off by setting the host's env var to "".
  // Treating "" like "unset" would fall back to the committed file, which fails OPEN.
  const res = resolvePublishTrust({ envValue: "", fileContents: JSON.stringify([grantFor("laptop")]) });
  assert.equal(res.state, "revoked");
  assert.equal(res.origin, "env");
  assert.deepEqual(res.grants, []);
  assert.equal(findGrantForSource({ res, sourceInstallationId: "laptop" }), null);
});
