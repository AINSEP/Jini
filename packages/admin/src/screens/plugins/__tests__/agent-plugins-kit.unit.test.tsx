// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
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
