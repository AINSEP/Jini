// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RoutineRow } from "@jini-ai/core/contracts/site/routines";
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { projectRoutineRow } from "../project-routine-row.js";
import { useRoutinesController, type RoutinesFocus, type RoutinesTimers } from "../Routines.hooks.js";
import { RoutineForm } from "../RoutineForm.js";
import type { RoutinesKit, SchedulePickerHook } from "../Routines.js";
import { RoutinesApiError, type RoutinesApi } from "../routines-api.js";

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

const draft = {
  name: "Weekly digest", prompt: "Summarize open work", agentId: "reviewer", model: null,
  schedule: { kind: "hourly", minute: 45 },
} as const;

function routineFormKit(): RoutinesKit {
  const unused = () => <></>;
  return {
    DataTable: unused, RowMenu: unused, ConfirmDialog: unused,
    RecurringSchedulePicker: ({ value, onChange }) => <>
      <output aria-label="Current schedule">{value.kind === "daily" ? `Daily at ${value.time} (${value.timezone})` : value.kind}</output>
      <button type="button" onClick={() => onChange({ kind: "hourly", minute: 45 })}>Choose hourly</button>
    </>,
  };
}
const useSchedulePicker: SchedulePickerHook = () => { throw new Error("picker UI is injected for this test"); };
const translateForm = createDictionaryTranslator({ featureDictionary: { es: { "New routine": "Nueva rutina", Name: "Nombre", "Desktop notice": "Solo escritorio" } } });

it("creates a routine from labelled fields, keeping the prompt and normalizing default agent/model values", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<RoutineForm row={null} onSave={onSave} onCancel={onCancel} useSchedulePicker={useSchedulePicker} kit={routineFormKit()}
    locale="es" t={translateForm} desktopNoticeKey="Desktop notice" />);
  const form = within(screen.getByRole("form", { name: "Nueva rutina" }));
  expect(form.getByText("Solo escritorio")).toBeInTheDocument();
  expect(form.getByLabelText("Current schedule")).toHaveTextContent(`Daily at 09:00 (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  expect(form.getByRole("textbox", { name: "Nombre" })).toBeRequired();
  expect(form.getByRole("textbox", { name: "Prompt" })).toBeRequired();
  await user.type(form.getByRole("textbox", { name: "Nombre" }), "  Weekly digest  ");
  await user.type(form.getByRole("textbox", { name: "Prompt" }), "  Summarize open work  ");
  await user.type(form.getByRole("textbox", { name: "Agent" }), "  reviewer  ");
  await user.type(form.getByRole("textbox", { name: "Model" }), "   ");
  await user.click(form.getByRole("button", { name: "Choose hourly" }));
  await user.click(form.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...draft, prompt: "  Summarize open work  " });
  expect(onCancel).not.toHaveBeenCalled();
});

it("edits the row with a nondefault model and does not submit again on Cancel", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<RoutineForm row={{ ...row, agentId: "coder", model: "host-model" }} onSave={onSave} onCancel={onCancel}
    useSchedulePicker={useSchedulePicker} kit={routineFormKit()} locale="en" t={translateForm} desktopNoticeKey="Desktop notice" />);
  const form = within(screen.getByRole("form", { name: "Edit" }));
  expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Digest");
  expect(form.getByRole("textbox", { name: "Prompt" })).toHaveValue("Summarize");
  expect(form.getByRole("textbox", { name: "Agent" })).toHaveValue("coder");
  const model = form.getByRole("textbox", { name: "Model" });
  expect(model).toHaveValue("host-model");
  expect(form.getByLabelText("Current schedule")).toHaveTextContent("hourly");
  await user.clear(model);
  await user.type(model, "  next-model  ");
  await user.click(form.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ name: "Digest", prompt: "Summarize", agentId: "coder", model: "next-model", schedule: { kind: "hourly", minute: 15 } });
  expect(onCancel).not.toHaveBeenCalled();
  await user.click(form.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledExactlyOnceWith();
  expect(onSave).toHaveBeenCalledTimes(1);
});

function controllerPorts(list: RoutinesApi["list"]) {
  const api: RoutinesApi = { list, create: async () => { throw new Error("unexpected create"); }, update: async () => { throw new Error("unexpected update"); },
    remove: async () => { throw new Error("unexpected removal"); } };
  const focus = { subscribe: vi.fn<RoutinesFocus["subscribe"]>(() => () => {}) };
  const timers = { setInterval: vi.fn<RoutinesTimers["setInterval"]>(), clearInterval: vi.fn<RoutinesTimers["clearInterval"]>() };
  return { api, focus, timers };
}

it("reports availability separately from failures and keeps loaded rows through a transient read error", async () => {
  const list = vi.fn<RoutinesApi["list"]>()
    .mockResolvedValueOnce({ state: "other-window", reason: "ROUTINES_LEASE_HELD", errorId: "lease-3" })
    .mockRejectedValueOnce(new RoutinesApiError({ message: "Broken", reason: null, errorId: "read-7", status: 500 }))
    .mockRejectedValueOnce("transport offline")
    .mockResolvedValueOnce({ state: "ready", routines: [row] })
    .mockRejectedValueOnce(new Error("refresh refused"));
  const ports = controllerPorts(list);
  const { result } = renderHook(() => useRoutinesController({ ...ports, visible: false }));
  expect(list).not.toHaveBeenCalled();
  await act(() => result.current.refresh());
  expect(result.current.view).toEqual({ kind: "unavailable", availability: "other-window", reason: "ROUTINES_LEASE_HELD", errorId: "lease-3" });
  await act(() => result.current.refresh());
  expect(result.current.view).toEqual({ kind: "failed", errorId: "read-7" });
  await act(() => result.current.refresh());
  expect(result.current.view).toEqual({ kind: "failed", errorId: null });
  await act(() => result.current.refresh());
  expect(result.current.view).toEqual({ kind: "ready", routines: [row] });
  await act(() => result.current.refresh());
  expect(result.current.view).toEqual({ kind: "ready", routines: [row] });
});

it.each(["success", "failure"] as const)("stops polling while hidden and drops a stale read %s", async (outcome) => {
  let resolve!: (result: Awaited<ReturnType<RoutinesApi["list"]>>) => void;
  let reject!: (error: unknown) => void;
  const pending = new Promise<Awaited<ReturnType<RoutinesApi["list"]>>>((yes, no) => { resolve = yes; reject = no; });
  const unavailable = { state: "assistant-off", reason: "ROUTINES_ASSISTANT_OFF", errorId: "assistant-3" } as const;
  const list = vi.fn<RoutinesApi["list"]>().mockResolvedValueOnce(unavailable).mockImplementationOnce(() => pending);
  const expectedView = { kind: "unavailable", availability: "assistant-off", reason: "ROUTINES_ASSISTANT_OFF", errorId: "assistant-3" };
  const ports = controllerPorts(list);
  const unsubscribe = vi.fn();
  const timer = Symbol("poll");
  ports.focus.subscribe.mockReturnValue(unsubscribe);
  ports.timers.setInterval.mockReturnValue(timer);
  const { result, rerender } = renderHook(({ visible }) => useRoutinesController({ ...ports, visible }), { initialProps: { visible: false } });
  expect(result.current.view).toEqual({ kind: "loading" });
  expect(list).not.toHaveBeenCalled();
  expect(ports.focus.subscribe).not.toHaveBeenCalled();
  expect(ports.timers.setInterval).not.toHaveBeenCalled();
  rerender({ visible: true });
  await waitFor(() => expect(result.current.view).toEqual(expectedView));
  const [tick, interval] = ports.timers.setInterval.mock.calls[0]!;
  expect(interval).toBe(30_000);
  act(() => tick());
  expect(list).toHaveBeenCalledTimes(2);
  rerender({ visible: false });
  expect(ports.timers.clearInterval).toHaveBeenCalledExactlyOnceWith(timer);
  expect(unsubscribe).toHaveBeenCalledExactlyOnceWith();
  await act(async () => {
    const failure = new RoutinesApiError({ message: "lease moved", status: 503, reason: "ROUTINES_LEASE_HELD", errorId: "old-lease" });
    if (outcome === "success") resolve({ state: "other-window", reason: "ROUTINES_LEASE_HELD", errorId: "old-lease" });
    else reject(failure);
  });
  expect(result.current.view).toEqual(expectedView);
});

it("sends the displayed delete revision, then lets the operator dismiss a stale deletion notice", async () => {
  const current = { ...row, revision: 19 };
  const list = vi.fn<RoutinesApi["list"]>().mockResolvedValueOnce({ state: "ready", routines: [row] })
    .mockResolvedValueOnce({ state: "ready", routines: [current] });
  const remove = vi.fn<RoutinesApi["remove"]>().mockRejectedValueOnce(
    new RoutinesApiError({ message: "Changed", status: 409, reason: "ROUTINE_CHANGED", errorId: "delete-1" }),
  );
  const ports = controllerPorts(list);
  const api = { ...ports.api, remove };
  const { result } = renderHook(() => useRoutinesController({ ...ports, api, visible: true }));
  await waitFor(() => expect(result.current.view).toEqual({ kind: "ready", routines: [row] }));
  await act(async () => { expect(await result.current.remove({ row })).toBe(false); });
  expect(remove).toHaveBeenCalledExactlyOnceWith({ id: "routine", revision: 3 });
  expect(result.current.view).toEqual({ kind: "ready", routines: [current] });
  expect(result.current.notice).toEqual({ key: "stale-delete", errorId: "delete-1" });
  act(() => result.current.dismissNotice());
  expect(result.current.notice).toBeNull();
});

it("uses create for a new draft and update with the displayed revision for an edit", async () => {
  const created = { ...row, ...draft, revision: 1 };
  const edited = { ...created, revision: 2, name: "Reviewed digest" };
  const list = vi.fn<RoutinesApi["list"]>().mockResolvedValueOnce({ state: "ready", routines: [created] })
    .mockResolvedValueOnce({ state: "ready", routines: [edited] });
  const create = vi.fn<RoutinesApi["create"]>().mockResolvedValue(created);
  const update = vi.fn<RoutinesApi["update"]>().mockResolvedValue(edited);
  const ports = controllerPorts(list);
  const api = { ...ports.api, create, update };
  const { result } = renderHook(() => useRoutinesController({ ...ports, api, visible: false }));
  await act(async () => { expect(await result.current.save({ draft, row: null })).toBe(true); });
  expect(create).toHaveBeenCalledExactlyOnceWith({ draft });
  expect(result.current.view).toEqual({ kind: "ready", routines: [created] });
  const change = { ...draft, name: "Reviewed digest" };
  await act(async () => { expect(await result.current.save({ draft: change, row: created })).toBe(true); });
  expect(update).toHaveBeenCalledExactlyOnceWith({ id: "routine", patch: change, expectedRevision: 1 });
  expect(result.current.view).toEqual({ kind: "ready", routines: [edited] });
});
