// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { settingsUiTabs, type SettingsUiView } from "../SettingsUiTabs.js";
import type { SettingsUiProps } from "../SettingsUi.js";
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
