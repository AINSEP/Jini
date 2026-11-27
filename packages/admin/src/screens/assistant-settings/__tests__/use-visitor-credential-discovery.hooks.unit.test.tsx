// @vitest-environment jsdom
import { useRef, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useStoredKeyDiscovery, useTypedKeyDiscovery } from "../use-visitor-credential-discovery.hooks.js";
import type { ByokConfig, ExecutionPort, ModelDiscoveryState } from "../visitor-credential-form-port.js";

const baseline: ByokConfig = { protocol: "openai", providerId: "test", apiKey: "", baseUrl: "https://provider.test/v1", model: "" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
}
function useDraft(config: ByokConfig, collaborator: ExecutionPort) {
  const port = useRef(collaborator);
  const discoveryConfig = useRef(config);
  discoveryConfig.current = config;
  const [modelDraft, setConfig] = useState(config);
  const [discovery, setDiscovery] = useState<ModelDiscoveryState>({ status: "idle" });
  return { inputs: { port, discoveryConfig, setConfig, setDiscovery, preferredModel: "preferred" }, discovery, modelDraft };
}

it("uses the current preset and key after a quiet period, ignoring both late results and old debounce work", async () => {
  const earlier = deferred<readonly string[]>();
  const latest = deferred<readonly string[]>();
  const listModels = vi.fn<NonNullable<ExecutionPort["listModels"]>>(({ apiKey }) => {
    if (apiKey === "earlier-key") return earlier.promise;
    if (apiKey === "latest-key") return latest.promise;
    throw new Error("Unexpected discovery credential");
  });
  const port: ExecutionPort = { listModels, testConnection: async () => ({ ok: true }) };
  vi.useFakeTimers();
  try {
    const hook = renderHook(({ apiKey, preset }) => {
      const { inputs, discovery, modelDraft } = useDraft({ ...baseline, apiKey }, port);
      useTypedKeyDiscovery({ ...inputs, presetSuppliedEndpoint: preset });
      return { discovery, modelDraft };
    }, { initialProps: { apiKey: "incomplete-key", preset: true } });
    try {
      act(() => { vi.advanceTimersByTime(699); });
      expect(listModels.mock.calls).toEqual([]);
      hook.rerender({ apiKey: "earlier-key", preset: true });
      await act(async () => { await vi.advanceTimersByTimeAsync(700); });
      hook.rerender({ apiKey: "latest-key", preset: true });
      await act(async () => { await vi.advanceTimersByTimeAsync(700); });
      expect(listModels.mock.calls).toEqual([[{ ...baseline, apiKey: "earlier-key" }], [{ ...baseline, apiKey: "latest-key" }]]);
      await act(async () => { latest.resolve(["candidate", "preferred"]); await latest.promise; });
      expect(hook.result.current).toMatchObject({ discovery: { status: "ok", models: ["candidate", "preferred"] }, modelDraft: { model: "preferred" } });
      await act(async () => { earlier.resolve(["obsolete"]); await earlier.promise; });
      expect(hook.result.current.discovery).toEqual({ status: "ok", models: ["candidate", "preferred"] });
      hook.rerender({ apiKey: "latest-key", preset: false });
      await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
      expect(hook.result.current.discovery).toEqual({ status: "idle" });
      expect(listModels).toHaveBeenCalledTimes(2);
      hook.rerender({ apiKey: "again-key", preset: true });
    } finally {
      hook.unmount();
    }
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it.each([[new Error("Provider unavailable"), "Provider unavailable"], ["opaque refusal", "Model discovery failed"]] as const)(
  "settles typed model discovery failures to %s without seeding the draft", async (error, message) => {
    const listModels = vi.fn<NonNullable<ExecutionPort["listModels"]>>(async () => { throw error; });
    const port: ExecutionPort = { listModels, testConnection: async () => ({ ok: true }) };
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => {
        const { inputs, discovery, modelDraft } = useDraft({ ...baseline, apiKey: "draft-key" }, port);
        useTypedKeyDiscovery({ ...inputs, presetSuppliedEndpoint: true });
        return { discovery, modelDraft };
      });
      try {
        expect(result.current.discovery).toEqual({ status: "loading" });
        await act(async () => { await vi.advanceTimersByTimeAsync(700); });
        expect(result.current.discovery).toEqual({ status: "error", message });
        expect(result.current.modelDraft.model).toBe("");
        expect(listModels.mock.calls).toEqual([[{ ...baseline, apiKey: "draft-key" }]]);
      } finally {
        unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  },
);

it("ignores a cancelled stored-key error and reports only the newer endpoint's refusal", async () => {
  const old = deferred<readonly string[]>();
  const recent = deferred<readonly string[]>();
  const error = new Error("Current provider rejected discovery");
  const listModels = vi.fn<NonNullable<ExecutionPort["listModels"]>>(({ baseUrl }) => {
    if (baseUrl === baseline.baseUrl) return old.promise;
    if (baseUrl === "https://other-provider.test/v1") return recent.promise;
    throw new Error("Unexpected endpoint");
  });
  const port: ExecutionPort = { listModels, testConnection: async () => ({ ok: true }) };
  const describeProbeError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => e === error ? "Cannot list models at this endpoint" : fallback);
  const { result, rerender } = renderHook(({ baseUrl, mismatch }) => {
    const { inputs, discovery } = useDraft({ ...baseline, baseUrl }, port);
    const storedEndpointMismatch = useRef(mismatch);
    storedEndpointMismatch.current = mismatch;
    useStoredKeyDiscovery({ ...inputs, storedIsSet: true, storedEndpointMismatch, describeProbeError });
    return discovery;
  }, { initialProps: { baseUrl: baseline.baseUrl, mismatch: false } });
  expect(result.current).toEqual({ status: "loading" });
  rerender({ baseUrl: "https://other-provider.test/v1", mismatch: false });
  await act(async () => { recent.reject(error); await recent.promise.catch(() => undefined); });
  expect(result.current).toEqual({ status: "error", message: "Cannot list models at this endpoint" });
  await act(async () => { old.reject(new Error("obsolete refusal")); await old.promise.catch(() => undefined); });
  expect(describeProbeError.mock.calls).toEqual([[{ e: error, fallback: "Model discovery failed" }]]);
  expect(result.current).toEqual({ status: "error", message: "Cannot list models at this endpoint" });
  rerender({ baseUrl: "https://unmatched-provider.test/v1", mismatch: true });
  expect(listModels.mock.calls).toEqual([[baseline], [{ ...baseline, baseUrl: "https://other-provider.test/v1" }]]);
});
