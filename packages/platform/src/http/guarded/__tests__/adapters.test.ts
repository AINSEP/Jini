import { expect, test } from "vitest";
import { createHttpClient } from "../client.js";
import { guardedFetch } from "../fetch-adapter.js";
import { createNodeGuardedHttpPorts } from "../node-ports.js";
import type { HttpRequest } from "@jini-ai/core/primitives";
import type { EgressPolicy, PinnedPeer } from "../index.js";
const policy: EgressPolicy = { allowedSchemes: ["https"], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 3, connectTimeoutMs: 1000, maxResponseBytes: 10, maxDecompressedBytes: 10 };
const clock = { nowMs: () => 0, timeoutSignal: () => new AbortController().signal };

// PARITY: retained behavior against the canonical shared implementation.

test("fetch adapter preserves form bodies, decoded bytes and separate cookies for OAuth", async () => {
  const calls: { request: HttpRequest; peer: PinnedPeer }[] = [];
  const client = createHttpClient({ policy, clock, userAgent: "Consumer/1.0", dns: { resolve: async () => ["8.8.8.8"] }, transport: { async requestPinned(input) {
    calls.push(input);
    return { status: 200, headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "100", "set-cookie": "incorrectly flattened" }, setCookies: ["a=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT", "b=2"], bodyText: "{}", bodyBytes: Buffer.from("{}"), bodyBytesTruncated: false };
  } } });
  const response = await guardedFetch({ client, url: "https://provider.example/token", timeoutMs: 500 }, { method: "POST", body: new URLSearchParams({ code: "a b" }), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  expect(await response.json()).toEqual({});
  expect(calls[0]!.request.body).toBe("code=a+b");
  expect(calls[0]!.request.headers["User-Agent"]).toBe("Consumer/1.0");
  expect(response.headers.has("content-encoding")).toBe(false);
  expect(response.headers.has("content-length")).toBe(false);
  expect(response.headers.getSetCookie()).toEqual(["a=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT", "b=2"]);
});

// PARITY: retained behavior against the canonical shared implementation.

test("OAuth redirect:error refuses a GET redirect without following or replaying credentials", async () => {
  let calls = 0;
  const client = createHttpClient({ policy, clock, userAgent: "Consumer/1.0", dns: { resolve: async () => ["8.8.8.8"] }, transport: { async requestPinned() { calls++; return { status: 302, headers: { location: "https://next.example/" }, bodyText: "" }; } } });
  await expect(guardedFetch({ client, url: "https://provider.example/metadata", timeoutMs: 500 }, { redirect: "error" })).rejects.toThrow(/redirect/);
  expect(calls).toBe(1);
  const manual = await guardedFetch({ client, url: "https://provider.example/metadata", timeoutMs: 500 }, { redirect: "manual" });
  expect(manual.status).toBe(302);
  expect(calls).toBe(2);
});

// PARITY: retained behavior against the canonical shared implementation.

test("fetch adapter refuses incomplete bytes rather than returning damaged JSON", async () => {
  const client = createHttpClient({ policy, clock, userAgent: "Consumer/1.0", dns: { resolve: async () => ["8.8.8.8"] }, transport: { async requestPinned() { return { status: 200, headers: {}, bodyText: "cut", bodyBytes: Buffer.from("cut"), bodyBytesTruncated: true }; } } });
  await expect(guardedFetch({ client, url: "https://provider.example/", timeoutMs: 500 })).rejects.toThrow(/truncated/);
});

// PARITY: retained behavior against the canonical shared implementation.

test("abort during DNS prevents any transport call and forwards the caller's reason", async () => {
  const controller = new AbortController();
  let calls = 0;
  const reason = new Error("caller stopped");
  const client = createHttpClient({ policy, clock, userAgent: "Consumer/1.0", dns: { resolve: async () => { controller.abort(reason); return ["8.8.8.8"]; } }, transport: { async requestPinned() { calls++; return { status: 200, headers: {}, bodyText: "" }; } } });
  await expect(client.send({ request: { method: "GET", url: "https://provider.example/", headers: {}, timeoutMs: 500, signal: controller.signal } })).rejects.toBe(reason);
  expect(calls).toBe(0);
});

// PARITY: retained behavior against the canonical shared implementation.

test("injected deadline cancels pending DNS without dialing", async () => {
  const timer = new AbortController();
  let calls = 0;
  const client = createHttpClient({ policy, userAgent: "Consumer/1.0", clock: { nowMs: () => 0, timeoutSignal: () => timer.signal }, dns: { resolve: () => new Promise(() => {}) }, transport: { async requestPinned() { calls++; return { status: 200, headers: {}, bodyText: "" }; } } });
  const pending = client.send({ request: { method: "GET", url: "https://provider.example/", headers: {}, timeoutMs: 500, totalDeadlineMs: 500 } });
  timer.abort(new Error("elapsed"));
  await expect(pending).rejects.toMatchObject({ name: "FetchTimeoutError", timeoutMs: 500 });
  expect(calls).toBe(0);
});

// PARITY: retained behavior against the canonical shared implementation.

test("native ports are constructed without initiating DNS or HTTP", () => {
  const ports = createNodeGuardedHttpPorts({});
  expect(typeof ports.dns.resolve).toBe("function");
  expect(typeof ports.transport.requestPinned).toBe("function");
  expect(ports.clock.nowMs()).toBeGreaterThan(0);
});

// PARITY: retained behavior against the canonical shared implementation.

test("DNS and redirect hops have no implicit total deadline", async () => {
  let elapsed = 0;
  const calls: HttpRequest[] = [];
  const client = createHttpClient({
    policy, userAgent: "Consumer/1.0",
    clock: { nowMs: () => elapsed, timeoutSignal: () => { throw new Error("unexpected total deadline"); } },
    dns: { resolve: async () => { elapsed += 2000; return ["8.8.8.8"]; } },
    transport: { requestPinned: async ({ request }) => {
      elapsed += 2000;
      calls.push(request);
      return calls.length === 1
        ? { status: 302, headers: { location: "/next" }, bodyText: "" }
        : { status: 200, headers: {}, bodyText: "complete" };
    } },
  });
  const response = await client.send({ request: { method: "GET", url: "https://provider.example/", headers: {}, idleTimeoutMs: 500 } });
  expect(response.bodyText).toBe("complete");
  expect(calls).toHaveLength(2);
  expect(calls.map(request => request.idleTimeoutMs)).toEqual([500, 500]);
  expect(elapsed).toBe(8000);
});

// PARITY: retained behavior against the canonical shared implementation.

test("the total deadline spans redirects and is independent of the idle policy ceiling", async () => {
  const timer = new AbortController();
  const budgets: number[] = [];
  const calls: HttpRequest[] = [];
  const client = createHttpClient({
    policy, userAgent: "Consumer/1.0", dns: { resolve: async () => ["8.8.8.8"] },
    clock: { nowMs: () => 0, timeoutSignal: ({ timeoutMs }) => { budgets.push(timeoutMs); return timer.signal; } },
    transport: { requestPinned: async ({ request }) => {
      calls.push(request);
      if (calls.length === 1) return { status: 302, headers: { location: "/next" }, bodyText: "" };
      timer.abort(new Error("elapsed"));
      return new Promise(() => {});
    } },
  });
  await expect(client.send({ request: { method: "GET", url: "https://provider.example/", headers: {}, timeoutMs: 60_000, totalDeadlineMs: 60_000 } }))
    .rejects.toMatchObject({ name: "FetchTimeoutError", timeoutMs: 60_000 });
  expect(budgets).toEqual([60_000]);
  expect(calls.map(request => request.idleTimeoutMs)).toEqual([1000, 1000]);
  expect(calls[0]!.signal).toBe(calls[1]!.signal);
});

test.each([0, -1, NaN, Infinity, 1.5])("invalid total deadline %s is refused before I/O", async (totalDeadlineMs) => {
  const client = createHttpClient({
    policy, clock, userAgent: "Consumer/1.0",
    dns: { resolve: async () => { throw new Error("unexpected DNS"); } },
    transport: { requestPinned: async () => { throw new Error("unexpected transport"); } },
  });
  await expect(client.send({ request: { method: "GET", url: "https://provider.example/", headers: {}, idleTimeoutMs: 500, totalDeadlineMs } }))
    .rejects.toThrow("totalDeadlineMs must be a positive safe integer");
});

test.each(["idleTimeoutMs", "timeoutMs"] as const)("invalid %s keeps its diagnostic and is refused before I/O", async (field) => {
  const client = createHttpClient({
    policy, clock, userAgent: "Consumer/1.0",
    dns: { resolve: async () => { throw new Error("unexpected DNS"); } },
    transport: { requestPinned: async () => { throw new Error("unexpected transport"); } },
  });
  const request: HttpRequest = { method: "GET", url: "https://provider.example/", headers: {}, timeoutMs: 500, [field]: 0 };
  await expect(client.send({ request })).rejects.toThrow(`${field} must be a positive safe integer`);
});
