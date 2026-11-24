// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { InfoTipProps } from "../../../react/kit.js";
import { useConfirmRequest } from "../../../react/index.js";
import { AdminPermanentDeletes } from "../AdminPermanentDeletes.js";
import { useAdminPermanentDeletes, type PermanentDeletesPolicy, type PermanentDeletesSettings } from "../use-admin-permanent-deletes.hooks.js";
import type { OwnerGrantDependencies, SiteGrantPort } from "../use-assistant-owner-grant.hooks.js";
import { publishSettingsRefresh, subscribeToSettingsRefresh } from "../../../shell/lib/settings-refresh-bus.js";

/**
 * @file The permanent-deletes owner grant against a fixture policy (the host's real 13-tool list and
 * its canonical admin destinations are pinned by the host's own wiring test): consent before enable,
 * autosaving checklist, owner-only lock, server-truth on failure and refresh on another tab's revoke.
 */
type AssistantPermanentDeletesSettings = PermanentDeletesSettings;
type AssistantPermanentDeletesPort = SiteGrantPort<PermanentDeletesSettings>;
const PERMANENT_DELETE_TOOLS = [
  { id: "trash_empty", group: "Content purges", label: "Delete every item in Trash forever", adminPath: "/admin/trash" },
  { id: "media_purge", group: "Content purges", label: "Delete one media file forever", adminPath: "/admin/media" },
  { id: "secret_unset", group: "Settings deletes", label: "Remove a deployment secret", adminPath: null },
] as const;
const PERMANENT_DELETE_DANGERS = ["Deleted items cannot be recovered.", "The agent can remove settings."] as const;
const ASSISTANT_PERMANENT_DELETES_NAMESPACE = "test.permanent-deletes";
const POLICY: PermanentDeletesPolicy = {
  namespace: ASSISTANT_PERMANENT_DELETES_NAMESPACE, key: ["test", "permanent-deletes"], tools: PERMANENT_DELETE_TOOLS,
  groupLabels: ["Content purges", "Settings deletes"], title: "Allow permanent deletes from chat?", dangers: PERMANENT_DELETE_DANGERS,
  confirmLabel: "Allow permanent deletes", failure: "failed to save permanent delete access",
};
const DEPS: OwnerGrantDependencies = {
  useConfirmation: useConfirmRequest, refresh: { subscribe: subscribeToSettingsRefresh, publish: publishSettingsRefresh },
  describeError: ({ error, fallback }) => error instanceof Error ? error.message : fallback,
};
const COPY = { info: "Off by default.", noAdminScreen: "No admin screen for this operation." };
function FakeInfoTip({ label, triggerLabel }: InfoTipProps) {
  return <button type="button" aria-label={triggerLabel} title={label}>i</button>;
}
const bind = (port: AssistantPermanentDeletesPort, t?: (key: string) => string) => useAdminPermanentDeletes({ ...DEPS, ...POLICY, port, ...(t ? { t } : {}) });
function fakePort(initial: AssistantPermanentDeletesSettings = { enabled: false, allowedToolIds: [], canEdit: true }) {
  let settings = structuredClone(initial), failure: Error | null = null;
  const writes: Parameters<AssistantPermanentDeletesPort["write"]>[0][] = [];
  const port: AssistantPermanentDeletesPort = {
    read: async () => structuredClone(settings),
    write: async input => { writes.push(structuredClone(input)); if (failure) throw failure; settings = { ...settings, enabled: input.enabled, allowedToolIds: [...input.allowedToolIds] }; return structuredClone(settings); },
  };
  return { port, writes, fail: (message: string) => { failure = new Error(message); }, changeElsewhere: () => { settings.enabled = false; } };
}
const toggle = () => screen.getByRole("checkbox", { name: "Allow permanent deletes from chat" });
const ready = () => waitFor(() => expect(toggle()).toBeEnabled());
function mount(port: AssistantPermanentDeletesPort) { return render(<AdminPermanentDeletes t={key => key} InfoTip={FakeInfoTip} copy={COPY} useAdminPermanentDeletesHook={input => bind(port, input.t)} />); }
describe("owner permanent deletes opt-in", () => {
  it("defaults OFF; names every danger; Escape cancels and returns focus without saving", async () => {
    const f = fakePort(), user = userEvent.setup(); mount(f.port); await ready();
    expect(toggle()).not.toBeChecked(); expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
    await user.click(toggle());
    const dialog = screen.getByRole("dialog", { name: "Allow permanent deletes from chat?" });
    for (const danger of PERMANENT_DELETE_DANGERS) expect(within(dialog).getByText(danger)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Allow permanent deletes" })).not.toHaveAttribute("data-agent-handle");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    await ready(); expect(toggle()).not.toBeChecked(); expect(toggle()).toHaveFocus(); expect(f.writes).toEqual([]);
  });
  it("confirmed enable shows the tool groups; checkboxes/select all/select none autosave; OFF keeps the list", async () => {
    const f = fakePort(), user = userEvent.setup(); mount(f.port); await ready(); await user.click(toggle());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Allow permanent deletes" }));
    await waitFor(() => expect(toggle()).toBeChecked());
    expect(f.writes[0]).toEqual({ enabled: true, allowedToolIds: [], riskAcknowledged: true });
    expect(screen.getAllByRole("checkbox")).toHaveLength(PERMANENT_DELETE_TOOLS.length + 1);
    expect(screen.getByRole("group", { name: "Content purges" })).toBeVisible(); expect(screen.getByRole("group", { name: "Settings deletes" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: PERMANENT_DELETE_TOOLS[0].label }));
    await waitFor(() => expect(f.writes.at(-1)).toEqual({ enabled: true, allowedToolIds: ["trash_empty"], riskAcknowledged: false }));
    await ready(); await user.click(screen.getByRole("button", { name: "Select all" }));
    await waitFor(() => expect(f.writes.at(-1)?.allowedToolIds).toEqual(PERMANENT_DELETE_TOOLS.map(tool => tool.id)));
    await ready(); await user.click(screen.getByRole("button", { name: "Select none" }));
    await waitFor(() => expect(f.writes.at(-1)?.allowedToolIds).toEqual([]));
    await ready(); await user.click(screen.getByRole("checkbox", { name: PERMANENT_DELETE_TOOLS[0].label }));
    await waitFor(() => expect(f.writes.at(-1)?.allowedToolIds).toEqual(["trash_empty"]));
    await ready(); await user.click(toggle());
    await waitFor(() => expect(toggle()).not.toBeChecked());
    expect(f.writes.at(-1)).toEqual({ enabled: false, allowedToolIds: ["trash_empty"], riskAcknowledged: false });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
  it("non-owner sees the disabled grant and checklist with a reason, and cannot write", async () => {
    const f = fakePort({ enabled: true, allowedToolIds: ["trash_empty"], canEdit: false }); mount(f.port);
    await waitFor(() => expect(screen.getByText("Only the owner can change permanent delete access.")).toBeVisible());
    expect(toggle()).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select none" })).toBeDisabled(); expect(f.writes).toEqual([]);
  });
  it("failed autosave keeps server truth and displays the real error; external revoke refreshes the master", async () => {
    const f = fakePort({ enabled: true, allowedToolIds: [], canEdit: true }), user = userEvent.setup(); mount(f.port); await ready();
    f.fail("principal is not authorized for permanent delete access");
    await user.click(screen.getByRole("checkbox", { name: PERMANENT_DELETE_TOOLS[0].label }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("principal is not authorized for permanent delete access"));
    expect(screen.getByRole("checkbox", { name: PERMANENT_DELETE_TOOLS[0].label })).not.toBeChecked();
    f.changeElsewhere(); act(() => publishSettingsRefresh([ASSISTANT_PERMANENT_DELETES_NAMESPACE]));
    await waitFor(() => expect(toggle()).not.toBeChecked());
  });
  it("uses the canonical admin destinations and does not invent a secret-removal screen", async () => {
    const f = fakePort({ enabled: true, allowedToolIds: [], canEdit: true }); mount(f.port); await ready();
    const links = screen.getAllByRole("link", { name: "Open admin screen" });
    expect(links.map(link => link.getAttribute("href"))).toEqual(PERMANENT_DELETE_TOOLS.flatMap(tool => tool.adminPath ? [tool.adminPath] : []));
    expect(screen.getByText(COPY.noAdminScreen)).toBeVisible();
  });
  it("supports keyboard activation through native checkbox and dialog controls", async () => {
    const f = fakePort(), user = userEvent.setup(); mount(f.port); await ready();
    toggle().focus(); await user.keyboard(" "); expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Enter}"); await ready(); expect(toggle()).not.toBeChecked(); expect(f.writes).toEqual([]);
  });
});

it("translates the save fallback while preserving real API errors", async () => {
  const f = fakePort({ enabled: true, allowedToolIds: [], canEdit: true });
  const port: AssistantPermanentDeletesPort = { ...f.port, write: async () => { throw null; } };
  render(<AdminPermanentDeletes t={key => key === "failed to save permanent delete access" ? "no se pudo guardar el acceso a eliminaciones permanentes" : key}
    InfoTip={FakeInfoTip} copy={COPY} useAdminPermanentDeletesHook={input => bind(port, input.t)} />);
  await ready();
  await userEvent.click(screen.getByRole("checkbox", { name: PERMANENT_DELETE_TOOLS[0].label }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no se pudo guardar el acceso a eliminaciones permanentes"));
  expect(screen.getByRole("checkbox", { name: PERMANENT_DELETE_TOOLS[0].label })).not.toBeChecked();
});

it("unchanged enable requests do not write or ask for confirmation", async () => {
  const f = fakePort();
  const { result } = renderHook(() => bind(f.port));
  await waitFor(() => expect(result.current.settings?.enabled).toBe(false));
  await act(async () => { await result.current.setEnabled({ enabled: false }, {}); });
  expect(f.writes).toEqual([]);
  expect(result.current.dialog.open).toBe(false);
  expect(result.current.settings).toEqual({ enabled: false, allowedToolIds: [], canEdit: true });
});

it("checklist commands preserve the stored selection while the master is off", async () => {
  const f = fakePort({ enabled: false, allowedToolIds: ["trash_empty"], canEdit: true });
  const { result } = renderHook(() => bind(f.port));
  await waitFor(() => expect(result.current.settings?.enabled).toBe(false));
  await act(async () => {
    await result.current.setTool({ toolId: "trash_empty", checked: false }, {});
    await result.current.selectAll({}, {});
    await result.current.selectNone({}, {});
  });
  expect(f.writes).toEqual([]);
  expect(result.current.settings?.allowedToolIds).toEqual(["trash_empty"]);
});

it("unchecking one tool preserves the other tools and checking an existing tool does not duplicate it", async () => {
  const secondId = PERMANENT_DELETE_TOOLS[1].id;
  const f = fakePort({ enabled: true, allowedToolIds: ["trash_empty", secondId], canEdit: true });
  const { result } = renderHook(() => bind(f.port));
  await waitFor(() => expect(result.current.settings?.enabled).toBe(true));
  await act(async () => { await result.current.setTool({ toolId: "trash_empty", checked: true }); });
  expect(f.writes).toEqual([{ enabled: true, allowedToolIds: ["trash_empty", secondId], riskAcknowledged: false }]);
  await act(async () => { await result.current.setTool({ toolId: "trash_empty", checked: false }); });
  expect(f.writes.at(-1)).toEqual({ enabled: true, allowedToolIds: [secondId], riskAcknowledged: false });
  expect(result.current.settings?.allowedToolIds).toEqual([secondId]);
});

it("checklist commands are inert before settings load", async () => {
  let resolveRead!: (settings: AssistantPermanentDeletesSettings) => void;
  const pending = new Promise<AssistantPermanentDeletesSettings>(resolve => { resolveRead = resolve; });
  const f = fakePort();
  const port: AssistantPermanentDeletesPort = { ...f.port, read: () => pending };
  const { result } = renderHook(() => bind(port));
  expect(result.current.settings).toBeNull();
  await act(async () => {
    await result.current.setTool({ toolId: "trash_empty", checked: true });
    await result.current.selectAll({});
    await result.current.selectNone({});
    await result.current.setEnabled({ enabled: false });
  });
  expect(f.writes).toEqual([]);
  await act(async () => { resolveRead({ enabled: false, allowedToolIds: [], canEdit: true }); });
  await waitFor(() => expect(result.current.settings?.enabled).toBe(false));
});

it("a read failure shows the actual error, disables the master and drops the loading status", async () => {
  const f = fakePort();
  mount({ ...f.port, read: async () => { throw new Error("permanent delete settings are unavailable"); } });
  expect(await screen.findByRole("alert")).toHaveTextContent("permanent delete settings are unavailable");
  expect(toggle()).toBeDisabled();
  expect(screen.queryByText("Loading permanent delete settings…")).toBeNull();
});

it("shows the loading status until the grant arrives", () => {
  const f = fakePort();
  mount({ ...f.port, read: () => new Promise<AssistantPermanentDeletesSettings>(() => {}) });
  expect(screen.getByRole("status")).toHaveTextContent("Loading permanent delete settings…");
  expect(toggle()).toBeDisabled();
});

it("keeps the master enabled while consent is open, then disables master and checklist while saving", async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const f = fakePort({ enabled: true, allowedToolIds: [], canEdit: true });
  const port: AssistantPermanentDeletesPort = { ...f.port, write: async input => { await hold; return f.port.write(input); } };
  const user = userEvent.setup(); mount(port); await ready();
  await user.click(screen.getByRole("checkbox", { name: PERMANENT_DELETE_TOOLS[0].label }));
  await waitFor(() => expect(screen.getByText("Waiting for confirmation or saving…")).toBeVisible());
  expect(toggle()).toBeDisabled();
  expect(screen.getByRole("group", { name: "Allowed permanent deletes" })).toBeDisabled();
  await act(async () => { release(); });
  await ready();
  expect(screen.queryByText("Waiting for confirmation or saving…")).toBeNull();
});

it("keeps the master focusable while the enable consent dialog is open", async () => {
  const f = fakePort(), user = userEvent.setup(); mount(f.port); await ready();
  await user.click(toggle());
  expect(screen.getByRole("dialog", { name: "Allow permanent deletes from chat?" })).toBeVisible();
  expect(screen.getByText("Waiting for confirmation or saving…")).toBeVisible();
  expect(toggle()).toBeEnabled();
});
