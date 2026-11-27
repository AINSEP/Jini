// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { useCopyToClipboard } from "@jini-ai/ui";
import type { ToolGapEntry } from "@jini-ai/core/contracts/site/daemon-tool-audit";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { createFakeRecentServerErrorsPort } from "../hooks/recent-server-errors-dependencies.hooks.js";
import { useRecentErrorItem } from "../hooks/use-recent-error-item.hooks.js";
import type { RecentServerErrorRow, RecentServerErrorsController } from "../hooks/use-recent-server-errors.hooks.js";
import { QueriesPanel, type QueryCachePanel } from "../queries-panel.js";
import { RecentErrorsPanel, type RecentErrorItemDependencies } from "../recent-errors-panel.js";
import { ToolGapsPanel } from "../tool-gaps-panel.js";

afterEach(cleanup);
const t = (key: string) => key;
const kit = fakeAdminKit({ query: { useFetchQuery } });
function wrapper({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={kit}><FetchQueryProvider>{children}</FetchQueryProvider></AdminKitProvider>;
}
function useItem(deps: RecentErrorItemDependencies) {
  return useRecentErrorItem({ ...deps, useCopyToClipboardHook: useCopyToClipboard });
}
const emptyLogs = { entries: [], matched: 0, buffered: 0, truncated: false, capturing: true };
const path = "/home/dev/site/packages/search/read.ts:8:2";
const repeated: RecentServerErrorRow = {
  key: "index", source: "daemon", scope: "queue", summary: "index failed",
  when: "Oct 8, 4:00 PM", at: "2026-10-08T16:00:00Z",
  firstWhen: "Oct 8, 3:00 PM", firstAt: "2026-10-08T15:00:00Z", count: 2,
  message: `Cannot read ${path}`, copyText: `Message:\nCannot read ${path}`,
  segments: [{ text: "Cannot read " }, { text: "packages/search/read.ts:8:2", fullPath: path }],
};
const single: RecentServerErrorRow = {
  ...repeated, key: "empty", source: "server", scope: null, summary: "", count: 1,
  firstAt: null, firstWhen: null, message: "", segments: [], copyText: "Message:\n",
};

it("shows a lazy cache loading state and makes only the production panel inert", async () => {
  const click = vi.fn();
  const LivePanel: QueryCachePanel = ({ theme, style }) => <button type="button" style={style} onClick={() => click()}>{theme} cache</button>;
  let settle!: (result: { default: QueryCachePanel }) => void;
  const Panel = lazy(() => new Promise<{ default: QueryCachePanel }>((resolve) => { settle = resolve; }));
  const view = render(<QueriesPanel readOnly t={t} Panel={Panel} />);
  const region = screen.getByRole("region", { name: "Queries" });
  expect(within(region).getByRole("status")).toHaveTextContent("Loading queries…");
  expect(within(region).getByText("Live cache overview. Interaction is disabled in production.")).toBeVisible();
  await act(async () => settle({ default: LivePanel }));
  const control = within(region).getByText("light cache");
  expect(control).toHaveStyle({ width: "100%" });
  expect(control.parentElement).toHaveAttribute("inert");
  view.rerender(<QueriesPanel readOnly={false} t={t} Panel={Panel} />);
  expect(within(region).queryByText("Live cache overview. Interaction is disabled in production.")).toBeNull();
  expect(control.parentElement).not.toHaveAttribute("inert");
  await userEvent.setup().click(within(region).getByRole("button", { name: "light cache" }));
  expect(click).toHaveBeenCalledExactlyOnceWith();
});

it("distinguishes initial loading, read failure, capture off and a successful empty capture", async () => {
  const refresh = vi.fn();
  let controller: RecentServerErrorsController = { rows: [], logs: null, loading: true, error: null, refresh, clipboard: createFakeRecentServerErrorsPort(), t };
  const useList = () => controller;
  const panel = () => <RecentErrorsPanel useRecentServerErrorsHook={useList} useRecentErrorItemHook={useItem} />;
  const view = render(panel());
  const region = screen.getByRole("region", { name: "Recent server errors" });
  const reload = within(region).getByRole("button", { name: "Refresh" });
  expect(reload).toBeDisabled();
  expect(within(region).getByRole("status")).toHaveTextContent("Loading recent errors…");
  controller = { ...controller, loading: false, error: "Log access refused" };
  view.rerender(panel());
  expect(within(region).getByRole("alert")).toHaveTextContent("Log access refused");
  await userEvent.setup().click(reload);
  expect(refresh).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "click" }));

  controller = { ...controller, error: null, logs: { ...emptyLogs, capturing: false } };
  view.rerender(panel());
  expect(within(region).getByRole("note")).toHaveTextContent("Restart the site to start recording.");
  expect(within(region).queryByText("No errors recorded.")).toBeNull();
  controller = { ...controller, logs: emptyLogs };
  view.rerender(panel());
  expect(within(region).getByRole("status")).toHaveTextContent("No errors recorded.");
  expect(within(region).queryByRole("list")).toBeNull();
  expect(within(region).queryByRole("alert")).toBeNull();
});

it("keeps cached rows during refresh and discloses and copies only the chosen error", async () => {
  const clipboard = createFakeRecentServerErrorsPort();
  const renderList = () => ({ rows: [repeated, single], logs: { ...emptyLogs, truncated: true }, loading: true, error: null, refresh: vi.fn(), clipboard, t });
  render(<RecentErrorsPanel useRecentServerErrorsHook={renderList} useRecentErrorItemHook={useItem} />);
  expect(screen.getByText("Showing the newest 50 errors.")).toBeVisible();
  expect(screen.queryByText("Loading recent errors…")).toBeNull();
  const user = userEvent.setup();
  const list = within(screen.getByRole("list"));
  const toggle = list.getByRole("button", { name: /index failed/ });
  const lone = list.getByRole("button", { name: /\(empty message\)/ });
  expect(lone).not.toHaveTextContent("×");
  const item = within(toggle.closest("li")!);
  expect(item.getByText("assistant")).toBeVisible();
  expect(item.getByText("queue")).toBeVisible();
  expect(item.getByTitle("Times this error occurred: 2")).toHaveTextContent("×2");
  expect(within(lone.closest("li")!).getByText("server")).toBeVisible();
  const detail = document.getElementById(toggle.getAttribute("aria-controls")!);
  expect(detail).toHaveAttribute("hidden");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(lone).toHaveAttribute("aria-expanded", "false");
  expect(detail).toBeVisible();
  expect(item.getByText("Oct 8, 3:00 PM")).toHaveAttribute("datetime", "2026-10-08T15:00:00Z");
  expect(item.getByTitle(path)).toHaveTextContent("packages/search/read.ts:8:2");
  expect(detail).toHaveTextContent("Cannot read packages/search/read.ts:8:2");
  await user.click(item.getByRole("button", { name: "Copy" }));
  expect(await item.findByRole("button", { name: "Copied" })).toBeVisible();
  expect(clipboard.copied).toEqual([`Message:\nCannot read ${path}`]);
  expect(within(lone.closest("li")!).getByRole("button", { name: "Copy" })).toBeVisible();
  await user.click(toggle);
  expect(detail).toHaveAttribute("hidden");
});

it("loads tool-gap metadata, shows failure on refresh, then shows an empty recovery", async () => {
  const gap: ToolGapEntry = {
    type: "tool_gap", id: "gap1", at: "2026-10-09T02:00:00Z", site: "docs", chatId: "thread-7",
    runId: "run-3", provider: "agent-a", toolUsed: "Bash", summary: "redacted command", gapLine: "No shell capability selected",
  };
  const entries: ToolGapEntry[] = [
    gap,
    { ...gap, id: "gap2", toolUsed: "Edit", summary: "metadata only", gapLine: null },
    { ...gap, id: "use3", type: "native_tool_used", toolUsed: "Patch", summary: "native action", gapLine: "must not show on native use" },
  ];
  let resolve!: (result: { entries: ToolGapEntry[] }) => void;
  const read = vi.fn(async () => ({ entries: [] as ToolGapEntry[] }))
    .mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockRejectedValueOnce(new Error("Projection expired"));
  render(<ToolGapsPanel t={t} read={read} />, { wrapper });
  const panel = within(screen.getByRole("region", { name: "Tool gaps" }));
  const button = panel.getByRole("button", { name: "Refresh" });
  expect(button).toBeDisabled();
  expect(panel.getByRole("status")).toHaveTextContent("Loading…");
  await act(async () => resolve({ entries }));
  const bash = within(panel.getByText("redacted command").closest("article")!);
  expect(bash.getByText(gap.at)).toHaveAttribute("datetime", gap.at);
  expect(bash.getByText("docs · Chat: thread-7")).toBeVisible();
  expect(bash.getByText(/agent-a · Bash · Tool gap/)).toBeVisible();
  expect(bash.getByText("No shell capability selected")).toBeVisible();
  const edit = within(panel.getByText("metadata only").closest("article")!);
  expect(edit.getByText("No Tool gap explanation was provided.")).toBeVisible();
  const native = within(panel.getByText("native action").closest("article")!);
  expect(native.getByText("Native tool used")).toBeVisible();
  expect(native.queryByText("must not show on native use")).toBeNull();

  const user = userEvent.setup();
  await user.click(button);
  expect(await panel.findByRole("alert")).toHaveTextContent("Projection expired");
  await user.click(button);
  expect(await panel.findByText("No tool gaps recorded.")).toBeVisible();
  expect(panel.queryByRole("alert")).toBeNull();
  expect(panel.queryByRole("article")).toBeNull();
  expect(read.mock.calls).toEqual([[], [], []]);
});
