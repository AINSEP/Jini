// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { expect, it, vi } from "vitest";
import { AdminBootScopeContext } from "../../lib/admin-boot-scope.js";
import { advanceAppearancePreview, useAdminAppearanceSnapshot } from "../use-admin-appearance-snapshot.hooks.js";

it("scopes reads to the signed-in operator and tags each response with the preview version at dispatch", async () => {
  const root = document.createElement("main");
  const another = document.createElement("main");
  const capture = vi.fn<(...args: Parameters<FetchQueryAdapter["useFetchQuery"]>) => void>();
  const useFetchQuery: FetchQueryAdapter["useFetchQuery"] = (required, optional) => {
    capture(required, optional);
    return { status: "loading", isFetching: false, refetch: () => {}, error: null, data: undefined };
  };
  let resolveInitial!: (value: { theme: string }) => void;
  const port = { loadAppearance: vi.fn<() => Promise<{ theme: string }>>()
    .mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; }))
    .mockResolvedValueOnce({ theme: "glass" }) };
  const Wrapper = ({ children }: { children: ReactNode }) =>
    <AdminBootScopeContext.Provider value={{ principalId: "reader-a", checking: false }}>{children}</AdminBootScopeContext.Provider>;
  renderHook(() => useAdminAppearanceSnapshot({ namespace: "ui.appearance", port, useFetchQuery }, { root }), { wrapper: Wrapper });
  expect(capture).toHaveBeenCalledExactlyOnceWith({ key: ["settings", "ui.appearance", "principal:reader-a"], fetch: expect.any(Function) }, { enabled: true, staleTime: Infinity });
  const fetch = capture.mock.calls[0]![0].fetch!;
  const pending = fetch();
  expect(advanceAppearancePreview({ root })).toBe(1);
  expect(advanceAppearancePreview({ root })).toBe(2);
  expect(advanceAppearancePreview({ root: another })).toBe(1);
  resolveInitial({ theme: "classic" });
  await expect(pending).resolves.toEqual({ appearance: { theme: "classic" }, readPreviewVersion: 0 });
  await expect(fetch()).resolves.toEqual({ appearance: { theme: "glass" }, readPreviewVersion: 2 });
});

it("asks the query observer not to read private appearance settings while boot is checking", () => {
  const request = vi.fn();
  const useFetchQuery: FetchQueryAdapter["useFetchQuery"] = (required, optional) => {
    request(required.key, optional);
    return { status: "loading", isFetching: false, refetch: () => {}, error: null, data: undefined };
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    <AdminBootScopeContext.Provider value={{ principalId: null, checking: true }}>{children}</AdminBootScopeContext.Provider>;
  renderHook(() => useAdminAppearanceSnapshot({ namespace: "ui.appearance", port: { loadAppearance: async () => "theme" }, useFetchQuery }), { wrapper });
  expect(request).toHaveBeenCalledExactlyOnceWith(["settings", "ui.appearance", "anonymous"], { enabled: false, staleTime: Infinity });
});
