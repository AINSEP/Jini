// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "../../../__tests__/fetch-query-support.js";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminTrashItemDto, AdminTrashPageDto, AdminTrashPurgeReportDto, AdminTrashRestoreReportDto } from "@jini-ai/core/contracts/site/cms-trash";

import { resetContentRefreshBus } from "../../../shell/lib/content-refresh-bus.js";
import { Trash } from "../Trash.js";
import { useTrash } from "../hooks/use-trash.hooks.js";
import type { TrashPort } from "../hooks/trash-port.hooks.js";

/**
 * @file The Trash screen mounted over the REAL `useTrash` controller and a scripted in-memory port
 * (no stubbed controller, no global `fetch`): loading, first-load failure, the empty state, row
 * cells (subtitle, AI actor tooltip), selection, the toolbar's disabled rules, Refresh, Restore,
 * the permanent-delete confirm (cancel and confirm) and the load-more button's busy label. The
 * hook's own state rules are proven in `use-trash.unit.test.tsx`; this file proves the screen
 * wires each control to them and renders each state.
 */

afterEach(() => resetContentRefreshBus());

const row = (id: string, extra: Partial<AdminTrashItemDto> = {}): AdminTrashItemDto => ({
  id, entityType: "post", entityId: `e-${id}`, title: `Title ${id}`, subtitle: null,
  trashedAt: "2026-11-25T00:00:00.000Z", purgeAfter: "2026-12-25T00:00:00.000Z",
  daysRemaining: 30, actorPrincipalId: "user-1", actorPluginId: null, actorUsername: "owner", ...extra,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Each `listTrash` call for a cursor takes the next queued answer (the last one repeats). */
function scriptedPort(script: {
  pages: Record<string, Array<AdminTrashPageDto | Error | Promise<AdminTrashPageDto>>>;
  restore?: AdminTrashRestoreReportDto;
  purge?: AdminTrashPurgeReportDto;
}) {
  const listCalls: Array<string | undefined> = [];
  const restoreCalls: unknown[] = [];
  const purgeCalls: unknown[] = [];
  const port: TrashPort = {
    listTrash: async (options) => {
      listCalls.push(options.cursor);
      const queue = script.pages[options.cursor ?? ""] ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      if (!next) throw new Error(`no page scripted for ${options.cursor ?? "page 1"}`);
      return next;
    },
    restoreTrashItems: async (input) => { restoreCalls.push(input); return script.restore ?? { restored: 0, results: [] }; },
    purgeTrashItems: async (input) => { purgeCalls.push(input); return script.purge ?? { purged: 0, results: [] }; },
  };
  return { port, listCalls, restoreCalls, purgeCalls };
}

function mount(port: TrashPort) {
  const useTrashHook = () => useTrash({
    port,
    locale: "en",
    t: ({ key }) => key,
    describeLoadError: ({ error }) => `Could not load: ${(error as Error).message}`,
    describeApiError: ({ e, fallback }) => `${fallback}: ${(e as Error).message}`,
  });
  return render(<Trash useTrashHook={useTrashHook} translateAdminNavLabel={({ key }) => key} />);
}

const page = (items: AdminTrashItemDto[], nextCursor: string | null = null): AdminTrashPageDto => ({ items, nextCursor, retentionDays: 30 });

describe("Trash screen states", () => {
  it("shows the loading notice until the first page lands, then the empty state", async () => {
    const first = deferred<AdminTrashPageDto>();
    mount(scriptedPort({ pages: { "": [first.promise] } }).port);
    expect(screen.getByText("Loading the Trash…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();

    await act(async () => { first.resolve(page([])); await first.promise; });
    expect(await screen.findByText("The Trash is empty.")).toBeInTheDocument();
    expect(screen.queryByText("Loading the Trash…")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("replaces the loading notice with the load error alone when the first page fails", async () => {
    mount(scriptedPort({ pages: { "": [new Error("offline")] } }).port);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load: offline");
    expect(screen.queryByText("Loading the Trash…")).toBeNull();
    expect(screen.queryByText("The Trash is empty.")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row's subtitle and marks an AI actor with the plugin id as a tooltip", async () => {
    mount(scriptedPort({ pages: { "": [page([
      row("a", { subtitle: "/blog/hello" }),
      row("b", { actorPluginId: "seo-agent" }),
    ])] } }).port);
    const aiActor = await screen.findByText("owner + AI");
    expect(aiActor).toHaveAttribute("title", "seo-agent");
    expect(screen.getByText("/blog/hello")).toHaveClass("jini-muted-cell");
    const plainRow = screen.getByText("Title a").closest("tr")!;
    expect(within(plainRow).getByText("owner")).not.toHaveAttribute("title");
  });

  it("labels the load-more button as loading while the next page is in flight", async () => {
    const next = deferred<AdminTrashPageDto>();
    mount(scriptedPort({ pages: { "": [page([row("a")], "c2")], c2: [next.promise] } }).port);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    await act(async () => { next.resolve(page([row("b")])); await next.promise; });
    expect(await screen.findByText("Title b")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Load more|Loading…/ })).toBeNull();
  });
});

describe("Trash screen actions", () => {
  it("keeps Restore and Delete permanently disabled until a row is ticked", async () => {
    mount(scriptedPort({ pages: { "": [page([row("a")])] } }).port);
    const checkbox = await screen.findByRole("checkbox", { name: 'Select "Title a"' });
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
    expect(screen.getByText("0 selected")).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeEnabled();
  });

  it("re-reads page 1 when Refresh is pressed", async () => {
    const { port, listCalls } = scriptedPort({ pages: { "": [page([row("a")]), page([row("a"), row("z")])] } });
    mount(port);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Title z")).toBeInTheDocument();
    expect(listCalls.filter((cursor) => cursor === undefined).length).toBeGreaterThanOrEqual(2);
  });

  it("restores the ticked row by entity identity and shows the outcome notice", async () => {
    const { port, restoreCalls } = scriptedPort({
      pages: { "": [page([row("a"), row("b")]), page([row("b")])] },
      restore: { restored: 1, results: [{ entityType: "post", entityId: "e-a", outcome: "restored" }] },
    });
    mount(port);
    fireEvent.click(await screen.findByRole("checkbox", { name: 'Select "Title a"' }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restored.")).toHaveClass("jini-notice");
    expect(restoreCalls).toEqual([{ items: [{ entityType: "post", entityId: "e-a" }] }]);
    await waitFor(() => expect(screen.queryByText("Title a")).toBeNull());
  });

  it("disables Refresh, Restore and Delete permanently while a restore is still running", async () => {
    const gate = deferred<AdminTrashRestoreReportDto>();
    const { port } = scriptedPort({ pages: { "": [page([row("a")])] } });
    port.restoreTrashItems = () => gate.promise;
    mount(port);
    fireEvent.click(await screen.findByRole("checkbox", { name: 'Select "Title a"' }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();

    await act(async () => { gate.resolve({ restored: 1, results: [{ entityType: "post", entityId: "e-a", outcome: "restored" }] }); await gate.promise; });
    expect(await screen.findByText("Restored.")).toBeInTheDocument();
  });

  it("asks before deleting permanently: cancel deletes nothing, confirm purges the selection", async () => {
    const { port, purgeCalls } = scriptedPort({
      pages: { "": [page([row("a"), row("b")]), page([])] },
      purge: { purged: 2, results: [{ id: "a", outcome: "purged" }, { id: "b", outcome: "purged" }] },
    });
    mount(port);
    fireEvent.click(await screen.findByRole("checkbox", { name: 'Select "Title a"' }));
    fireEvent.click(screen.getByRole("checkbox", { name: 'Select "Title b"' }));

    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("2 item(s) will be deleted permanently. This cannot be undone.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(purgeCalls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(purgeCalls).toEqual([{ ids: ["a", "b"] }]));
    expect(await screen.findByText("The Trash is empty.")).toBeInTheDocument();
  });
});
