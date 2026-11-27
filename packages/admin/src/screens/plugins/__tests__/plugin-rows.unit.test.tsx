// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { InfoTip, useInfoTip } from "@jini-ai/ui/admin-widgets";
import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import type { AgentPluginListRow } from "../../../agent-plugins/models.js";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { AgentPluginRow, type AgentPluginRowProps } from "../AgentPluginRow.js";
import { AgentPluginMaturity } from "../AgentPluginMaturity.js";
import { PluginRow } from "../PluginRow.js";
import { PluginRulesProvider } from "../rules-context.js";
import { makeRules } from "./plugin-rules-fixture.js";

afterEach(cleanup);
const t = (key: string) => key;
const rules = makeRules();
const kit = fakeAdminKit({ components: { InfoTip }, hooks: { useInfoTip } });
function wrapper({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={kit}><PluginRulesProvider rules={rules}>{children}</PluginRulesProvider></AdminKitProvider>;
}
const agent: AgentPluginListRow = {
  pluginId: "data-check", enabled: true, version: "2.3.4", description: "Internal guidance",
  keywords: ["private-term"], skills: [], mcpServerIds: [],
};

it("expands owner-facing details, preserves separate inspect and state controls, and explains unavailable uninstall", async () => {
  const inspect = vi.fn();
  const toggle = vi.fn();
  const plugin: AgentPluginListRow = {
    ...agent, summary: "  Check copies before importing.  ", connectionStatus: "pending",
    missingRequires: ["reports:read"], hostOk: false,
    skills: [{ name: "validate", summary: "Validates the input." }], mcpServerIds: ["records", "rules"],
  };
  function List() {
    const [expanded, setExpanded] = useState(false);
    return <><p id="uninstall-note">Bundled packages stay on disk.</p><ul>
      <AgentPluginRow plugin={plugin} expanded={expanded} busy={false} t={t} locale="en" agentHandleBase="row-data-check"
        onToggleExpanded={() => setExpanded(!expanded)} stateControl={{ kind: "toggle", onToggleEnabled: toggle }} onInspect={inspect}
        manage={<button type="button">Manage connections</button>} update={<button type="button">Update package</button>} uninstallNoteId="uninstall-note" />
    </ul></>;
  }
  const user = userEvent.setup();
  render(<List />, { wrapper });
  const row = within(screen.getByRole("listitem", { name: "Data Check" }));
  const summary = row.getByRole("button", { name: "Data Check v2.3.4" });
  const detail = document.getElementById(summary.getAttribute("aria-controls")!);
  expect(detail).toHaveAttribute("hidden");
  expect(row.getByText("Waiting for sign-in")).toBeVisible();
  expect(row.getByText("Not for this Acme version")).toBeVisible();
  expect(row.getByText("Needs reports:read")).toBeVisible();
  expect(row.getByRole("button", { name: "Manage connections" })).toBeVisible();
  const uninstall = row.getByRole("button", { name: "Uninstall Data Check — unavailable" });
  expect(uninstall).toBeDisabled();
  expect(uninstall).toHaveAccessibleDescription("Bundled packages stay on disk.");
  await user.click(row.getByRole("button", { name: "Inspect package files — Data Check" }));
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(summary).toHaveAttribute("aria-expanded", "false");
  const activation = row.getByRole("switch", { name: "Disable Data Check" });
  expect(activation).toBeChecked();
  expect(row.getByText("Enabled")).toBeVisible();
  await user.click(activation);
  expect(toggle).toHaveBeenCalledTimes(1);
  await user.click(summary);
  expect(summary).toHaveAttribute("aria-expanded", "true");
  expect(detail).toBeVisible();
  const expanded = within(detail!);
  expect(expanded.getByText("Check copies before importing.")).toBeVisible();
  expect(row.queryByText("Internal guidance")).toBeNull();
  expect(expanded.getByText("validate")).toBeVisible();
  expect(expanded.getByText("records")).toBeVisible();
  expect(expanded.getByText("rules")).toBeVisible();
  expect(expanded.getByRole("button", { name: "Update package" })).toBeVisible();
});

function rowProps(plugin: AgentPluginListRow): AgentPluginRowProps {
  return {
    plugin, expanded: true, busy: false, t, locale: "en", agentHandleBase: "row-data-check",
    onToggleExpanded: vi.fn(), stateControl: { kind: "toggle", onToggleEnabled: vi.fn() },
    onInspect: vi.fn(), uninstallNoteId: "uninstall-note",
  };
}

it("keeps a Soon plugin locked off before a linked provider and omits a redundant self-named skill", async () => {
  const onEnable = vi.fn();
  const onToggleExpanded = vi.fn();
  const props = rowProps({ ...agent, version: null, summary: " ", enabled: false, maturity: "soon", providerPlugin: "data-provider",
    skills: [{ name: "data-check", summary: "Duplicated by row title" }] });
  const user = userEvent.setup();
  render(<ul><AgentPluginRow {...props} onToggleExpanded={onToggleExpanded} stateControl={{ kind: "remove-or-enable", onEnable, onRemove: vi.fn() }} /></ul>, { wrapper });
  const row = within(screen.getByRole("listitem", { name: "Data Check" }));
  const lock = row.getByRole("switch", { name: "Enable Data Check" });
  expect(lock).toBeDisabled();
  expect(lock).not.toBeChecked();
  await user.click(lock);
  expect(onEnable).not.toHaveBeenCalled();
  const maturity = row.getByRole("button", { name: "Soon" });
  expect(maturity).toHaveAccessibleDescription("Not ready for production use yet. You can still view its files.");
  await user.click(maturity);
  expect(onToggleExpanded).not.toHaveBeenCalled();
  expect(row.getByText("Disabled")).toBeVisible();
  expect(row.queryByRole("button", { name: /only be turned on in the Plugins page/ })).toBeNull();
  expect(row.queryByText("Skills")).toBeNull();
  expect(row.queryByText("MCP servers")).toBeNull();
  expect(row.getAllByText("Internal guidance")).toHaveLength(2); // preview and expanded explanation
});

it.each([false, true])("routes Downloaded's enabled=%s row to the corresponding action, but never while busy", async (enabled) => {
  const onRemove = vi.fn();
  const onEnable = vi.fn();
  const props = { ...rowProps({ ...agent, enabled, description: null }), stateControl: { kind: "remove-or-enable", onEnable, onRemove } as const };
  const user = userEvent.setup();
  const root = render(<ul><AgentPluginRow {...props} busy /></ul>, { wrapper });
  const name = enabled ? "Turn off Data Check" : "Enable Data Check";
  const action = screen.getByRole("button", { name });
  expect(action).toBeDisabled();
  await user.click(action);
  expect(onEnable).not.toHaveBeenCalled();
  expect(onRemove).not.toHaveBeenCalled();
  root.rerender(<ul><AgentPluginRow {...props} /></ul>);
  expect(action).not.toBeDisabled();
  expect(action).toHaveAttribute("data-agent-element", enabled ? "row-data-check-remove" : "row-data-check-enable");
  await user.click(action);
  expect(enabled ? onRemove : onEnable).toHaveBeenCalledTimes(1);
  expect(enabled ? onEnable : onRemove).not.toHaveBeenCalled();
});

it.each([false, true])("shows the linked agent's enabled=%s state and opens its encoded provider row", async (enabled) => {
  const original = window.location.href;
  window.history.replaceState(null, "", "/admin/addons/agent-plugins");
  try {
    render(<ul><AgentPluginRow {...rowProps({ ...agent, enabled, providerPlugin: "charts/proxy + local" })} /></ul>, { wrapper });
    const row = within(screen.getByRole("listitem", { name: "Data Check" }));
    expect(row.getByText(enabled ? "Enabled" : "Disabled")).toBeVisible();
    expect(row.queryByRole("switch")).toBeNull();
    const button = row.getByRole("button", { name: "This is both an agent plugin and a regular plugin. It can only be turned on in the Plugins page." });
    expect(button).toHaveAttribute("data-agent-element", "row-data-check-linked");
    const user = userEvent.setup();
    await user.click(button);
    expect(window.location.pathname + window.location.search).toBe("/admin/addons/plugins?tab=installed&plugin=charts%2Fproxy%20%2B%20local");
  } finally {
    window.history.replaceState(null, "", original);
  }
});

it("announces Untested as a warning and shows no maturity control for a normal release", () => {
  const { rerender } = render(<AgentPluginMaturity maturity="untested" t={t} />, { wrapper });
  expect(screen.getByRole("button", { name: "Untested" })).toHaveAccessibleDescription("Not yet tested end to end. It may not work.");
  rerender(<AgentPluginMaturity maturity={undefined} t={t} />);
  expect(screen.queryByRole("button")).toBeNull();
});

const cms: AdminPluginDto = {
  id: "site-reports", name: "Site Reports", version: "4.1.0", source: "site", tier: "tier-3", status: "valid",
  enabled: false, quarantine: null, errors: [], conflicts: [],
};

it("focuses the deep-linked site plugin, exposes problem detail, and routes Settings and Inspect independently", async () => {
  const plugin: AdminPluginDto = {
    ...cms, providerSettings: true,
    quarantine: { at: "2026-11-22T00:00:00Z", reason: "Hook timed out", consecutiveFailures: 4 },
    errors: [{ code: "BAD_HOOK", message: "Invalid reports hook", file: "reports.js" }],
    conflicts: [{ kind: "route", key: "/reports", heldBy: "legacy", heldByName: "Legacy Reports", heldKey: "/reports" }],
  };
  const inspect = vi.fn();
  const settings = vi.fn();
  function List() {
    const [expanded, setExpanded] = useState(false);
    return <ul><PluginRow plugin={plugin} expanded={expanded} focused onToggleExpanded={() => setExpanded(!expanded)}
      onInspect={inspect} onSettings={settings} action={<button type="button">Separate action</button>}
      agentHandleBase="row-site-reports" t={t} useAdminLocaleHook={() => "en"} /></ul>;
  }
  const user = userEvent.setup();
  render(<List />, { wrapper });
  const row = within(screen.getByRole("listitem", { name: "Site Reports" }));
  const summary = row.getByRole("button", { name: "Site Reports v4.1.0" });
  expect(summary).toHaveFocus();
  expect(summary.closest("li")).toHaveAttribute("data-focused", "true");
  const detail = document.getElementById(summary.getAttribute("aria-controls")!);
  expect(detail).toHaveAttribute("hidden");
  await user.keyboard("{Enter}");
  expect(summary).toHaveAttribute("aria-expanded", "true");
  expect(detail).toBeVisible();
  expect(row.getByRole("group", { name: "Plugin details" })).toHaveTextContent("site-reports");
  expect(row.getByText("Hook timed out")).toBeVisible();
  expect(row.getByText(/Legacy Reports/)).toBeVisible();
  expect(row.getByText("BAD_HOOK")).toBeVisible();
  expect(row.getByText("Invalid reports hook")).toBeVisible();
  await user.click(row.getByRole("button", { name: "Settings — Site Reports" }));
  expect(settings).toHaveBeenCalledTimes(1);
  expect(inspect).not.toHaveBeenCalled();
  await user.click(row.getByRole("button", { name: "Inspect package files — Site Reports" }));
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(settings).toHaveBeenCalledTimes(1);
  expect(row.getByRole("button", { name: "Separate action" })).toBeVisible();
});

it("keeps healthy plugin facts readable without inventing Settings or problems", () => {
  render(<ul><PluginRow plugin={cms} expanded t={t} agentHandleBase="row-site-reports" onInspect={vi.fn()} action={null}
    useAdminLocaleHook={() => "en"} onToggleExpanded={vi.fn()} /></ul>, { wrapper });
  const row = within(screen.getByRole("listitem", { name: "Site Reports" }));
  const details = row.getByRole("group", { name: "Plugin details" });
  expect(details).toHaveTextContent("site-reports");
  expect(row.queryByRole("button", { name: /Settings/ })).toBeNull();
  expect(row.queryByRole("list")).toBeNull();
});

it("lets a still-enabled Soon plugin be switched off and disables only a busy switch", async () => {
  const onToggleEnabled = vi.fn();
  const props = { ...rowProps({ ...agent, maturity: "soon", version: null }), stateControl: { kind: "toggle", onToggleEnabled } as const };
  const user = userEvent.setup();
  const { rerender } = render(<ul><AgentPluginRow {...props} busy /></ul>, { wrapper });
  const control = screen.getByRole("switch", { name: "Disable Data Check" });
  expect(control).toBeChecked();
  expect(control).toBeDisabled();
  expect(control).toHaveAttribute("aria-busy", "true");
  await user.click(control);
  expect(onToggleEnabled).not.toHaveBeenCalled();
  rerender(<ul><AgentPluginRow {...props} /></ul>);
  expect(control).toBeEnabled();
  await user.click(control);
  expect(onToggleEnabled).toHaveBeenCalledTimes(1);
});

it.each(["quarantine", "conflict", "validation"] as const)("keeps %s details separate from absent problems", (kind) => {
  const plugin: AdminPluginDto = {
    ...cms,
    quarantine: kind === "quarantine" ? { at: "2026-11-22T00:00:00Z", reason: "Hook timed out", consecutiveFailures: 4 } : null,
    errors: kind === "validation" ? [{ code: "BAD_HOOK", message: "Invalid reports hook", file: null }] : [],
    conflicts: kind === "conflict" ? [{ kind: "route", key: "/reports", heldBy: "legacy", heldByName: "Legacy Reports", heldKey: "/reports" }] : [],
  };
  render(<ul><PluginRow plugin={plugin} expanded t={t} agentHandleBase="row-site-reports" onInspect={vi.fn()}
    action={null} useAdminLocaleHook={() => "en"} onToggleExpanded={vi.fn()} /></ul>, { wrapper });
  const row = within(screen.getByRole("listitem", { name: "Site Reports" }));
  const expected = { quarantine: "Hook timed out", conflict: /Legacy Reports/, validation: "Invalid reports hook" };
  expect(row.getByText(expected[kind])).toBeVisible();
  for (const other of ["quarantine", "conflict", "validation"] as const) {
    if (other !== kind) expect(row.queryByText(expected[other])).toBeNull();
  }
});
