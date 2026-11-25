// @vitest-environment jsdom
/**
 * @file `useInterfacePreferences` against the real fetch-query binding and a fake port: stored
 * values, a refresh that re-reads them, the default before the first read, and a failed read.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FetchQueryProvider, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import { resolveAdminLayoutClassName, useInterfacePreferences, type InterfacePreferences, type InterfacePreferencesPort } from "../use-interface-preferences.hooks.js";

const SHOW_FAB: InterfacePreferences = { hideChatFabWhileOpen: false, wrapTabs: true };
const HIDE_FAB: InterfacePreferences = { hideChatFabWhileOpen: true, wrapTabs: false };
const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;

function fakePort(initial: InterfacePreferences | Error) {
  let stored = initial;
  const listeners = new Set<() => void>();
  const port: InterfacePreferencesPort<InterfacePreferences> = {
    loadInterface: () => (stored instanceof Error ? Promise.reject(stored) : Promise.resolve(stored)),
    subscribeToSettingsRefresh: ({ listener }) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { port, store: (next: InterfacePreferences | Error) => { stored = next; }, refresh: () => listeners.forEach((l) => l()), listeners };
}
const use = (port: InterfacePreferencesPort<InterfacePreferences>) =>
  useInterfacePreferences({ port, namespace: "core.interface", defaultPreferences: HIDE_FAB, useFetchQuery, useInvalidate });

describe("useInterfacePreferences", () => {
  it("returns the defaults before the stored values arrive, then the stored values", async () => {
    const fake = fakePort(SHOW_FAB);
    const { result } = renderHook(() => use(fake.port), { wrapper });
    expect(result.current).toEqual(HIDE_FAB);
    await waitFor(() => expect(result.current).toEqual(SHOW_FAB));
  });

  it("re-reads on a refresh and unsubscribes on unmount", async () => {
    const fake = fakePort(SHOW_FAB);
    const { result, unmount } = renderHook(() => use(fake.port), { wrapper });
    await waitFor(() => expect(result.current).toEqual(SHOW_FAB));
    fake.store(HIDE_FAB);
    await act(async () => fake.refresh());
    await waitFor(() => expect(result.current).toEqual(HIDE_FAB));
    unmount();
    expect(fake.listeners.size).toBe(0);
  });

  it("keeps the defaults when the first read fails", async () => {
    const fake = fakePort(new Error("offline"));
    const { result } = renderHook(() => use(fake.port), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual(HIDE_FAB);
  });
});

describe("resolveAdminLayoutClassName", () => {
  it("adds one class per enabled preference", () => {
    expect(resolveAdminLayoutClassName({ hideChatFabWhileOpen: false, wrapTabs: false })).toBe("jini-admin-layout");
    expect(resolveAdminLayoutClassName(HIDE_FAB)).toBe("jini-admin-layout hides-fab-while-open");
    expect(resolveAdminLayoutClassName({ hideChatFabWhileOpen: true, wrapTabs: true })).toBe("jini-admin-layout hides-fab-while-open wraps-tabs");
  });
});
