// @vitest-environment jsdom
import { useEffect, useReducer } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSiteKeyStatus, SiteKeyPort } from "@jini-ai/core/contracts/site/site-key";
import type { CachedLoader, FetchQueryAdapter, MutationResult, QueryResult } from "@jini-ai/core/fetch";
import { classifySiteKeyGenerateError, useSiteKey } from "../use-site-key.hooks.js";

afterEach(cleanup);

const none: AdminSiteKeyStatus = { active: false, source: "none", keyFilePath: "/k/site.key", runtimeMode: "server", state: "missing" } as unknown as AdminSiteKeyStatus;
const active: AdminSiteKeyStatus = { ...none, active: true, source: "env", fingerprint: "fp-1", state: "active" } as AdminSiteKeyStatus;

/** One shared in-memory cache entry behind both the query and the loader, as a real adapter shares its cache. */
function makeAdapter() {
  const cache: { value: unknown; error: Error | null; fetch?: () => Promise<unknown> } = { value: undefined, error: null };
  const subs = new Set<() => void>();
  const notify = () => subs.forEach(fn => fn());
  const run = async () => { try { cache.value = await cache.fetch!(); cache.error = null; } catch (e) { cache.error = e as Error; } notify(); };
  const refetch = vi.fn(() => { void run(); });
  const hooks = {
    useFetchQuery: <T,>({ fetch }: { fetch: () => Promise<T> }): QueryResult<T> => {
      cache.fetch = fetch;
      const [, force] = useReducer((x: number) => x + 1, 0);
      useEffect(() => { subs.add(force); void run(); return () => { subs.delete(force); }; }, []);
      return { data: cache.value as T, error: cache.error, status: "success", isFetching: false, refetch } as QueryResult<T>;
    },
    useCachedLoader: <T,>({ fetch }: { fetch: () => Promise<T> }): CachedLoader<T> => ({ peek: () => cache.value as T,
      load: async () => { const v = await fetch(); cache.value = v; notify(); return v; }, replace: ({ value }: { value: T }) => { cache.value = value; notify(); } }) as CachedLoader<T>,
    useFetchMutation: <I, O>({ run: go }: { run: (r: { input: I }) => Promise<O> }): MutationResult<I, O> => ({ mutate: go, status: "idle", error: null, reset: () => undefined }) as unknown as MutationResult<I, O>,
  } as unknown as Pick<FetchQueryAdapter, "useFetchQuery" | "useFetchMutation" | "useCachedLoader">;
  return { hooks, refetch };
}

function setup(port: Partial<SiteKeyPort>, readApiRefusal: Parameters<typeof useSiteKey>[0]["readApiRefusal"] = () => null) {
  const adapter = makeAdapter();
  const full = { status: vi.fn(async () => none), reveal: vi.fn(async () => ({ ...active, hex: "abcd" })), generate: vi.fn(async () => ({ outcome: "generated", fingerprint: "fp-new", keyFilePath: "/k/new.key", runtimeMode: "server" })), ...port } as unknown as SiteKeyPort;
  const copy = { siteKeyLoadErrorMessage: ({ locale, error }: { locale: string; error: string }) => `load(${locale}): ${error}`,
    siteKeyRevealErrorMessage: ({ locale, error }: { locale: string; error: string }) => `reveal(${locale}): ${error}`, unknownError: "Unknown" };
  const describeApiError = ({ e, fallback }: { e: unknown; fallback: string }) => (e instanceof Error ? e.message : fallback);
  const hook = renderHook(() => useSiteKey({ port: full, t: (k) => `t:${k}`, locale: "es", queryHooks: adapter.hooks, describeApiError, readApiRefusal, copy }));
  return { hook, port: full, refetch: adapter.refetch };
}

describe("useSiteKey status and reveal", () => {
  it("wraps a failed status load in the localized load message", async () => {
    const s = setup({ status: vi.fn(async () => { throw "offline"; }) });
    await waitFor(() => expect(s.hook.result.current.loadError).toBe("load(es): t:Unknown"));
    expect(s.hook.result.current.status).toBeUndefined();
  });

  it("reveal does nothing for an inactive key, shows and hides the hex for an active one", async () => {
    const s = setup({});
    await waitFor(() => expect(s.hook.result.current.status).toEqual(none));
    await act(() => s.hook.result.current.reveal());
    expect(s.port.reveal).not.toHaveBeenCalled();
    const a = setup({ status: vi.fn(async () => active) });
    await waitFor(() => expect(a.hook.result.current.status).toEqual(active));
    await act(() => a.hook.result.current.reveal());
    expect([a.hook.result.current.revealedHex, a.hook.result.current.revealing]).toEqual(["abcd", false]);
    act(() => a.hook.result.current.hideRevealed());
    expect(a.hook.result.current.revealedHex).toBeNull();
  });

  it("a reveal without hex leaves nothing shown; a failed reveal reports the localized error", async () => {
    const s = setup({ status: vi.fn(async () => active), reveal: vi.fn().mockResolvedValueOnce(active).mockRejectedValueOnce(new Error("forbidden")) });
    await waitFor(() => expect(s.hook.result.current.status).toEqual(active));
    await act(() => s.hook.result.current.reveal());
    expect(s.hook.result.current.revealedHex).toBeNull();
    await act(() => s.hook.result.current.reveal());
    expect([s.hook.result.current.revealError, s.hook.result.current.revealing]).toEqual(["reveal(es): forbidden", false]);
  });
});

describe("useSiteKey generate and refresh", () => {
  it("generates only when no key exists, then shows the new file key without refetching", async () => {
    const s = setup({});
    await waitFor(() => expect(s.hook.result.current.status).toEqual(none));
    await act(() => s.hook.result.current.generate());
    expect(s.port.generate).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.status).toEqual({ active: true, source: "file", fingerprint: "fp-new", keyFilePath: "/k/new.key", runtimeMode: "server", state: "active" });
    await act(() => s.hook.result.current.generate());
    expect(s.port.generate).toHaveBeenCalledTimes(1);
  });

  it("classifies a refused generate, and refresh clears it and any revealed hex", async () => {
    const s = setup({ generate: vi.fn(async () => { throw new Error("409"); }) }, () => ({ code: "KEY_MISMATCH", message: "m", detail: "stamp differs" }));
    await waitFor(() => expect(s.hook.result.current.status).toEqual(none));
    await act(() => s.hook.result.current.generate());
    expect(s.hook.result.current.generateError).toEqual({ kind: "locked", code: "KEY_MISMATCH", detail: "stamp differs" });
    expect(s.hook.result.current.generating).toBe(false);
    await act(() => s.hook.result.current.refresh());
    expect(s.refetch).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.generateError).toBeNull();
  });

  it("a failed refresh load keeps the current generate error", async () => {
    const status = vi.fn(async () => none);
    const s = setup({ status, generate: vi.fn(async () => { throw new Error("boom"); }) });
    await waitFor(() => expect(s.hook.result.current.status).toEqual(none));
    await act(() => s.hook.result.current.generate());
    status.mockRejectedValue(new Error("down"));
    await act(() => s.hook.result.current.refresh());
    expect(s.hook.result.current.generateError).toEqual({ kind: "generic", detail: "boom" });
  });
});

describe("classifySiteKeyGenerateError", () => {
  const t = (k: string) => `t:${k}`;
  const describeApiError = ({ fallback }: { fallback: string }) => `described:${fallback}`;
  const classify = (refusal: { code: string | undefined; message: string; detail: string | undefined } | null) =>
    classifySiteKeyGenerateError({ e: new Error("x"), t, describeApiError, readApiRefusal: () => refusal, copy: { unknownError: "U" } });
  it("maps each refusal marker, preferring code over message and detail over the description", () => {
    expect(classify(null)).toEqual({ kind: "generic", detail: "described:t:U" });
    expect(classify({ code: undefined, message: "KEY_DEPENDENT_DATA", detail: undefined })).toEqual({ kind: "locked", code: "KEY_DEPENDENT_DATA", detail: "described:t:U" });
    expect(classify({ code: "KEY_INVALID", message: "ALREADY_EXISTS", detail: "bad hex" })).toEqual({ kind: "refused", code: "KEY_INVALID", detail: "bad hex" });
    expect(classify({ code: "SITE_META_UNREADABLE", message: "", detail: "d" })).toEqual({ kind: "refused", code: "SITE_META_UNREADABLE", detail: "d" });
    expect(classify({ code: "ALREADY_EXISTS", message: "", detail: "d" })).toEqual({ kind: "already-exists" });
    expect(classify({ code: "OTHER", message: "", detail: "d" })).toEqual({ kind: "generic", detail: "described:t:U" });
  });
});
