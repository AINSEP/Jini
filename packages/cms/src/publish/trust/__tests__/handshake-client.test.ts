import { hkdfSync } from "node:crypto";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import { buildChallengeMessage } from "../challenge.js";
import { verifyPublishSignature } from "../keys.js";
import { PublishTrustHandshakeError } from "../handshake-error.js";
import assert from "node:assert/strict";
import { test } from "vitest";

import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";

import { fetchDestinationIdentity, openPublishSession, type PublishTrustWire } from "../handshake-client.js";

/** A non-default peer vocabulary: proves the host's words, not a baked-in product name, reach the owner. */
const PROTOCOL: PublishTrustWire = {
  messageVersion: "acme-publish-challenge-v1",
  peerSiteLabel: "an Acme site",
  notPeerFailure: "not-a-acme-site",
};

function httpDouble({ respond }: { respond: (request: HttpRequest) => HttpResponse }) {
  const sent: HttpRequest[] = [];
  return { sent, httpClient: { send: async (request: HttpRequest) => { sent.push(request); return respond(request); } } };
}

test("identity is asked at the handshake base path and the destination's answer is returned", async () => {
  const { sent, httpClient } = httpDouble({ respond: () => ({ status: 200, headers: {}, bodyText: JSON.stringify({
    installationId: "dest", workspaceId: "dest-ws", origin: "https://dest.example",
  }) }) });
  const identity = await fetchDestinationIdentity({ deps: { httpClient, protocol: PROTOCOL }, input: { baseUrl: "https://dest.example" } });
  assert.deepEqual(identity, { installationId: "dest", workspaceId: "dest-ws", origin: "https://dest.example" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.method, "GET");
  assert.equal(sent[0]!.url, "https://dest.example/api/publish-trust/v1/identity");
  assert.equal(sent[0]!.timeoutMs, 15_000);
  assert.equal(sent[0]!.body, undefined);
});

test("a 404 is the host's not-a-peer failure, worded with the host's peer label", async () => {
  const { httpClient } = httpDouble({ respond: () => ({ status: 404, headers: {}, bodyText: "nope" }) });
  const err = await fetchDestinationIdentity({ deps: { httpClient, protocol: PROTOCOL }, input: { baseUrl: "https://dest.example" } })
    .then(() => null, (e: unknown) => e);
  assert.ok(err instanceof PublishTrustHandshakeError);
  assert.equal(err.failure, "not-a-acme-site");
  assert.equal(err.message, "dest.example answered, but it does not look like an Acme site. Check the address.");
});

test("a non-JSON answer quotes a bounded body under the host's peer label", async () => {
  const { httpClient } = httpDouble({ respond: () => ({ status: 200, headers: {}, bodyText: `<html>${"x".repeat(300)}` }) });
  await assert.rejects(
    () => fetchDestinationIdentity({ deps: { httpClient, protocol: PROTOCOL }, input: { baseUrl: "https://dest.example" } }),
    { name: "PublishTrustHandshakeError", failure: "not-a-acme-site",
      message: `dest.example answered, but it does not look like an Acme site (<html>${"x".repeat(194)}).` },
  );
});

test("an identity without a workspace id is the host's not-a-peer failure", async () => {
  const { httpClient } = httpDouble({ respond: () => ({ status: 200, headers: {}, bodyText: JSON.stringify({ installationId: "dest" }) }) });
  await assert.rejects(
    () => fetchDestinationIdentity({ deps: { httpClient, protocol: PROTOCOL }, input: { baseUrl: "https://dest.example" } }),
    { failure: "not-a-acme-site", message: "dest.example answered, but it does not look like an Acme site." },
  );
});

const baseUrl = "https://dest.example";
const destination = { installationId: "dest", workspaceId: "dest-ws", origin: baseUrl };

test.each([
  { status: 401, bodyText: '{"code":"IGNORED"}', failure: "not-connected",
    message: "dest.example doesn't recognise this computer yet. Connect it, then deploy the site once." },
  { status: 503, bodyText: '{"code":"SECRET_STORE_UNCONFIGURED","message":"private backend detail"}', failure: "refused",
    message: "dest.example has no Site key set up yet, so it cannot accept publishes. Set one up on that site, then try again." },
  { status: 503, bodyText: "not-json", failure: "refused",
    message: "dest.example refused to set up publishing right now. Try again in a moment." },
  { status: 503, bodyText: "null", failure: "refused",
    message: "dest.example refused to set up publishing right now. Try again in a moment." },
  { status: 302, bodyText: "", failure: "refused",
    message: "dest.example refused to set up publishing right now. Try again in a moment." },
])("maps HTTP $status $bodyText to plain $failure guidance", async ({ status, bodyText, failure, message }) => {
  const { httpClient } = httpDouble({ respond: () => ({ status, headers: {}, bodyText }) });
  await assert.rejects(fetchDestinationIdentity({ deps: { httpClient, protocol: PROTOCOL }, input: { baseUrl } }),
    { name: "PublishTrustHandshakeError", failure, message });
});

test.each([new Error("connection interrupted"), "connection interrupted"])("classifies thrown transport failures as unreachable (%s)", async cause => {
  const { httpClient } = httpDouble({ respond: () => { throw cause; } });
  await assert.rejects(fetchDestinationIdentity({ deps: { httpClient, protocol: PROTOCOL }, input: { baseUrl } }), {
    name: "PublishTrustHandshakeError", failure: "unreachable", message: "dest.example could not be reached: connection interrupted",
  });
});

function sessionFixture(overrides: { challenge?: unknown; minted?: unknown } = {}) {
  const derives: Array<{ workspaceId: string; purpose: string; info: string }> = [];
  // Same deterministic site key as keys.test.ts, whose public key pins generation 1.
  const siteKey = Buffer.from("0b".repeat(32), "hex");
  const keyring: KeyringPort = {
    activeKey: async () => { throw new Error("unexpected active key read"); },
    deriveSigningSecret: async () => { throw new Error("unexpected webhook key derivation"); },
    derive: async ({ workspaceId, purpose, info }) => {
      derives.push({ workspaceId, purpose, info });
      return new Uint8Array(hkdfSync("sha256", siteKey, Buffer.alloc(0), `${purpose}:${workspaceId}:${info}`, 32));
    },
  };
  const reply = (value: unknown): HttpResponse => ({ status: 200, headers: {}, bodyText: JSON.stringify(value) });
  const { sent, httpClient } = httpDouble({ respond: request => {
    switch (`${request.method} ${request.url}`) {
      case "GET https://dest.example/api/publish-trust/v1/identity": return reply(destination);
      case "POST https://dest.example/api/publish-trust/v1/challenge":
        assert.equal(request.body, "{}");
        return reply(overrides.challenge ?? { nonce: "fresh-nonce", targetInstallationId: "dest" });
      case "POST https://dest.example/api/publish-trust/v1/session": return reply(overrides.minted ?? { token: "session-1" });
      default: throw new Error("unexpected handshake request");
    }
  } });
  const deps = { keyring, httpClient, protocol: PROTOCOL };
  return { deps, sent, derives };
}

test("requests a signed default session using the local workspace and honors the destination’s capability list", async () => {
  const { deps, sent, derives } = sessionFixture({ minted: { token: "session-1", expiresAt: "2026-11-27T15:00:00Z",
    capabilities: ["publish_content.read", null, 7] } });
  const session = await openPublishSession({ deps, input: { baseUrl, workspaceId: "ws-pin" } });
  const sourceInstallationId = "M1tMc8XzZE7tdgMu70hQZQ";
  assert.deepEqual(derives, [
    { workspaceId: "ws-pin", purpose: "publish-trust-installation-id", info: "self" },
    { workspaceId: "ws-pin", purpose: "publish-trust-signing-key", info: sourceInstallationId + ":https://dest.example:v1" },
  ]);
  assert.deepEqual(sent.map(request => [request.method, request.url, request.headers]), [
    ["GET", baseUrl + "/api/publish-trust/v1/identity", {}],
    ["POST", baseUrl + "/api/publish-trust/v1/challenge", { "content-type": "application/json" }],
    ["POST", baseUrl + "/api/publish-trust/v1/session", { "content-type": "application/json" }],
  ]);
  const { signatureB64u, ...signed } = JSON.parse(String(sent[2]!.body)) as {
    signatureB64u: string; nonce: string; sourceInstallationId: string; generation: number;
  };
  const capabilities = ["publish_content.read", "publish_content.apply"] as const;
  assert.deepEqual(signed, { nonce: "fresh-nonce", sourceInstallationId, generation: 1, capabilities });
  assert.equal(verifyPublishSignature({
    publicKeyB64u: "xhb7t91QM_vTtKjYYLw1qvL6UTcuQwqTwISAkDqAFYI", signatureB64u,
    message: buildChallengeMessage({ messageVersion: PROTOCOL.messageVersion, nonce: "fresh-nonce",
      sourceInstallationId, targetInstallationId: "dest", generation: 1, capabilities }),
  }), true);
  assert.deepEqual(session, { token: "session-1", expiresAt: "2026-11-27T15:00:00Z", capabilities: ["publish_content.read"], identity: destination });
});

test("requests the backstop capability only when requested and keeps the explicit signing generation", async () => {
  const { deps, sent, derives } = sessionFixture();
  const session = await openPublishSession({ deps, input: { baseUrl, workspaceId: "ws-pin", generation: 4, backstop: true } });
  assert.deepEqual(session, { token: "session-1", expiresAt: "",
    capabilities: ["publish_content.read", "publish_content.apply", "publish_content.backstop"], identity: destination });
  assert.match(derives.at(-1)?.info ?? "", /:https:\/\/dest\.example:v4$/);
  const body = JSON.parse(String(sent[2]!.body)) as { generation: number; capabilities: unknown };
  assert.deepEqual([body.generation, body.capabilities], [4, ["publish_content.read", "publish_content.apply", "publish_content.backstop"]]);
});

test.each([
  { reason: "nonce", challenge: { nonce: "", targetInstallationId: "dest" } },
  { reason: "destination ID", challenge: { nonce: "fresh-nonce", targetInstallationId: false } },
])("does not derive a signing key for a challenge with invalid $reason", async ({ challenge }) => {
  const { deps, derives, sent } = sessionFixture({ challenge });
  await assert.rejects(openPublishSession({ deps, input: { baseUrl, workspaceId: "ws-pin" } }),
    { name: "PublishTrustHandshakeError", failure: "not-a-acme-site", message: "dest.example answered, but it does not look like an Acme site." });
  assert.deepEqual(derives, []);
  assert.equal(sent.length, 2);
});

test("refuses a successful session reply with no non-empty token", async () => {
  const { deps } = sessionFixture({ minted: { token: "" } });
  await assert.rejects(openPublishSession({ deps, input: { baseUrl, workspaceId: "ws-pin" } }),
    { name: "PublishTrustHandshakeError", failure: "not-a-acme-site", message: "dest.example answered, but it does not look like an Acme site." });
});
