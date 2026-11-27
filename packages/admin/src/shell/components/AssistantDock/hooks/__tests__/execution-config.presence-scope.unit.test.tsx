// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { useStoredAdminKey, useExecutionConfig } from "../execution-config.hooks.js";

it("keeps failed credential presence unknown and reports no credential bytes", async () => {
  const error = new Error("unavailable");
  const credentialLoader = { load: vi.fn(() => Promise.reject(error)), peek: () => undefined, replace: vi.fn() };
  const onLoadFailure = vi.fn();
  const credentialKey = ["admin-execution-credential", "principal:a", "presence"];
  const invalidate = vi.fn();
  const subscribeRefresh = vi.fn(() => () => {});
  const retry = <T,>({ load }: { load: () => Promise<T>; signal: AbortSignal }) => load();
  const { result } = renderHook(() => useStoredAdminKey({ credentialLoader, invalidate, credentialKey, retry, subscribeRefresh, onLoadFailure }));
  await waitFor(() => expect(onLoadFailure).toHaveBeenCalledWith(error));
  expect(result.current).toBe(null);
  expect(credentialLoader.load).toHaveBeenCalledWith();
});

it("keeps presence and config loaders distinct and scopes both keys to the principal", async () => {
  const initialConfig: ExecutionConfig = { mode: "local-cli", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: null } };
  const port = { loadConfig: vi.fn(async () => initialConfig), loadCredential: vi.fn(async () => ({ isSet: true })), now: () => 50 };
  const calls: { key: readonly unknown[]; staleTime: number | undefined; fetch: (() => Promise<unknown>) | undefined }[] = [];
  let queryScope = "principal:a";
  const retry = <T,>({ load }: { load: () => Promise<T>; signal: AbortSignal }) => load();
  const io = { retry, subscribeRefresh: () => () => {}, onLoadFailure: vi.fn() };
  const input: Parameters<typeof useExecutionConfig>[0] = {
    port, initialConfig, namespace: "execution", useBootScopeHook: () => ({ queryScope, checking: false, principalId: queryScope }),
    useCachedLoaderHook: (required, optional) => {
      calls.push({ key: required.key, staleTime: optional?.staleTime, fetch: required.fetch });
      return { peek: () => undefined, load: async () => { throw new Error("loader is not used by the fake ledger"); }, replace: vi.fn() };
    },
    useInvalidateHook: () => vi.fn(),
    useLedgerHook: () => ({ executionConfig: initialConfig, executionConfigRef: { current: initialConfig }, setExecutionConfig: vi.fn(), configLoaded: false, readExecutionConfigForSend: async () => initialConfig }),
    useStoredKeyHook: () => null, ledgerIo: io, storedKeyIo: io, applyChange: () => null, persistWrite: async () => true,
  };
  const { rerender } = renderHook(() => useExecutionConfig(input));
  expect(calls.map(call => call.key)).toEqual([["settings", "execution", "principal:a", "dock"], ["admin-execution-credential", "principal:a", "presence"]]);
  await expect(calls[0]?.fetch?.()).resolves.toEqual({ config: initialConfig, loadedAt: 50 });
  await expect(calls[1]?.fetch?.()).resolves.toEqual({ isSet: true });
  expect(port.loadConfig).toHaveBeenCalledTimes(1);
  expect(port.loadCredential).toHaveBeenCalledTimes(1);
  queryScope = "principal:b";
  rerender();
  expect(calls.slice(2).map(call => call.key)).toEqual([["settings", "execution", "principal:b", "dock"], ["admin-execution-credential", "principal:b", "presence"]]);
  expect(calls.map(call => call.staleTime)).toEqual([Infinity, Infinity, Infinity, Infinity]);
});

it("refreshes credential presence on the settings feed and aborts its retry on unmount", async () => {
  const credentialLoader = { load: vi.fn().mockResolvedValueOnce({ isSet: true }).mockResolvedValueOnce({ isSet: false }),
    peek: () => undefined, replace: vi.fn() };
  const credentials = ["admin-execution-credential", "principal:b", "presence"];
  const invalidate = vi.fn();
  let refresh!: () => void;
  const unsubscribe = vi.fn();
  const subscribeRefresh = ({ revalidate }: { revalidate: () => void }) => { refresh = revalidate; return unsubscribe; };
  let signal: AbortSignal | undefined;
  const retry = <T,>({ load, signal: current }: { load: () => Promise<T>; signal: AbortSignal }) => {
    signal = current;
    return load();
  };
  const onLoadFailure = vi.fn();
  const { result, unmount } = renderHook(() => useStoredAdminKey({
    credentialLoader, invalidate, credentialKey: credentials, retry, subscribeRefresh, onLoadFailure,
  }));
  await waitFor(() => expect(result.current).toBe(true));
  refresh();
  await waitFor(() => expect(result.current).toBe(false));
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ key: credentials });
  expect(credentialLoader.load.mock.calls).toEqual([[], []]);
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
  expect(unsubscribe.mock.calls).toEqual([[]]);
});

it("does not report credential cancellation as a read failure", async () => {
  const rejection = new DOMException("page closed", "AbortError");
  const pending = Promise.reject(rejection);
  const credentialLoader = { load: () => pending, peek: () => undefined, replace: vi.fn() };
  const onLoadFailure = vi.fn();
  const { result } = renderHook(() => useStoredAdminKey({
    credentialLoader, invalidate: vi.fn(), credentialKey: ["credential"], onLoadFailure,
    retry: ({ load }) => load(), subscribeRefresh: () => () => {},
  }));
  await act(async () => { await pending.catch(() => {}); });
  expect(result.current).toBeNull();
  expect(onLoadFailure).not.toHaveBeenCalled();
});
