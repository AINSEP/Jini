/**
 * @file `createAdminHttp` behaviour through recording ports (P12 #4.J). Named mutations each break
 * one case here: `retry-twice`, `logout-on-any-401`, `publish-unload-as-outage`.
 */
import { describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@jini-ai/core/admin-runtime";
import { createAdminHttp, buildFetchInit, type CreateAdminHttpPorts } from "../request.js";

type Base = "/api/a" | "/api/b";
type Entry = "page";

class HostError extends Error {
  constructor(
    { message, status }: { message: string; status: number },
    readonly extra: { code?: string | undefined; body?: Record<string, unknown> } = {},
  ) {
    super(message);
  }
  get status(): number { return Number(this.message.match(/#(\d+)/)?.[1] ?? 0); }
  get code(): string | undefined { return this.extra.code; }
  get body(): Record<string, unknown> | undefined { return this.extra.body; }
}

interface Recorder {
  ports: CreateAdminHttpPorts<AdminApiError, Base, Entry>;
  fetch: ReturnType<typeof vi.fn>;
  calls: string[];
  reachable: { value: boolean };
  unloading: { value: boolean };
  refused: { value: boolean };
}

function jsonResponse(body: unknown, { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });
}

/** Recording ports with Core's `AdminApiError` as the host error, and a write-aware retry policy. */
function recorder(responses: Array<Response | Error>): Recorder {
  const calls: string[] = [];
  const reachable = { value: true };
  const unloading = { value: false };
  const refused = { value: false };
  const fetch = vi.fn(async ({ url }: { url: string; init: RequestInit }) => {
    calls.push(`fetch ${url}`);
    const next = responses.shift();
    if (!next) throw new Error("no scripted response");
    if (next instanceof Error) throw next;
    return next;
  });
  const ports: CreateAdminHttpPorts<AdminApiError, Base, Entry> = {
    fetch,
    timeoutSignal: ({ ms }) => { calls.push(`timeout ${ms}`); return new AbortController().signal; },
    isPageUnloading: () => unloading.value,
    resolveBasePath: ({ basePath }) => basePath ?? "/api/a",
    isUpstreamRefused: () => refused.value,
    decodeApiError: ({ body }, { fallbackMessage = "fallback" } = {}) => {
      const record = (body ?? {}) as Record<string, unknown>;
      return { message: typeof record.error === "string" ? record.error : fallbackMessage, code: typeof record.code === "string" ? record.code : undefined };
    },
    createError: (required, optional) => new AdminApiError(required, optional),
    isRequestError: (required): required is { error: AdminApiError } => required.error instanceof AdminApiError,
    messages: {
      timeout: ({ ms }) => `timed out after ${ms}`,
      unreachable: ({ status }) => `unreachable${status === undefined ? "" : ` ${status}`}`,
      requestFailed: ({ method, path, status }) => `failed ${method} ${path} ${status}`,
    },
    reconnect: {
      markReachable: () => calls.push("markReachable"),
      waitUntilReachable: async () => { calls.push("wait"); return reachable.value; },
    },
    shouldRetry: ({ code, unreachableCode, method, upstreamRefused, retryWrites }) =>
      code === unreachableCode && ((method ?? "GET") === "GET" || upstreamRefused || retryWrites),
    sessionInvalidated: () => calls.push("sessionInvalidated"),
    getFailureGeneration: () => 7,
    reportFailure: ({ error, path, method, generation, basePath, failureEntry }) =>
      calls.push(`report ${error.code ?? error.status} ${method} ${basePath}${path} g${generation}${failureEntry ? ` ${failureEntry}` : ""}`),
  };
  return { ports, fetch, calls, reachable, unloading, refused };
}

const networkDown = () => new TypeError("Failed to fetch");

describe("createAdminHttp — restart retry", () => {
  it("retries exactly once after the server is reachable again, then reports only the final failure", async () => {
    const r = recorder([networkDown(), networkDown()]);
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 50 });
    await expect(http.request({ path: "/x" })).rejects.toMatchObject({ code: "API_UNREACHABLE", status: 0 });
    // retry-twice: a third fetch would appear here.
    expect(r.fetch).toHaveBeenCalledTimes(2);
    expect(r.calls.filter((c) => c.startsWith("report"))).toEqual(["report API_UNREACHABLE GET /api/a/x g7"]);
  });

  it("a successful retry publishes nothing", async () => {
    const r = recorder([networkDown(), jsonResponse({ ok: 1 })]);
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 50 });
    await expect(http.request<{ ok: number }>({ path: "/x" })).resolves.toEqual({ ok: 1 });
    expect(r.calls.filter((c) => c.startsWith("report"))).toEqual([]);
    expect(r.calls.filter((c) => c === "wait")).toHaveLength(1);
  });

  it("retry exhaustion: an unreachable server after waiting rethrows the first error without resending", async () => {
    const r = recorder([networkDown()]);
    r.reachable.value = false;
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 50 });
    await expect(http.request({ path: "/x" })).rejects.toMatchObject({ code: "API_UNREACHABLE" });
    expect(r.fetch).toHaveBeenCalledTimes(1);
  });

  it("write admission: an unreachable POST is not resent unless refused upstream or retryWrites", async () => {
    const plain = recorder([networkDown()]);
    await expect(createAdminHttp({ ports: plain.ports, timeoutMs: 50 }).request({ path: "/w" }, { init: { method: "POST" } })).rejects.toBeTruthy();
    expect(plain.fetch).toHaveBeenCalledTimes(1);

    const opted = recorder([networkDown(), jsonResponse({})]);
    await createAdminHttp({ ports: opted.ports, timeoutMs: 50 }).request({ path: "/w" }, { init: { method: "POST" }, options: { retryWrites: true } });
    expect(opted.fetch).toHaveBeenCalledTimes(2);

    const refused = recorder([jsonResponse(undefined, { status: 502 }), jsonResponse({})]);
    refused.refused.value = true;
    await createAdminHttp({ ports: refused.ports, timeoutMs: 50 }).request({ path: "/w" }, { init: { method: "POST" } });
    expect(refused.fetch).toHaveBeenCalledTimes(2);
  });

  it("two instances keep independent upstream-refused marks", async () => {
    const a = recorder([jsonResponse(undefined, { status: 502 })]);
    a.refused.value = true;
    const httpA = createAdminHttp({ ports: a.ports, timeoutMs: 50 });
    const error = await httpA.requestOnce({ path: "/w", init: { method: "POST" } }).catch((e: unknown) => e);
    const b = recorder([]);
    const httpB = createAdminHttp({ ports: b.ports, timeoutMs: 50 });
    const send = vi.fn(async () => { throw error; });
    await expect(httpB.requestRidingOutRestart({ send, method: "POST" })).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    const sendA = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("ok");
    await expect(httpA.requestRidingOutRestart({ send: sendA, method: "POST" })).resolves.toBe("ok");
  });
});

describe("createAdminHttp — session invalidation", () => {
  it("only a 401 carrying UNAUTHENTICATED invalidates the session", async () => {
    const real = recorder([jsonResponse({ code: "UNAUTHENTICATED", error: "signed out" }, { status: 401 })]);
    await expect(createAdminHttp({ ports: real.ports, timeoutMs: 50 }).request({ path: "/me" })).rejects.toMatchObject({ status: 401, message: "signed out" });
    expect(real.calls).toContain("sessionInvalidated");

    // logout-on-any-401: a relayed vendor 401 must not sign the tab out.
    const vendor = recorder([jsonResponse({ code: "VENDOR_KEY", error: "bad key" }, { status: 401 })]);
    await expect(createAdminHttp({ ports: vendor.ports, timeoutMs: 50 }).request({ path: "/v" })).rejects.toMatchObject({ code: "VENDOR_KEY" });
    expect(vendor.calls).not.toContain("sessionInvalidated");
  });
});

describe("createAdminHttp — page unload", () => {
  it("a navigation-cancelled fetch is an AbortError and no outage, and later requests report normally after pageshow", async () => {
    const r = recorder([networkDown(), networkDown(), networkDown()]);
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 50 });
    r.unloading.value = true;
    // publish-unload-as-outage: reporting here would add a report line.
    await expect(http.request({ path: "/x" })).rejects.toMatchObject({ name: "AbortError" });
    expect(r.calls.filter((c) => c.startsWith("report"))).toEqual([]);
    r.unloading.value = false;
    r.reachable.value = false;
    await expect(http.request({ path: "/x" })).rejects.toMatchObject({ code: "API_UNREACHABLE" });
    expect(r.calls.filter((c) => c.startsWith("report"))).toHaveLength(1);
  });
});

describe("createAdminHttp — legacy request shapes", () => {
  it("resolves a valid JSON null body, and requireJson rejects unparseable success", async () => {
    const r = recorder([jsonResponse(null), new Response("not json", { status: 200 })]);
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 50 });
    await expect(http.requestOnce({ path: "/n" })).resolves.toBeNull();
    await expect(http.requestOnce({ path: "/j" }, { requireJson: true })).rejects.toBeInstanceOf(SyntaxError);
  });

  it("a caller signal wins over the deadline; otherwise the timeout port supplies one", async () => {
    const r = recorder([jsonResponse({}), jsonResponse({})]);
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 1234 });
    const signal = new AbortController().signal;
    await http.authenticatedAdminRequest({ path: "/s", method: "GET" }, { signal });
    expect(r.fetch.mock.calls[0]?.[0].init.signal).toBe(signal);
    expect(r.calls).not.toContain("timeout 1234");
    await http.authenticatedAdminRequest({ path: "/s", method: "GET" });
    expect(r.calls).toContain("timeout 1234");
  });

  it("onOk sees the response before the promise resolves, and an errorFactory error keeps its identity", async () => {
    const order: string[] = [];
    const r = recorder([jsonResponse({ v: 1 }), jsonResponse({ error: "nope" }, { status: 409 })]);
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 50 });
    await http.request({ path: "/ok" }, { onOk: ({ response }) => order.push(`onOk ${response.status}`) }).then(() => order.push("resolved"));
    expect(order).toEqual(["onOk 200", "resolved"]);
    const custom = new AdminApiError({ message: "custom", status: 409 });
    const thrown = await http.authenticatedAdminRequest({ path: "/c", method: "PUT", body: { a: 1 } }, {
      errorFactory: ({ error }) => (error.status === 409 ? custom : error),
    }).catch((e: unknown) => e);
    expect(thrown).toBe(custom);
  });

  it("the factory constructs no error itself: every error comes from createError", async () => {
    const r = recorder([jsonResponse(undefined, { status: 500 })]);
    r.reachable.value = false;
    r.ports.createError = (required, optional) => Object.assign(new HostError({ message: `${required.message} #${required.status}`, status: required.status }, optional), {}) as unknown as AdminApiError;
    r.ports.isRequestError = (required): required is { error: AdminApiError } => required.error instanceof HostError;
    const thrown = await createAdminHttp({ ports: r.ports, timeoutMs: 50 }).request({ path: "/boom" }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(HostError);
    expect(thrown).toMatchObject({ code: "API_UNREACHABLE", message: "unreachable 500 #500" });
  });

  it("a failure entry and an explicit base path reach the failure report; a throwing reporter never replaces the rejection", async () => {
    const r = recorder([jsonResponse({ error: "down" }, { status: 503 })]);
    const http = createAdminHttp({ ports: r.ports, timeoutMs: 50 });
    await expect(http.request({ path: "/p" }, { options: { basePath: "/api/b", failureEntry: "page" } })).rejects.toMatchObject({ message: "down" });
    expect(r.calls).toContain("report 503 GET /api/b/p g7 page");
    const t = recorder([jsonResponse({ error: "down" }, { status: 503 })]);
    t.ports.reportFailure = () => { throw new Error("notice broke"); };
    await expect(createAdminHttp({ ports: t.ports, timeoutMs: 50 }).request({ path: "/p" })).rejects.toMatchObject({ message: "down" });
  });

  it("a timed-out fetch becomes REQUEST_TIMEOUT with the host's copy", async () => {
    const r = recorder([new DOMException("signal timed out", "TimeoutError")]);
    r.reachable.value = false;
    await expect(createAdminHttp({ ports: r.ports, timeoutMs: 9 }).fetchOrThrowUnreachable({ url: "/t", init: {} }))
      .rejects.toMatchObject({ code: "REQUEST_TIMEOUT", message: "timed out after 9", body: { cause: "signal timed out" } });
  });

  it("buildFetchInit merges headers onto the JSON default and lets a caller's own type win", () => {
    expect(buildFetchInit({ headers: { "If-Match": "x" } })).toEqual({ credentials: "same-origin", headers: { "Content-Type": "application/json", "If-Match": "x" } });
    expect(buildFetchInit({ headers: { "content-type": "text/plain" } }).headers).toEqual({ "content-type": "text/plain" });
  });
});
