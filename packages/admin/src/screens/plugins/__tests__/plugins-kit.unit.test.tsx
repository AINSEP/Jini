// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { Plugins, bindPlugins, type PluginsProps } from "../Plugins.js";
import type { PluginsController } from "../hooks/use-plugins.hooks.js";
import { DownloadedPluginRows, InstalledPluginRows, PLUGINS_TAB_PANELS } from "../PluginLists.js";
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
    TabBar: ({ tabs }) => <>{tabs.map((tab) => <span key={tab.id} data-testid={tab.id}>{tab.icon}</span>)}</>,
  } });
  const view = renderWithAdminKit(<Bound />);
  expect(view.getByTestId("installed").textContent).toBe("host installed");
  expect(view.getByTestId("downloaded").textContent).toBe("host downloaded");
  expect(view.getByTestId("marketplace").textContent).toBe("host marketplace");
});

it.each(["installed", "downloaded"] as const)("threads the row kit into the %s panel", (tab) => {
  const Row: typeof PluginRow = ({ action }) => <li>{usePluginRules() === rules ? "shared rules" : "wrong rules"}{action}</li>;
  const Trash: typeof PluginTrashIcon = () => <span>host trash</span>;
  const Panel = PLUGINS_TAB_PANELS[tab];
  const onToggleEnabled = vi.fn(async () => {});
  const view = renderWithAdminKit(
    <PluginRulesProvider rules={rules}>
      <Panel {...props} kit={{ ...kit, PluginRow: Row, PluginTrashIcon: Trash }} plugins={[plugin]}
        controller={{ ...controller, onToggleEnabled }} rowHandleById={new Map([[plugin.id, "row-example"]])} />
    </PluginRulesProvider>,
  );
  expect(view.getByRole("listitem").textContent).toContain("shared rules");
  if (tab === "downloaded") expect(view.getByText("host trash")).toBeTruthy();
  view.getByRole("button", { name: rules.pluginToggleAriaLabel({ plugin, locale: "en" }) }).click();
  expect(onToggleEnabled).toHaveBeenCalledExactlyOnceWith(plugin);
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

it("explains removal blockers in Downloaded and requests the exact inactive site plugin", async () => {
  const builtIn: AdminPluginDto = { ...plugin, id: "builtin-index", name: "Built-in Index", source: "built-in" };
  const active: AdminPluginDto = { ...plugin, id: "active-index", name: "Active Index", enabled: true };
  const inactive: AdminPluginDto = { ...plugin, id: "inactive-index", name: "Inactive Index", providerSettings: true };
  const busy: AdminPluginDto = { ...plugin, id: "busy-index", name: "Busy Index" };
  const rowHandles = new Map([builtIn, active, inactive, busy].map((row) => [row.id, `plugins-row-${row.id}`]));
  const onToggleEnabled = vi.fn(async () => {});
  const onRequestRemove = vi.fn();
  const onOpenSettings = vi.fn();
  const onInspectPlugin = vi.fn();
  const onToggleExpanded = vi.fn();
  const Panel = PLUGINS_TAB_PANELS.downloaded;
  const user = userEvent.setup();
  renderWithAdminKit(<PluginRulesProvider rules={rules}>
    <Panel {...props} plugins={[builtIn, active, inactive, busy]} rowHandleById={rowHandles}
      controller={{ ...controller, rowSavingId: busy.id, onToggleEnabled, onRequestRemove, onOpenSettings, onInspectPlugin, onToggleExpanded }} />
  </PluginRulesProvider>);
  const built = within(screen.getByRole("listitem", { name: "Built-in Index" }));
  const running = within(screen.getByRole("listitem", { name: "Active Index" }));
  const available = within(screen.getByRole("listitem", { name: "Inactive Index" }));
  const unavailable = within(screen.getByRole("listitem", { name: "Busy Index" }));
  const builtRemove = built.getByRole("button", { name: "Remove Built-in Index — unavailable" });
  expect(builtRemove).toBeDisabled();
  expect(builtRemove).toHaveAccessibleDescription("Built-in note");
  const activeRemove = running.getByRole("button", { name: "Remove Active Index — unavailable" });
  expect(activeRemove).toBeDisabled();
  expect(activeRemove).toHaveAccessibleDescription("Turn a plugin off on Installed before removing it.");
  expect(running.queryByRole("button", { name: "Enable Active Index" })).toBeNull();
  expect(unavailable.getByRole("button", { name: "Remove Busy Index" })).toBeDisabled();
  expect(unavailable.getByRole("button", { name: "Enable Busy Index" })).toBeDisabled();
  await user.click(builtRemove);
  await user.click(activeRemove);
  await user.click(unavailable.getByRole("button", { name: "Remove Busy Index" }));
  expect(onRequestRemove).not.toHaveBeenCalled();
  await user.click(available.getByRole("button", { name: "Remove Inactive Index" }));
  expect(onRequestRemove).toHaveBeenCalledExactlyOnceWith(inactive);
  await user.click(built.getByRole("button", { name: "Enable Built-in Index" }));
  expect(onToggleEnabled).toHaveBeenCalledExactlyOnceWith(builtIn);
  await user.click(available.getByRole("button", { name: "Settings — Inactive Index" }));
  expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("inactive-index");
  await user.click(available.getByRole("button", { name: "Inspect package files — Inactive Index" }));
  expect(onInspectPlugin).toHaveBeenCalledExactlyOnceWith("inactive-index");
  await user.click(available.getByRole("button", { name: "Inactive Index v1.0.0" }));
  expect(onToggleExpanded).toHaveBeenCalledExactlyOnceWith({ id: "inactive-index" });
});

it("shows tab-specific empty-state guidance and offers directory installation only when the Add tab is unavailable", () => {
  const Downloaded = PLUGINS_TAB_PANELS.downloaded;
  const Installed = PLUGINS_TAB_PANELS.installed;
  const Market = PLUGINS_TAB_PANELS.marketplace;
  const Add = PLUGINS_TAB_PANELS.add;
  const inputs = { ...props, controller, rowHandleById: new Map(), plugins: [] };
  renderWithAdminKit(<div aria-label="empty plugin tabs">
    <section aria-label="Installed"><Installed {...inputs} /></section>
    <section aria-label="Downloaded"><Downloaded {...inputs} /></section>
    <section aria-label="Unavailable installer"><Add {...inputs} /></section>
    <section aria-label="Marketplace with installer"><Market {...inputs} /></section>
    <section aria-label="Marketplace without installer"><Market {...inputs} controller={{ ...controller, canInstallFolder: false }} /></section>
  </div>);
  const installed = within(screen.getByRole("region", { name: "Installed" }));
  const downloaded = within(screen.getByRole("region", { name: "Downloaded" }));
  expect(installed.getByText("Enabled plugins extend what this site can do.")).toBeVisible();
  expect(downloaded.getByText(/A new one appears here on the next load/)).toBeVisible();
  expect(installed.queryByRole("list")).toBeNull();
  expect(downloaded.queryByRole("list")).toBeNull();
  expect(screen.getByRole("region", { name: "Unavailable installer" })).toBeEmptyDOMElement();
  const hint = "Install a plugin by placing its files in this site's plugin install directory.";
  expect(within(screen.getByRole("region", { name: "Marketplace with installer" })).queryByText(hint)).toBeNull();
  expect(within(screen.getByRole("region", { name: "Marketplace without installer" })).getByText(hint)).toBeVisible();
});

it.each([["Installed", InstalledPluginRows], ["Downloaded", DownloadedPluginRows]] as const)(
  "reports the missing row identity in the %s list before rendering an unaddressable control",
  (_name, List) => {
    const inputs = { ...props, plugins: [plugin], controller, rowHandleById: new Map(), expandedIds: new Set<string>(), onToggleExpanded: vi.fn(), onRequestRemove: vi.fn() };
    expect(() => renderWithAdminKit(<List {...inputs} />))
      .toThrow("plugin example has no row handle");
  },
);

it("retains loaded rows during reload and toggle errors and binds settings, save and toast dismissal", async () => {
  const configured: AdminPluginDto = { ...plugin, providerSettings: true };
  const onCloseSettings = vi.fn();
  const onSettingsSaved = vi.fn();
  const dismissSettingsNotice = vi.fn();
  const Settings: PluginsProps["kit"]["PluginProviderSettingsDialog"] = ({ plugin: row, agentHandleBase, onSaved, onClose }) => (
    <div role="dialog" aria-label={`Settings for ${row.name}`}>
      <span>{agentHandleBase}</span><button type="button" onClick={() => onSaved()}>Save</button><button type="button" onClick={() => onClose()}>Close</button>
    </div>
  );
  const Toast: PluginsProps["kit"]["Toast"] = ({ message, role, onDismiss }) => <div role={role}>{message}<button type="button" onClick={() => onDismiss()}>Dismiss notice</button></div>;
  const usePluginsHook = () => ({ ...controller, plugins: [configured], settingsPlugin: configured, settingsNotice: "Settings applied.",
    error: "Refresh failed", rowError: "Toggle failed", onCloseSettings, onSettingsSaved, dismissSettingsNotice });
  const user = userEvent.setup();
  renderWithAdminKit(<Plugins {...props} kit={{ ...kit, PluginProviderSettingsDialog: Settings, Toast }}
    hooks={{ ...props.hooks, usePluginsHook }} focusPluginId="example" />);
  expect(screen.getAllByRole("alert").map((notice) => notice.textContent)).toEqual(["Toggle failed", "Refresh failed"]);
  expect(screen.getByRole("listitem", { name: "Example" })).toHaveAttribute("data-focused", "true");
  const settings = within(screen.getByRole("dialog", { name: "Settings for Example" }));
  expect(settings.getByText("plugins-row-example")).toBeVisible();
  await user.click(settings.getByRole("button", { name: "Save" }));
  expect(onSettingsSaved).toHaveBeenCalledExactlyOnceWith();
  await user.click(settings.getByRole("button", { name: "Close" }));
  expect(onCloseSettings).toHaveBeenCalledExactlyOnceWith();
  const notice = within(screen.getByRole("status"));
  expect(screen.getByRole("status")).toHaveTextContent("Settings applied.");
  await user.click(notice.getByRole("button", { name: "Dismiss notice" }));
  expect(dismissSettingsNotice).toHaveBeenCalledExactlyOnceWith();
});

it("does not mount an overlay without the matching row handle", () => {
  const Settings = vi.fn(() => <p>unexpected settings</p>);
  const Remove = vi.fn(() => <p>unexpected removal</p>);
  const overlays = PluginsOverlays({
    ...props, kit: { ...kit, PluginProviderSettingsDialog: Settings, PluginRemoveConfirmDialog: Remove },
    controller: { ...controller, settingsPlugin: plugin, pendingRemovePlugin: plugin }, settingsHandle: undefined, removeHandle: undefined,
  });
  renderWithAdminKit(overlays);
  expect(Settings).not.toHaveBeenCalled();
  expect(Remove).not.toHaveBeenCalled();
  expect(screen.queryByText("unexpected settings")).toBeNull();
  expect(screen.queryByText("unexpected removal")).toBeNull();
});

it("keeps the disabled invalid package visible for inspection without offering activation", () => {
  // AC-21: pluginToggleControl marks this action invisible. The row remains inspectable.
  const invalid: AdminPluginDto = { ...plugin, status: "invalid" };
  renderWithAdminKit(<Plugins {...props}
    hooks={{ ...props.hooks, usePluginsHook: () => ({ ...controller, plugins: [invalid] }) }} />);
  const row = within(screen.getByRole("listitem", { name: "Example" }));
  expect(row.getByRole("button", { name: "Inspect package files — Example" })).toBeEnabled();
  expect(row.queryByRole("button", { name: "Enable Example" })).toBeNull();
});

it("focuses an Installed provider and sends disclosure, inspection and settings to that row", async () => {
  const provider: AdminPluginDto = { ...plugin, id: "provider-a", name: "Provider A", providerSettings: true };
  const onToggleExpanded = vi.fn();
  const onInspectPlugin = vi.fn();
  const onOpenSettings = vi.fn();
  const user = userEvent.setup();
  renderWithAdminKit(<Plugins {...props} focusPluginId="provider-a" hooks={{ ...props.hooks, usePluginsHook: () => ({
    ...controller, plugins: [plugin, provider], rowSavingId: provider.id, onToggleExpanded, onInspectPlugin, onOpenSettings,
  }) }} />);
  const row = within(screen.getByRole("listitem", { name: "Provider A" }));
  const summary = row.getByRole("button", { name: "Provider A v1.0.0" });
  expect(summary).toHaveFocus();
  expect(row.getByRole("button", { name: "Enable Provider A" })).toBeDisabled();
  await user.click(summary);
  expect(onToggleExpanded).toHaveBeenCalledExactlyOnceWith({ id: "provider-a" });
  await user.click(row.getByRole("button", { name: "Inspect package files — Provider A" }));
  expect(onInspectPlugin).toHaveBeenCalledExactlyOnceWith("provider-a");
  await user.click(row.getByRole("button", { name: "Settings — Provider A" }));
  expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith("provider-a");
  const other = within(screen.getByRole("listitem", { name: "Example" }));
  expect(other.queryByRole("button", { name: /Settings/ })).toBeNull();
  expect(other.getByRole("button", { name: "Enable Example" })).toBeEnabled();
});

it("falls back to Installed on hosts that refuse local plugin installation", () => {
  const TabBar: PluginsProps["kit"]["TabBar"] = ({ tabs, activeId }) => (
    <div role="tablist" aria-label="Plugin panes">{tabs.map((tab) => <button key={tab.id} type="button" role="tab"
      disabled={tab.disabled} aria-selected={activeId === tab.id}>{tab.label}{tab.tag ? ` ${tab.tag}` : ""}</button>)}</div>
  );
  renderWithAdminKit(<Plugins {...props} tabId="add" kit={{ ...kit, TabBar }}
    hooks={{ ...props.hooks, usePluginsHook: () => ({ ...controller, canInstallFolder: false }) }} />);
  const bar = within(screen.getByRole("tablist", { name: "Plugin panes" }));
  expect(bar.getByRole("tab", { name: "Add a plugin Soon" })).toBeDisabled();
  expect(bar.getByRole("tab", { name: "Installed" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("listitem", { name: "Example" })).toBeVisible();
});

it.each(["settings", "remove"] as const)("fails with the missing %s identity rather than opening another plugin's overlay", (kind) => {
  const vanished: AdminPluginDto = { ...plugin, id: "vanished" };
  const usePluginsHook = () => ({
    ...controller, plugins: [plugin], settingsPlugin: kind === "settings" ? vanished : null,
    pendingRemovePlugin: kind === "remove" ? vanished : null,
  });
  expect(() => renderWithAdminKit(<Plugins {...props} hooks={{ ...props.hooks, usePluginsHook }} />))
    .toThrow(`plugin vanished has no ${kind} handle`);
});
