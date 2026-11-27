// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AgentPluginMemoryPanel } from "../AgentPluginMemoryPanel.js";
import type { AgentPluginMemoryPort, PluginMemoryListing } from "../hooks/agent-plugin-memory-port.hooks.js";
import { useAgentPluginMemory } from "../hooks/use-agent-plugin-memory.hooks.js";
import { deferred, english, PluginQueryHarness } from "./plugin-hook-test-fixtures.js";

const listing = (pluginId: string, notes: PluginMemoryListing["notes"] = []): PluginMemoryListing => ({
  pluginId, notes, learned: [], limits: { learned: 12, notes: 8, files: 16 },
});
const describeApiError = ({ e, fallback }: { e: unknown; fallback: string }) => `${fallback} ${String(e)}`;
function mount(port: AgentPluginMemoryPort, pluginId = "planner") {
  return renderHook(({ id }) => useAgentPluginMemory({ pluginId: id, port, t: english, describeApiError }), {
    initialProps: { id: pluginId }, wrapper: PluginQueryHarness,
  });
}

it("loads the project note, protects unsaved edits, and saves a renamed note literally", async () => {
  const user = userEvent.setup();
  const initial = deferred<PluginMemoryListing>();
  const pending = deferred<PluginMemoryListing>();
  let saved = listing("planner", [{ relativePath: "notes.md", text: "Other notes" }, { relativePath: "project.md", text: "Original project" }]);
  let reads = 0;
  const read = vi.fn<AgentPluginMemoryPort["read"]>(({ pluginId }) => {
    if (pluginId !== "planner") throw new Error(`unexpected read: ${pluginId}`);
    reads += 1;
    return reads === 1 ? initial.promise : Promise.resolve(saved);
  });
  const saveNote = vi.fn<AgentPluginMemoryPort["saveNote"]>(() => pending.promise);
  const port = { read, saveNote };
  function Panel() {
    const controller = useAgentPluginMemory({ pluginId: "planner", port, t: english, describeApiError });
    return <AgentPluginMemoryPanel controller={controller} />;
  }
  render(<Panel />, { wrapper: PluginQueryHarness });
  const path = screen.getByRole("textbox", { name: "Note file" });
  const text = screen.getByRole("textbox", { name: "Project notes" });
  const save = screen.getByRole("button", { name: "Save note" });
  expect(save).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Loading memory…");
  await act(async () => { initial.resolve(saved); });
  expect(path).toHaveValue("project.md");
  expect(text).toHaveValue("Original project");
  const other = screen.getByRole("button", { name: "notes.md" });
  await user.click(other);
  expect(path).toHaveValue("notes.md");
  expect(text).toHaveValue("Other notes");
  await user.clear(path);
  await user.type(path, "team.md");
  await user.clear(text);
  await user.type(text, "New team memory");
  await user.click(screen.getByRole("button", { name: "project.md" }));
  expect(screen.getByRole("status")).toHaveTextContent("Save this note before opening another one.");
  expect(path).toHaveValue("team.md");
  expect(text).toHaveValue("New team memory");
  await user.click(save);
  expect(save).toBeDisabled();
  expect(saveNote).toHaveBeenCalledExactlyOnceWith({ pluginId: "planner", entryPath: "team.md", text: "New team memory" });
  saved = listing("planner", [...saved.notes, { relativePath: "team.md", text: "New team memory" }]);
  await act(async () => { pending.resolve(saved); });
  expect(screen.getByRole("status")).toHaveTextContent("Note saved.");
  expect(screen.getByRole("button", { name: "team.md" })).toBeEnabled();
  expect(text).toHaveValue("New team memory");
});

it("distinguishes a failed read from empty memory and blocks saves until hydrated", async () => {
  const saveNote = vi.fn<AgentPluginMemoryPort["saveNote"]>();
  const read = vi.fn<AgentPluginMemoryPort["read"]>(async ({ pluginId }) => {
    if (pluginId === "broken") throw new Error("offline");
    if (pluginId === "empty") return listing("empty");
    throw new Error(`unexpected read: ${pluginId}`);
  });
  const { result, rerender } = mount({ read, saveNote }, "broken");
  await waitFor(() => expect(result.current.status).toBe("Could not load memory."));
  expect(result.current.notesEmptyMessage).toBeNull();
  expect(result.current.learnedEmptyMessage).toBeNull();
  await act(async () => { await result.current.save(); });
  expect(saveNote).not.toHaveBeenCalled();
  rerender({ id: "empty" });
  await waitFor(() => expect(result.current.editorDisabled).toBe(false));
  expect(result.current.entryPath).toBe("project.md");
  expect(result.current.text).toBe("");
  expect(result.current.notesEmptyMessage).toBe("No note files yet. Save a project note to get started.");
  expect(result.current.learnedEmptyMessage).toBe("Nothing learned yet. The assistant saves what it verifies here.");
  act(() => result.current.openNote({ entryPath: "unsaved.md" }));
  expect(result.current.entryPath).toBe("unsaved.md");
  expect(result.current.text).toBe("");
});

it.each(["success", "failure"] as const)("ignores a stale save %s after changing plugin", async (outcome) => {
  const previous = listing("planner", [{ relativePath: "legacy.md", text: "Planner only" }]);
  const current = listing("calendar", [{ relativePath: "calendar.md", text: "Calendar only" }]);
  const calendar = deferred<PluginMemoryListing>();
  const save = deferred<PluginMemoryListing>();
  const saveNote = vi.fn<AgentPluginMemoryPort["saveNote"]>(() => save.promise);
  const read: AgentPluginMemoryPort["read"] = async ({ pluginId }) => {
    if (pluginId === "planner") return previous;
    if (pluginId === "calendar") return calendar.promise;
    throw new Error(`unexpected read: ${pluginId}`);
  };
  const describe = vi.fn(describeApiError);
  const port = { read, saveNote };
  const { result, rerender } = renderHook(({ id }) => ({
    active: useAgentPluginMemory({ pluginId: id, port, t: english, describeApiError: describe }),
    observer: useAgentPluginMemory({ pluginId: "planner", port, t: english, describeApiError }),
  }), { initialProps: { id: "planner" }, wrapper: PluginQueryHarness });
  await waitFor(() => expect(result.current.active.text).toBe("Planner only"));
  expect(result.current.active.entryPath).toBe("legacy.md");
  let writing!: Promise<void>;
  act(() => { writing = result.current.active.save(); });
  expect(result.current.active.saving).toBe(true);
  await act(async () => { await result.current.active.save(); });
  expect(saveNote).toHaveBeenCalledExactlyOnceWith({ pluginId: "planner", entryPath: "legacy.md", text: "Planner only" });
  rerender({ id: "calendar" });
  expect(result.current.active).toMatchObject({ entryPath: "project.md", text: "", editorDisabled: true });
  await act(async () => { calendar.resolve(current); });
  await waitFor(() => expect(result.current.active.text).toBe("Calendar only"));
  act(() => result.current.active.setText({ text: "Draft in calendar" }));
  await act(async () => {
    if (outcome === "success") save.resolve(listing("planner", [{ relativePath: "legacy.md", text: "Stale write echo" }]));
    else save.reject("stale failure");
    await writing;
  });
  expect(result.current.active.listing).toEqual(current);
  expect(result.current.active.entryPath).toBe("calendar.md");
  expect(result.current.active.text).toBe("Draft in calendar");
  expect(result.current.active.status).toBeNull();
  expect(result.current.active.saving).toBe(false);
  expect(result.current.observer.listing).toEqual(previous);
  expect(describe).not.toHaveBeenCalled();
});

it("retains the draft on a save refusal and can retry it", async () => {
  const saved = listing("planner", [{ relativePath: "project.md", text: "Edited notes" }]);
  const saveNote = vi.fn<AgentPluginMemoryPort["saveNote"]>()
    .mockRejectedValueOnce("Disk full").mockResolvedValueOnce(saved);
  const read = vi.fn<AgentPluginMemoryPort["read"]>()
    .mockResolvedValueOnce(listing("planner")).mockResolvedValue(saved);
  const { result } = mount({ read, saveNote });
  await waitFor(() => expect(result.current.editorDisabled).toBe(false));
  act(() => result.current.setText({ text: "Edited notes" }));
  await act(async () => { await result.current.save(); });
  expect(result.current.status).toBe("Could not save note. Disk full");
  expect(result.current.text).toBe("Edited notes");
  expect(result.current.editorDisabled).toBe(false);
  await act(async () => { await result.current.save(); });
  expect(saveNote.mock.calls).toEqual([
    [{ pluginId: "planner", entryPath: "project.md", text: "Edited notes" }],
    [{ pluginId: "planner", entryPath: "project.md", text: "Edited notes" }],
  ]);
  expect(result.current.status).toBe("Note saved.");
  expect(result.current.listing).toEqual(saved);
});

it("keeps the editor disabled and exposes a status if a successful read has malformed notes", async () => {
  const saveNote = vi.fn<AgentPluginMemoryPort["saveNote"]>();
  // Malformed JSON can cross the host read port even though the declared success shape is typed.
  const badListing = { ...listing("planner"), notes: "not an array" } as unknown as PluginMemoryListing;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { result } = mount({ read: async () => badListing, saveNote });
    await waitFor(() => expect(result.current.status).toBe("Could not load memory."));
    expect(result.current.editorDisabled).toBe(true);
    await act(async () => { await result.current.save(); });
    expect(saveNote).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
