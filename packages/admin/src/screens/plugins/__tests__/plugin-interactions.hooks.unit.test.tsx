// @vitest-environment jsdom
import { act, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoTip, useInfoTip } from "@jini-ai/ui/admin-widgets";
import { useFocusTrap } from "@jini-ai/ui/panel-kit";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { PluginRemoveConfirmDialog } from "../PluginRemoveConfirmDialog.js";
import { useAgentPluginTab } from "../hooks/use-agent-plugin-tab.hooks.js";
import { linkedLockTip } from "../hooks/use-linked-lock-tip.hooks.js";
import { usePluginRemoveConfirm } from "../hooks/use-plugin-remove-confirm.hooks.js";
import { usePluginRowFocus } from "../hooks/use-plugin-row-focus.hooks.js";
import { makeRules } from "./plugin-rules-fixture.js";

it("follows URL tab changes and replaces history with only supported agent-plugin tabs", () => {
  const state = history.state;
  const url = window.location.href;
  try {
    history.replaceState(null, "", "/admin/addons/agent-plugins?tab=downloaded");
    const length = history.length;
    const { result, rerender } = renderHook(({ tabId }: { tabId: string | null }) => useAgentPluginTab({ tabId }), {
      initialProps: { tabId: "downloaded" as string | null },
    });
    expect(result.current.activeTabId).toBe("downloaded");
    act(() => result.current.onActiveTabIdChange("add"));
    expect(result.current.activeTabId).toBe("add");
    expect(location.pathname + location.search).toBe("/admin/addons/agent-plugins?tab=add");
    expect(history.length).toBe(length);
    rerender({ tabId: "marketplace" });
    expect(result.current.activeTabId).toBe("marketplace");
    rerender({ tabId: null });
    expect(result.current.activeTabId).toBe("installed");
    rerender({ tabId: "downloaded" });
    act(() => result.current.onActiveTabIdChange("typo"));
    expect(result.current.activeTabId).toBe("installed");
    expect(location.pathname + location.search).toBe("/admin/addons/agent-plugins?tab=installed");
    expect(history.length).toBe(length);
  } finally {
    history.replaceState(state, "", url);
  }
});

const kit = fakeAdminKit({ hooks: { useInfoTip, useFocusTrap } });
const wrapper = ({ children }: PropsWithChildren) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
function mountLock() {
  const onFollow = vi.fn<() => void>();
  const useTip = linkedLockTip({ onFollow });
  renderWithAdminKit(<InfoTip label="Controlled on the Plugins page" useTip={useTip} />, { kit });
  return { onFollow, trigger: screen.getByRole("button", { name: "Controlled on the Plugins page" }) };
}

it("explains the lock on hover, dismisses it with Escape and follows only on activation", async () => {
  const user = userEvent.setup();
  const { trigger, onFollow } = mountLock();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.hover(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(onFollow).not.toHaveBeenCalled();
  await user.tab();
  expect(trigger).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
  expect(onFollow).not.toHaveBeenCalled();
  await user.keyboard("{Enter} ");
  await user.click(trigger);
  expect(onFollow.mock.calls).toEqual([[], [], []]);
});

it("uses the tip state at pointer-down so the first touch explains and the second follows", async () => {
  const user = userEvent.setup();
  const { trigger, onFollow } = mountLock();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.pointer({ keys: "[TouchA]", target: trigger });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(onFollow).not.toHaveBeenCalled();
  await user.pointer({ keys: "[TouchA]", target: trigger });
  expect(onFollow).toHaveBeenCalledExactlyOnceWith();
});

it("traps Tab in the named removal dialog and removes its Escape listener when closed", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn<() => void>();
  const onConfirm = vi.fn<() => void>();
  const translatedBody = "All workspaces are affected. Restore within 60 days.";
  const t = (key: string) => key.startsWith("This removes it") ? translatedBody : key;
  const view = renderWithAdminKit(<>
    <button>Behind dialog</button>
    <PluginRemoveConfirmDialog name="Metrics $&" agentHandleBase="metrics" onCancel={onCancel} onConfirm={onConfirm}
      t={t} rules={makeRules()} />
    <button>After dialog</button>
  </>, { kit });
  const dialog = screen.getByRole("dialog", { name: 'Move "Metrics $&" to trash?' });
  expect(within(dialog).getByText(translatedBody)).toBeInTheDocument();
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  const confirm = within(dialog).getByRole("button", { name: "Move to trash" });
  expect(cancel).toHaveFocus();
  await user.tab({ shift: true });
  expect(confirm).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  expect(onCancel).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledExactlyOnceWith();
  expect(onConfirm).not.toHaveBeenCalled();
  view.unmount();
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("builds unlocalized removal copy when the host omits a translator", () => {
  const { result } = renderHook(() => usePluginRemoveConfirm({ name: "Records", onCancel: vi.fn(), rules: makeRules() }), { wrapper });
  expect(result.current.copy.title).toBe('Move "Records" to trash?');
  expect(result.current.copy.body).toBe("This removes it for all workspaces on this site. You can restore it from the Trash for 60 days.");
});

function FocusRow({ focused, summarySelector }: { focused: boolean; summarySelector: string }) {
  const ref = usePluginRowFocus({ focused, summarySelector });
  return <li ref={ref}><button className="summary">Metrics summary</button><button>Other action</button></li>;
}
it("scrolls and focuses only the deep-linked row's current summary", async () => {
  const user = userEvent.setup();
  const screenRows = (focused: boolean, summarySelector = ".summary") => <><button>Outside</button><ul>
    <li><button className="summary">Unlinked summary</button></li><FocusRow focused={focused} summarySelector={summarySelector} />
  </ul></>;
  const view = renderWithAdminKit(screenRows(false));
  const outside = screen.getByRole("button", { name: "Outside" });
  const summary = screen.getByRole("button", { name: "Metrics summary" });
  const scroll = vi.fn();
  Object.defineProperty(summary.closest("li")!, "scrollIntoView", { value: scroll });
  await user.tab();
  expect(outside).toHaveFocus();
  expect(scroll).not.toHaveBeenCalled();
  view.rerender(<AdminKitProvider kit={kit}>{screenRows(true)}</AdminKitProvider>);
  expect(summary).toHaveFocus();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "center", behavior: "smooth" });
  expect(scroll.mock.contexts).toEqual([summary.closest("li")]);
  await user.click(outside);
  view.rerender(<AdminKitProvider kit={kit}>{screenRows(true, ".absent")}</AdminKitProvider>);
  expect(outside).toHaveFocus();
  expect(scroll).toHaveBeenCalledTimes(2);
});
