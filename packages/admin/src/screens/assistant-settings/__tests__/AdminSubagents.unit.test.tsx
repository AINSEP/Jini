// @vitest-environment jsdom
import { render, screen } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { InfoTipProps } from "../../../react/kit.js";
import { AdminSubagents } from "../AdminSubagents.js";
import type { AdminSubagentsController, AdminSubagentsSettings } from "../admin-subagents.types.js";

/**
 * @file The Full CLI access screen's contract with its host: it renders the injected controller's
 * server grant, locks the switch for non-owners, env locks, load errors and in-flight saves, asks the
 * controller for the NEW value, and shows the host's copy. The host's grant policy is tested there.
 */
function FakeInfoTip({ label, triggerLabel }: InfoTipProps) {
  return <button type="button" aria-label={triggerLabel} title={label}>i</button>;
}
const COPY = { info: "Master explainer.", toolSourcesHint: "Engine and plugin tools.", agentMcpInfo: ({ name }: { name: string }) => `Loads ${name}'s servers.` };
const OWNER: AdminSubagentsSettings = { enabled: true, canEdit: true, capabilities: { userMcp: true },
  agents: [{ id: "claude", name: "Claude Code" }, { id: "codex", name: "Codex" }], byAgent: { codex: { capabilities: { userMcp: false } } } };
function controller(overrides: Partial<AdminSubagentsController> = {}): AdminSubagentsController {
  return { settings: OWNER, loadError: null, saveError: null, busy: false, dialog: { open: false, title: "", body: "", confirmLabel: "", onConfirm: vi.fn(), onCancel: vi.fn() },
    setEnabled: vi.fn(async () => {}), setAgentMcp: vi.fn(async () => {}), ...overrides };
}
const t = (key: string) => key;
function mount(c: AdminSubagentsController, translate = t) {
  return render(<AdminSubagents t={translate} InfoTip={FakeInfoTip} copy={COPY} useAdminSubagentsHook={() => c} />);
}
const master = () => screen.getByRole("checkbox", { name: "Full CLI access" });

describe("AdminSubagents", () => {
  it("shows the server grant, the per-agent MCP choices (an agent's own value wins) and the host copy", () => {
    mount(controller());
    expect(master()).toBeChecked(); expect(master()).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Also use Claude Code's personal MCP servers." })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Also use Codex's personal MCP servers." })).not.toBeChecked();
    expect(screen.getByText(COPY.toolSourcesHint)).toBeTruthy();
    expect(screen.getByRole("button", { name: "More info: Full CLI access" }).getAttribute("title")).toBe(COPY.info);
  });
  it("asks the controller for the new values", async () => {
    const c = controller(); mount(c);
    await userEvent.click(master());
    expect(c.setEnabled).toHaveBeenCalledWith({ enabled: false });
    await userEvent.click(screen.getByRole("checkbox", { name: "Also use Codex's personal MCP servers." }));
    expect(c.setAgentMcp).toHaveBeenCalledWith({ agentId: "codex", enabled: true });
  });
  it("locks the switch for a non-owner with the owner-only note", () => {
    mount(controller({ settings: { ...OWNER, canEdit: false } }));
    expect(master()).toBeDisabled();
    expect(master().getAttribute("aria-describedby")?.split(" ")).toContain(screen.getByText("Only the owner can change Full CLI access.").id);
  });
  it("locks the owner's switch with the server's env-lock reason", () => {
    mount(controller({ settings: { ...OWNER, unavailableReason: "Locked by environment." } }));
    expect(master()).toBeDisabled();
    expect(master().getAttribute("aria-describedby")?.split(" ")).toContain(screen.getByText("Locked by environment.").id);
  });
  it("locks while saving and after a load error", () => {
    const { unmount } = mount(controller({ busy: true }));
    expect(master()).toBeDisabled(); unmount();
    mount(controller({ loadError: "grant unavailable" }));
    expect(master()).toBeDisabled();
  });
  it("shows the loading status until the grant arrives", () => {
    mount(controller({ settings: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading Full CLI access…");
    expect(master()).not.toBeChecked(); expect(master()).toBeDisabled();
  });
});

it("defaults the personal MCP setting off when neither the agent nor server supplied a grant", () => {
  mount(controller({ settings: { enabled: false, canEdit: true, agents: [{ id: "claude", name: "Claude Code" }] } }));
  expect(master()).not.toBeChecked();
  expect(master()).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "Also use Claude Code's personal MCP servers." })).not.toBeChecked();
});
