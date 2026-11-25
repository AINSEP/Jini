import assert from "node:assert/strict";
import { test } from "vitest";

import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";

import { fetchDestinationIdentity, PublishTrustHandshakeError, type PublishTrustWire } from "../handshake-client.js";

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
