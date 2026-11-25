import assert from "node:assert/strict";
import { test } from "vitest";

import { nowIso } from "@jini-ai/core/primitives";

import { connectDestination, disconnectDestination, type ConnectDeps } from "../connect.js";
import { COMMITTED_JSON_CODEC, createFileProvisioning, type ProvisioningFileIo } from "../provisioning.js";

const PROTOCOL = { messageVersion: "acme-publish-challenge-v1", peerSiteLabel: "an Acme site", notPeerFailure: "not-a-acme-site" } as const;

function connectionFixture() {
  const files = new Map<string, string>();
  const io: ProvisioningFileIo = {
    read: async ({ path: file }) => files.get(file) ?? null,
    write: async ({ path: file, contents }) => { files.set(file, contents); },
  };
  const configPath = "/fixture/deploy/publish-trust.json";
  const provisioning = createFileProvisioning({ io, codec: COMMITTED_JSON_CODEC, path: configPath });
  const formatted: string[] = [];
  const deps: ConnectDeps = {
    workspaceId: "source-ws",
    clock: { nowMs: () => Date.parse("2026-10-04T00:00:00.000Z") },
    nowIso: ({ clock }) => { const iso = nowIso({ clock }); formatted.push(iso); return iso; },
    keyring: {
      activeKey: async () => ({ keyId: "v1" }),
      deriveSigningSecret: async () => { throw new Error("Webhook signing is not used when connecting a destination"); },
      derive: async () => new Uint8Array(32).fill(7),
    },
    httpClient: { send: async ({ method, url }) => {
      assert.equal(method, "GET");
      assert.equal(url, "https://dest.example/api/publish-trust/v1/identity");
      return { status: 200, headers: {}, bodyText: JSON.stringify({ installationId: "dest", workspaceId: "dest-ws", origin: "https://dest.example" }) };
    } },
    protocol: PROTOCOL,
    provisioning,
  };
  return { deps, io, files, configPath, formatted, input: { baseUrl: "https://dest.example", entityTypes: ["post"] } };
}

test("connecting never grants backstop, even when callers include raw types", async () => {
  const { deps, formatted } = connectionFixture();
  await connectDestination({ deps, input: { baseUrl: "https://dest.example", entityTypes: ["post", "raw-row", "raw-file"] } });
  const written = await deps.provisioning.readProvisioned();
  assert.ok(written.ok);
  assert.equal(written.grants.length, 1);
  assert.deepEqual(written.grants[0]!.entityTypes, ["post"]);
  assert.deepEqual(written.grants[0]!.capabilities, ["publish_content.read", "publish_content.apply"]);
  assert.equal(written.grants[0]!.workspaceId, "dest-ws");
  assert.deepEqual(formatted, ["2026-10-04T00:00:00.000Z"]);
});

// CONNECT-REPEAT-SAME-DOCUMENT: the second connect runs against the document the first one committed.
test("reconnecting an unchanged grant says that nothing needs deploying", async () => {
  const { deps, input } = connectionFixture();
  const first = await connectDestination({ deps, input });
  assert.equal(first.changed, true);
  assert.equal(first.nextStep, "Commit deploy/publish-trust.json and deploy. It holds public keys only — there is nothing secret in it.");
  const again = await connectDestination({ deps, input });
  assert.deepEqual(again, {
    identity: { installationId: "dest", workspaceId: "dest-ws", origin: "https://dest.example" },
    baseUrl: "https://dest.example", changed: false,
    target: { kind: "committed-json", path: "/fixture/deploy/publish-trust.json", nextStep: first.nextStep },
    nextStep: "This computer was already connected to that site. Nothing to change.",
  });
  const provisioned = await deps.provisioning.readProvisioned();
  assert.ok(provisioned.ok);
  assert.equal(provisioned.grants.length, 1);
  assert.equal(provisioned.grants[0]!.workspaceId, "dest-ws");
});

for (const action of ["connect", "disconnect"] as const) {
  test(`${action} reports a provisioning refusal and leaves the document intact`, async () => {
    const { deps, files, configPath, input } = connectionFixture();
    files.set(configPath, "null");
    await assert.rejects(
      () => action === "connect" ? connectDestination({ deps, input }) : disconnectDestination({ deps }),
      { name: "PublishTrustConnectError", message: "This site's publishing settings could not be saved: grant must be a JSON object" },
    );
    assert.equal(files.get(configPath), "null");
  });
}

test("disconnecting clears the stored grant and a second disconnect is unchanged", async () => {
  const { deps, input } = connectionFixture();
  await connectDestination({ deps, input });
  const removed = await disconnectDestination({ deps });
  assert.deepEqual(removed, { changed: true, target: deps.provisioning.target });
  assert.deepEqual(await deps.provisioning.readProvisioned(), { ok: true, grants: [] });
  assert.deepEqual(await disconnectDestination({ deps }), { changed: false, target: deps.provisioning.target });
});

test("a destination that is not a peer site stops the connect before anything is written", async () => {
  const { deps, files, input } = connectionFixture();
  const refusing: ConnectDeps = { ...deps, httpClient: { send: async () => ({ status: 404, headers: {}, bodyText: "" }) } };
  await assert.rejects(() => connectDestination({ deps: refusing, input }),
    { name: "PublishTrustHandshakeError", failure: "not-a-acme-site" });
  assert.equal(files.size, 0);
});
