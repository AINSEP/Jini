import { expect, test, vi } from "vitest";
import { createPrivacyConsentBrowserAdapter, createSettingsTabs } from "../settings-tabs.js";
import { loadNamespaceValues, saveChangedEntries } from "../ledger-slice.js";

function fixture() {
  const values = new Map<string, Map<string, unknown>>();
  const events: string[] = [];
  let failKey: string | undefined;
  let readError: unknown;
  const missing = new Error("unregistered");
  const port = {
    getSettingsEffective: async ({ namespace }: { namespace: string }) => {
      if (readError) throw readError;
      return [...(values.get(namespace) ?? new Map<string, unknown>())].map(([key, value]) => ({ key, value, sourceLayer: "workspace" as const, defVersion: 1 }));
    },
    setSetting: async ({ namespace, key, scope, value }: { namespace: string; key: string; scope: "global" | "workspace" | "user"; value: unknown }) => {
      events.push(`write:${key}`);
      if (key === failKey) throw new Error("write failed");
      const entries = values.get(namespace) ?? new Map<string, unknown>();
      entries.set(key, value);
      values.set(namespace, entries);
      return { key, scope, value, revisionSeq: 1 };
    },
  };
  const deps = {
    loadNamespaceValues: ({ namespace }: { namespace: string }) => loadNamespaceValues({ namespace, port }, { isUnregisteredNamespace: ({ error }) => error === missing }),
    saveChangedEntries: (required: Omit<Parameters<typeof saveChangedEntries>[0], "port">) => saveChangedEntries({ ...required, port }),
    interfaceNamespace: "host.interface", legacyThemeId: "classic",
    DEFAULT_INSTRUCTIONS: "", DEFAULT_LOCALE: "en",
    DEFAULT_NOTIFICATIONS: { soundEnabled: true, successSoundId: "success", failureSoundId: "failure", desktopEnabled: false },
    DEFAULT_PRIVACY: { telemetry: { metrics: false, content: false }, installationId: null, privacyDecisionAt: null },
    DEFAULT_APPEARANCE: { theme: "light" as const, accentColor: "#2563eb" },
    DEFAULT_INTERFACE: { hideChatFabWhileOpen: true, wrapTabs: false, adminTheme: "classic" },
    normalizeAccentColor: ({ value }: { value: unknown }) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null,
    onMetricsWithdrawal: vi.fn(() => { events.push("deny"); }),
    onMetricsSaved: vi.fn(({ metrics }: { metrics: boolean }) => { events.push(`saved:${metrics}`); }),
  };
  return { tabs: createSettingsTabs({ deps }), deps, values, events, missing,
    fail: (key: string) => { failKey = key; }, readFail: (error: unknown) => { readError = error; } };
}

test("all six codecs read, diff-write, and skip unchanged data", async () => {
  const { tabs, values, events } = fixture();
  await tabs.saveInstructions({ next: "instructions", previous: "" });
  expect(await tabs.loadInstructions()).toBe("instructions");
  const notifications = { soundEnabled: false, successSoundId: "ok", failureSoundId: "no", desktopEnabled: true };
  await tabs.saveNotifications(notifications, await tabs.loadNotifications());
  expect(await tabs.loadNotifications()).toEqual(notifications);
  const privacy = { telemetry: { metrics: true, content: true }, installationId: "id", privacyDecisionAt: 42 };
  await tabs.savePrivacy(privacy, await tabs.loadPrivacy());
  expect(await tabs.loadPrivacy()).toEqual(privacy);
  await tabs.saveLanguage({ next: "fr", previous: "en" });
  expect(await tabs.loadLanguage()).toBe("fr");
  const appearance = { theme: "dark" as const, accentColor: "#123456", accentColors: { custom: "#abcdef" } };
  await tabs.saveAppearance(appearance, await tabs.loadAppearance());
  expect(await tabs.loadAppearance()).toEqual(appearance);
  const ui = { hideChatFabWhileOpen: false, wrapTabs: true, adminTheme: "custom" };
  await tabs.saveInterface(ui, await tabs.loadInterface());
  expect(await tabs.loadInterface()).toEqual(ui);
  events.length = 0;
  await tabs.saveInstructions({ next: "instructions", previous: "instructions" });
  await tabs.saveNotifications(notifications, notifications);
  await tabs.savePrivacy(privacy, privacy);
  await tabs.saveLanguage({ next: "fr", previous: "fr" });
  await tabs.saveAppearance(appearance, appearance);
  await tabs.saveInterface(ui, ui);
  expect(events).toEqual([]);
  expect(values.get("host.interface")?.get("adminTheme")).toBe("custom");
});

test("only unavailable namespaces fall back; transport failures propagate", async () => {
  const { tabs, readFail, missing } = fixture();
  readFail(missing);
  expect(await tabs.loadInstructions()).toBe("");
  const error = new Error("transport");
  readFail(error);
  await expect(tabs.loadInstructions()).rejects.toBe(error);
});

test("privacy sentinels round trip to null", async () => {
  const { tabs, values, deps } = fixture();
  values.set("core.privacy", new Map<string, unknown>([["installationId", ""], ["decisionAt", 0]]));
  expect(await tabs.loadPrivacy()).toEqual(deps.DEFAULT_PRIVACY);
  await tabs.savePrivacy(deps.DEFAULT_PRIVACY, { telemetry: { metrics: false, content: false }, installationId: "old", privacyDecisionAt: 7 });
  expect(values.get("core.privacy")?.get("installationId")).toBe("");
  expect(values.get("core.privacy")?.get("decisionAt")).toBe(0);
});

test("withdrawal denies immediately even when the first write fails", async () => {
  const { tabs, deps, events, fail } = fixture();
  fail("telemetry.metrics");
  await expect(tabs.savePrivacy(deps.DEFAULT_PRIVACY, { ...deps.DEFAULT_PRIVACY, telemetry: { metrics: true, content: false } })).rejects.toThrow("write failed");
  expect(events).toEqual(["deny", "write:telemetry.metrics"]);
  expect(deps.onMetricsSaved).not.toHaveBeenCalled();
});

test("metrics success signals before a later write fails", async () => {
  const { tabs, deps, events, fail } = fixture();
  fail("telemetry.content");
  await expect(tabs.savePrivacy({ ...deps.DEFAULT_PRIVACY, telemetry: { metrics: true, content: true } }, deps.DEFAULT_PRIVACY)).rejects.toThrow("write failed");
  expect(events).toEqual(["write:telemetry.metrics", "saved:true", "write:telemetry.content"]);
});

test("browser consent callbacks deny despite storage failure and clear the marker before a saved signal", () => {
  const events: string[] = [];
  const storageError = new Error("storage denied");
  const observe = vi.fn();
  const browser = {
    localStorage: {
      setItem: vi.fn(() => { events.push("marker:deny"); throw storageError; }),
      removeItem: vi.fn(() => { events.push("marker:clear"); }),
    },
    dispatchEvent: vi.fn((event: Event) => { events.push(`${event.type}:${(event as Event & { detail: boolean }).detail}`); return true; }),
  };
  const callbacks = createPrivacyConsentBrowserAdapter({ deps: {
    getBrowser: () => browser, createEvent: (type, init) => Object.assign(new Event(type), { detail: init.detail }),
    observe, withdrawalKey: "withdrawal", consentEvent: "consent",
    saveMarkerStep: "Save metrics withdrawal marker", clearMarkerStep: "Clear metrics withdrawal marker",
  } });
  callbacks.onMetricsWithdrawal();
  expect(browser.localStorage.setItem).toHaveBeenCalledExactlyOnceWith("withdrawal", "1");
  expect(observe).toHaveBeenCalledExactlyOnceWith({ error: storageError, step: "Save metrics withdrawal marker" });
  callbacks.onMetricsSaved({ metrics: true });
  expect(browser.localStorage.removeItem).toHaveBeenCalledExactlyOnceWith("withdrawal");
  expect(events).toEqual(["marker:deny", "consent:false", "marker:clear", "consent:true"]);
});

test("appearance normalizes unknown themes and preserves per-theme drafts on scalar saves", async () => {
  const { tabs, values, deps } = fixture();
  values.set("core.appearance", new Map<string, unknown>([["theme", "unknown"], ["adminThemeAccents", { classic: "#000000", custom: "#abcdef", removed: "#123456", invalid: 3 }]]));
  const loaded = await tabs.loadAppearance();
  expect(loaded).toEqual({ ...deps.DEFAULT_APPEARANCE, accentColors: { custom: "#abcdef", removed: "#123456" } });
  expect(tabs.adminThemeAccent({ appearance: loaded, themeId: "classic" })).toBeUndefined();
  expect(tabs.adminThemeAccent({ appearance: loaded, themeId: "custom" })).toBe("#abcdef");
  expect(tabs.adminThemeAccent({ appearance: loaded, themeId: "unknown" })).toBeUndefined();
  const edited = tabs.withAdminThemeAccent({ appearance: loaded, themeId: "classic", accentColor: "#111111" });
  expect(edited.accentColors).toEqual(loaded.accentColors);
  expect(tabs.adminThemeAccent({ appearance: edited, themeId: "classic" })).toBe("#111111");
  expect(tabs.withAdminThemeAccent({ appearance: edited, themeId: "classic", accentColor: undefined }).accentColor).toBe("#2563eb");
  expect(tabs.withAdminThemeAccent({ appearance: loaded, themeId: "custom", accentColor: undefined }).accentColors).toEqual({ removed: "#123456" });
  expect(tabs.withAdminThemeAccent({ appearance: loaded, themeId: "unknown", accentColor: "#777777" }).accentColors?.unknown).toBe("#777777");
  await tabs.saveAppearance({ theme: "dark", accentColor: "#222222" }, loaded);
  expect((await tabs.loadAppearance()).accentColors).toEqual(loaded.accentColors);
});
