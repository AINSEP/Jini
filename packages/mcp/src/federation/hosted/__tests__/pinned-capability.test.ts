/** Pinning and delivery contract of `createPinnedCapabilityRuntime` / `startCapabilityDelivery`, with a second-host endpoint policy. */
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createPinnedCapabilityRuntime, startCapabilityDelivery, type CapabilitySubscribable, type PinnedCapability, type PinnedCapabilityRuntime } from "../pinned-capability.js";

const names = { url: "ACME_URL", token: "ACME_TOKEN", handoff: "ACME_HANDOFF" };
const isCapability = (value: unknown): value is PinnedCapability => typeof value === "object" && value !== null
  && "url" in value && "token" in value && typeof value.url === "string" && value.url.startsWith("http://127.0.0.1:")
  && typeof value.token === "string" && /^[a-f0-9]{64}$/.test(value.token);
const cap = { url: "http://127.0.0.1:4100/mcp", token: "a".repeat(64) };

describe("createPinnedCapabilityRuntime", () => {
  test("captures the capability, scrubs the env and scopes the bearer to the exact endpoint", () => {
    const env: Record<string, string | undefined> = { ACME_URL: cap.url, ACME_TOKEN: cap.token, ACME_HANDOFF: "b".repeat(64), KEEP: "1" };
    const runtime = createPinnedCapabilityRuntime({ env, names, isCapability });
    expect(env).toEqual({ KEEP: "1" });
    expect(runtime.owned).toBe(true);
    expect(runtime.handoffToken).toBe("b".repeat(64));
    expect(runtime.endpointUrl({})).toBe(cap.url);
    expect(runtime.bearerToken({ url: cap.url })).toBe(cap.token);
    expect(runtime.bearerToken({ url: "http://127.0.0.1:4101/mcp" })).toBeUndefined();
  });
  test("a handoff-only process is owned, has no endpoint, and pins the first accepted capability", () => {
    const runtime = createPinnedCapabilityRuntime({ env: { ACME_HANDOFF: "c".repeat(64) }, names, isCapability });
    expect(runtime.owned).toBe(true);
    expect(runtime.endpointUrl({})).toBeNull();
    expect(runtime.accept({ url: "https://evil.example/mcp", token: cap.token })).toBe(false);
    expect(runtime.accept(cap)).toBe(true);
    expect(runtime.accept({ ...cap })).toBe(true);
    expect(runtime.accept({ url: "http://127.0.0.1:4200/mcp", token: cap.token })).toBe(false);
    expect(runtime.accept({ url: cap.url, token: "d".repeat(64) })).toBe(false);
    expect(runtime.endpointUrl({})).toBe(cap.url);
    expect(runtime.bearerToken({ url: cap.url })).toBe(cap.token);
  });
  test("an unrelated environment owns nothing and a malformed handoff is dropped", () => {
    const runtime = createPinnedCapabilityRuntime({ env: { ACME_HANDOFF: "short" }, names, isCapability });
    expect(runtime.owned).toBe(false);
    expect(runtime.handoffToken).toBeUndefined();
  });
});

describe("startCapabilityDelivery", () => {
  test("POSTs each published capability with the handoff bearer and stops after disconnect", async () => {
    let listener: ((c: PinnedCapability) => void | Promise<void>) | undefined;
    const unsubscribe = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const { disconnect } = startCapabilityDelivery({
      endpoint: new URL("http://127.0.0.1:9/handoff"), handoffToken: "h".repeat(64), fetch: fetchImpl as unknown as typeof fetch, onUnavailable: () => {},
      host: Promise.resolve({ subscribe: ({ listener: l }) => { listener = l; return unsubscribe; } }),
    });
    await vi.waitFor(() => expect(listener).toBeDefined());
    await listener!(cap);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:9/handoff");
    expect(init.headers).toMatchObject({ authorization: `Bearer ${"h".repeat(64)}` });
    expect(JSON.parse(String(init.body))).toEqual(cap);
    disconnect({});
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  test("a refused handoff rejects so the runtime retries; a missing host subscribes nothing; a subscribe failure warns", async () => {
    let listener: ((c: PinnedCapability) => void | Promise<void>) | undefined;
    startCapabilityDelivery({ endpoint: new URL("http://127.0.0.1:9/h"), handoffToken: "h".repeat(64), onUnavailable: () => {},
      fetch: (async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
      host: Promise.resolve({ subscribe: ({ listener: l }) => { listener = l; return () => {}; } }) });
    await vi.waitFor(() => expect(listener).toBeDefined());
    await expect(listener!(cap)).rejects.toThrow("Capability handoff unavailable");
    const warned = vi.fn();
    startCapabilityDelivery({ endpoint: new URL("http://127.0.0.1:9/h"), handoffToken: "h".repeat(64), onUnavailable: warned,
      fetch: fetch, host: Promise.resolve({ subscribe: () => { throw new Error("boom"); } }) });
    await vi.waitFor(() => expect(warned).toHaveBeenCalledOnce());
    const none = vi.fn();
    startCapabilityDelivery({ endpoint: new URL("http://127.0.0.1:9/h"), handoffToken: "h".repeat(64), onUnavailable: none, fetch, host: Promise.resolve(undefined) });
    await Promise.resolve(); await Promise.resolve();
    expect(none).not.toHaveBeenCalled();
  });
});

/** A fetch fake that never answers: it records the request and rejects when its signal aborts. */
function hungFetch() {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = ((url: URL, init: RequestInit) => {
    calls.push({ url, init });
    return new Promise<Response>((_resolve, reject) => { init.signal!.addEventListener("abort", () => reject(init.signal!.reason)); });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** A subscribable fake that hands the test the listener delivery registered. */
function subscribableHost() {
  let listener: ((c: PinnedCapability) => void | Promise<void>) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(({ listener: registered }: { listener: (c: PinnedCapability) => void | Promise<void> }) => { listener = registered; return unsubscribe; });
  return { subscribe, unsubscribe, listener: async () => { await vi.waitFor(() => expect(listener).toBeDefined()); return listener!; } };
}

describe("createPinnedCapabilityRuntime: the token has one way out", () => {
  const other = { url: "http://127.0.0.1:4999/mcp", token: "e".repeat(64) };

  test("no member except the bearer supplier and the handoff token yields a token", () => {
    const runtime = createPinnedCapabilityRuntime({ env: { ACME_URL: cap.url, ACME_TOKEN: cap.token, ACME_HANDOFF: "b".repeat(64) }, names, isCapability });
    expect(Object.keys(runtime).sort()).toEqual(["accept", "bearerToken", "endpointUrl", "handoffToken", "owned", "scrubbed"]);
    expect(runtime.endpointUrl({})).toBe(cap.url);
    const exposed = JSON.stringify([runtime.endpointUrl({}), runtime.owned, runtime.scrubbed, runtime.accept(cap)]);
    expect(exposed).not.toMatch(/[a-f0-9]{64}/);
    expectTypeOf<keyof PinnedCapabilityRuntime>().toEqualTypeOf<"accept" | "bearerToken" | "endpointUrl" | "handoffToken" | "owned" | "scrubbed">();
    expectTypeOf<ReturnType<PinnedCapabilityRuntime["endpointUrl"]>>().toEqualTypeOf<string | null>();
  });

  test("later changes to the environment object or to a delivered object cannot move the pin", () => {
    const env: Record<string, string | undefined> = { ACME_HANDOFF: "c".repeat(64) };
    const runtime = createPinnedCapabilityRuntime({ env, names, isCapability });
    const delivered: { url: string; token: string } = { ...cap };
    expect(runtime.accept(delivered)).toBe(true);
    delivered.url = other.url;
    delivered.token = other.token;
    Object.assign(env, { ACME_URL: other.url, ACME_TOKEN: other.token });
    expect(runtime.endpointUrl({})).toBe(cap.url);
    expect(runtime.bearerToken({ url: cap.url })).toBe(cap.token);
    expect(runtime.bearerToken({ url: other.url })).toBeUndefined();
    expect(runtime.accept(other)).toBe(false);
  });

  test("a delivered object that answers differently on a later read pins only what the policy saw", () => {
    const runtime = createPinnedCapabilityRuntime({ env: { ACME_HANDOFF: "c".repeat(64) }, names, isCapability });
    let reads = 0;
    const shifting = { get url() { reads += 1; return reads === 1 ? cap.url : other.url; }, token: cap.token };
    expect(runtime.accept(shifting)).toBe(true);
    expect(reads).toBe(1);
    expect(runtime.endpointUrl({})).toBe(cap.url);
    expect(runtime.bearerToken({ url: other.url })).toBeUndefined();
  });

  test("extra properties on a delivered capability are not held", () => {
    const seen: unknown[] = [];
    const recording = (value: unknown): value is PinnedCapability => { seen.push(value); return isCapability(value); };
    const runtime = createPinnedCapabilityRuntime({ env: {}, names, isCapability: recording });
    expect(runtime.accept({ ...cap, extra: "kept?" } as PinnedCapability)).toBe(true);
    expect(seen.at(-1)).toEqual(cap);
    expect(Object.isFrozen(seen.at(-1))).toBe(true);
  });

  test("a handoff-only runtime gives no bearer before a capability is accepted and the right one after", () => {
    const runtime = createPinnedCapabilityRuntime({ env: { ACME_HANDOFF: "c".repeat(64) }, names, isCapability });
    expect(runtime.bearerToken({ url: cap.url })).toBeUndefined();
    expect(runtime.accept(cap)).toBe(true);
    expect(runtime.bearerToken({ url: cap.url })).toBe(cap.token);
    expect(runtime.bearerToken({ url: `${cap.url}/` })).toBeUndefined();
  });

  test("malformed capability and handoff values are still deleted from the environment object, and reported", () => {
    const env: Record<string, string | undefined> = { ACME_URL: "https://elsewhere.example/mcp", ACME_TOKEN: "not-a-token", ACME_HANDOFF: "short", KEEP: "1" };
    const runtime = createPinnedCapabilityRuntime({ env, names, isCapability });
    expect(env).toEqual({ KEEP: "1" });
    expect(runtime.scrubbed).toEqual(["ACME_URL", "ACME_TOKEN", "ACME_HANDOFF"]);
    expect([runtime.owned, runtime.endpointUrl({}), runtime.handoffToken]).toEqual([false, null, undefined]);
    expect(createPinnedCapabilityRuntime({ env: { KEEP: "1" }, names, isCapability }).scrubbed).toEqual([]);
  });
});

describe("startCapabilityDelivery: the handoff bearer in transit", () => {
  const endpoint = new URL("http://127.0.0.1:9/handoff");
  const handoffToken = "h".repeat(64);

  test("the POST never follows a redirect and always carries a signal", async () => {
    const host = subscribableHost();
    const fetchImpl = vi.fn(async (_url: URL, _init: RequestInit) => new Response(null, { status: 204 }));
    startCapabilityDelivery({ endpoint, handoffToken, fetch: fetchImpl as unknown as typeof fetch, onUnavailable: () => {}, host: Promise.resolve(host) });
    await (await host.listener())(cap);
    const init = fetchImpl.mock.calls[0]![1];
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("disconnect during a POST aborts it", async () => {
    const host = subscribableHost();
    const { calls, fetchImpl } = hungFetch();
    const { disconnect } = startCapabilityDelivery({ endpoint, handoffToken, fetch: fetchImpl, onUnavailable: () => {}, host: Promise.resolve(host) }, { timeoutMs: 60_000 });
    const posting = Promise.resolve((await host.listener())(cap));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.init.signal!.aborted).toBe(false);
    disconnect({});
    await expect(posting).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0]!.init.signal!.aborted).toBe(true);
    expect(host.unsubscribe).toHaveBeenCalledOnce();
  });

  test("disconnect before the host resolves subscribes nothing", async () => {
    const host = subscribableHost();
    let resolveHost!: (value: CapabilitySubscribable) => void;
    const unavailable = vi.fn();
    const { disconnect } = startCapabilityDelivery({ endpoint, handoffToken, fetch: hungFetch().fetchImpl, onUnavailable: unavailable,
      host: new Promise<CapabilitySubscribable>(resolve => { resolveHost = resolve; }) });
    disconnect({});
    resolveHost(host);
    await new Promise(resolve => setImmediate(resolve));
    expect(host.subscribe).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  });

  test("the timeout aborts a POST that never answers", async () => {
    const host = subscribableHost();
    const { calls, fetchImpl } = hungFetch();
    startCapabilityDelivery({ endpoint, handoffToken, fetch: fetchImpl, onUnavailable: () => {}, host: Promise.resolve(host) }, { timeoutMs: 20 });
    await expect(Promise.resolve((await host.listener())(cap))).rejects.toMatchObject({ name: "TimeoutError" });
    expect(calls[0]!.init.signal!.aborted).toBe(true);
  });

  test("a refused delivery names the HTTP status and never the bearer or the capability", async () => {
    const host = subscribableHost();
    startCapabilityDelivery({ endpoint, handoffToken, onUnavailable: () => {}, host: Promise.resolve(host),
      fetch: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch });
    const refusal = await Promise.resolve((await host.listener())(cap)).then(() => null, (error: unknown) => error as Error);
    expect(refusal?.message).toBe("Capability handoff unavailable: the receiving process answered HTTP 403");
    expect(JSON.stringify([refusal?.message, refusal?.stack])).not.toMatch(/h{64}|a{64}/);
  });

  test("a subscribe failure and a rejected host reach the host's warning with the error that caused them", async () => {
    const boom = new Error("boom");
    const subscribeFailure = vi.fn();
    startCapabilityDelivery({ endpoint, handoffToken, onUnavailable: subscribeFailure, fetch, host: Promise.resolve({ subscribe: () => { throw boom; } }) });
    await vi.waitFor(() => expect(subscribeFailure.mock.calls).toEqual([[{ error: boom }]]));
    const down = new Error("listener never started");
    const hostFailure = vi.fn();
    startCapabilityDelivery({ endpoint, handoffToken, onUnavailable: hostFailure, fetch, host: Promise.reject(down) });
    await vi.waitFor(() => expect(hostFailure.mock.calls).toEqual([[{ error: down }]]));
    expect(hostFailure.mock.calls[0]![0].error).toBe(down);
  });
});

test.each([null, 'http://127.0.0.1:4100/mcp', false])('invalid handoff input %j never creates a capability', value => {
  const env = { ACME_HANDOFF: 'c'.repeat(64) };
  const runtime = createPinnedCapabilityRuntime({ env, names, isCapability });
  expect(runtime.accept(value as unknown as PinnedCapability)).toBe(false);
  expect(runtime.endpointUrl({})).toBeNull();
  expect(runtime.bearerToken({ url: cap.url })).toBeUndefined();
  expect(runtime.accept(cap)).toBe(true);
  expect(runtime.endpointUrl({})).toBe(cap.url);
});
