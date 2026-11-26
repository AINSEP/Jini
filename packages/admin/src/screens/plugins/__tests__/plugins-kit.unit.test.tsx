// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { Plugins, bindPlugins, type PluginsProps } from "../Plugins.js";
import type { PluginsController } from "../hooks/use-plugins.hooks.js";
import { PLUGINS_TAB_PANELS } from "../PluginLists.js";
import { PluginsOverlays } from "../PluginsOverlays.js";
import { PluginRulesProvider, usePluginRules } from "../rules-context.js";
import { PluginRow } from "../PluginRow.js";
import { AddPluginPanel } from "../AddPluginPanel.js";
import { PluginPackageFilesModal } from "../PluginPackageFilesModal.js";
import { PluginRemoveConfirmDialog } from "../PluginRemoveConfirmDialog.js";
import { InstalledTabIcon, DownloadedTabIcon, MarketplaceTabIcon, PluginTrashIcon } from "../plugins-visuals.js";
import { makeRules } from "./plugin-rules-fixture.js";

afterEach(cleanup);

const rules = makeRules();
const kit: PluginsProps["kit"] = {
  PluginRulesProvider, PluginRow, AddPluginPanel, PluginPackageFilesModal, PluginRemoveConfirmDialog,
  InstalledTabIcon, DownloadedTabIcon, MarketplaceTabIcon, PluginTrashIcon,
  Toast: () => null, TabBar: () => null, PluginProviderSettingsDialog: () => null,
};
const plugin: NonNullable<PluginsController["plugins"]>[number] = {
  id: "example", name: "Example", version: "1.0.0", source: "site", tier: "tier-3", status: "valid",
  enabled: false, quarantine: null, errors: [], conflicts: [],
};
const controller: PluginsController = {
  plugins: [plugin], error: null, rowError: null, rowSavingId: null, expandedIds: new Set(),
  onToggleEnabled: vi.fn(async () => {}), onRemovePlugin: vi.fn(async () => {}), onToggleExpanded: vi.fn(),
  inspectedPlugin: null, onInspectPlugin: vi.fn(), onCloseInspector: vi.fn(), settingsPlugin: null,
  onOpenSettings: vi.fn(), onCloseSettings: vi.fn(), onSettingsSaved: vi.fn(), settingsNotice: null,
  dismissSettingsNotice: vi.fn(), pendingRemovePlugin: null, onRequestRemove: vi.fn(),
  onConfirmRemove: vi.fn(), onCancelRemove: vi.fn(), t: (key) => key, locale: "en", canInstallFolder: true,
};
const props: PluginsProps = {
  kit,
  hooks: {
    usePluginsHook: () => controller, useAdminLocale: () => "en",
    useWiredPluginPackageFiles: vi.fn(), useWiredPluginProviderSettings: vi.fn(), useProviderSettingsFocus: vi.fn(),
  },
  deps: {
    pluginRules: rules, pluginRemoveAriaLabel: rules.pluginRemoveAriaLabel, pluginRemoveBlocker: rules.pluginRemoveBlocker,
    pluginToggleAriaLabel: rules.pluginToggleAriaLabel, pluginToggleControl: rules.pluginToggleControl,
    translateAdminNavLabel: ({ key }) => key, onTabChange: vi.fn(), productName: "Acme",
    builtInNote: "Built-in note", marketplaceNote: "Marketplace note",
  },
};

it("bindPlugins selects the supplied rules provider and preserves the rules instance", () => {
  const HostProvider: typeof PluginRulesProvider = ({ children }) => <>{children}</>;
  const Bound = bindPlugins({ ...props, kit: { ...kit, PluginRulesProvider: HostProvider } });
  const output = Plugins(Bound({}).props);
  expect(output.type).toBe(HostProvider);
  expect(output.props.rules).toBe(rules);
});

it("uses injected icons in the screen's installed, downloaded and marketplace tabs", () => {
  const Bound = bindPlugins({ ...props, kit: {
    ...kit, PluginRow: () => <li>host row</li>,
    InstalledTabIcon: () => <span>host installed</span>, DownloadedTabIcon: () => <span>host downloaded</span>,
    MarketplaceTabIcon: () => <span>host marketplace</span>,
    TabBar: ({ tabs }) => <>{tabs.map((tab) => <span key={tab.id}>{tab.icon}</span>)}</>,
  } });
  const view = renderWithAdminKit(<Bound />);
  expect(view.getByText("host installed")).toBeTruthy();
  expect(view.getByText("host downloaded")).toBeTruthy();
  expect(view.getByText("host marketplace")).toBeTruthy();
});

it.each(["installed", "downloaded"] as const)("threads the row kit into the %s panel", (tab) => {
  const Row: typeof PluginRow = ({ action }) => <li>{usePluginRules() === rules ? "shared rules" : "wrong rules"}{action}</li>;
  const Trash: typeof PluginTrashIcon = () => <span>host trash</span>;
  const Panel = PLUGINS_TAB_PANELS[tab];
  const view = renderWithAdminKit(
    <PluginRulesProvider rules={rules}>
      <Panel {...props} kit={{ ...kit, PluginRow: Row, PluginTrashIcon: Trash }} plugins={[plugin]}
        controller={controller} rowHandleById={new Map([[plugin.id, "row-example"]])} />
    </PluginRulesProvider>,
  );
  expect(view.getByRole("listitem").textContent).toContain("shared rules");
  if (tab === "downloaded") expect(view.getByText("host trash")).toBeTruthy();
  view.getByRole("button", { name: rules.pluginToggleAriaLabel({ plugin, locale: "en" }) }).click();
  expect(controller.onToggleEnabled).toHaveBeenCalledWith(plugin);
});

it("uses the injected marketplace icon and add panel", () => {
  const Marketplace = PLUGINS_TAB_PANELS.marketplace;
  const Add = PLUGINS_TAB_PANELS.add;
  const boundKit = { ...kit, MarketplaceTabIcon: () => <span>host market</span>, AddPluginPanel: () => <span>host add</span> };
  const panelProps = { ...props, kit: boundKit, plugins: [plugin], rowHandleById: new Map<string, string>() };
  const view = renderWithAdminKit(<>
    <Marketplace {...panelProps} controller={controller} />
    <Add {...panelProps} controller={{ ...controller, install: {} as NonNullable<PluginsController["install"]> }} />
  </>);
  expect(view.getByText("host market")).toBeTruthy();
  expect(view.getByText("host add")).toBeTruthy();
});

it("uses injected package-files and remove overlays", () => {
  const Files: typeof PluginPackageFilesModal = ({ plugin }) => <span>host files {plugin.id}</span>;
  const Remove: typeof PluginRemoveConfirmDialog = ({ onConfirm }) => <button onClick={onConfirm}>host remove</button>;
  const view = renderWithAdminKit(PluginsOverlays({
    ...props, kit: { ...kit, PluginPackageFilesModal: Files, PluginRemoveConfirmDialog: Remove },
    controller: { ...controller, inspectedPlugin: plugin, pendingRemovePlugin: plugin },
    settingsHandle: undefined, removeHandle: "row-example",
  }));
  expect(view.getByText("host files example")).toBeTruthy();
  view.getByRole("button", { name: "host remove" }).click();
  expect(controller.onConfirmRemove).toHaveBeenCalledWith(plugin);
});
