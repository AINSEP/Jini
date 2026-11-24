import { afterEach, describe, expect, it, vi } from "vitest";
import type { listProviderModels } from "../providers/model-catalog.js";

import { createLiveModelDiscovery, fetchLiveClaudeModels, unionModels, type LiveModelCredential } from "../model-catalog-live-discovery.js";

/**
 * @file Unit coverage for the moved live-model discovery logic with fakes. The host integration
 * proof (real credential repo + sealer + loopback provider server) stays in the host's own tests.
 */

const KEY = { workspaceId: "ws", principalId: "admin" };
const DEFAULT_URL = "https://default.example";
const TTL_MS = 5 * 60_000;

function setup({ credentials }: { credentials: Map<string, LiveModelCredential> }) {
  let now = 0;
  const clock = { nowMs: () => now };
  const calls: { apiKey: string; baseUrl: string }[] = [];
  let result: readonly { id: string; label: string }[] | null = [{ id: "claude-live", label: "Claude Live" }];
  const discovery = createLiveModelDiscovery({
    resolveCredential: async ({ workspaceId, principalId }) => credentials.get(JSON.stringify([workspaceId, principalId])) ?? null,
    defaultBaseUrl: DEFAULT_URL,
    clock,
    discover: async (required) => { calls.push(required); return result; },
  });
  return {
    discovery, calls,
    advance: (ms: number) => { now += ms; },
    setResult: (next: typeof result) => { result = next; },
  };
}
const slot = (workspaceId: string, principalId: string) => JSON.stringify([workspaceId, principalId]);

afterEach(() => { vi.restoreAllMocks(); });

describe("createLiveModelDiscovery", () => {
  it("returns null without discovery when there is no credential, a blank key, or a non-anthropic protocol", async () => {
    for (const credential of [undefined, { protocol: "anthropic", apiKey: "   " }, { protocol: "openai", apiKey: "k" }]) {
      const credentials = new Map<string, LiveModelCredential>();
      if (credential) credentials.set(slot("ws", "admin"), credential);
      const { discovery, calls } = setup({ credentials });
      expect(await discovery.getLiveClaudeModels(KEY)).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it("falls back to the injected default base URL and caches one call per TTL window", async () => {
    const credentials = new Map<string, LiveModelCredential>([[slot("ws", "admin"), { protocol: "anthropic", apiKey: "k", baseUrl: null }]]);
    const { discovery, calls, advance } = setup({ credentials });
    expect(await discovery.getLiveClaudeModels(KEY)).toEqual([{ id: "claude-live", label: "Claude Live" }]);
    advance(TTL_MS - 1);
    await discovery.getLiveClaudeModels(KEY);
    expect(calls).toEqual([{ apiKey: "k", baseUrl: DEFAULT_URL }]);
    advance(2);
    await discovery.getLiveClaudeModels(KEY);
    expect(calls).toHaveLength(2);
  });

  it("uses a stored base URL and reissues on key rotation inside the TTL", async () => {
    const credentials = new Map<string, LiveModelCredential>([[slot("ws", "admin"), { protocol: "anthropic", apiKey: "key-a", baseUrl: "https://custom.example" }]]);
    const { discovery, calls } = setup({ credentials });
    await discovery.getLiveClaudeModels(KEY);
    credentials.set(slot("ws", "admin"), { protocol: "anthropic", apiKey: "key-b", baseUrl: "https://custom.example" });
    await discovery.getLiveClaudeModels(KEY);
    expect(calls).toEqual([{ apiKey: "key-a", baseUrl: "https://custom.example" }, { apiKey: "key-b", baseUrl: "https://custom.example" }]);
  });

  it("keeps delimiter-containing tenant IDs in separate slots and preserves a successful empty catalog", async () => {
    const credential = { protocol: "anthropic", apiKey: "same" };
    const credentials = new Map<string, LiveModelCredential>([[slot("ws:1", "2"), credential], [slot("ws", "1:2"), credential]]);
    const { discovery, calls, setResult } = setup({ credentials });
    setResult([]);
    expect(await discovery.getLiveClaudeModels({ workspaceId: "ws:1", principalId: "2" })).toEqual([]);
    expect(await discovery.getLiveClaudeModels({ workspaceId: "ws", principalId: "1:2" })).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("returns null for a failed discovery", async () => {
    const credentials = new Map<string, LiveModelCredential>([[slot("ws", "admin"), { protocol: "anthropic", apiKey: "k" }]]);
    const { discovery, setResult } = setup({ credentials });
    setResult(null);
    expect(await discovery.getLiveClaudeModels(KEY)).toBeNull();
  });
});

describe("fetchLiveClaudeModels", () => {
  it("returns the listed models on success", async () => {
    const listModels = (async () => ({ ok: true, models: [{ id: "m", label: "M" }] })) as unknown as typeof listProviderModels;
    const warn = vi.fn();
    expect(await fetchLiveClaudeModels({ apiKey: "k", baseUrl: "u", warn }, { listModels })).toEqual([{ id: "m", label: "M" }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("sends one warning through the injected warn and returns null on failure", async () => {
    const warn = vi.fn();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listModels = (async () => ({ ok: false, kind: "auth", detail: "bad key" })) as unknown as typeof listProviderModels;
    expect(await fetchLiveClaudeModels({ apiKey: "k", baseUrl: "u", warn }, { listModels })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("live Claude model discovery failed (auth: bad key) — falling back to the static model list");
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

describe("unionModels", () => {
  it("keeps every fallback entry in order and appends only new live ids as id/label", () => {
    const fallback = [{ id: "default", label: "Default" }, { id: "sonnet", label: "Sonnet" }];
    const live = [{ id: "sonnet", label: "dup" }, { id: "claude-x", label: "X", extra: true } as { id: string; label: string }];
    expect(unionModels({ fallback, live })).toEqual([...fallback, { id: "claude-x", label: "X" }]);
  });
});
