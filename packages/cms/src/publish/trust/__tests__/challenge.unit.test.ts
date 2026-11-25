import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { test } from "vitest";

import {
  buildChallengeMessage,
  CHALLENGE_TTL_MS,
  InMemoryPublishChallengeStore,
  issuePublishChallenge,
  verifyChallengeResponse,
  type PublishChallengeRecord,
  type PublishChallengeResponse,
  type PublishChallengeStorePort,
} from "../challenge.js";
import { PUBLISH_TRUST_GRANT_VERSION, type PublishTrustGrant } from "../grant.js";

/**
 * @file Branch-by-branch pins for `challenge.ts`: every refusal reason verbatim, the ORDER the
 * checks run in (the nonce is burned first), and the one instant every time check is judged at.
 */

const NOW = "2026-09-19T12:00:00.000Z";
const TARGET = "dest-install";
const SOURCE = "src-install";
const NONCE = "nonce-1";
/** An explicit test message version: the host owns the real pinned tag and injects it. */
const MESSAGE_VERSION = "test-publish-challenge-v1";

const { privateKey } = generateKeyPairSync("ed25519");
const { privateKey: otherPrivateKey } = generateKeyPairSync("ed25519");

/** Raw 32-byte Ed25519 public point, base64url — the format a grant carries. */
function rawPublicKeyB64u(key: KeyObject): string {
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - 32).toString("base64url");
}

function grant(overrides: Partial<PublishTrustGrant> = {}): PublishTrustGrant {
  return {
    version: PUBLISH_TRUST_GRANT_VERSION,
    sourceInstallationId: SOURCE,
    publicKeys: [{ publicKeyB64u: rawPublicKeyB64u(privateKey), generation: 1 }],
    workspaceId: "ws-1",
    entityTypes: ["post"],
    capabilities: ["publish_content.read", "publish_content.apply"],
    notAfter: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function issued(overrides: Partial<PublishChallengeRecord> = {}): PublishChallengeRecord {
  return {
    nonce: NONCE,
    targetInstallationId: TARGET,
    issuedAtIso: NOW,
    expiresAtIso: new Date(Date.parse(NOW) + CHALLENGE_TTL_MS).toISOString(),
    ...overrides,
  };
}

/** A typed single-use store double holding at most the given records, logging every take. */
function recordingStore(records: PublishChallengeRecord[] = [issued()]) {
  const held = new Map(records.map((record) => [record.nonce, record]));
  const takes: string[] = [];
  const store: PublishChallengeStorePort = {
    put: async ({ record }) => {
      held.set(record.nonce, record);
    },
    takeOnce: async ({ nonce }) => {
      takes.push(nonce);
      const record = held.get(nonce) ?? null;
      held.delete(nonce);
      return record;
    },
  };
  return { store, takes };
}

/** A correctly signed response; overrides apply AFTER signing unless `signFields` says otherwise. */
function response(
  overrides: Partial<PublishChallengeResponse> = {},
  signFields: Partial<PublishChallengeResponse> = {},
  signer: KeyObject = privateKey
): PublishChallengeResponse {
  const base = { nonce: NONCE, sourceInstallationId: SOURCE, generation: 1, capabilities: ["publish_content.read"], ...signFields };
  const message = buildChallengeMessage({ ...base, messageVersion: MESSAGE_VERSION, targetInstallationId: TARGET });
  return { ...base, signatureB64u: sign(null, Buffer.from(message), signer).toString("base64url"), ...overrides };
}

async function verify(
  input: { response: PublishChallengeResponse; grant?: PublishTrustGrant; records?: PublishChallengeRecord[]; nowIso?: string }
) {
  const { store, takes } = recordingStore(input.records);
  const result = await verifyChallengeResponse(
    {
      deps: { store, clock: { nowIso: () => input.nowIso ?? NOW }, messageVersion: MESSAGE_VERSION },
      input: { grant: input.grant ?? grant(), targetInstallationId: TARGET, response: input.response }
    }
  );
  return { result, takes };
}

async function reasonFor(input: Parameters<typeof verify>[0]): Promise<string | null> {
  const { result } = await verify(input);
  return result.ok ? null : result.reason;
}

test("buildChallengeMessage joins the version and fields by newline with sorted capabilities", () => {
  const capabilities = ["publish_content.read", "publish_content.apply"];
  assert.equal(
    buildChallengeMessage({ messageVersion: MESSAGE_VERSION, nonce: "n", targetInstallationId: "t", sourceInstallationId: "s", generation: 2, capabilities }),
    "test-publish-challenge-v1\nn\nt\ns\n2\npublish_content.apply,publish_content.read"
  );
  assert.deepEqual(capabilities, ["publish_content.read", "publish_content.apply"]);
});

test("issuePublishChallenge stores and returns a record expiring one TTL after issue", async () => {
  const { store } = recordingStore([]);
  const record = await issuePublishChallenge({ store, clock: { nowIso: () => NOW }, idGen: { newId: () => NONCE }, targetInstallationId: TARGET });
  assert.deepEqual(record, issued());
  assert.deepEqual(await store.takeOnce({ nonce: NONCE }), record);
});

test("a correctly signed response verifies with the requested capabilities", async () => {
  const { result } = await verify({ response: response() });
  assert.deepEqual(result, {
    ok: true,
    verified: { sourceInstallationId: SOURCE, targetInstallationId: TARGET, generation: 1, capabilities: ["publish_content.read"] },
  });
});

test("an absent response is refused without consuming any nonce", async () => {
  // JSON.parse stands in for an untyped request body: the whole response can be missing.
  const absent: PublishChallengeResponse = JSON.parse("null");
  const { result, takes } = await verify({ response: absent });
  assert.deepEqual(result, { ok: false, reason: "no nonce supplied" });
  assert.deepEqual(takes, []);
});

test("an empty nonce is refused without consuming any nonce", async () => {
  const { result, takes } = await verify({ response: response({ nonce: "" }) });
  assert.deepEqual(result, { ok: false, reason: "no nonce supplied" });
  assert.deepEqual(takes, []);
});

test("a non-string nonce is refused as not supplied", async () => {
  const wire: PublishChallengeResponse = JSON.parse('{"nonce":7}');
  assert.equal(await reasonFor({ response: wire }), "no nonce supplied");
});

test("an unknown nonce is refused", async () => {
  assert.equal(await reasonFor({ response: response(), records: [] }), "nonce is unknown or was already used");
});

test("the nonce is consumed before any later check fails", async () => {
  const { result, takes } = await verify({ response: response({ signatureB64u: "" }) });
  assert.deepEqual(result, { ok: false, reason: "the response carries no signature" });
  assert.deepEqual(takes, [NONCE]);
});

test("an unparsable clock is refused as an expired nonce", async () => {
  assert.equal(await reasonFor({ response: response(), nowIso: "not a time" }), "nonce has expired");
});

test("a nonce is expired at exactly its expiry instant", async () => {
  assert.equal(await reasonFor({ response: response(), records: [issued({ expiresAtIso: NOW })] }), "nonce has expired");
});

test("a nonce is still usable one millisecond before its expiry", async () => {
  const records = [issued({ expiresAtIso: new Date(Date.parse(NOW) + 1).toISOString() })];
  assert.equal(await reasonFor({ response: response(), records }), null);
});

for (const expiresAtIso of ["corrupt", "", undefined]) {
  test(`a stored record with expiry ${JSON.stringify(expiresAtIso)} is refused and consumed`, async () => {
    // Exercise an adapter's corrupt persisted record with an otherwise valid signed response.
    const record: PublishChallengeRecord = JSON.parse(JSON.stringify({ ...issued(), expiresAtIso }));
    const { store, takes } = recordingStore([record]);
    const result = await verifyChallengeResponse(
      {
        deps: { store, clock: { nowIso: () => NOW }, messageVersion: MESSAGE_VERSION },
        input: { grant: grant(), targetInstallationId: TARGET, response: response() }
      }
    );
    assert.deepEqual(result, { ok: false, reason: "nonce has expired" });
    assert.deepEqual(takes, [NONCE]);
    assert.equal(await store.takeOnce({ nonce: NONCE }), null);
  });
}

test("a nonce issued for another destination is refused", async () => {
  const records = [issued({ targetInstallationId: "other-dest" })];
  assert.equal(await reasonFor({ response: response(), records }), "nonce was issued for another destination");
});

test("nonce expiry is checked before the nonce's destination", async () => {
  const records = [issued({ targetInstallationId: "other-dest", expiresAtIso: NOW })];
  assert.equal(await reasonFor({ response: response(), records }), "nonce has expired");
});

test("an expired grant is refused", async () => {
  assert.equal(await reasonFor({ response: response(), grant: grant({ notAfter: NOW }) }), "the publishing grant has expired or been revoked");
});

test("the nonce's destination is checked before the grant", async () => {
  const records = [issued({ targetInstallationId: "other-dest" })];
  assert.equal(await reasonFor({ response: response(), records, grant: grant({ notAfter: NOW }) }), "nonce was issued for another destination");
});

test("the nonce and the grant are judged at one clock reading", async () => {
  // The second reading would be past the grant: reading the clock twice would refuse this.
  const readings = [NOW, "2100-01-01T00:00:00.000Z"];
  const { store } = recordingStore();
  const result = await verifyChallengeResponse(
    {
      deps: { store, clock: { nowIso: () => readings.shift() ?? "exhausted" }, messageVersion: MESSAGE_VERSION },
      input: { grant: grant(), targetInstallationId: TARGET, response: response() }
    }
  );
  assert.equal(result.ok, true);
});

test("a response naming another installation is refused", async () => {
  const signed = response({}, { sourceInstallationId: "someone-else" });
  assert.equal(await reasonFor({ response: signed }), "the response names an installation this grant is not for");
});

test("the grant's validity is checked before the source installation", async () => {
  const signed = response({ sourceInstallationId: "someone-else" });
  assert.equal(await reasonFor({ response: signed, grant: grant({ notAfter: NOW }) }), "the publishing grant has expired or been revoked");
});

test("an empty capability list is refused", async () => {
  assert.equal(await reasonFor({ response: response({ capabilities: [] }) }), "no capabilities requested");
});

test("a non-array capability list is refused", async () => {
  const wire: PublishChallengeResponse = { ...response(), ...JSON.parse('{"capabilities":"publish_content.read"}') };
  assert.equal(await reasonFor({ response: wire }), "no capabilities requested");
});

test("the source installation is checked before the capabilities", async () => {
  assert.equal(
    await reasonFor({ response: response({ sourceInstallationId: "someone-else", capabilities: [] }) }),
    "the response names an installation this grant is not for"
  );
});

test("the first capability outside the grant is named", async () => {
  const signed = response({}, { capabilities: ["publish_content.read", "admin.*", "content.write"] });
  assert.equal(await reasonFor({ response: signed }), "'admin.*' is outside this grant");
});

test("a non-string capability is named through String()", async () => {
  const wire: PublishChallengeResponse = { ...response(), ...JSON.parse('{"capabilities":[7]}') };
  assert.equal(await reasonFor({ response: wire }), "'7' is outside this grant");
});

test("capabilities are checked before the key generation", async () => {
  assert.equal(await reasonFor({ response: response({ capabilities: ["x"], generation: 9 }) }), "'x' is outside this grant");
});

test("a generation the grant holds no key for is refused", async () => {
  assert.equal(await reasonFor({ response: response({}, { generation: 2 }) }), "no accepted public key for the claimed generation");
});

test("the key generation is checked before the signature's presence", async () => {
  assert.equal(await reasonFor({ response: response({ generation: 2, signatureB64u: "" }) }), "no accepted public key for the claimed generation");
});

test("a non-string signature is refused as absent", async () => {
  const wire: PublishChallengeResponse = { ...response(), ...JSON.parse('{"signatureB64u":5}') };
  assert.equal(await reasonFor({ response: wire }), "the response carries no signature");
});

test("a signature from another key is refused", async () => {
  assert.equal(await reasonFor({ response: response({}, {}, otherPrivateKey) }), "signature verification failed");
});

test("a signature over different capabilities is refused", async () => {
  const signed = response({ capabilities: ["publish_content.apply"] });
  assert.equal(await reasonFor({ response: signed }), "signature verification failed");
});

test("the key is looked up by the claimed generation among several", async () => {
  const keys = [
    { publicKeyB64u: rawPublicKeyB64u(otherPrivateKey), generation: 1 },
    { publicKeyB64u: rawPublicKeyB64u(privateKey), generation: 2 },
  ];
  assert.equal(await reasonFor({ response: response({}, { generation: 2 }), grant: grant({ publicKeys: keys }) }), null);
});

test("the in-memory store hands a record back once and then forgets it", async () => {
  const store = new InMemoryPublishChallengeStore({ nowIso: () => NOW });
  await store.put({ record: issued() });
  assert.deepEqual(await store.takeOnce({ nonce: NONCE }), issued());
  assert.equal(await store.takeOnce({ nonce: NONCE }), null);
});

test("the in-memory store sweeps a record expiring exactly now and keeps a later one", async () => {
  const store = new InMemoryPublishChallengeStore({ nowIso: () => NOW });
  await store.put({ record: issued({ nonce: "due", expiresAtIso: NOW }) });
  await store.put({ record: issued({ nonce: "live", expiresAtIso: new Date(Date.parse(NOW) + 1).toISOString() }) });
  await store.put({ record: issued({ nonce: "trigger" }) });
  assert.equal(await store.takeOnce({ nonce: "due" }), null);
  assert.equal((await store.takeOnce({ nonce: "live" }))?.nonce, "live");
});

test("the in-memory store sweeps corrupt expiries and retains live records", async () => {
  const store = new InMemoryPublishChallengeStore({ nowIso: () => NOW });
  for (const [index, expiresAtIso] of ["corrupt", "", undefined].entries()) {
    const record: PublishChallengeRecord = JSON.parse(JSON.stringify({ ...issued({ nonce: `bad-${index}` }), expiresAtIso }));
    await store.put({ record });
  }
  const live = issued({ nonce: "live" });
  await store.put({ record: live });
  for (let index = 0; index < 3; index++) assert.equal(await store.takeOnce({ nonce: `bad-${index}` }), null);
  assert.deepEqual(await store.takeOnce({ nonce: "live" }), live);
});

test("the in-memory sweep fails closed when its clock becomes unusable", async () => {
  let nowIso = NOW;
  const store = new InMemoryPublishChallengeStore({ nowIso: () => nowIso });
  await store.put({ record: issued({ nonce: "previously-live" }) });
  nowIso = "invalid";
  await store.put({ record: issued({ nonce: "trigger" }) });
  assert.equal(await store.takeOnce({ nonce: "previously-live" }), null);
});
