import { expect, it, vi } from "vitest";
import { createDeployHostKit } from "../host-kit.js";

it("caller abort identity wins and reachability closes on refusal", async () => {
  const reason = new Error("caller cancelled");
  const caller = new AbortController(); caller.abort(reason);
  const fetchFn = vi.fn<typeof fetch>(async (_input, init) => { init?.signal?.throwIfAborted(); throw new Error("missing caller signal"); });
  const close = vi.fn(async () => {});
  const guardedFetch = vi.fn();
  const kit = createDeployHostKit({ fetchFn,
    createReachability: () => ({ guard: { assertSafeUrl: () => { throw new Error("refused"); } }, fetch: guardedFetch, close }),
    now: () => 0, sleep: async () => {}, createSigV4Client: () => ({ fetch: vi.fn(), sign: vi.fn() }),
  });
  const kitFetch = kit.fetch;
  if (!kitFetch) throw new Error("deploy host kit exposes no fetch");
  await expect(kitFetch("https://example.test", { signal: caller.signal }, { timeoutMs: 10000 })).rejects.toBe(reason);
  expect(await kit.probeContent({ url: "https://refused.test", expected: "proof" })).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
  expect(guardedFetch).not.toHaveBeenCalled();
});
