import { expect, it, vi } from "vitest";
import type { KeyringPort } from "../../../secrets/ports.js";
import { createKeyringBackedSigner } from "../signing.keyring.js";
import { verifySignature } from "../signing.js";

it("derives the per-subscription secret and signs in the site's published wire format", async () => {
  const deriveSigningSecret = vi.fn(async () => Buffer.from("test-signing-secret"));
  const keyring = { activeKey: vi.fn(), derive: vi.fn(), deriveSigningSecret } as unknown as KeyringPort;
  const signer = createKeyringBackedSigner({ keyring });
  const rawBody = '{"topic":"post.published","data":{"id":"post-1"}}';
  const subscription = { workspaceId: "ws-1", id: "sub-1", secretVersion: 3 } as Parameters<typeof signer.signForSubscription>[0]["subscription"];
  const header = await signer.signForSubscription({ subscription, rawBody, timestampSeconds: 1720000000 });
  // Same independently computed HMAC vector as signing.test.ts.
  expect(header).toBe("t=1720000000,v1=0abfec753eb9bc10c30880638c61b6c0b8a9943bd774fa3f78f5850964c7a059");
  expect(deriveSigningSecret).toHaveBeenCalledWith({ workspaceId: "ws-1", subscriptionId: "sub-1", version: 3 });
  vi.spyOn(Date, "now").mockReturnValue(1720000000 * 1000);
  expect(verifySignature({ secret: Buffer.from("test-signing-secret"), rawBody, header, toleranceSeconds: 300 })).toBe(true);
  vi.restoreAllMocks();
});
