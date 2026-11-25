import { expect, test, vi } from "vitest";
import { createServerReconnect, shouldRetryAfterReconnect } from "../server-reconnect.js";

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
