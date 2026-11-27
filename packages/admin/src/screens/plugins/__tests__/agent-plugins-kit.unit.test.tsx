// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { AgentPlugins, bindAgentPlugins, type AgentPluginsProps, type AgentPluginsController } from "../AgentPlugins.js";
import { AgentPluginsOverlays } from "../AgentPluginsOverlays.js";
import { agentPluginsTabs } from "../AgentPluginsTabs.js";
import { PluginRulesProvider, usePluginRules } from "../rules-context.js";
import { AgentPluginDisableConfirmDialog } from "../AgentPluginDisableConfirmDialog.js";
import { AddAgentPluginPanel } from "../AddAgentPluginPanel.js";
import { AgentPluginRow } from "../AgentPluginRow.js";
import { AgentPluginManageButton } from "../AgentPluginManageButton.js";
import { useAgentPluginConfirmation } from "../AgentPlugins.hooks.js";
import { useAgentPluginInstall } from "../hooks/use-agent-plugin-install.hooks.js";
import { useAgentPluginTab } from "../hooks/use-agent-plugin-tab.hooks.js";
import { useAgentPluginSurfaces } from "../hooks/use-agent-plugin-surfaces.hooks.js";
import { useAgentPluginDetailsView } from "../hooks/use-agent-plugin-details-modal.hooks.js";
import type { AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "../hooks/agent-plugin-surfaces-port.hooks.js";
import { AgentPluginUpdateSlot } from "../AgentPluginUpdateControl.js";
import { makeRules } from "./plugin-rules-fixture.js";

afterEach(cleanup);

const rules = makeRules();
const kit: AgentPluginsProps["kit"] = {
  PluginRulesProvider, AgentPluginDisableConfirmDialog, AddAgentPluginPanel,
  AgentPluginRow, AgentPluginManageButton, AgentPluginUpdateSlot,
  AgentPluginDetailsModal: () => null,
};
const plugin: NonNullable<AgentPluginsController["agentPlugins"]>[number] = {
  pluginId: "example", enabled: true, origin: "operator-installed", archiveDigest: "digest",
  version: null, description: null,
  keywords: [], skills: [], mcpServerIds: [],
};
const controller: AgentPluginsController = {
  agentPlugins: [plugin], error: null, toggleError: null, togglingIds: new Set(),
  onToggleEnabled: vi.fn(async () => {}), onInstalled: vi.fn(), expandedIds: new Set(),
  onToggleExpanded: vi.fn(), inspectedPlugin: null, inspectPlugin: vi.fn(), closeInspector: vi.fn(),
  t: (key) => key, locale: "en",
};
const props: AgentPluginsProps = {
  kit, hooks: {} as AgentPluginsProps["hooks"],
  deps: {
    pluginRules: rules, agentPluginDisplayName: rules.agentPluginDisplayName,
    updatableAgentPluginDigest: rules.updatableAgentPluginDigest,
    translateAdminNavLabel: ({ key }) => key,
    uninstallNote: "Uninstall note", downloadedNote: "Downloaded note", marketplaceNote: "Marketplace note",
  } as AgentPluginsProps["deps"],
};

it("bindAgentPlugins selects the supplied rules provider and preserves the rules instance", () => {
  const HostProvider: typeof PluginRulesProvider = ({ children }) => <>{children}</>;
  const Bound = bindAgentPlugins({ ...props, kit: { ...kit, PluginRulesProvider: HostProvider } });
  const output = AgentPlugins(Bound({}).props);
  expect(output.type).toBe(HostProvider);
  expect(output.props.rules).toBe(rules);
});

it.each(["installed", "downloaded"] as const)("threads row, manage and update slots through the %s tab", (tab) => {
  const Row: typeof AgentPluginRow = ({ manage, update, agentHandleBase }) => (
    <li data-testid="host-row" data-handle={agentHandleBase}>
      {usePluginRules() === rules ? "shared rules" : "wrong rules"}{manage}{update}
    </li>
  );
  const Manage: typeof AgentPluginManageButton = () => <span>host manage</span>;
  const Update: typeof AgentPluginUpdateSlot = ({ expectedOldDigest }) => <span>host update {expectedOldDigest}</span>;
  const tabs = agentPluginsTabs({
    props: { ...props, kit: { ...kit, AgentPluginRow: Row, AgentPluginManageButton: Manage, AgentPluginUpdateSlot: Update } },
    controller, uninstallNoteId: "uninstall-note", agentPluginInstallPort: props.deps.agentPluginInstallPort,
    installController: {} as Parameters<typeof AddAgentPluginPanel>[0]["controller"],
    onRequestToggleEnabled: vi.fn(), onRequestRemove: vi.fn(),
  });
  const view = renderWithAdminKit(
    <PluginRulesProvider rules={rules}>
      {tabs.find((item) => item.id === tab)!.panel}
    </PluginRulesProvider>,
  );
  expect(view.getByTestId("host-row").textContent).toBe("shared ruleshost managehost update digest");
  expect(view.getByTestId("host-row").getAttribute("data-handle")).toBe(buildAgentListHandles({ prefix: "agent-plugin-row", ids: [plugin.pluginId] })[0]);
});

it("uses the injected add panel in the add tab", () => {
  const Add: typeof AddAgentPluginPanel = () => <span>host add</span>;
  const tabs = agentPluginsTabs({
    props: { ...props, kit: { ...kit, AddAgentPluginPanel: Add } }, controller,
    installController: {} as Parameters<typeof AddAgentPluginPanel>[0]["controller"],
    uninstallNoteId: "note", agentPluginInstallPort: props.deps.agentPluginInstallPort,
    onRequestToggleEnabled: vi.fn(), onRequestRemove: vi.fn(),
  });
  expect(renderWithAdminKit(<>{tabs.find((tab) => tab.id === "add")!.panel}</>).getByText("host add")).toBeTruthy();
});

it("uses the injected disable dialog and clears confirmation before toggling", () => {
  const events: [string, unknown][] = [];
  const Dialog: typeof AgentPluginDisableConfirmDialog = ({ onConfirm, variant }) => <button onClick={onConfirm}>{variant}</button>;
  const view = renderWithAdminKit(AgentPluginsOverlays({
    props: { ...props, kit: { ...kit, AgentPluginDisableConfirmDialog: Dialog } },
    controller: { ...controller, onToggleEnabled: async row => { events.push(["toggle", row.pluginId]); } },
    pendingDisable: { pluginId: plugin.pluginId, variant: "remove" }, pendingDisablePlugin: plugin,
    setPendingDisable: next => { events.push(["clear", next]); },
  }));
  view.getByRole("button", { name: "remove" }).click();
  expect(events).toEqual([["clear", null], ["toggle", "example"]]);
});

const updatePort: AgentPluginsProps["deps"]["agentPluginInstallPort"] = {
  sha256: async () => { throw new Error("unexpected digest"); },
  installZip: async () => { throw new Error("unexpected upload"); },
};

function screenProps(overrides: Partial<AgentPluginsController> = {}): AgentPluginsProps {
  class FolderZipError extends Error { readonly reason = "unreadable" as const; }
  return {
    ...props,
    hooks: {
      useAgentPluginTabHook: useAgentPluginTab,
      useAgentPluginInstallHook: useAgentPluginInstall,
      useAgentPluginConfirmationHook: useAgentPluginConfirmation,
      useAgentPluginUpdateHook: () => { throw new Error("unexpected update hook"); },
      useAgentPluginsHook: () => ({ ...controller, ...overrides }),
      useAdminThemeBoundaryHook: () => ({ "data-theme": "midnight" }),
      useDetails: () => { throw new Error("unexpected file read"); },
      useAgentPluginMemoryHook: () => { throw new Error("unexpected memory read"); },
      useAgentPluginDetailsViewHook: useAgentPluginDetailsView,
      useAgentPluginSurfacesHook: useAgentPluginSurfaces,
    },
    deps: {
      ...props.deps,
      productName: "Acme",
      isApiError: (_error): _error is never => false,
      agentPluginInstallPort: updatePort,
      defaultAgentPluginSurfacesPort: {
        list: async () => ({ surfaces: [] }),
        bootstrap: async () => { throw new Error("unexpected surface bootstrap"); },
        action: async () => { throw new Error("unexpected surface action"); },
      },
      dictionaries: {},
      folderZip: { FOLDER_EMPTY: "Empty", FOLDER_UNREADABLE: "Unreadable", FolderZipError, zipFolderFiles: async () => { throw new Error("unexpected zip"); } },
    },
  };
}

it("keeps loading, list failure, toggle failure and empty results distinct", () => {
  const base = screenProps();
  const renderState = (overrides: Partial<AgentPluginsController>) =>
    <AgentPlugins {...base} hooks={{ ...base.hooks, useAgentPluginsHook: () => ({ ...controller, ...overrides }) }} />;
  renderWithAdminKit(renderState({ agentPlugins: null }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading Agent Plugins…");
  expect(screen.queryByRole("list")).toBeNull();

  // Use one renderWithAdminKit per state because that helper wraps the initial element in a provider.
  cleanup();
  renderWithAdminKit(renderState({ agentPlugins: null, error: "List service offline" }));
  expect(screen.getByRole("status")).toHaveTextContent("List service offline");
  expect(screen.queryByText("Loading Agent Plugins…")).toBeNull();
  cleanup();
  renderWithAdminKit(renderState({ agentPlugins: [], toggleError: "Toggle refused" }));
  expect(screen.getByRole("status")).toHaveTextContent("No Agent Plugins are installed in this workspace.");
  expect(screen.getByRole("alert")).toHaveTextContent("Toggle refused");
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.getByRole("link", { name: "Agent Plugins open standard" })).toHaveAttribute("href", "https://agent-plugins.org/specification");
});

it("switches tabs, preserves disabled rows, and dispatches confirm-gated disable and turn-off separately", async () => {
  const original = window.location.href;
  window.history.replaceState(null, "", "/admin/addons/agent-plugins");
  const off = { ...plugin, pluginId: "off-package", enabled: false, origin: "bundled" as const };
  const toggle = vi.fn(async (_row: typeof plugin) => {});
  const base = screenProps();
  const installHook = vi.fn(useAgentPluginInstall);
  const overridePort: typeof updatePort = { ...updatePort };
  const Update: typeof AgentPluginUpdateSlot = ({ expectedOldDigest, port }) => (
    <span>{port === overridePort ? "Alternate update " : "Wrong update "}{expectedOldDigest}</span>
  );
  function Screen() {
    const [plugins, setPlugins] = useState([plugin, off]);
    const [expanded, setExpanded] = useState("");
    return <AgentPlugins {...base} agentPluginInstallPort={overridePort} kit={{ ...base.kit, AgentPluginUpdateSlot: Update }}
      hooks={{ ...base.hooks, useAgentPluginInstallHook: installHook, useAgentPluginsHook: () => ({
        ...controller, agentPlugins: plugins, expandedIds: new Set([expanded]),
        onToggleExpanded: ({ pluginId }) => setExpanded(pluginId),
        onToggleEnabled: async (row) => { await toggle(row); setPlugins(previous => previous.map(p => p.pluginId === row.pluginId ? { ...p, enabled: !p.enabled } : p)); },
      }) }} />;
  }
  const user = userEvent.setup();
  try {
    renderWithAdminKit(<Screen />);
    expect(installHook).toHaveBeenCalledWith(expect.objectContaining({ port: overridePort, productName: "Acme", rules }));
    expect(screen.getByRole("tabpanel").closest("[data-theme]")).toHaveAttribute("data-theme", "midnight");
    expect(screen.getByRole("tab", { name: "Installed" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("switch", { name: "Enable Off Package" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Example" }));
    expect(screen.getByText("Alternate update digest")).toBeVisible();
    await user.click(screen.getByRole("switch", { name: "Disable Example" }));
    const dialog = within(screen.getByRole("dialog", { name: "Disable Example for this site?" }));
    expect(toggle).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle).not.toHaveBeenCalled();
    await user.click(screen.getByRole("switch", { name: "Disable Example" }));
    await user.click(screen.getByRole("button", { name: "Disable" }));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(plugin);
    expect(await screen.findByRole("switch", { name: "Enable Example" })).not.toBeChecked();

    await user.click(screen.getByRole("tab", { name: "Downloaded" }));
    expect(window.location.search).toBe("?tab=downloaded");
    await user.click(screen.getByRole("button", { name: "Enable Off Package" }));
    expect(toggle.mock.calls).toEqual([[plugin], [off]]);
    await user.click(await screen.findByRole("button", { name: "Turn off Off Package" }));
    expect(screen.getByRole("dialog", { name: "Turn off Off Package?" })).toBeVisible();
    expect(toggle).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(toggle).toHaveBeenLastCalledWith({ ...off, enabled: true });
    expect(await screen.findByRole("button", { name: "Enable Off Package" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Marketplace" }));
    expect(screen.getByRole("heading", { name: "Nothing to browse yet" })).toBeVisible();
    expect(screen.getByText("Marketplace note")).toBeVisible();
    expect(screen.getByText("Downloaded note")).toBeVisible();
    expect(screen.getByRole("link", { name: "Read the package format" })).toHaveAttribute("href", "https://agent-plugins.org/specification");
    await user.click(screen.getByRole("tab", { name: "Add a plugin" }));
    expect(screen.getByRole("heading", { name: "Add a plugin" })).toBeVisible();
  } finally {
    window.history.replaceState(null, "", original);
  }
});

it("opens the eye on package files and Manage on the selected row's loaded admin surfaces", async () => {
  const surface: AgentPluginSurfaceSummary = { id: "reports", title: "Reports console", src: "/reports/index.html", actions: [] };
  const linked = { ...plugin, maturity: "untested" as const, origin: "bundled" as const };
  const inactive = { ...plugin, pluginId: "inactive", enabled: false, origin: "bundled" as const };
  const list = vi.fn<AgentPluginSurfacesPort["list"]>().mockResolvedValue({ surfaces: [surface] });
  const base = screenProps({ agentPlugins: [linked, inactive] });
  const surfacesPort = { ...base.deps.defaultAgentPluginSurfacesPort, list };
  const inspect = vi.fn();
  const Details: AgentPluginsProps["kit"]["AgentPluginDetailsModal"] = ({ plugin: selected, onClose, t, ...hooks }) => {
    if (hooks.useDetails !== base.hooks.useDetails || hooks.useAgentPluginMemoryHook !== base.hooks.useAgentPluginMemoryHook ||
        hooks.useAgentPluginDetailsViewHook !== base.hooks.useAgentPluginDetailsViewHook || hooks.useAgentPluginSurfacesHook !== base.hooks.useAgentPluginSurfacesHook) {
      throw new Error("the inspector received the wrong host hooks");
    }
    return <div role="dialog" aria-label={selected.displayName}>
      {selected.surfaces?.[0]?.title ?? t("Package files")}<button type="button" onClick={onClose}>Close inspector</button>
    </div>;
  };
  function Panel() {
    const [selected, setSelected] = useState<AgentPluginsController["inspectedPlugin"]>(null);
    return <AgentPlugins {...base} deps={{ ...base.deps, defaultAgentPluginSurfacesPort: surfacesPort }}
      kit={{ ...base.kit, AgentPluginDetailsModal: Details }}
      hooks={{ ...base.hooks, useAgentPluginsHook: () => ({
        ...base.hooks.useAgentPluginsHook(), inspectedPlugin: selected,
        inspectPlugin: (target) => { inspect(target); setSelected(target); },
        closeInspector: () => setSelected(null),
      }) }} />;
  }
  const user = userEvent.setup();
  renderWithAdminKit(<Panel />);
  const manage = await screen.findByRole("button", { name: "Manage Example" });
  expect(list).toHaveBeenCalledExactlyOnceWith({ pluginId: "example" });
  expect(screen.queryByRole("button", { name: "Manage Inactive" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Inspect package files — Example" }));
  expect(within(screen.getByRole("dialog", { name: "Example" })).getByText("Package files")).toBeVisible();
  expect(inspect).toHaveBeenLastCalledWith({ id: "example", displayName: "Example", maturity: "untested" });
  await user.click(screen.getByRole("button", { name: "Close inspector" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(manage);
  expect(within(screen.getByRole("dialog", { name: "Example" })).getByText("Reports console")).toBeVisible();
  expect(inspect).toHaveBeenLastCalledWith({ id: "example", displayName: "Example", maturity: "untested", surfaces: [surface] });
});

it("does not offer a Manage button when the surface listing settles empty", async () => {
  const base = screenProps({ agentPlugins: [{ ...plugin, origin: "bundled" }] });
  const list = vi.fn<AgentPluginSurfacesPort["list"]>().mockResolvedValue({ surfaces: [] });
  renderWithAdminKit(<AgentPlugins {...base} deps={{ ...base.deps, defaultAgentPluginSurfacesPort: { ...base.deps.defaultAgentPluginSurfacesPort, list } }} />);
  await waitFor(() => expect(list).toHaveBeenCalledExactlyOnceWith({ pluginId: "example" }));
  expect(screen.getByRole("switch", { name: "Disable Example" })).toBeChecked();
  expect(screen.queryByRole("button", { name: "Manage Example" })).toBeNull();
});

it("does not open a confirmation for a plugin that disappeared from the current list", () => {
  const base = screenProps({ agentPlugins: [] });
  const openConfirm = vi.fn(() => <div role="dialog">Unexpected confirmation</div>);
  const setPendingDisable = vi.fn();
  renderWithAdminKit(AgentPluginsOverlays({
    props: { ...base, kit: { ...base.kit, AgentPluginDisableConfirmDialog: openConfirm } },
    controller: { ...controller, agentPlugins: [] },
    pendingDisable: { pluginId: "no-longer-installed", variant: "disable" },
    pendingDisablePlugin: null,
    setPendingDisable,
  }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(openConfirm).not.toHaveBeenCalled();
  expect(setPendingDisable).not.toHaveBeenCalled();
});
