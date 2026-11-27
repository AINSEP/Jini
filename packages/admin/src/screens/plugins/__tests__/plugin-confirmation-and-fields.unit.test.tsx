// @vitest-environment jsdom
import { act, cleanup, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentPluginListRow } from "../../../agent-plugins/models.js";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { AgentPluginDisableConfirmDialog } from "../AgentPluginDisableConfirmDialog.js";
import { useAgentPluginConfirmation } from "../AgentPlugins.hooks.js";
import { useAgentPluginDisableConfirm } from "../hooks/use-agent-plugin-disable-confirm.hooks.js";
import { PluginRemoveConfirmDialog } from "../PluginRemoveConfirmDialog.js";
import { ProviderSettingField } from "../PluginProviderSettingField.js";
import { usePluginProviderChoice } from "../PluginProviderSettingField.hooks.js";
import type { AdminPluginProviderSettingField } from "../api/plugins-api.types.js";
import { makeRules } from "./plugin-rules-fixture.js";

afterEach(cleanup);
const t = (key: string) => key;
const rules = makeRules();
const plugin: AgentPluginListRow = {
  pluginId: "reporting", enabled: true, origin: "operator-installed", version: "2.0.0",
  description: null, keywords: [], skills: [], mcpServerIds: [],
};

it("enables directly but waits for confirmation on disable and resolves the latest row by id", () => {
  const toggle = vi.fn();
  const disabled = { ...plugin, pluginId: "draft-tools", enabled: false };
  const { result, rerender } = renderHook((agentPlugins: AgentPluginListRow[] | null) =>
    useAgentPluginConfirmation({ agentPlugins, onToggleEnabled: toggle }), { initialProps: [plugin, disabled] as AgentPluginListRow[] | null });
  expect(result.current.pendingDisablePlugin).toBeNull();
  act(() => result.current.onRequestToggleEnabled(disabled));
  expect(toggle).toHaveBeenCalledExactlyOnceWith(disabled);
  expect(result.current.pendingDisable).toBeNull();
  act(() => result.current.onRequestToggleEnabled(plugin));
  expect(toggle.mock.calls).toEqual([[disabled]]);
  expect(result.current.pendingDisable).toEqual({ pluginId: "reporting", variant: "disable" });
  expect(result.current.pendingDisablePlugin).toBe(plugin);
  const replacement = { ...plugin, version: "2.1.0" };
  rerender([disabled, replacement]);
  expect(result.current.pendingDisablePlugin).toBe(replacement);
  act(() => result.current.onRequestRemove(replacement));
  expect(result.current.pendingDisable).toEqual({ pluginId: "reporting", variant: "remove" });
  rerender([disabled]);
  expect(result.current.pendingDisablePlugin).toBeNull();
  rerender(null);
  expect(result.current.pendingDisablePlugin).toBeNull();
  act(() => result.current.setPendingDisable(null));
  expect(result.current.pendingDisable).toBeNull();
});

it("names the disable target and displays dependencies before a deliberate confirm", async () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  renderWithAdminKit(<AgentPluginDisableConfirmDialog name="Reporting" variant="disable" origin="operator-installed"
    requiredBy={["audit needs report:csv"]} agentHandleBase="row-reporting" t={t} rules={rules} onCancel={onCancel} onConfirm={onConfirm} />);
  const dialog = within(screen.getByRole("dialog", { name: "Disable Reporting for this site?" }));
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const confirm = dialog.getByRole("button", { name: "Disable" });
  expect(cancel).toHaveFocus();
  expect(dialog.getByText(/keeps its files and memory/)).toBeVisible();
  expect(dialog.getByText("Other enabled plugins rely on it: audit needs report:csv")).toBeVisible();
  expect(confirm).toHaveAttribute("data-agent-element", "row-reporting-disable-confirm");
  await user.tab({ shift: true });
  expect(confirm).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  await user.click(confirm);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("turns off from Downloaded, cancels only on Escape and detaches the key handler on unmount", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const user = userEvent.setup();
  const view = renderWithAdminKit(<AgentPluginDisableConfirmDialog name="Reporting" variant="remove"
    agentHandleBase="row-reporting" t={t} rules={rules} onCancel={onCancel} onConfirm={onConfirm} />);
  const dialog = within(screen.getByRole("dialog", { name: "Turn off Reporting?" }));
  expect(dialog.getByRole("button", { name: "Turn off" })).toHaveAttribute("data-agent-element", "row-reporting-remove-confirm");
  expect(dialog.getByText(/This package ships with Acme/)).toBeVisible();
  expect(dialog.queryByText(/Other enabled plugins rely on it/)).toBeNull();
  await user.keyboard("{ArrowDown}");
  expect(onCancel).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledExactlyOnceWith();
  expect(onConfirm).not.toHaveBeenCalled();
  view.unmount();
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("discloses site-wide trash impact and dispatches the named trash action only on confirm", async () => {
  const cancel = vi.fn();
  const confirm = vi.fn();
  const user = userEvent.setup();
  renderWithAdminKit(<PluginRemoveConfirmDialog name="Index Sync" t={t} rules={rules} agentHandleBase="row-index"
    onCancel={cancel} onConfirm={confirm} />);
  const dialog = within(screen.getByRole("dialog", { name: 'Move "Index Sync" to trash?' }));
  expect(dialog.getByText("This removes it for all workspaces on this site. You can restore it from the Trash for 60 days.")).toBeVisible();
  expect(dialog.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(cancel).toHaveBeenCalledExactlyOnceWith();
  expect(confirm).not.toHaveBeenCalled();
  const action = dialog.getByRole("button", { name: "Move to trash" });
  expect(action).toHaveAttribute("data-agent-element", "row-index-remove-confirm");
  await user.click(action);
  expect(confirm).toHaveBeenCalledTimes(1);
});

const field: AdminPluginProviderSettingField = { name: "address", label: "Endpoint", secret: false, saved: false, required: false };
function Field({ field: spec, initial = "", onWrite }: { field: AdminPluginProviderSettingField; initial?: string; onWrite?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <ProviderSettingField field={spec} t={t} value={value} onChange={(next) => { setValue(next); onWrite?.(next); }}
    id="provider-endpoint" handle="row-provider-endpoint" pluginName="Endpoint Provider" />;
}

it("offers custom editing only when declared, and sends actual text rather than the custom sentinel", async () => {
  const onWrite = vi.fn();
  const options = [{ value: "https://us.example.test", label: "US" }, { value: "https://eu.example.test", label: "EU" }];
  const user = userEvent.setup();
  renderWithAdminKit(<Field field={{ ...field, options, allowCustom: true, hint: "Where requests go", required: true }} onWrite={onWrite} />);
  const select = screen.getByRole("combobox", { name: "Endpoint" });
  expect(select).toHaveValue("");
  expect(select).toHaveAccessibleDescription("Where requests go");
  expect(select).toHaveAttribute("aria-required", "true");
  expect(screen.getByRole("option", { name: "—" })).toBeVisible();
  await user.selectOptions(select, screen.getByRole("option", { name: "EU" }));
  expect(select).toHaveValue("https://eu.example.test");
  expect(screen.queryByRole("option", { name: "—" })).toBeNull();
  expect(onWrite).toHaveBeenLastCalledWith("https://eu.example.test");
  await user.selectOptions(select, screen.getByRole("option", { name: "Custom…" }));
  const custom = screen.getByRole("textbox", { name: "Custom Endpoint" });
  expect(custom).toHaveValue("");
  expect(onWrite).toHaveBeenLastCalledWith("");
  await user.type(custom, "https://private.example.test");
  expect(custom).toHaveValue("https://private.example.test");
  expect(onWrite).toHaveBeenLastCalledWith("https://private.example.test");
  await user.selectOptions(select, screen.getByRole("option", { name: "US" }));
  expect(screen.queryByRole("textbox", { name: "Custom Endpoint" })).toBeNull();
  expect(onWrite).toHaveBeenLastCalledWith("https://us.example.test");
});

it("opens a persisted custom choice and does not add a custom option to fixed choices", () => {
  const options = [{ value: "west", label: "West" }];
  renderWithAdminKit(<Field field={{ ...field, options, allowCustom: true }} initial="https://old.example.test" />);
  expect(screen.getByRole("textbox", { name: "Custom Endpoint" })).toHaveValue("https://old.example.test");
  cleanup();
  renderWithAdminKit(<Field field={{ ...field, options }} initial="west" />);
  expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveValue("west");
  expect(screen.queryByRole("option", { name: "Custom…" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Custom Endpoint" })).toBeNull();
});

it("uses plain text for nonsecret values and masks new and saved tokens without requiring saved ones", async () => {
  const user = userEvent.setup();
  renderWithAdminKit(<Field field={field} />);
  const input = screen.getByRole("textbox", { name: "Endpoint" });
  expect(input).toHaveAttribute("autocomplete", "off");
  expect(input).not.toHaveAttribute("aria-describedby");
  await user.type(input, "lab");
  expect(input).toHaveValue("lab");
  cleanup();
  renderWithAdminKit(<Field field={{ ...field, label: "Access token", secret: true, required: true }} />);
  const fresh = screen.getByLabelText("Access token");
  expect(fresh).toHaveAttribute("type", "password");
  expect(fresh).toHaveAttribute("aria-required", "true");
  expect(fresh).toHaveAttribute("placeholder", "");
  cleanup();
  renderWithAdminKit(<Field field={{ ...field, label: "Access token", secret: true, required: true, saved: true }} />);
  const saved = screen.getByLabelText("Access token");
  expect(saved).toHaveAttribute("type", "password");
  expect(saved).toHaveAttribute("autocomplete", "new-password");
  expect(saved).toHaveAttribute("placeholder", "Saved — leave blank to keep");
  expect(saved).not.toHaveAttribute("aria-required");
});

it("provides an empty choice model for a declaration without options", () => {
  const onChange = vi.fn();
  const { result } = renderHook(() => usePluginProviderChoice({ field, value: "west", onChange }));
  expect(result.current.options).toEqual([]);
  expect(result.current.listed).toBe(false);
  expect(result.current.custom).toBe(false);
  act(() => result.current.choose({ next: "east" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith("east");
});

it("does not promise that turning off a package hides its row from Installed", () => {
  // Installed was broadened to include every downloaded package, even after turning it off.
  renderWithAdminKit(<AgentPluginDisableConfirmDialog name="Reporting" variant="remove"
    agentHandleBase="row-reporting" t={t} rules={rules} onCancel={vi.fn()} onConfirm={vi.fn()} />);
  const dialog = within(screen.getByRole("dialog", { name: "Turn off Reporting?" }));
  expect(dialog.getByText(/skills stop reaching the assistant on the next run/)).toBeVisible();
  expect(dialog.getByText(/can be enabled again any time/)).toBeVisible();
  expect(dialog.queryByText(/drops off the Installed tab/)).toBeNull();
});

it("passes only the supplied confirmation inputs when no origin, dependents or translator were bound", () => {
  const build = vi.fn<typeof rules.buildAgentPluginDisableConfirmCopy>(rules.buildAgentPluginDisableConfirmCopy);
  const onCancel = vi.fn();
  function Probe() {
    const confirmation = useAgentPluginDisableConfirm({ name: "Reporting", variant: "disable", onCancel, rules: { buildAgentPluginDisableConfirmCopy: build } });
    return <div ref={confirmation.dialogRef}>{confirmation.copy.title}</div>;
  }
  renderWithAdminKit(<Probe />);
  expect(screen.getByText("Disable Reporting for this site?")).toBeVisible();
  expect(build).toHaveBeenCalledExactlyOnceWith({ name: "Reporting", variant: "disable" }, {});
});
