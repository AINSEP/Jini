import { act, renderHook, waitFor } from "./harness/render.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSeo } from "./harness/hooks.js";
import { useSeoEntrySection } from "../hooks/use-seo-entry-section.hooks.js";
import { createFakeSeoPort } from "./harness/api.js";
import type { SeoSettings } from "./harness/api.js";

/**
 * @file `useSeo` — the site-wide SEO settings form + sitemap regenerate action.
 * `Seo.unit.test.tsx` already exercises the full UI flow through mocked hook modules; this file
 * is the hook's own injected-port coverage — see `seo-port.hooks.ts` for why the injection exists.
 */

function settingsFixture(overrides: Partial<SeoSettings> = {}): SeoSettings {
  return {
    titleTemplate: "%s | Site",
    defaultRobots: { noindex: false, nofollow: false },
    sitemapEnabled: true,
    robotsRules: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSeo — injected port", () => {
  it("loads settings on mount from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeSeoPort({ settings: settingsFixture({ titleTemplate: "%s :: Seeded" }) });

    const { result } = renderHook(() => useSeo(port, "en"));

    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(result.current.settings?.titleTemplate).toBe("%s :: Seeded");
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("save writes through the port and sets a Saved. notice", async () => {
    const port = createFakeSeoPort({ settings: settingsFixture() });
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => {
      await result.current.save({ titleTemplate: "%s | Updated" });
    });

    expect(result.current.settings?.titleTemplate).toBe("%s | Updated");
    expect(result.current.notice).toBe("Saved.");
  });

  it("saving null for an optional default clears it, and the cleared value reads back as undefined — never a literal null", async () => {
    // The fake models `setSeoSettings`' real clear path (`buildScalarWrites` normalizes `null` to
    // the `""` absent-sentinel, which `getSeoSettings` reads back through `undefinedIfEmpty`).
    // Spreading the patch verbatim instead would hand the UI a `null` no real response contains.
    const port = createFakeSeoPort({ settings: settingsFixture({ defaultDescription: "Seeded default" }) });
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => {
      await result.current.save({ defaultDescription: null });
    });

    expect(result.current.settings?.defaultDescription).toBeUndefined();
    expect(result.current.settings).not.toHaveProperty("defaultDescription", null);
  });

  it("a key omitted from the patch is left alone — the write is a merge, so 'unchanged' must not clear", async () => {
    const port = createFakeSeoPort({ settings: settingsFixture({ defaultDescription: "Seeded default" }) });
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => {
      await result.current.save({ titleTemplate: "%s | Updated" });
    });

    expect(result.current.settings?.defaultDescription).toBe("Seeded default");
  });

  it("regenerateSitemap calls the port without touching settings", async () => {
    const port = createFakeSeoPort({ settings: settingsFixture() });
    const regenerate = vi.spyOn(port, "regenerateSitemap");
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    const settingsBefore = result.current.settings;

    await act(async () => {
      expect(await result.current.regenerateSitemap()).toBe(true);
    });

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith();
    expect(result.current.settings).toEqual(settingsBefore);
    expect(result.current.notice).toBe("Sitemap regeneration accepted.");
    expect(result.current.error).toBeNull();
  });
  it("surfaces a load failure without inventing settings", async () => {
    const port = createFakeSeoPort();
    vi.spyOn(port, "getSeoSettings").mockRejectedValue(new Error("load denied"));
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.error).toBe("load denied"));
    expect(result.current.settings).toBeNull();
  });

  it("reports a failed save, preserves settings, and clears saving and notice", async () => {
    const port = createFakeSeoPort({ settings: settingsFixture() });
    vi.spyOn(port, "setSeoSettings").mockRejectedValue(new Error("save denied"));
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    await act(async () => { await result.current.save({ titleTemplate: "Changed" }); });
    expect(result.current.error).toBe("save denied");
    expect(result.current.notice).toBeNull();
    expect(result.current.saving).toBe(false);
    expect(result.current.settings).toEqual(settingsFixture());
  });

  it("returns false on failed regeneration and reports the failure without a success notice", async () => {
    const port = createFakeSeoPort({ settings: settingsFixture() });
    vi.spyOn(port, "regenerateSitemap").mockRejectedValue(new Error("regeneration denied"));
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    await act(async () => { expect(await result.current.regenerateSitemap()).toBe(false); });
    expect(result.current.error).toBe("regeneration denied");
    expect(result.current.notice).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("resyncs the image draft from loaded and saved settings", async () => {
    const port = createFakeSeoPort({ settings: settingsFixture({ defaultOgImage: "media:old" }) });
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.defaultOgImage).toBe("media:old"));
    act(() => result.current.setDefaultOgImage("media:unsaved"));
    await act(async () => { await result.current.save({ defaultOgImage: "media:new" }); });
    expect(result.current.defaultOgImage).toBe("media:new");
    await act(async () => { await result.current.save({ defaultOgImage: null }); });
    expect(result.current.defaultOgImage).toBe("");
  });

});


describe("SEO selection and modal state", () => {
  it("opens and closes the sitemap modal", async () => {
    const port = createFakeSeoPort({ settings: settingsFixture() });
    const { result } = renderHook(() => useSeo(port, "en"));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(result.current.sitemapModalOpen).toBe(false);
    act(() => result.current.openSitemapModal());
    expect(result.current.sitemapModalOpen).toBe(true);
    act(() => result.current.closeSitemapModal());
    expect(result.current.sitemapModalOpen).toBe(false);
  });

  it("changes and clears the selected entry", () => {
    const { result } = renderHook(() => useSeoEntrySection());
    expect(result.current.entryId).toBe("");
    act(() => result.current.setEntryId("p1"));
    expect(result.current.entryId).toBe("p1");
    act(() => result.current.setEntryId(""));
    expect(result.current.entryId).toBe("");
  });
});
