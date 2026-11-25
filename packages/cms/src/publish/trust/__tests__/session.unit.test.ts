import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";

import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import { mintPublishSession, SESSION_TTL_MS, verifyPublishSession } from "../session.js";

/**
 * @file Branch-by-branch pins for `session.ts`: every refusal reason verbatim, the ORDER the checks
 * run in, and that no key is derived for a token that fails the cheap format checks.
 */

const NOW = "2026-09-19T12:00:00.000Z";
const AUDIENCE = "dest-install";
const WORKSPACE = "ws-1";
/** Fixed derived material; the fake keyring hands it out for every derive call. */
const KEY = new Uint8Array(32).fill(7);

type DeriveInput = Parameters<KeyringPort["derive"]>[0];

/** A typed keyring double that records every derivation request. */
function recordingKeyring(): { keyring: KeyringPort; derives: DeriveInput[] } {
  const derives: DeriveInput[] = [];
  const keyring: KeyringPort = {
    activeKey: async () => ({ keyId: "test" }),
    deriveSigningSecret: async () => {
      throw new Error("deriveSigningSecret is not used by session.ts");
    },
    derive: async (input) => {
      derives.push(input);
      return KEY;
    },
  };
  return { keyring, derives };
}

function depsAt(nowIso = NOW) {
  const { keyring, derives } = recordingKeyring();
  return { deps: { keyring, workspaceId: WORKSPACE, clock: { nowIso: () => nowIso } }, derives };
}

/** Signs an arbitrary encoded payload under {@link KEY}, so payload checks after the MAC are reachable. */
function signedToken(encodedPayload: string): string {
  const mac = createHmac("sha256", Buffer.from(KEY)).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${mac}`;
}

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    sourceInstallationId: "src-install",
    targetInstallationId: AUDIENCE,
    workspaceId: WORKSPACE,
    capabilities: ["publish_content.read"],
    generation: 1,
    expiresAtIso: new Date(Date.parse(NOW) + 1000).toISOString(),
    ...overrides,
  };
}

async function reasonFor(token: string, nowIso = NOW, expectedAudience = AUDIENCE): Promise<string | null> {
  const result = await verifyPublishSession({ deps: depsAt(nowIso).deps, input: { token, expectedAudience } });
  return result.ok ? null : result.reason;
}

test("mint derives the session key under its own purpose and info", async () => {
  const { deps, derives } = depsAt();
  await mintPublishSession({ deps, input: { sourceInstallationId: "s", targetInstallationId: AUDIENCE, capabilities: [], generation: 3 } });
  assert.deepEqual(derives, [{ workspaceId: WORKSPACE, purpose: "publish-trust-session-key", info: "session-hmac" }]);
});

test("mint returns a payload expiring one TTL after the clock and a token MAC'd over it", async () => {
  const { deps } = depsAt();
  const minted = await mintPublishSession({
                                            deps,
                                            input: {
      sourceInstallationId: "src-install",
      targetInstallationId: AUDIENCE,
      capabilities: ["publish_content.read"],
      generation: 1,
    }
                                          });
  assert.deepEqual(minted.payload, payload({ expiresAtIso: new Date(Date.parse(NOW) + SESSION_TTL_MS).toISOString() }));
  assert.equal(minted.token, signedToken(encode(JSON.stringify(minted.payload))));
});

test("a minted token verifies and yields its payload", async () => {
  const { deps } = depsAt();
  const minted = await mintPublishSession({
                                            deps,
                                            input: {
      sourceInstallationId: "src-install",
      targetInstallationId: AUDIENCE,
      capabilities: ["publish_content.read"],
      generation: 1,
    }
                                          });
  assert.deepEqual(await verifyPublishSession({ deps, input: { token: minted.token, expectedAudience: AUDIENCE } }), {
    ok: true,
    payload: minted.payload,
  });
});

test("a non-string token from the wire is refused as not supplied", async () => {
  // JSON.parse stands in for an untyped request body: the token field really can be anything.
  const wire: { token: string; expectedAudience: string } = JSON.parse('{"token":42,"expectedAudience":"dest-install"}');
  const { deps } = depsAt();
  assert.deepEqual(await verifyPublishSession({ deps, input: wire }), { ok: false, reason: "no session token supplied" });
});

test("an empty token is refused as not supplied", async () => {
  assert.equal(await reasonFor(""), "no session token supplied");
});

for (const token of ["abc", "a.b.c", ".mac", "payload."]) {
  test(`token '${token}' is refused as malformed`, async () => {
    assert.equal(await reasonFor(token), "malformed session token");
  });
}

test("format refusals happen before any key derivation", async () => {
  const { deps, derives } = depsAt();
  await verifyPublishSession({ deps, input: { token: "a.b.c", expectedAudience: AUDIENCE } });
  await verifyPublishSession({ deps, input: { token: "", expectedAudience: AUDIENCE } });
  assert.equal(derives.length, 0);
});

test("a well-formed token derives the session key exactly once", async () => {
  const { deps, derives } = depsAt();
  await verifyPublishSession({ deps, input: { token: "a.b", expectedAudience: AUDIENCE } });
  assert.deepEqual(derives, [{ workspaceId: WORKSPACE, purpose: "publish-trust-session-key", info: "session-hmac" }]);
});

test("a MAC of the right length but wrong bytes is refused as an invalid signature", async () => {
  const token = signedToken(encode(JSON.stringify(payload())));
  const [encoded, mac] = token.split(".") as [string, string];
  const flipped = `${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`;
  assert.equal(await reasonFor(`${encoded}.${flipped}`), "session token signature is invalid");
});

test("a MAC of the wrong length is refused as an invalid signature", async () => {
  assert.equal(await reasonFor(`${encode(JSON.stringify(payload()))}.AAAA`), "session token signature is invalid");
});

test("an unsigned tampered payload is refused at the MAC before it is parsed", async () => {
  const good = signedToken(encode(JSON.stringify(payload())));
  const mac = good.split(".")[1];
  assert.equal(await reasonFor(`${encode("not json")}.${mac}`), "session token signature is invalid");
});

test("an authenticated non-JSON payload is refused as not JSON", async () => {
  assert.equal(await reasonFor(signedToken(encode("{nope"))), "session token payload is not JSON");
});

test("an authenticated null payload is refused as not an object", async () => {
  assert.equal(await reasonFor(signedToken(encode("null"))), "session token payload is not an object");
});

test("an authenticated number payload is refused as not an object", async () => {
  assert.equal(await reasonFor(signedToken(encode("42"))), "session token payload is not an object");
});

test("an unsupported version is refused and named", async () => {
  assert.equal(await reasonFor(signedToken(encode(JSON.stringify(payload({ v: 2 }))))), "unsupported session token version 2");
});

test("a missing version is refused as version undefined", async () => {
  const { v: _v, ...rest } = payload();
  assert.equal(await reasonFor(signedToken(encode(JSON.stringify(rest)))), "unsupported session token version undefined");
});

test("the version is checked before the expiry", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ v: 9, expiresAtIso: "never" }))));
  assert.equal(await reasonFor(token), "unsupported session token version 9");
});

test("an unparsable verification clock is refused as no usable expiry", async () => {
  assert.equal(await reasonFor(signedToken(encode(JSON.stringify(payload()))), "not a time"), "session token has no usable expiry");
});

test("a non-string expiry is refused as no usable expiry", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ expiresAtIso: Date.parse(NOW) + 1000 }))));
  assert.equal(await reasonFor(token), "session token has no usable expiry");
});

test("an unparsable expiry is refused as no usable expiry", async () => {
  assert.equal(await reasonFor(signedToken(encode(JSON.stringify(payload({ expiresAtIso: "soon" }))))), "session token has no usable expiry");
});

test("a token is expired at exactly its expiry instant", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ expiresAtIso: NOW }))));
  assert.equal(await reasonFor(token), "session token has expired");
});

test("a token is still valid one millisecond before its expiry", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ expiresAtIso: new Date(Date.parse(NOW) + 1).toISOString() }))));
  assert.equal(await reasonFor(token), null);
});

test("expiry is checked before the audience", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ expiresAtIso: NOW, targetInstallationId: "other" }))));
  assert.equal(await reasonFor(token), "session token has expired");
});

test("a token for another destination is refused", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ targetInstallationId: "other-dest" }))));
  assert.equal(await reasonFor(token), "session token was minted for another destination");
});

test("the audience is checked before the workspace", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ targetInstallationId: "other", workspaceId: "other" }))));
  assert.equal(await reasonFor(token), "session token was minted for another destination");
});

test("a token for another workspace is refused", async () => {
  const token = signedToken(encode(JSON.stringify(payload({ workspaceId: "ws-2" }))));
  assert.equal(await reasonFor(token), "session token was minted for another workspace");
});

test("an authenticated array payload passes the object check and is refused at the version", async () => {
  assert.equal(await reasonFor(signedToken(encode("[]"))), "unsupported session token version undefined");
});
