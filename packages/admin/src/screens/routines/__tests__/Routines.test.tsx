// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoutineRow, RoutineSchedule } from "@jini-ai/core/contracts/site/routines";
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { projectRoutineRow } from "../project-routine-row.js";
import { useRoutinesController } from "../Routines.hooks.js";
import { createRoutinesApi, RoutinesApiError, type RequestAdminJson, type RoutineDraft, type RoutinesApi } from "../routines-api.js";

import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { DataTable, RowMenu } from "../../../react/index.js";
import { Routines, type RoutinesKit } from "../Routines.js";
import { RoutinesMount } from "../RoutinesMount.js";
import type { RoutinesController } from "../Routines.hooks.js";

afterEach(cleanup);

const row: RoutineRow = {
  id: "routine", name: "Digest", prompt: "Summarize", schedule: { kind: "hourly", minute: 15 },
  target: { mode: "create_each_run" }, skillId: null, agentId: null, model: null, creatorId: "owner", enabled: true,
  nextRunAt: null, revision: 3, createdAt: 1, updatedAt: 2,
  lastRun: { runId: "run", trigger: "scheduled", status: "running", startedAt: 1,
    catchUp: true, approvalState: "waiting", projectId: "project", conversationId: "chat", agentRunId: "agent" },
};

describe("routines", () => {
  it("projects Waiting for approval and Catch-up run together", () => {
    const view = projectRoutineRow({ row, locale: "en", t: createDictionaryTranslator({ featureDictionary: {} }) });
    expect(view.badges).toEqual(["Catch-up run", "Waiting for approval"]);
    expect(view.outcomeLabel).toBe("Running");
  });

  it("reloads a stale revision without retrying the write", async () => {
    const api: RoutinesApi = {
      list: vi.fn().mockResolvedValueOnce({ state: "ready", routines: [row] })
        .mockResolvedValueOnce({ state: "ready", routines: [{ ...row, revision: 9 }] }),
      create: vi.fn(), remove: vi.fn(),
      update: vi.fn().mockRejectedValue(new RoutinesApiError({ message: "Changed", status: 409, reason: "ROUTINE_CHANGED", errorId: null })),
    };
    const focus = { subscribe: () => () => {} };
    const timers = { setInterval: vi.fn(), clearInterval: vi.fn() };
    const { result } = renderHook(() => useRoutinesController({ api, visible: true, focus, timers }));
    await waitFor(() => expect(result.current.view.kind).toBe("ready"));
    await act(async () => { expect(await result.current.setEnabled({ row, enabled: false })).toBe(false); });
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(result.current.notice?.key).toBe("stale");
    expect(result.current.view).toEqual({ kind: "ready", routines: [{ ...row, revision: 9 }] });
  });
});

const t = createDictionaryTranslator({ featureDictionary: {} });

it.each([
  { schedule: { kind: "daily", time: "17:35", timezone: "Europe/Paris" }, label: "Every day at 17:35 (Europe/Paris)" },
  { schedule: { kind: "weekdays", time: "06:20", timezone: "Asia/Tokyo" }, label: "Weekdays at 06:20 (Asia/Tokyo)" },
  { schedule: { kind: "weekly", weekday: 2, time: "21:10", timezone: "UTC" }, label: "Every week on Tuesday at 21:10 (UTC)" },
] satisfies { schedule: RoutineSchedule; label: string }[])("formats calendar schedules with their local time and zone: $label", ({ schedule, label }) => {
  expect(projectRoutineRow({ row: { ...row, schedule }, locale: "en", t }).scheduleLabel).toBe(label);
});

it("preserves unrecognized translation placeholders", () => {
  const translate = createDictionaryTranslator({ featureDictionary: { en: {
    "Every hour, {minute} minutes past the hour": "At :{minute} {suffix}",
  } } });
  expect(projectRoutineRow({ row, locale: "en", t: translate }).scheduleLabel).toBe("At :15 {suffix}");
});

it("sends encoded routine revisions through the selected admin base", async () => {
  const basePath = "/workspace/routines";
  const draft: RoutineDraft = { name: "Review", prompt: "Review the sprint", schedule: { kind: "hourly", minute: 23 }, agentId: null, model: null };
  const created = { ...row, ...draft, id: "a/b ?", revision: 1 };
  const paused = { ...created, enabled: false, revision: 2 };
  const request = vi.fn<RequestAdminJson>()
    .mockResolvedValueOnce({ routines: [row] })
    .mockResolvedValueOnce({ routines: "not an array" })
    .mockResolvedValueOnce({ routine: created })
    .mockResolvedValueOnce({ routine: paused })
    .mockResolvedValueOnce(undefined);
  const api = createRoutinesApi({ requestAdminJson: request, basePath });
  await expect(api.list()).resolves.toEqual({ state: "ready", routines: [row] });
  await expect(api.list()).resolves.toEqual({ state: "ready", routines: [] });
  await expect(api.create({ draft })).resolves.toEqual(created);
  await expect(api.update({ id: created.id, patch: { enabled: false }, expectedRevision: 1 })).resolves.toEqual(paused);
  await expect(api.remove({ id: created.id, revision: 2 })).resolves.toBeUndefined();
  expect(request.mock.calls).toEqual([
    [{ path: "", method: "GET" }, { basePath }],
    [{ path: "", method: "GET" }, { basePath }],
    [{ path: "", method: "POST", body: draft }, { basePath }],
    [{ path: "/a%2Fb%20%3F", method: "PATCH", body: { enabled: false, expectedRevision: 1 } }, { basePath }],
    [{ path: "/a%2Fb%20%3F?revision=2", method: "DELETE" }, { basePath }],
  ]);
});

it.each([
  ["ROUTINES_UNAVAILABLE", "desktop-only"],
  ["ROUTINES_ASSISTANT_OFF", "assistant-off"],
  ["ROUTINES_LEASE_HELD", "other-window"],
  ["ROUTINES_STORE_OPEN_FAILED", "error"],
])("maps known service refusal %s to %s", async (reason, state) => {
  const request = vi.fn<RequestAdminJson>().mockRejectedValue({
    status: 503, body: { details: { reason }, errorId: "incident-9", error: { details: { reason: "OTHER" }, errorId: "ignored" } },
  });
  const api = createRoutinesApi({ requestAdminJson: request, basePath: "/routines" });
  await expect(api.list()).resolves.toEqual({ state, reason, errorId: "incident-9" });
});

it("surfaces nested stale errors and malformed failures without mistaking them for refusals", async () => {
  const request = vi.fn<RequestAdminJson>()
    .mockRejectedValueOnce(Object.assign(new Error("Reload before updating"), {
      status: 409, body: { error: { errorId: "old-rev", details: { reason: "ROUTINE_CHANGED" } } },
    }))
    .mockRejectedValueOnce({ status: 503, body: { details: { reason: "SOME_OTHER_SERVICE" } } })
    .mockRejectedValueOnce({ status: 503, body: { details: { reason: 42 }, errorId: 8 } })
    .mockRejectedValueOnce({ status: 500, body: { details: { reason: "ROUTINES_UNAVAILABLE" } } })
    .mockRejectedValueOnce("connection closed");
  const api = createRoutinesApi({ requestAdminJson: request, basePath: "/routines" });
  await expect(api.update({ id: "routine", patch: { enabled: true }, expectedRevision: 1 })).rejects.toMatchObject({
    name: "RoutinesApiError", message: "Reload before updating", status: 409, reason: "ROUTINE_CHANGED", errorId: "old-rev", stale: true,
  });
  await expect(api.list()).rejects.toMatchObject({ status: 503, reason: "SOME_OTHER_SERVICE", errorId: null, stale: false });
  await expect(api.list()).rejects.toMatchObject({ status: 503, reason: null, errorId: null, stale: false });
  await expect(api.list()).rejects.toMatchObject({ status: 500, reason: "ROUTINES_UNAVAILABLE", stale: false });
  await expect(api.list()).rejects.toMatchObject({ message: "Request failed", status: 0, reason: null, errorId: null, stale: false });
});

const kit: RoutinesKit = {
  DataTable, RowMenu,
  ConfirmDialog: ({ open, title, body, cancelLabel, confirmLabel, onCancel, onConfirm }) => open
    ? <div role="dialog" aria-label={String(title)}>{body}
        <button type="button" onClick={() => onCancel()}>{cancelLabel}</button>
        <button type="button" onClick={() => onConfirm()}>{confirmLabel}</button>
      </div>
    : <></>,
  RecurringSchedulePicker: ({ value, onChange }) => <button type="button" onClick={() => onChange({ kind: "hourly", minute: 47 })}>{value.kind === "hourly" ? `Minute ${value.minute}` : "Change schedule"}</button>,
};

function routinesProps(view: RoutinesController["view"], notice: RoutinesController["notice"] = null) {
  const controller = {
    view, notice, busyId: null, refresh: vi.fn<RoutinesController["refresh"]>(),
    save: vi.fn<RoutinesController["save"]>().mockResolvedValue(true),
    setEnabled: vi.fn<RoutinesController["setEnabled"]>().mockResolvedValue(true),
    remove: vi.fn<RoutinesController["remove"]>().mockResolvedValue(true), dismissNotice: vi.fn(),
  };
  const props = {
    kit, t, locale: "en", theme: "night", visible: true,
    desktopNoticeKey: "Keep the desktop open.",
    unavailableKeys: { ROUTINES_ASSISTANT_OFF: "Turn on the assistant to run routines." },
    useRoutinesController: vi.fn((_required: { visible: boolean }) => controller),
    useSchedulePicker: () => { throw new Error("The harness exposes only its schedule editor button"); },
    useConversationDeepLink: () => ({ hrefFor: ({ conversationId }: { conversationId: string }) => `/chats/${conversationId}` }),
  };
  return { props, controller };
}

it("does not mount the controller during a disabled rollout", () => {
  const { props } = routinesProps({ kind: "loading" });
  const mount = {
    ...props, visible: false, useAdminLocaleHook: () => "fr",
    t: createDictionaryTranslator({ featureDictionary: { fr: { Routines: "Routines planifiées" } } }),
  };
  const view = render(<RoutinesMount {...mount} releaseEnabled={false} />);
  expect(screen.queryByRole("region")).toBeNull();
  expect(props.useRoutinesController).not.toHaveBeenCalled();
  view.rerender(<RoutinesMount {...mount} releaseEnabled />);
  expect(screen.getByRole("region", { name: "Routines planifiées" })).toHaveAttribute("data-theme", "night");
  expect(props.useRoutinesController).toHaveBeenLastCalledWith({ visible: false });
});

it("shows loading, load failures, and refused service without enabling writes", () => {
  const { rerender } = render(<Routines {...routinesProps({ kind: "loading" }).props} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading routines…");
  expect(screen.queryByRole("button", { name: "New routine" })).toBeNull();

  rerender(<Routines {...routinesProps({ kind: "failed", errorId: "load-18" }).props} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load routines. (load-18)");
  expect(screen.queryByRole("table")).toBeNull();

  rerender(<Routines {...routinesProps({ kind: "failed", errorId: null }).props} />);
  expect(screen.getByRole("alert").textContent).toBe("Could not load routines.");

  rerender(<Routines {...routinesProps({
    kind: "unavailable", availability: "assistant-off", reason: "ROUTINES_ASSISTANT_OFF", errorId: "ref-20",
  }, { key: "stale-delete", errorId: null }).props} />);
  expect(screen.getByRole("status").textContent).toBe("Turn on the assistant to run routines. (ref-20)");
  expect(screen.getByRole("status")).toHaveAttribute("data-routines-state", "assistant-off");
  expect(screen.getByRole("alert").textContent).toBe("This routine was already deleted or changed. The list has been reloaded.");
  expect(screen.queryByRole("button", { name: "New routine" })).toBeNull();

  for (const reason of ["ROUTINES_UNAVAILABLE", null] as const) {
    rerender(<Routines {...routinesProps({ kind: "unavailable", availability: "desktop-only", reason, errorId: null }).props} />);
    expect(screen.getByRole("status").textContent).toBe("Routines run only while the desktop app is open.");
  }
});

it("changes only the routine selected in its row menu", async () => {
  const user = userEvent.setup();
  const paused: RoutineRow = { ...row, id: "another", name: "Monthly report", enabled: false, lastRun: null, model: "model-8", agentId: "agent-3" };
  const completed: RoutineRow = {
    ...row, id: "completed", name: "Archive", nextRunAt: Date.UTC(2026, 7, 2, 14, 30),
    lastRun: { runId: "archive-run", trigger: "scheduled", status: "succeeded", startedAt: Date.UTC(2026, 7, 1, 14),
      completedAt: Date.UTC(2026, 7, 1, 14, 11), approvalState: "none", projectId: "project", conversationId: "", agentRunId: "agent" },
  };
  const { props, controller } = routinesProps({ kind: "ready", routines: [row, paused, completed] });
  render(<Routines {...props} />);
  const digestRow = screen.getByRole("row", { name: /Digest/ });
  const reportRow = screen.getByRole("row", { name: /Monthly report/ });
  expect(within(digestRow).getByRole("link", { name: "Open conversation" })).toHaveAttribute("href", "/chats/chat");
  expect(within(digestRow).getByRole("cell", { name: "Every hour, 15 minutes past the hour" }).textContent).toBe("Every hour, 15 minutes past the hour");
  expect(within(digestRow).getByText("Catch-up run")).toBeVisible();
  expect(within(reportRow).getByText("Paused")).toBeVisible();
  expect(within(reportRow).getByRole("cell", { name: "agent-3 · model-8" })).toHaveTextContent("agent-3 · model-8");
  expect(within(reportRow).getByRole("cell", { name: "Never run" })).toHaveTextContent("Never run");
  expect(within(reportRow).queryByRole("link")).toBeNull();
  const archiveRow = within(screen.getByRole("row", { name: /Archive/ }));
  expect(archiveRow.getByRole("cell", { name: /Aug 2, 2026, 2:30\sPM/ })).toBeVisible();
  expect(archiveRow.getByRole("cell", { name: /Succeeded Aug 1, 2026, 2:11\sPM/ })).toBeVisible();
  expect(archiveRow.queryByRole("link")).toBeNull();

  async function choose(name: string, action: string) {
    await user.click(screen.getByRole("button", { name: `Routines: ${name}` }));
    await user.click(await screen.findByRole("menuitem", { name: action }));
  }

  await choose("Monthly report", "Resume routine");
  expect(controller.setEnabled.mock.calls).toEqual([[{ row: paused, enabled: true }]]);
  await choose("Digest", "Pause routine");
  const pause = screen.getByRole("dialog", { name: "Pause routine" });
  expect(pause).toHaveTextContent("It will not run until you resume it.");
  expect(controller.setEnabled).toHaveBeenCalledTimes(1);
  await user.click(within(pause).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(controller.setEnabled).toHaveBeenCalledTimes(1);
  await choose("Digest", "Pause routine");
  await user.click(within(screen.getByRole("dialog", { name: "Pause routine" })).getByRole("button", { name: "Pause routine" }));
  expect(controller.setEnabled.mock.calls).toEqual([[{ row: paused, enabled: true }], [{ row, enabled: false }]]);

  await choose("Monthly report", "Delete routine");
  const deletion = screen.getByRole("dialog", { name: "Delete routine" });
  expect(deletion).toHaveTextContent("A run already in progress will finish.");
  expect(controller.remove).not.toHaveBeenCalled();
  await user.click(within(deletion).getByRole("button", { name: "Delete routine" }));
  expect(controller.remove.mock.calls).toEqual([[{ row: paused }]]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps rejected edits open and closes the form after a successful retry", async () => {
  const user = userEvent.setup();
  const { props, controller } = routinesProps({ kind: "ready", routines: [row] }, { key: "save-failed", errorId: "write-9" });
  controller.save.mockResolvedValueOnce(false);
  render(<Routines {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent("We could not save this routine. Nothing was changed. (write-9)");
  await user.click(screen.getByRole("button", { name: "Routines: Digest" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  const form = screen.getByRole("form", { name: "Edit" });
  const name = within(form).getByRole("textbox", { name: "Name" });
  expect(name).toHaveValue("Digest");
  await user.clear(name);
  await user.type(name, " Weekly digest ");
  await user.click(within(form).getByRole("button", { name: "Minute 15" }));
  const save = within(form).getByRole("button", { name: "Save" });
  await user.click(save);
  expect(screen.getByRole("form", { name: "Edit" })).toContainElement(save);
  const draft = { name: "Weekly digest", prompt: "Summarize", schedule: { kind: "hourly", minute: 47 }, agentId: null, model: null };
  expect(controller.save.mock.calls).toEqual([[{ draft, row }]]);
  await user.click(save);
  await waitFor(() => expect(screen.queryByRole("form", { name: "Edit" })).toBeNull());
  expect(controller.save.mock.calls).toEqual([[{ draft, row }], [{ draft, row }]]);
});

it("shows an empty ready list and sends a create draft without a source row", async () => {
  const user = userEvent.setup();
  const { props, controller } = routinesProps({ kind: "ready", routines: [] });
  render(<Routines {...props} />);
  expect(screen.getByText("No routines yet")).toBeVisible();
  const add = screen.getByRole("button", { name: "New routine" });
  await user.click(add);
  await user.click(within(screen.getByRole("form", { name: "New routine" })).getByRole("button", { name: "Cancel" }));
  expect(controller.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("form")).toBeNull();

  await user.click(add);
  const form = within(screen.getByRole("form", { name: "New routine" }));
  await user.type(form.getByRole("textbox", { name: "Name" }), "Sprint digest");
  await user.type(form.getByRole("textbox", { name: "Prompt" }), "Review the sprint");
  await user.click(form.getByRole("button", { name: "Change schedule" }));
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  expect(controller.save.mock.calls).toEqual([[{ row: null, draft: {
    name: "Sprint digest", prompt: "Review the sprint", schedule: { kind: "hourly", minute: 47 }, agentId: null, model: null,
  } }]]);
});

it("does not treat an inherited JavaScript property name as a service refusal", async () => {
  const request = vi.fn<RequestAdminJson>().mockRejectedValue({ status: 503, body: { details: { reason: "constructor" } } });
  const api = createRoutinesApi({ requestAdminJson: request, basePath: "/routines" });
  await expect(api.list()).rejects.toMatchObject({ name: "RoutinesApiError", status: 503, reason: "constructor" });
});
