// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { AgentPluginMemoryPanel } from "../AgentPluginMemoryPanel.js";
import { useAgentPluginMemory } from "../hooks/use-agent-plugin-memory.hooks.js";
import type { AgentPluginMemoryPort, PluginMemoryListing } from "../hooks/agent-plugin-memory-port.hooks.js";
import { makeRules } from "./plugin-rules-fixture.js";

afterEach(cleanup);
const t = (key: string) => key;
const { describeApiError } = makeRules();
const kit = fakeAdminKit({ query: { useFetchQuery, useFetchMutation, useCachedLoader } });
function wrapper({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={kit}><FetchQueryProvider>{children}</FetchQueryProvider></AdminKitProvider>;
}
function Panel({ port }: { port: AgentPluginMemoryPort }) {
  return <AgentPluginMemoryPanel controller={useAgentPluginMemory({ pluginId: "report-builder", port, t, describeApiError })} />;
}
const empty: PluginMemoryListing = { pluginId: "report-builder", limits: { learned: 2000, notes: 3000, files: 50 }, learned: [], notes: [] };

it("keeps the note editor disabled until the listing is known, then distinguishes empty notes and learning", async () => {
  let resolve!: (value: PluginMemoryListing) => void;
  const pending = new Promise<PluginMemoryListing>((done) => { resolve = done; });
  const read = vi.fn<AgentPluginMemoryPort["read"]>(() => pending);
  const saveNote = vi.fn<AgentPluginMemoryPort["saveNote"]>();
  render(<Panel port={{ read, saveNote }} />, { wrapper });
  const notes = within(screen.getByRole("region", { name: "Note files" }));
  const knowledge = within(screen.getByRole("region", { name: "Learned knowledge" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading memory…");
  expect(screen.getByRole("textbox", { name: "Note file" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Project notes" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
  expect(notes.queryByText(/No note files yet/)).toBeNull();
  expect(knowledge.queryByText(/Nothing learned yet/)).toBeNull();
  await act(async () => resolve(empty));
  expect(read).toHaveBeenCalledWith({ pluginId: "report-builder" });
  expect(screen.getByRole("textbox", { name: "Note file" })).toHaveValue("project.md");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save note" })).toBeEnabled());
  expect(notes.getByText("No note files yet. Save a project note to get started.")).toBeVisible();
  expect(knowledge.getByText("Nothing learned yet. The assistant saves what it verifies here.")).toBeVisible();
  expect(saveNote).not.toHaveBeenCalled();
});

it("opens an existing note, renames and saves it, and presents learning as read-only disclosure", async () => {
  let listing: PluginMemoryListing = { ...empty,
    notes: [{ relativePath: "project.md", text: "Baseline note" }, { relativePath: "reports.md", text: "Existing report" }],
    learned: [{ relativePath: "schema.md", text: "Number fields are decimal." }],
  };
  const read = vi.fn<AgentPluginMemoryPort["read"]>(async ({ pluginId }) => {
    if (pluginId !== listing.pluginId) throw new Error("unexpected plugin id");
    return listing;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const saveNote = vi.fn<AgentPluginMemoryPort["saveNote"]>(async ({ pluginId, entryPath, text }) => {
    if (pluginId !== listing.pluginId) throw new Error("unexpected plugin id");
    await pending;
    listing = { ...listing, notes: [...listing.notes, { relativePath: entryPath, text }] };
    return listing;
  });
  const user = userEvent.setup();
  render(<Panel port={{ read, saveNote }} />, { wrapper });
  const notesRegion = within(screen.getByRole("region", { name: "Note files" }));
  const learnedRegion = within(screen.getByRole("region", { name: "Learned knowledge" }));
  const editor = screen.getByRole("textbox", { name: "Project notes" });
  const path = screen.getByRole("textbox", { name: "Note file" });
  await waitFor(() => expect(editor).toHaveValue("Baseline note"));
  await user.click(notesRegion.getByRole("button", { name: "reports.md" }));
  expect(editor).toHaveValue("Existing report");
  expect(path).toHaveValue("reports.md");
  await user.clear(path);
  await user.type(path, "weekly.md");
  expect(editor).toHaveValue("Existing report");
  await user.clear(editor);
  await user.type(editor, "Count confirmed.");
  await user.click(notesRegion.getByRole("button", { name: "project.md" }));
  expect(screen.getByRole("status")).toHaveTextContent("Save this note before opening another one.");
  expect(editor).toHaveValue("Count confirmed.");
  await user.click(screen.getByRole("button", { name: "Save note" }));
  expect(saveNote).toHaveBeenCalledExactlyOnceWith({ pluginId: "report-builder", entryPath: "weekly.md", text: "Count confirmed." });
  expect(editor).toBeDisabled();
  expect(notesRegion.getByRole("button", { name: "project.md" })).toBeDisabled();
  expect(notesRegion.queryByRole("button", { name: "weekly.md" })).toBeNull();
  await act(async () => release());
  expect(await notesRegion.findByRole("button", { name: "weekly.md" })).toBeEnabled();
  expect(screen.getByRole("status")).toHaveTextContent("Note saved.");
  await user.click(notesRegion.getByRole("button", { name: "reports.md" }));
  expect(editor).toHaveValue("Existing report");
  await user.click(notesRegion.getByRole("button", { name: "weekly.md" }));
  expect(editor).toHaveValue("Count confirmed.");
  const summary = learnedRegion.getByText("schema.md");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await user.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(learnedRegion.getByText("Number fields are decimal.")).toBeVisible();
});
