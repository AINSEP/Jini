// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useThemePreference, type ColorSchemeMediaPort, type ThemePreferencePorts } from "../use-theme-preference.hooks.js";

const KEY = "host.theme";

function setup({ stored, dark }: { stored: string | null; dark: boolean }) {
  const saved = new Map<string, string>(stored === null ? [] : [[KEY, stored]]);
  const media = Object.assign(new EventTarget(), { matches: dark });
  const queries: string[] = [];
  const matchMedia = ((query: string) => { queries.push(query); return media; }) as unknown as ColorSchemeMediaPort;
  const root = document.createElement("html");
  const ports: ThemePreferencePorts = {
    storage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); } },
    storageKey: KEY, defaultPreference: "light", matchMedia, root,
  };
  const view = renderHook(() => useThemePreference(ports));
  const os = (next: boolean) => act(() => { media.matches = next; media.dispatchEvent(new Event("change")); });
  const state = () => [view.result.current[0], saved.get(KEY), root.dataset["theme"], root.style.colorScheme];
  return { view, os, state, queries, choose: (next: "light" | "dark" | "system") => act(() => view.result.current[1](next)) };
}

describe("useThemePreference", () => {
  it.each([null, "unsupported"])("a missing or unknown stored value (%s) falls back to the host default, even on a dark OS", (stored) => {
    const h = setup({ stored, dark: true });
    expect(h.state()).toEqual(["light", "light", "light", "light"]);
    expect(h.queries[0]).toBe("(prefers-color-scheme: dark)");
  });

  it("an explicit choice ignores the OS; system follows it until another choice detaches it", () => {
    const h = setup({ stored: "dark", dark: false });
    expect(h.state()).toEqual(["dark", "dark", "dark", "dark"]);
    h.os(true);
    h.choose("system");
    expect(h.state()).toEqual(["system", "system", "dark", "dark"]);
    h.os(false);
    expect(h.state()).toEqual(["system", "system", "light", "light"]);
    h.choose("light");
    h.os(true);
    expect(h.state()).toEqual(["light", "light", "light", "light"]);
  });

  it("unmount releases the OS listener", () => {
    const h = setup({ stored: "system", dark: true });
    expect(h.state()[2]).toBe("dark");
    h.view.unmount();
    h.os(false);
    expect(h.state()[2]).toBe("dark");
  });
});
