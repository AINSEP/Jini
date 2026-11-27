// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CachedLoader, FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { ChatPaneAgent } from "../../../../../react/kit.js";
import {
  createAgentsLoader, fetchAgents, getResumeCapableAgentIds, readDaemonOnline, recordAgents,
  replaceAgents, rescanAgentsInto, resetResumeCapableAgentIds, useAgentsLoader,
} from "../agents-inventory.hooks.js";

function inventoryCache(seed?: ChatPaneAgent[]) {
  let stored = seed;
  const load = vi.fn<CachedLoader<ChatPaneAgent[]>["load"]>(async () => {
    if (!stored) throw new Error("Unexpected unscripted inventory read");
    return stored;
  });
  const loader = { peek: () => stored, load, replace: ({ value }: { value: ChatPaneAgent[] }) => { stored = value; } };
  return { loader, load };
}
class InventoryError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: Record<string, unknown> | undefined;
  constructor({ message, status }: { message: string; status: number }, { code, body }: { code?: string | undefined; body?: Record<string, unknown> } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
type Request = Parameters<typeof fetchAgents>[0]["request"];
function inventoryRequest(script: readonly { method: string; path: string; reply: () => unknown }[]) {
  const queue = [...script];
  const calls = vi.fn<(...args: Parameters<Request>) => void>();
  const request: Request = async <T,>(input: Parameters<Request>[0], options?: Parameters<Request>[1]): Promise<T> => {
    calls(input, options);
    const next = queue.shift();
    if (!next || input.method !== next.method || input.path !== next.path || options?.basePath !== "/api/agents" || options.requireJson !== true) {
      throw new Error(`Unexpected inventory request: ${input.method} ${input.path}`);
    }
    return next.reply() as T;
  };
  return { request, calls };
}
const rescan = (reply: () => unknown) => ({ method: "POST", path: "/rescan", reply });
const read = (reply: () => unknown) => ({ method: "GET", path: "", reply });
const fresh = [{ id: "fresh", name: "Fresh", carriesOwnMemory: true }];
const old = [{ id: "old", name: "Old" }];

it("records the new snapshot and only explicit resume-capable agents, replacing previous capability data", () => {
  const resumeCapableAgentIds = { current: new Set<string>(["old"]) as ReadonlySet<string> };
  const writeAgentsSnapshot = vi.fn();
  const agents = [{ id: "yes", name: "Yes", carriesOwnMemory: true }, { id: "no", name: "No", carriesOwnMemory: false }, { id: "unknown", name: "Unknown" }];
  expect(recordAgents({ agents, resumeCapableAgentIds, writeAgentsSnapshot })).toBe(agents);
  expect([...getResumeCapableAgentIds({ resumeCapableAgentIds })]).toEqual(["yes"]);
  expect(writeAgentsSnapshot).toHaveBeenCalledExactlyOnceWith({ agents });
  resetResumeCapableAgentIds({ resumeCapableAgentIds });
  expect([...getResumeCapableAgentIds({ resumeCapableAgentIds })]).toEqual([]);
});

it.each([
  ["unusable empty reply", () => ({ agents: [] })],
  ["HTTP refusal", () => { throw new InventoryError({ message: "No rescan endpoint", status: 404 }); }],
  ["malformed JSON", () => { throw new SyntaxError("Invalid JSON"); }],
] as const)("replaces the cached and persisted inventory with a fresh GET after a rescan's %s", async (_label, reply) => {
  const { loader } = inventoryCache(old);
  const { request, calls } = inventoryRequest([rescan(reply), read(() => ({ agents: fresh }))]);
  const resumeCapableAgentIds = { current: new Set<string>() };
  const writeAgentsSnapshot = vi.fn();
  await expect(rescanAgentsInto({ loader, request, resumeCapableAgentIds, writeAgentsSnapshot,
    agentsUrl: "/api/agents", fetchTimeoutMs: 500, ApiError: InventoryError, clock: () => 1_000 })).resolves.toEqual(fresh);
  expect(loader.peek()).toBe(fresh);
  expect([...resumeCapableAgentIds.current]).toEqual(["fresh"]);
  expect(writeAgentsSnapshot).toHaveBeenCalledExactlyOnceWith({ agents: fresh });
  expect(calls.mock.calls.map(([input]) => input)).toEqual([{ method: "POST", path: "/rescan" }, { method: "GET", path: "" }]);
});

it("accepts a usable rescan without an additional GET and attaches the catalog's closest deadline", async () => {
  const { loader } = inventoryCache(old);
  const decorated = [{ id: "cli", name: "CLI", modelCatalog: {
    source: "cli", freshness: "fresh", fetchedAt: "1970-01-01T00:00:00.000Z", expiresAt: "1970-01-01T00:00:05.000Z",
    coverage: "observed", launchFingerprint: "first",
  } }] satisfies ChatPaneAgent[];
  const { request, calls } = inventoryRequest([rescan(() => ({ agents: decorated }))]);
  const clock = () => 1_000;
  await expect(rescanAgentsInto({ loader, request, resumeCapableAgentIds: { current: new Set() }, writeAgentsSnapshot: vi.fn(),
    agentsUrl: "/api/agents", fetchTimeoutMs: 500, ApiError: InventoryError, clock })).resolves.toBe(decorated);
  const hydrated = createAgentsLoader({ loader, clock });
  expect(hydrated.peek()).toBe(decorated);
  expect(hydrated.refreshAt()).toBe(5_000);
  expect(calls).toHaveBeenCalledOnce();
});

it("preserves the last good cache when the rescan never reached the host or when the fallback GET is unusable", async () => {
  const unreachable = new InventoryError({ message: "Loopback unavailable", status: 0 });
  const { loader } = inventoryCache(old);
  const writeAgentsSnapshot = vi.fn();
  const resumeCapableAgentIds = { current: new Set(["old"]) };
  const base = { loader, writeAgentsSnapshot, resumeCapableAgentIds, agentsUrl: "/api/agents", fetchTimeoutMs: 500, ApiError: InventoryError, clock: () => 1_000 };
  const offline = inventoryRequest([rescan(() => { throw unreachable; })]);
  await expect(rescanAgentsInto({ ...base, request: offline.request })).rejects.toBe(unreachable);
  expect(offline.calls).toHaveBeenCalledOnce();
  const invalid = inventoryRequest([rescan(() => ({ agents: [] })), read(() => ({ agents: "invalid" }))]);
  await expect(rescanAgentsInto({ ...base, request: invalid.request })).rejects.toThrow("GET /api/agents answered with no agents");
  expect(invalid.calls).toHaveBeenCalledTimes(2);
  expect(loader.peek()).toBe(old);
  expect([...resumeCapableAgentIds.current]).toEqual(["old"]);
  expect(writeAgentsSnapshot).not.toHaveBeenCalled();
});

it("keeps a pending snapshot until its deadline, then backs off future reads and failures", async () => {
  let now = 0;
  const clock = () => now;
  const { loader, load } = inventoryCache();
  const access = createAgentsLoader({ loader, clock });
  const pending: ChatPaneAgent[] = [{ id: "cli", name: "CLI", discoveryPending: true }];
  const discover = () => {
    const latest = [...pending];
    loader.replace({ value: latest });
    return latest;
  };
  load.mockImplementation(async () => discover());
  expect(access.refreshAt()).toBeUndefined();
  await expect(access.load()).resolves.toEqual(pending);
  expect(access.refreshAt()).toBe(1_000);
  now = 999;
  await expect(access.load()).resolves.toBe(loader.peek());
  expect(load).toHaveBeenCalledExactlyOnceWith(undefined, { staleTime: 0 });
  for (const [at, deadline] of [[1_000, 3_000], [3_000, 7_000], [7_000, 37_000]] as const) {
    now = at;
    await expect(access.load()).resolves.toEqual(pending);
    expect(access.refreshAt()).toBe(deadline);
  }
  now = 37_000;
  load.mockRejectedValueOnce(new Error("Discovery stalled"));
  await expect(access.load()).rejects.toThrow("Discovery stalled");
  expect(access.refreshAt()).toBe(67_000);
  expect(access.peek()).toEqual(pending);
  await expect(access.load()).resolves.toBe(loader.peek());
  expect(load).toHaveBeenCalledTimes(5);
});

it("does not replace or extend a new rescan when an older GET settles later", async () => {
  let now = 10_000;
  const { loader, load } = inventoryCache();
  const clock = () => now;
  const state = { clock, resumeCapableAgentIds: { current: new Set<string>() }, writeAgentsSnapshot: vi.fn() };
  let settle!: (agents: ChatPaneAgent[]) => void;
  load.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const access = createAgentsLoader({ loader, clock });
  const pending = access.load();
  const accepted = [{ id: "new-scan", name: "New scan" }];
  replaceAgents({ ...state, loader, agents: accepted });
  expect(access.refreshAt()).toBe(910_000);
  now = 20_000;
  settle(old);
  await expect(pending).resolves.toBe(accepted);
  expect(access.refreshAt()).toBe(910_000);
  expect(access.peek()).toBe(accepted);
});

it("supplies the boot-scoped loader key and sends daemon health directly to the agents URL", async () => {
  const { loader } = inventoryCache();
  const capture = vi.fn();
  const useLoader: FetchQueryAdapter["useCachedLoader"] = <T,>(required: Parameters<FetchQueryAdapter["useCachedLoader"]>[0], optional?: Parameters<FetchQueryAdapter["useCachedLoader"]>[1]) => {
    capture(required, optional);
    return loader as unknown as CachedLoader<T>;
  };
  const { request } = inventoryRequest([read(() => ({ agents: fresh }))]);
  const fetchInventory = () => fetchAgents({ request, agentsUrl: "/api/agents", fetchTimeoutMs: 500, ApiError: InventoryError });
  const clock = () => 42;
  const { result, rerender } = renderHook(({ scope }) => useAgentsLoader({
    useBootScope: () => ({ principalId: scope, queryScope: `principal:${scope}`, checking: false }),
    useLoader, fetchAgents: fetchInventory, clock,
  }), { initialProps: { scope: "a" } });
  expect(result.current.peek()).toBeUndefined();
  rerender({ scope: "b" });
  expect(capture.mock.calls).toEqual([
    [{ key: ["assistant", "agents", "principal:a"], fetch: fetchInventory }, { staleTime: 900_000 }],
    [{ key: ["assistant", "agents", "principal:b"], fetch: fetchInventory }, { staleTime: 900_000 }],
  ]);
  await expect(fetchInventory()).resolves.toBe(fresh);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(readDaemonOnline({ fetch, agentsUrl: "/api/agents", fetchTimeoutMs: 500 })).resolves.toBe(false);
  await expect(readDaemonOnline({ fetch, agentsUrl: "/api/agents", fetchTimeoutMs: 500 })).resolves.toBe(true);
  expect(fetch.mock.calls).toEqual([
    ["/api/agents", { credentials: "same-origin", signal: expect.any(AbortSignal) }],
    ["/api/agents", { credentials: "same-origin", signal: expect.any(AbortSignal) }],
  ]);
});

it("labels a failed inventory response with its method, route and host diagnostics", async () => {
  const original = new InventoryError({ message: "Service not ready", status: 503 }, { code: "RESTARTING", body: { retry: true } });
  const response = new Response(null, { status: 503 });
  const request: Request = async (input, options) => {
    if (input.method !== "GET" || input.path !== "" || options?.basePath !== "/api/agents" || !options.errorFactory) {
      throw new Error("Expected a route-aware GET error factory");
    }
    throw options.errorFactory({ error: original, response });
  };
  await expect(fetchAgents({ request, agentsUrl: "/api/agents", fetchTimeoutMs: 500, ApiError: InventoryError })).rejects.toMatchObject({
    message: "GET /api/agents answered 503", status: 503, code: "RESTARTING", body: { retry: true },
  });
});

it.each([
  { label: "expired", freshness: "fresh", expiresAt: "1970-01-01T00:00:01.000Z", deadline: 31_000 },
  { label: "stale", freshness: "stale", expiresAt: "1970-01-01T00:05:00.000Z", deadline: 31_000 },
  { label: "bad timestamp", freshness: "fresh", expiresAt: "invalid", deadline: 901_000 },
  { label: "unusually long expiry", freshness: "fresh", expiresAt: "1970-01-01T00:30:00.000Z", deadline: 901_000 },
] as const)("uses the correct retry/freshness deadline for a $label model catalog", async ({ freshness, expiresAt, deadline }) => {
  const clock = () => 1_000;
  const { loader, load } = inventoryCache();
  const agents: ChatPaneAgent[] = [{ id: "catalog-cli", name: "CLI", modelCatalog: {
    source: "cli", freshness, fetchedAt: "1970-01-01T00:00:00.000Z", expiresAt, coverage: "observed", launchFingerprint: "first",
  } }, { id: "no-catalog", name: "Other" }];
  load.mockResolvedValueOnce(agents);
  const access = createAgentsLoader({ loader, clock });
  loader.replace({ value: agents });
  await expect(access.load()).resolves.toBe(agents);
  expect(access.refreshAt()).toBe(deadline);
});
