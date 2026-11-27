import { describe, expect, it, vi } from "vitest";
import { createSourceControlProviderKit } from "../provider-kit.js";
import type { SourceControlKitHttpClient } from "../provider-module.js";

describe("createSourceControlProviderKit transport-failure description", () => {
  it("hands the host the raw error and returns exactly the host's refusal text and log detail", () => {
    const seen: unknown[] = [];
    const kit = createSourceControlProviderKit({
      host: { describeTransportError: ({ error }) => { seen.push(error); return { refusal: "egress refused", logDetail: "redacted" }; } },
    });
    const error = new Error("blocked https://secret.example/?token=abc");

    expect(kit.describeTransportError(error)).toEqual({ refusal: "egress refused", logDetail: "redacted" });
    expect(seen).toEqual([error]);
  });

  it("keeps an undefined refusal and the host's redacted fallback detail for a non-refusal failure", () => {
    const kit = createSourceControlProviderKit({
      host: { describeTransportError: () => ({ refusal: undefined, logDetail: "fallback-detail" }) },
    });

    expect(kit.describeTransportError(new Error("boom"))).toEqual({ refusal: undefined, logDetail: "fallback-detail" });
  });
});

it("passes the provider's fetch init unchanged through the host observer", async () => {
  const response = new Response("viewer", { status: 202 });
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
  const observed = vi.fn<typeof fetch>();
  const observeFetch = vi.fn(({ fetch }: { fetch: typeof globalThis.fetch }) =>
    observed.mockImplementation((url, init) => fetch(url, init)));
  const kit = createSourceControlProviderKit({
    host: { describeTransportError: () => ({ refusal: undefined, logDetail: "" }), observeFetch },
  }, { fetchFn });

  const url = "https://git.example/account";
  const init = { method: "GET", redirect: "error", headers: { accept: "application/json" } } as const;
  expect(await kit.fetch(url, init)).toBe(response);
  expect(observeFetch).toHaveBeenCalledTimes(1);
  expect(observed).toHaveBeenCalledExactlyOnceWith(url, init);
  expect(fetchFn).toHaveBeenCalledExactlyOnceWith(url, init);
});

it("uses the current fetch and refuses guarded HTTP requests when no client was wired", async () => {
  const kit = createSourceControlProviderKit({
    host: { describeTransportError: () => ({ refusal: undefined, logDetail: "" }) },
  });
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("current fetch"));
  try {
    const url = "https://git.example/resource";
    expect(await (await kit.fetch(url, {})).text()).toBe("current fetch");
    expect(transport).toHaveBeenCalledExactlyOnceWith(url, {});
    await expect(kit.httpClient.send({ url, method: "GET", headers: {}, idleTimeoutMs: 1000 })).rejects
      .toThrow("no outbound HTTP client is wired for this call");
    expect(transport).toHaveBeenCalledTimes(1);
  } finally { transport.mockRestore(); }
});

it("keeps the positional HTTP client and lets the provider guard and classify redirects", async () => {
  const send = vi.fn<SourceControlKitHttpClient["send"]>().mockResolvedValue({ status: 204, headers: {}, bodyText: "" });
  const httpClient = { send };
  const kit = createSourceControlProviderKit({
    host: { describeTransportError: () => ({ refusal: undefined, logDetail: "" }) },
  }, { httpClient });
  const request = { url: "https://git.example/repo", method: "GET", headers: {}, idleTimeoutMs: 1000 } as const;
  expect(await kit.httpClient.send(request, { redirect: "error" })).toEqual({ status: 204, headers: {}, bodyText: "" });
  expect(send).toHaveBeenCalledExactlyOnceWith(request, { redirect: "error" });

  const init = { method: "GET", redirect: "follow" } as const;
  expect(kit.redirectGuardInit(init)).toEqual({ method: "GET", redirect: "manual" });
  expect(init.redirect).toBe("follow");
  const redirect = new Response(null, { status: 307, headers: { location: "https://elsewhere.example/" } });
  const refused = vi.fn(() => kit.assertNotRedirected(redirect, "Fixture Git"));
  expect(refused).toThrowError("Fixture Git attempted to redirect an authenticated request — refused to follow it (possible credential-leak vector).");
  expect(kit.isRedirectRefusal(refused.mock.results[0]?.value)).toBe(true);
  expect(kit.isRedirectRefusal(new Error("unrelated"))).toBe(false);
});

it("uses the injected retry backoff and otherwise waits for the requested milliseconds", async () => {
  const host = { describeTransportError: () => ({ refusal: undefined, logDetail: "" }) };
  const sleep = vi.fn(async (_ms: number) => {});
  await createSourceControlProviderKit({ host }, { sleep }).sleep!(37);
  expect(sleep).toHaveBeenCalledExactlyOnceWith(37);
  vi.useFakeTimers();
  try {
    const elapsed = vi.fn();
    const waited = createSourceControlProviderKit({ host }).sleep!(37).then(elapsed);
    await vi.advanceTimersByTimeAsync(36);
    expect(elapsed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waited;
    expect(elapsed).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
