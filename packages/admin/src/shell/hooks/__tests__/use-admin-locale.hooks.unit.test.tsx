// @vitest-environment jsdom
/**
 * @file `useAdminLocale` against the real fetch-query binding and an explicit port (P12 #6.J).
 * Named mutations: `omit-query-scope`, `skip-language-invalidation`, `drop-english-fallback`.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import type { AdminLocalePort } from "../admin-locale-port.hooks.js";
import { useAdminLocale, type UseAdminLocaleArgs } from "../use-admin-locale.hooks.js";

interface Deferred { resolve(value: string): void; reject(error: Error): void; promise: Promise<string> }
function deferred(): Deferred {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { resolve, reject, promise };
}

/** A port whose reads are answered by the test, in any order, plus a refresh trigger. */
function scriptedPort() {
  const reads: Deferred[] = [];
  const listeners = new Set<() => void>();
  const unsubscribed = vi.fn();
  const port: AdminLocalePort = {
    loadLanguage: () => { const d = deferred(); reads.push(d); return d.promise; },
    subscribeToSettingsRefresh: ({ listener }) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); unsubscribed(); };
    },
  };
  const refresh = () => { for (const listener of listeners) listener(); };
  return { port, reads, refresh, listeners, unsubscribed };
}

const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;

function args(port: AdminLocalePort, scope: { value: string; checking?: boolean }): UseAdminLocaleArgs {
  return {
    port,
    useBootScope: () => ({ queryScope: scope.value, checking: scope.checking ?? false }),
    useFetchQuery,
    useInvalidate,
    queryPrefix: ["settings", "core.language"],
    fallbackLocale: "en",
  };
}

describe("useAdminLocale", () => {
  it("returns the injected fallback until the first read resolves, and after an initial read fails", async () => {
    const s = scriptedPort();
    const { result } = renderHook(() => useAdminLocale(args(s.port, { value: "a" })), { wrapper });
    // drop-english-fallback: undefined would render here.
    expect(result.current).toBe("en");
    await waitFor(() => expect(s.reads).toHaveLength(1));
    await act(async () => { s.reads[0]!.reject(new Error("settings down")); });
    expect(result.current).toBe("en");
  });

  it("does not read while the boot scope is still checking", async () => {
    const s = scriptedPort();
    renderHook(() => useAdminLocale(args(s.port, { value: "a", checking: true })), { wrapper });
    await act(async () => {});
    expect(s.reads).toHaveLength(0);
  });

  it("scope switch: B's read is the one shown even when A's slower read settles last", async () => {
    const s = scriptedPort();
    const scope = { value: "a" };
    const { result, rerender } = renderHook(() => useAdminLocale(args(s.port, scope)), { wrapper });
    await waitFor(() => expect(s.reads).toHaveLength(1));
    scope.value = "b";
    rerender();
    // omit-query-scope: one shared key would not start a second read for B.
    await waitFor(() => expect(s.reads).toHaveLength(2));
    await act(async () => { s.reads[1]!.resolve("fr"); });
    await act(async () => { s.reads[0]!.resolve("de"); });
    expect(result.current).toBe("fr");
  });

  it("reverse-order refresh: the latest refresh wins even when the earlier read settles last", async () => {
    const s = scriptedPort();
    const { result } = renderHook(() => useAdminLocale(args(s.port, { value: "a" })), { wrapper });
    await waitFor(() => expect(s.reads).toHaveLength(1));
    await act(async () => { s.reads[0]!.resolve("en"); });
    act(() => s.refresh());
    // skip-language-invalidation: no refresh read would start.
    await waitFor(() => expect(s.reads).toHaveLength(2));
    act(() => s.refresh());
    await waitFor(() => expect(s.reads).toHaveLength(3));
    await act(async () => { s.reads[2]!.resolve("ja"); });
    await act(async () => { s.reads[1]!.resolve("fr"); });
    expect(result.current).toBe("ja");
  });

  it("keeps the previous locale when a refresh read fails", async () => {
    const s = scriptedPort();
    const { result } = renderHook(() => useAdminLocale(args(s.port, { value: "a" })), { wrapper });
    await waitFor(() => expect(s.reads).toHaveLength(1));
    await act(async () => { s.reads[0]!.resolve("fr"); });
    act(() => s.refresh());
    await waitFor(() => expect(s.reads).toHaveLength(2));
    await act(async () => { s.reads[1]!.reject(new Error("blip")); });
    expect(result.current).toBe("fr");
  });

  it("captures the port at mount, unsubscribes on unmount, and survives StrictMode replay", async () => {
    const s = scriptedPort();
    const other = scriptedPort();
    let port = s.port;
    const strict = ({ children }: { children: ReactNode }) => <StrictMode>{wrapper({ children })}</StrictMode>;
    const { rerender, unmount } = renderHook(() => useAdminLocale(args(port, { value: "a" })), { wrapper: strict });
    port = other.port;
    rerender();
    expect(other.listeners.size).toBe(0);
    expect(s.listeners.size).toBe(1);
    unmount();
    expect(s.listeners.size).toBe(0);
    expect(s.unsubscribed).toHaveBeenCalled();
  });
});
