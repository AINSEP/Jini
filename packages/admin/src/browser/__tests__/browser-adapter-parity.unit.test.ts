import { expect, test, vi } from "vitest";
import { createServerReconnect, probeReadyz, shouldRetryAfterReconnect } from "../server-reconnect.js";

test("a synchronous reconnect listener joins the already published poll", async () => {
  const probe = vi.fn(async () => true);
  const reconnect = createServerReconnect({ probe, now: () => 0, sleep: async () => {} });
  let joined: Promise<boolean> | undefined;
  reconnect.subscribe(() => {
    if (reconnect.getStatus() === "reconnecting") joined = reconnect.waitUntilReachable();
  });
  const first = reconnect.waitUntilReachable();
  expect(joined).toBe(first);
  expect(await first).toBe(true);
  expect(probe).toHaveBeenCalledTimes(1);
});

test("an ambiguous write is never retried", () => {
  expect(shouldRetryAfterReconnect({ code: "down", unreachableCode: "down", method: "POST", upstreamRefused: false, retryWrites: false }, {})).toBe(false);
});

test("times out at the deadline, then clears the outage on an ordinary successful request", async () => {
  let clock = 100;
  const probe = vi.fn(async () => false);
  const sleep = vi.fn(async ({ ms }: { ms: number }) => { clock += ms; });
  const reconnect = createServerReconnect({ probe, now: () => clock, sleep }, { pollMs: 25, timeoutMs: 50 });
  const transitions: string[] = [];
  const unsubscribe = reconnect.subscribe(() => { transitions.push(reconnect.getStatus()); });

  const waiting = reconnect.waitUntilReachable();
  reconnect.markReachable();
  expect(reconnect.getStatus()).toBe("reconnecting");
  await expect(waiting).resolves.toBe(false);
  expect(reconnect.getStatus()).toBe("unreachable");
  expect(probe).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[{ ms: 25 }], [{ ms: 25 }]]);
  reconnect.markReachable();
  reconnect.markReachable();
  expect(transitions).toEqual(["reconnecting", "unreachable", "online"]);

  unsubscribe();
  probe.mockResolvedValueOnce(true);
  await expect(reconnect.waitUntilReachable()).resolves.toBe(true);
  expect(reconnect.getStatus()).toBe("online");
  expect(transitions).toEqual(["reconnecting", "unreachable", "online"]);
});

test.each([
  { code: "other", method: "GET", upstreamRefused: true, retryWrites: true, retry: false },
  { code: undefined, method: "GET", upstreamRefused: false, retryWrites: false, retry: false },
  { code: "down", method: undefined, upstreamRefused: false, retryWrites: false, retry: true },
  { code: "down", method: "head", upstreamRefused: false, retryWrites: false, retry: true },
  { code: "down", method: "PATCH", upstreamRefused: true, retryWrites: false, retry: true },
  { code: "down", method: "POST", upstreamRefused: false, retryWrites: true, retry: true },
])("retries $method for $code only under its reconnect policy ($upstreamRefused, $retryWrites)", ({ retry, ...input }) => {
  expect(shouldRetryAfterReconnect({ ...input, unreachableCode: "down" })).toBe(retry);
});

test.each([
  { status: 200, body: '{"ready":true}', reachable: true },
  { status: 503, body: '{"ready":false}', reachable: true },
  { status: 502, body: "Upstream refused connection", reachable: false },
  { status: 200, body: '{"ready":"true"}', reachable: false },
  { status: 200, body: "null", reachable: false },
])("checks whether /readyz gave a real readiness answer ($status, $body)", async ({ status, body, reachable }) => {
  const url = "https://site.test/readyz";
  const signal = new AbortController().signal;
  const request = vi.fn(async (_input: Parameters<typeof fetch>[0], _options?: RequestInit) => new Response(body, { status }));
  await expect(probeReadyz({ request, url, timeoutSignal: () => signal })).resolves.toBe(reachable);
  expect(request.mock.calls).toEqual([[url, { credentials: "same-origin", cache: "no-store", signal }]]);
});

test("a rejected readiness request reports the server as still unreachable", async () => {
  const request = vi.fn(async () => { throw new Error("connection refused"); });
  await expect(probeReadyz({ request, url: "https://site.test/readyz", timeoutSignal: () => new AbortController().signal })).resolves.toBe(false);
});
