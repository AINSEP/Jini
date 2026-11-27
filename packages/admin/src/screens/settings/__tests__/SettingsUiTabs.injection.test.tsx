// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { createRef, type ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { settingsUiTabs, type SettingsUiView } from "../SettingsUiTabs.js";
import { SettingsUi, type SettingsUiProps } from "../SettingsUi.js";
import type { NotificationsPreferences, PrivacyConsentState, SettingsSlice } from "../../../react/kit.js";
import type { InterfaceConfig } from "../../../core/settings-tab-preferences.js";
import type { ExecutionConfig, ExecutionPort } from "@jini-ai/core/contracts/execution";
import { BrowserAgentSettingsPanel } from "../../webmcp/BrowserAgentSettingsPanel.js";
import { createAdminByokKeyPanelTranslator } from "../../../shell/components/AdminByokKeyPanel.hooks.js";

afterEach(cleanup);

it("uses the host browser panel and passes the host translator to all BYOK controls", () => {
  const panel = vi.fn((props: ComponentProps<typeof BrowserAgentSettingsPanel>) => <BrowserAgentSettingsPanel {...props} />);
  const migration = vi.fn((_: ComponentProps<SettingsUiProps["kit"]["AdminByokMigrationPrompt"]>) => null);
  const keyFooter = vi.fn((_: ComponentProps<SettingsUiProps["kit"]["AdminByokKeyFooter"]>) => null);
  const settingsFooter = vi.fn((_: ComponentProps<SettingsUiProps["kit"]["AdminByokSettingsFooter"]>) => null);
  const translator = vi.fn(createAdminByokKeyPanelTranslator);
  const useAdminLocale = () => "es";
  const useAdminBrowserAgentSettings = () => ({ enabled: true, setEnabled: vi.fn() });
  const webMcpT = ({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`;
  const props = {
    s: { instructions: {}, notifications: {}, privacy: {}, language: {}, interface: {} },
    settingsLocale: "es", t: (key: string) => key, tCap: ({ key }: { key: string }) => key, tExecution: (key: string) => key,
    executionPolicy: { subtitleKey: "Policy" }, agentPresentation: { scopeCopy: "Scope" }, adminCredential: {},
    hooks: { useAdminLocale, useAdminBrowserAgentSettings },
    kit: {
      BrowserAgentSettingsPanel: panel, AdminByokMigrationPrompt: migration, AdminByokKeyFooter: keyFooter, AdminByokSettingsFooter: settingsFooter,
      ExecutionTab: ({ apiKeyFooter, formFooter }: ComponentProps<SettingsUiProps["kit"]["ExecutionTab"]>) => <>{apiKeyFooter}{formFooter}</>,
      InstructionsTab: () => null, NotificationsTab: () => null, PrivacyTab: () => null, LanguageTab: () => null,
      I18nProvider: () => null, MemorySettingsPanel: () => null, Workspace: () => null, AboutPanel: () => null,
    },
    deps: { createAdminByokKeyPanelTranslator: translator, webMcpT, now: () => 0, SETTINGS_EXECUTION_PRODUCT_VARS: {},
      tWorkspace: ({ key }: { key: string }) => key, createProbeErrorDescriber: () => () => "error" },
  } as unknown as SettingsUiView;
  const tabs = settingsUiTabs(props);
  render(<>{tabs.find(tab => tab.id === "privacy")!.panel}{tabs.find(tab => tab.id === "execution")!.panel}</>);
  expect(screen.getByRole("checkbox", { name: "es:Browser-agent access (WebMCP)" }).getAttribute("aria-checked")).toBe("true");
  expect(panel.mock.calls[0]?.[0]).toEqual({ locale: "es", t: webMcpT, useBrowserAgentSettingsHook: useAdminBrowserAgentSettings });
  for (const control of [migration, keyFooter, settingsFooter]) {
    expect(control.mock.calls[0]?.[0].createTranslator).toBe(translator);
    expect(control.mock.calls[0]?.[0].useAdminLocaleHook).toBe(useAdminLocale);
  }
});

function settingsSlice<T>(value: T): SettingsSlice<T> {
  return { value, loadError: null, saveState: { status: "idle" }, onChange: vi.fn(), refresh: async () => {} };
}

function setupScreen() {
  const config: ExecutionConfig = {
    mode: "local-cli", localCli: { agentId: "codex" },
    byok: { protocol: "anthropic", providerId: "anthropic", apiKey: "", baseUrl: "https://api.example.test", model: "sample" },
  };
  const port: ExecutionPort = { detectLocalAgents: async () => [], testConnection: async () => ({ ok: false }) };
  const controller: ReturnType<SettingsUiProps["hooks"]["useSettingsUiHook"]> = {
    memoryTopTab: "memories", setMemoryTopTab: vi.fn(), port,
    execution: settingsSlice(config), instructions: settingsSlice("Use short examples."),
    notifications: settingsSlice<NotificationsPreferences>({ soundEnabled: false, successSoundId: "chime", failureSoundId: "knock", desktopEnabled: true }),
    privacy: settingsSlice<PrivacyConsentState>({ telemetry: {}, installationId: null, privacyDecisionAt: null }),
    language: settingsSlice("fr"), interface: settingsSlice<InterfaceConfig>({ wrapTabs: true, hideChatFabWhileOpen: true, adminTheme: "glass" }),
    loading: true, loadError: null, save: { status: "idle" },
  };
  const navigate = vi.fn<SettingsUiProps["deps"]["navigate"]>();
  const onTab = vi.fn();
  const setCredential = vi.fn<SettingsUiProps["hooks"]["useAdminExecutionCredentialHook"]>(() => ({
    stored: null, apiKeyStoredExternally: false, apiKeyPlaceholder: undefined, storedKeyIsForOtherEndpoint: false,
    canDiscoverModels: false, canSaveKey: false, saveState: { status: "idle" }, settingsSaveState: { status: "idle" },
    saveKey: async () => {}, saveSettings: async () => {}, legacyKey: null, migrateLegacyKey: async () => {}, dismissLegacyPrompt: () => {},
  }));
  const localeSync = vi.fn();
  const rootRef = createRef<HTMLDivElement>();
  const translation = ({ key }: { key: string }) => key;
  const props: Omit<SettingsUiProps, "tabId"> = {
    hooks: {
      useAdminThemeBoundaryHook: () => ({ "data-theme": "glass" }), useSettingsUiHook: () => controller,
      useSettingsActiveTabScrollHook: () => rootRef, useSettingsLocaleSyncHook: localeSync,
      useExecutionPolicy: () => ({ config, allowed: true, readAllowedForSend: async () => true, visibility: "shown", note: null, preserveChange: next => next, subtitleKey: "Scope" }),
      useSettingsExecutionHook: ({ onChange }) => ({ config, onConfigChange: onChange, visibility: "shown", note: null, subtitleKey: "Scope", unavailableReason: undefined }),
      useAiAgentPresentationHook: () => ({ port, scopeCopy: "Desktop", warning: null }),
      useAdminExecutionCredentialHook: setCredential, useAdminLocale: () => "fr",
      useUserInterfaceTab: () => { throw new Error("The interface tab isn't used in this fixture"); },
      useAdminBrowserAgentSettings: () => ({ enabled: true, setEnabled: vi.fn() }),
    },
    kit: {
      BrowserAgentSettingsPanel,
      I18nProvider: ({ initialLocale, children }) => <div lang={initialLocale}>{children}</div>,
      SettingsDialogShell: ({ activeTabId, tabs, chromeExtra, onActiveTabIdChange }) => <>
        <div role="tablist">{tabs.map(tab => <button type="button" role="tab" aria-selected={tab.id === activeTabId} onClick={() => onActiveTabIdChange?.(tab.id)} key={tab.id}>{tab.icon}{tab.label}</button>)}</div>
        {chromeExtra}
        <div role="tabpanel">{tabs.find(tab => tab.id === activeTabId)?.panel}</div>
      </>,
      ExecutionTab: () => null,
      InstructionsTab: ({ value, onChange }) => <>
        <label>Instructions editor<input value={value} onChange={event => onChange(event.target.value)} /></label>
        <button type="button" onClick={() => onChange(undefined)}>Clear instructions</button>
      </>,
      NotificationsTab: ({ onChange }) => <button type="button" onClick={() => onChange({ soundEnabled: true })}>Enable notification sound</button>,
      PrivacyTab: () => null, LanguageTab: () => null, MemorySettingsPanel: () => null, Workspace: () => null, AboutPanel: () => null,
      AdminByokMigrationPrompt: () => null, AdminByokKeyFooter: () => null, AdminByokSettingsFooter: () => null,
    },
    deps: {
      createAdminByokKeyPanelTranslator, SETTINGS_DIALOG_DICTIONARIES: {}, ADMIN_LOCALES: [{ code: "fr", label: "French" }],
      DEFAULT_INSTRUCTIONS: "Factory defaults.", DEFAULT_EXECUTION_CONFIG: config, DEFAULT_PROVIDER_PRESETS: [],
      tApp: translation, tCapability: translation, tWorkspace: translation, webMcpT: translation, navigate,
      createSettingsTabChange: () => onTab, isDesktopAdmin: () => true, defaultLocalAgentId: "codex",
      scopeKeys: { desktopKey: "Desktop", serverKey: "Server" }, SETTINGS_EXECUTION_PRODUCT_VARS: {},
      createProbeErrorDescriber: () => () => "Probe failed", resolveAdminByokFooterStatusLine: () => null,
      memoryUnavailableNote: "Memory unavailable", localCliDataAttribute: "data-cli", legacySkillsPath: "/addons/skills",
      legacyAppearancePath: "/appearance", now: () => 120,
    },
  };
  return { props, controller, navigate, onTab, setCredential, localeSync, rootRef };
}

it("gates settings on all slices, then shows the load and save failures separately", () => {
  const h = setupScreen();
  const { rerender } = render(<SettingsUi {...h.props} tabId="instructions" />);
  expect(screen.getByText("Chargement des paramètres…")).toBeVisible();
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(h.localeSync).not.toHaveBeenCalled();
  h.controller.loading = false;
  h.controller.loadError = "workspace disconnected";
  h.controller.save = { status: "error", message: "Draft could not be saved" };
  rerender(<SettingsUi {...h.props} tabId="instructions" />);
  expect(screen.getByRole("tab", { name: "Instructions", selected: true })).toBeVisible();
  expect(screen.getByText(/^Impossible de charger les paramètres enregistrés \(workspace disconnected\)\. Les valeurs par défaut sont affichées/)).toHaveAttribute("role", "alert");
  expect(screen.getByText("Draft could not be saved")).toHaveAttribute("role", "alert");
  expect(h.localeSync).toHaveBeenLastCalledWith({ locale: "fr" });
  expect(h.rootRef.current).toHaveAttribute("data-theme", "glass");
  expect(h.rootRef.current).toHaveAttribute("data-cli", "shown");
});

it("redirects only legacy tabs and treats an unsupported tab as uncontrolled", () => {
  const h = setupScreen();
  const view = render(<SettingsUi {...h.props} tabId="skills" />);
  expect(h.navigate.mock.calls).toEqual([[{ routePath: "/addons/skills" }, { replace: true }]]);
  view.rerender(<SettingsUi {...h.props} tabId="appearance" />);
  expect(h.navigate.mock.calls).toEqual([
    [{ routePath: "/addons/skills" }, { replace: true }],
    [{ routePath: "/appearance" }, { replace: true }],
  ]);
  h.controller.loading = false;
  view.rerender(<SettingsUi {...h.props} tabId="does-not-exist" />);
  expect(screen.getByRole("tab", { name: "Instructions", selected: false })).toBeVisible();
  expect(screen.queryByRole("tab", { selected: true })).toBeNull();
  expect(h.navigate).toHaveBeenCalledTimes(2);
});

it("preserves typed instructions, resets blank instructions and applies a notification patch without losing other preferences", async () => {
  const user = userEvent.setup();
  const h = setupScreen();
  h.controller.loading = false;
  const view = render(<SettingsUi {...h.props} tabId="instructions" />);
  const editor = screen.getByRole("textbox", { name: "Instructions editor" });
  expect(editor).toHaveValue("Use short examples.");
  await user.type(editor, "!");
  expect(h.controller.instructions.onChange).toHaveBeenCalledExactlyOnceWith("Use short examples.!");
  await user.click(screen.getByRole("button", { name: "Clear instructions" }));
  expect(h.controller.instructions.onChange).toHaveBeenLastCalledWith("Factory defaults.");
  await user.click(screen.getByRole("tab", { name: "Notifications" }));
  expect(h.onTab).toHaveBeenCalledExactlyOnceWith("notifications");
  view.rerender(<SettingsUi {...h.props} tabId="notifications" />);
  await user.click(screen.getByRole("button", { name: "Enable notification sound" }));
  expect(h.controller.notifications.onChange).toHaveBeenCalledExactlyOnceWith({
    soundEnabled: true, successSoundId: "chime", failureSoundId: "knock", desktopEnabled: true,
  });
});

it("updates the BYOK slice without resetting the current execution mode or CLI", () => {
  const h = setupScreen();
  render(<SettingsUi {...h.props} />);
  const input = h.setCredential.mock.lastCall?.[0];
  if (!input) throw new Error("The Settings screen did not bind credentials");
  input.onByokChange({ protocol: "anthropic", providerId: "anthropic", apiKey: "", baseUrl: "https://second.example.test", model: "another" });
  expect(h.controller.execution.onChange).toHaveBeenCalledExactlyOnceWith({
    mode: "local-cli", localCli: { agentId: "codex" },
    byok: { protocol: "anthropic", providerId: "anthropic", apiKey: "", baseUrl: "https://second.example.test", model: "another" },
  });
});
