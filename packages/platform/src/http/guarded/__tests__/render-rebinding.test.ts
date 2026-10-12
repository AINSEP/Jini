/** Rebinding uses the real platform guard and changing DNS answers, not hostname refusal fakes. */
import { expect, test } from "vitest";
import { createHttpClient } from "../client.js";
import type { EgressPolicy, DnsResolver, PinnedPeer } from "../ports.js";

const policy: EgressPolicy = { allowedSchemes: ["http", "https"], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 0, connectTimeoutMs: 1000, maxResponseBytes: 1000, maxDecompressedBytes: 1000 };
const clock = { nowMs: () => 0, timeoutSignal: ({ timeoutMs }: { timeoutMs: number }) => AbortSignal.timeout(timeoutMs) };

test("DNS changes after validation: the first POST dials the pinned public peer; the next POST refuses the private answer", async () => {
  let lookups = 0; const peers: PinnedPeer[] = [];
  const dns: DnsResolver = { resolve: async ({ hostname }) => { expect(hostname).toBe("rebind.example"); return ++lookups === 1 ? ["8.8.8.8"] : ["10.0.0.1"]; } };
  const client = createHttpClient({ policy, clock, dns, userAgent: "render-test", transport: {
    requestPinned: async ({ request, peer }) => {
      // Simulate a second lookup at connection time. The transport must use the already-vetted IP.
      expect(await dns.resolve({ hostname: new URL(request.url).hostname })).toEqual(["10.0.0.1"]);
      peers.push(peer); expect(request.method).toBe("POST"); expect(request.body).toBe('{"query":"rows"}');
      expect(peer.ip).toBe("8.8.8.8");
      return { status: 200, headers: { "content-type": "application/json" }, bodyText: '{"rows":[1]}' };
    },
  } });
  const request = { method: "POST" as const, url: "https://rebind.example/data", body: '{"query":"rows"}', headers: { "content-type": "application/json" }, timeoutMs: 1000 };
  expect((await client.send({ request })).bodyText).toBe('{"rows":[1]}');
  await expect(client.send({ request })).rejects.toMatchObject({ name: "EgressRefusedError" });
  expect(peers).toHaveLength(1); expect(lookups).toBe(3);
});

test.each(["POST", "PUT", "PATCH"] as const)("%s to a private literal never reaches the transport", async method => {
  let connected = false; let resolved = false;
  const client = createHttpClient({ policy, clock, userAgent: "render-test", dns: { resolve: async () => { resolved = true; return ["8.8.8.8"]; } }, transport: {
    requestPinned: async () => { connected = true; return { status: 200, headers: {}, bodyText: "unsafe" }; },
  } });
  await expect(client.send({ request: { method, url: "http://10.0.0.1/data", body: "{}", headers: {}, timeoutMs: 1000 } })).rejects.toMatchObject({ name: "EgressRefusedError" });
  expect(connected).toBe(false); expect(resolved).toBe(false);
});
