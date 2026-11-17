/** Pinning and delivery contract of `createPinnedCapabilityRuntime` / `startCapabilityDelivery`, with a second-host endpoint policy. */
import { describe, expect, test, vi } from "vitest";
import { createPinnedCapabilityRuntime, startCapabilityDelivery, type PinnedCapability } from "../pinned-capability.js";

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
    expect(runtime.capability({})).toEqual(cap);
    expect(runtime.bearerToken({ url: cap.url })).toBe(cap.token);
    expect(runtime.bearerToken({ url: "http://127.0.0.1:4101/mcp" })).toBeUndefined();
  });
  test("a handoff-only process is owned, has no endpoint, and pins the first accepted capability", () => {
    const runtime = createPinnedCapabilityRuntime({ env: { ACME_HANDOFF: "c".repeat(64) }, names, isCapability });
    expect(runtime.owned).toBe(true);
    expect(runtime.capability({})).toBeNull();
    expect(runtime.accept({ url: "https://evil.example/mcp", token: cap.token })).toBe(false);
    expect(runtime.accept(cap)).toBe(true);
    expect(runtime.accept({ ...cap })).toBe(true);
    expect(runtime.accept({ url: "http://127.0.0.1:4200/mcp", token: cap.token })).toBe(false);
    expect(runtime.accept({ url: cap.url, token: "d".repeat(64) })).toBe(false);
    expect(runtime.capability({})).toEqual(cap);
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
