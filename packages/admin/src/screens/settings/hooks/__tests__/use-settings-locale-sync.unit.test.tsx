// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSettingsLocaleSync } from "../../hooks/use-settings-locale-sync.hooks.js";

/**
 * @file `useSettingsLocaleSync` — the `useWiredX` dependency-injection conversion, identical shape
 * to `use-ai-assistant-locale-sync.unit.test.tsx` (the two hooks are "identical by coincidence", per
 * that file's own header, not a shared dependency). `useI18n()`'s `{ locale, setLocale }` pair is
 * injected as `{ activeLocale, setLocale }` rather than called directly, so the first `describe`
 * block below describes "the provider's locale disagrees with the prop" with a plain fake
 * `setLocale` — no `I18nProvider` mounted at all. No prior test file existed for this hook.
 */

describe("useSettingsLocaleSync", () => {
  it("calls setLocale on mount when the provider's active locale disagrees with the prop", () => {
    const setLocale = vi.fn();
    renderHook(() => useSettingsLocaleSync({ locale: "es" }, { activeLocale: "en", setLocale }));

    expect(setLocale).toHaveBeenCalledWith("es");
  });

  it("does not call setLocale when the provider already agrees", () => {
    const setLocale = vi.fn();
    renderHook(() => useSettingsLocaleSync({ locale: "en" }, { activeLocale: "en", setLocale }));

    expect(setLocale).not.toHaveBeenCalled();
  });

  it("re-syncs when the locale prop changes after mount", () => {
    const setLocale = vi.fn();
    const { rerender } = renderHook(
      ({ locale, activeLocale }) => useSettingsLocaleSync({ locale }, { activeLocale, setLocale }),
      { initialProps: { locale: "en", activeLocale: "en" } },
    );
    expect(setLocale).not.toHaveBeenCalled();

    rerender({ locale: "fr", activeLocale: "en" });
    expect(setLocale).toHaveBeenCalledWith("fr");
  });

  it("re-syncs when the injected activeLocale itself drifts, without the prop changing", () => {
    // Proves the effect actually reads the INJECTED activeLocale, not just the prop — a fake that
    // silently ignored `activeLocale` would still pass the two tests above.
    const setLocale = vi.fn();
    const { rerender } = renderHook(
      ({ activeLocale }) => useSettingsLocaleSync({ locale: "en" }, { activeLocale, setLocale }),
      { initialProps: { activeLocale: "en" } },
    );
    expect(setLocale).not.toHaveBeenCalled();

    rerender({ activeLocale: "de" });
    expect(setLocale).toHaveBeenCalledWith("en");
  });
});
