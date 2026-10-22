import { createServer, type Server } from "node:http";
import { afterEach, expect, test } from "vitest";
import { createHttpClient } from "../client.js";
import { createNodeGuardedHttpPorts } from "../node-ports.js";
import type { EgressPolicy } from "../ports.js";

// Exercise actual Node socket inactivity, including response-body reads, rather than
// a transport double that merely echoes timeout options. These tests bind loopback ports.
const policy: EgressPolicy = {
  allowedSchemes: ["http"], denyPrivateAddresses: true, devHostAllowlist: ["127.0.0.1"],
  maxRedirects: 3, connectTimeoutMs: 1000, maxResponseBytes: 1024, maxDecompressedBytes: 1024,
};
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(stall = false): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.write("a");
    if (stall) return;
    let count = 0;
    const timer = setInterval(() => {
      res.write("b");
      if (++count === 7) res.end();
    }, 200);
    res.on("close", () => clearInterval(timer));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture port");
  return `http://127.0.0.1:${address.port}/`;
}

function client() {
  return createHttpClient({ ...createNodeGuardedHttpPorts({}), policy, userAgent: "Consumer/1.0" });
}

test("a progressing body outlives its socket idle timeout without a total deadline", async () => {
  const url = await fixture();
  const response = await client().send({ request: { method: "GET", url, headers: {}, idleTimeoutMs: 1000 } });
  expect(response.bodyText).toBe("abbbbbbb");
});

test("the legacy timeoutMs also remains a socket idle timeout", async () => {
  const url = await fixture();
  const response = await client().send({ request: { method: "GET", url, headers: {}, timeoutMs: 1000 } });
  expect(response.bodyText).toBe("abbbbbbb");
});

test("an explicit total deadline cuts off even a progressing body", async () => {
  const url = await fixture();
  await expect(client().send({ request: { method: "GET", url, headers: {}, idleTimeoutMs: 1000, totalDeadlineMs: 600 } }))
    .rejects.toMatchObject({ name: "FetchTimeoutError", url, timeoutMs: 600 });
});

test("an idle body keeps the legacy timeout error and message", async () => {
  const url = await fixture(true);
  await expect(client().send({ request: { method: "GET", url, headers: {}, idleTimeoutMs: 100 } }))
    .rejects.toMatchObject({ name: "Error", message: "request timed out after 100ms" });
});
