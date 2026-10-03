import assert from "node:assert/strict";
import { test } from "vitest";

import { createKeyringBackedSigner } from "../signing.keyring.js";
import { createFixedSecretSigner, verifySignature } from "../signing.js";
import type { KeyringPort } from "../ports.js";
import type { WebhookSubscriptionRecord } from "../types.js";

const vocabulary = { timestampField: "t", signatureField: "v1" };


function makeSubscription(overrides: Partial<WebhookSubscriptionRecord> = {}): WebhookSubscriptionRecord {
  return {
    id: "sub-1",
    workspaceId: "ws-1",
    ownerPrincipalId: "user-1",
    label: "test",
    targetUrl: "https://example.com/hook",
    topics: ["workspace.created"],
    secretVersion: 1,
    previousSecretVersion: null,
    status: "active",
    createdByPrincipalId: "user-1",
    createdByPluginId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    disabledAt: null,
    ...overrides,
  };
}

function makeFixedKeyring(secret: Buffer): KeyringPort {
  return {
    async activeKey() {
      return { keyId: "v1" };
    },
    async deriveSigningSecret() {
      return new Uint8Array(secret);
    },
    async derive() {
      return new Uint8Array(secret);
    },
  };
}

test("createKeyringBackedSigner produces the same signature createFixedSecretSigner would for an equivalent secret", async () => {
  const secret = Buffer.from("a".repeat(64), "hex");
  const subscription = makeSubscription();
  const rawBody = JSON.stringify({ hello: "world" });
  const timestampSeconds = 1_700_000_000;

  const keyringSigner = createKeyringBackedSigner({ keyring: makeFixedKeyring(secret), vocabulary });
  const fixedSigner = createFixedSecretSigner({ secrets: new Map([[subscription.id, secret]]), vocabulary });

  const fromKeyring = await keyringSigner.signForSubscription({ subscription, rawBody, timestampSeconds });
  const fromFixed = await fixedSigner.signForSubscription({ subscription, rawBody, timestampSeconds });

  assert.equal(fromKeyring, fromFixed);
  assert.ok(verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody, header: fromKeyring, toleranceSeconds: 300 }));
});

test("createKeyringBackedSigner derives per-subscription using workspaceId/subscriptionId/secretVersion", async () => {
  let capturedInput: unknown;
  const keyring: KeyringPort = {
    async activeKey() {
      return { keyId: "v1" };
    },
    async deriveSigningSecret(input) {
      capturedInput = input;
      return new Uint8Array(32);
    },
    async derive() {
      return new Uint8Array(32);
    },
  };

  const signer = createKeyringBackedSigner({ keyring, vocabulary });
  const subscription = makeSubscription({ id: "sub-42", workspaceId: "ws-9", secretVersion: 3 });
  await signer.signForSubscription({ subscription, rawBody: "{}", timestampSeconds: 1 });

  assert.deepEqual(capturedInput, { workspaceId: "ws-9", subscriptionId: "sub-42", version: 3 });
});
