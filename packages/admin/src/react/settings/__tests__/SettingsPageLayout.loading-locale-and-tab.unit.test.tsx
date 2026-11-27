import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SettingsAboutPanel, SettingsPageLayout, type SettingsPageLayoutProps } from "../SettingsPageLayout.js";
import type { I18nProviderProps, SettingsDialogShellProps } from "../../kit.js";

const previousLanguage = document.documentElement.lang;
afterEach(() => { cleanup(); document.documentElement.lang = previousLanguage; });

test("loading gates the entire tab tree and the nested provider leaves document locale alone", () => {
  document.documentElement.lang = "fr";
  const useSettingsLocaleSyncHook = vi.fn();
  const I18nProvider = vi.fn(({ initialLocale, syncDocumentAttributes, children }: I18nProviderProps) => {
    if (syncDocumentAttributes !== false) document.documentElement.lang = initialLocale ?? "en";
    return <>{children}</>;
  });
  const SettingsDialogShell = vi.fn(({ tabs, chromeExtra }: SettingsDialogShellProps) => <div>{tabs.map(tab => <span key={tab.id}>{tab.label}</span>)}{chromeExtra}</div>);
  const tabs: SettingsPageLayoutProps["tabs"] = {
    execution: { label: "Execution", panel: null }, instructions: { label: "Instructions", panel: null }, notifications: { label: "Notifications", panel: null },
    privacy: { label: "Privacy", panel: null }, language: { label: "Language", panel: null }, interface: { label: "Interface", panel: null },
    memory: { label: "Memory", panel: null }, workspace: { label: "Workspace", panel: null }, about: { label: "About", panel: null },
  };
  const props: SettingsPageLayoutProps = {
    loading: true, locale: null, loadError: null, save: { status: "idle" }, tabId: "unknown", tabs,
    kit: { I18nProvider, SettingsDialogShell }, themeBoundary: { "data-theme": "light" }, rootRef: null, rootDataAttributes: {},
    dictionaries: {}, fallbackLocale: "en", useSettingsLocaleSyncHook, onTabChange: vi.fn(), copy: { t: key => key },
  };
  const view = render(<SettingsPageLayout {...props} />);
  expect(view.getByText("Loading settings…")).toBeTruthy();
  expect(SettingsDialogShell).not.toHaveBeenCalled();
  expect(I18nProvider).not.toHaveBeenCalled();
  expect(useSettingsLocaleSyncHook).not.toHaveBeenCalled();
  view.rerender(<SettingsPageLayout {...props} loading={false} loadError="offline" save={{ status: "saved" }} />);
  expect(document.documentElement.lang).toBe("fr");
  expect(useSettingsLocaleSyncHook).toHaveBeenLastCalledWith({ locale: "en" });
  expect(view.getByRole("alert").textContent).toBe("Could not load saved settings (offline). Showing defaults — edits will still save.");
  expect(view.getByRole("status").textContent).toBe("Saved");
  const shellProps = SettingsDialogShell.mock.calls[0]?.[0];
  expect(shellProps?.tabs.map(tab => tab.id)).toEqual(["execution", "instructions", "notifications", "privacy", "language", "interface", "memory", "workspace", "about"]);
  expect(shellProps).not.toHaveProperty("activeTabId");
  expect(shellProps).toMatchObject({ presentation: "inline", fullscreenEnabled: false });
  expect(shellProps).not.toHaveProperty("onClose");
  view.rerender(<SettingsPageLayout {...props} loading={false} locale="es" tabId="privacy" />);
  expect(useSettingsLocaleSyncHook).toHaveBeenLastCalledWith({ locale: "es" });
  expect(SettingsDialogShell.mock.lastCall?.[0].activeTabId).toBe("privacy");
});

test("shows version and host hint without exposing any update controls", () => {
  const view = render(<SettingsAboutPanel versionLabel="Host 9.17.2 · Engine 3.4.1" hint="Managed by the site operator." t={key => key === "Version" ? "Versión" : key} />);
  expect(view.getByText("Versión")).toBeVisible();
  expect(view.getByText("Host 9.17.2 · Engine 3.4.1")).toBeVisible();
  expect(view.getByText("Managed by the site operator.")).toBeVisible();
  expect(view.queryByRole("button")).toBeNull();
  expect(view.queryByRole("link")).toBeNull();
});
