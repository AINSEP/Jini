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
  const { fetch: kitFetch, probeContent } = kit;
  if (!kitFetch || !probeContent) throw new Error("deploy host kit exposes no fetch/probeContent");
  await expect(kitFetch("https://example.test", { signal: caller.signal }, { timeoutMs: 10000 })).rejects.toBe(reason);
  expect(await probeContent({ url: "https://refused.test", expected: "proof" })).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
  expect(guardedFetch).not.toHaveBeenCalled();
});

it("a content proof distinguishes the deployed bytes from stale, oversized and empty responses", async () => {
  const close = vi.fn(async () => {});
  const cancelled = vi.fn();
  const guard = vi.fn(({ raw }: { raw: string }) => new URL(raw));
  const proof = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(4097))); },
    cancel: cancelled,
  });
  const responses = [new Response("deploy-v3"), new Response("deploy-v2"), new Response(proof), new Response(null), new Response("deploy-v3", { status: 503 })];
  const fetchPort = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected probe");
    return next;
  });
  const kit = createDeployHostKit({
    fetchFn: async () => { throw new Error("proof must use the guarded transport"); },
    createReachability: () => ({ guard: { assertSafeUrl: guard }, fetch: fetchPort, close }),
    now: () => 400, sleep: async () => {}, createSigV4Client: () => ({ fetch: vi.fn(), sign: vi.fn() }),
  });
  const url = "https://docs.example.test/.well-known/deployment";
  if (!kit.probeContent) throw new Error("content probe is missing");
  for (const expectedResult of [true, false, false, false, false]) {
    expect(await kit.probeContent({ url, expected: "deploy-v3" })).toBe(expectedResult);
  }
  expect(guard.mock.calls).toEqual(Array.from({ length: 5 }, () => [{ raw: url, label: "deployment content proof" }]));
  expect(fetchPort.mock.calls).toEqual(Array.from({ length: 5 }, () => [{ url }, { init: { signal: expect.any(AbortSignal), redirect: "error" } }]));
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(5);
});

it("the plugin ABI preserves error details and passes the positional probe detector a response and body", async () => {
  const response = new Response("gated", { status: 401 });
  const close = vi.fn(async () => {});
  const kit = createDeployHostKit({
    fetchFn: vi.fn(), createReachability: () => ({ guard: { assertSafeUrl: ({ raw }) => new URL(raw) }, fetch: async () => response, close }),
    now: () => 400, sleep: async () => {}, createSigV4Client: () => ({ fetch: vi.fn(), sign: vi.fn() }),
  });
  const detector = vi.fn((resp: Response) => resp.status === 401);
  const result = await kit.checkDeploymentUrl("https://docs.example.test", { detectProtected: detector });
  expect(result).toMatchObject({ reachable: false, status: "protected", statusCode: 401 });
  expect(detector).toHaveBeenCalledExactlyOnceWith(response, "gated");
  expect(close).toHaveBeenCalledTimes(1);
  expect(new kit.DeployError("Provider refused", 422, { provider: "docs" })).toMatchObject({
    message: "Provider refused", status: 422, details: { provider: "docs" },
  });
  let refusal: unknown;
  try {
    kit.assertNotRedirected(new Response(null, { status: 302 }), "Docs");
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(kit.DeployError);
});

it("host fetch reports only its timeout with an origin-only error and maintains simple plugin-call adapters", async () => {
  const timeoutController = new AbortController();
  const deadline = new Error("deadline expired");
  timeoutController.abort(deadline);
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
  try {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => { init?.signal?.throwIfAborted(); return new Response("unexpected"); });
    const sleep = vi.fn<Parameters<typeof createDeployHostKit>[0]["sleep"]>(async () => {});
    const signer = { fetch: vi.fn(), sign: vi.fn() };
    const createSigV4Client = vi.fn<Parameters<typeof createDeployHostKit>[0]["createSigV4Client"]>(() => signer);
    const kit = createDeployHostKit({ fetchFn, sleep, now: () => 902, createSigV4Client,
      createReachability: () => { throw new Error("plugin fetch does not open a reachability connection"); },
    }, { timeouts: { QUICK: 5, DEPLOY: 10, UPLOAD: 20 } });
    await expect(kit.fetch("https://docs.example.test/path?query=ignored", { method: "POST" }, { timeoutMs: 5 })).rejects.toMatchObject({
      message: "fetch timed out after 5ms: https://docs.example.test", cause: deadline,
    });
    await expect(kit.fetch("not a URL", {}, { timeoutMs: 10 })).rejects.toMatchObject({
      message: "fetch timed out after 10ms: the requested server", cause: deadline,
    });
    expect(timeout.mock.calls).toEqual([[5], [10]]);
    expect(fetchFn).toHaveBeenNthCalledWith(1, "https://docs.example.test/path?query=ignored", { method: "POST", signal: timeoutController.signal });
    expect(kit.timeouts).toEqual({ QUICK: 5, DEPLOY: 10, UPLOAD: 20 });
    expect(kit.now?.()).toBe(902);
    await kit.sleep(75);
    expect(sleep).toHaveBeenCalledExactlyOnceWith({ ms: 75 });
    const options = { accessKeyId: "fixture-id", secretAccessKey: "fixture-key", region: "west", service: "blob" };
    expect(kit.createSigV4Client(options)).toBe(signer);
    expect(createSigV4Client).toHaveBeenCalledExactlyOnceWith({ options });
  } finally {
    timeout.mockRestore();
  }
});
