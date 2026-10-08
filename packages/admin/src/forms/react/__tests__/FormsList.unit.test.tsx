import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormsTestProvider, germanT } from "./harness.js";
import { FormsList } from "../pages/FormsList.js";

/**
 * @file `FormsList` — pins this dispatch's row-actions pass: a `RowMenu` "More" column matching
 * `Posts.tsx`/`Pages.tsx`, with Edit, a bidirectional status toggle, and (T7a, 2026-09-21) a
 * destructive Delete that opens a `ConfirmDialog` ("Move to trash?") and, only on confirm, POSTs
 * the generic `/trash/items` route (`type: "form"`) — see `FormsList.tsx`'s own file header for the
 * fuller rationale. Follows the RTL harness `Media.unit.test.tsx`/`Plugins.unit.test.tsx`
 * established for this package (mocked global `fetch`, URL-routed rather than call-order-coupled,
 * no server).
 *
 * `renderScreen` wraps every render in `FetchQueryProvider` (2026-08-12, `@jini-ai/ui/fetch-query`
 * migration) — `FormsList`'s hooks are now backed by `useFetchQuery`/`useFetchMutation`, which
 * throw without a `FetchQueryProvider` ancestor. `main.tsx` provides this in production; here it
 * is one `FetchQueryProvider` per render, matching `taxonomy`'s own component-test precedent.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderScreen(node: React.ReactElement, options: import("../hooks/FormsPorts.hooks.js").FormsReactOptions = {}) {
  return render(<FormsTestProvider options={options}>{node}</FormsTestProvider>);
}

const ACTIVE_FORM = {
  id: "f1",
  workspaceId: "workspace-local",
  name: "Contact",
  slug: "contact",
  fields: [],
  notify: { enabled: false, recipients: [] },
  status: "active" as const,
  createdAt: "2026-07-01T09:00:00.000Z",
  updatedAt: "2026-07-01T09:00:00.000Z",
};

const DISABLED_FORM = {
  ...ACTIVE_FORM,
  id: "f2",
  name: "Newsletter",
  slug: "newsletter",
  status: "disabled" as const,
};

/** Routes a mocked `fetch` call on method + a distinguishing URL substring — see
 *  `Media.unit.test.tsx`'s identical helper for why (order/count-coupled mocks silently
 *  mis-assert the moment a call is added or reordered). */
function routeFetch(routes: Array<{ method?: string; match: string; handler: () => Promise<Response> }>) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const entry = routes.find((r) => url.includes(r.match) && (r.method ?? "GET") === method);
    if (!entry) return Promise.reject(new Error(`FormsList test: no mocked route for ${method} ${url}`));
    return entry.handler();
  };
}

/** Async because the list renders "Loading forms…" first — a synchronous `getByRole` here runs
 *  before the mocked fetch resolves and fails on every caller. `findByRole` waits for the row to
 *  exist, which is what the tests that already awaited a query directly were getting for free. */
async function rowFor(title: string): Promise<HTMLElement> {
  const link = await screen.findByRole("link", { name: title });
  const row = link.closest("tr");
  if (!row) throw new Error(`row for "${title}" has no <tr> ancestor`);
  return row as HTMLElement;
}

let fetchMock: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

beforeEach(() => {
  fetchMock = vi.fn();
  // `FormsList` now also reads `core.language.locale` (via `useAdminLocale`) to translate its own
  // chrome — a real `fetch` call this file's tests never queued for and never counted as one of
  // the form-data GETs they assert on. Routed here, ahead of `fetchMock`, so `fetchMock` keeps
  // meaning exactly what this file's tests assert on it.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/settings/effective")) {
      return Promise.resolve(jsonResponse({ data: [] }));
    }
    return fetchMock(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // `navigate()` (lib/router) drives real `history.pushState` — reset between tests so the Edit
  // test below can't leak a route into a later test run in this same file.
  window.history.pushState(null, "", "/");
});

/** What a sighted operator reads in the dates cell: each line's short text, with the
 *  screen-reader-only labels left out. */
function visibleDateLines(cell: HTMLElement): string[] {
  return Array.from(cell.querySelectorAll("time [aria-hidden='true']"), (line) => line.textContent ?? "");
}

describe("Created / Updated column", () => {
  it("shows created then updated as compact unlabeled lines and puts the newest update first", async () => {
    const recent = { ...DISABLED_FORM, updatedAt: "2026-10-04T16:52:00.000Z" };
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM, recent] })) }]));
    renderScreen(<FormsList />);

    expect(await screen.findByRole("columnheader", { name: "Created / Updated" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    const dateCell = within(await rowFor("Newsletter")).getAllByRole("cell")[2];
    assert.isDefined(dateCell);
    const times = dateCell.querySelectorAll("time");
    expect(Array.from(times, (time) => time.getAttribute("datetime"))).toEqual(["2026-07-01T09:00:00.000Z", "2026-10-04T16:52:00.000Z"]);
    // Browser time zone varies across machines; require a short date and a time, never the words.
    const lines = visibleDateLines(dateCell);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^\d{1,2}\/\d{1,2}\/26, \d{1,2}:\d{2}/);
      expect(line).not.toMatch(/Created|Updated|T16:52/);
    }
    // The event words live only in the hover title and the screen-reader text.
    assert.isDefined(times[0]);
    assert.isDefined(times[1]);
    expect(times[0].getAttribute("title")).toMatch(/^Created [A-Z][a-z]{2} \d{1,2}, 2026, /);
    expect(times[1].getAttribute("title")).toMatch(/^Updated Oct \d{1,2}, 2026, /);
    expect(within(dateCell).getByText(times[1].getAttribute("title")!)).toHaveClass("visually-hidden");
    const rows = screen.getAllByRole("row").slice(1);
    assert.isDefined(rows[0]);
    assert.isDefined(rows[1]);
    expect(within(rows[0]).getByRole("link", { name: "Newsletter" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: "Contact" })).toBeInTheDocument();
  });

  it("shows one line when the form was never edited after it was created", async () => {
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) }]));
    renderScreen(<FormsList />);

    const dateCell = within(await rowFor("Contact")).getAllByRole("cell")[2];
    assert.isDefined(dateCell);
    const times = dateCell.querySelectorAll("time");
    expect(times).toHaveLength(1);
    assert.isDefined(times[0]);
    expect(times[0].getAttribute("datetime")).toBe("2026-07-01T09:00:00.000Z");
    expect(times[0].getAttribute("title")).toMatch(/^Created .*2026.* · Updated .*2026/);
    expect(visibleDateLines(dateCell)).toEqual([expect.stringMatching(/^\d{1,2}\/\d{1,2}\/26, \d{1,2}:\d{2}/)]);
  });

  it("uses the stored admin locale for the header, date order and hover labels", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/settings/effective")) {
        return Promise.resolve(jsonResponse({ data: [{ key: "locale", value: "de" }] }));
      }
      return fetchMock(input, init);
    });
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) }]));
    renderScreen(<FormsList />, { locale: "de", t: germanT });

    expect(await screen.findByRole("columnheader", { name: "Erstellt / Aktualisiert" })).toBeInTheDocument();
    const dateCell = within(await rowFor("Contact")).getAllByRole("cell")[2];
    assert.isDefined(dateCell);
    // German short order is day.month.year — "01.07.26, 11:00" in CEST.
    expect(visibleDateLines(dateCell)).toEqual([expect.stringMatching(/^\d{2}\.0[67]\.26, \d{2}:\d{2}$/)]);
    const title = dateCell.querySelector("time")!.getAttribute("title");
    expect(title).toMatch(/^Erstellt .* · Aktualisiert /);
    expect(title).toMatch(/(?:Juni|Juli)/);
  });
});

describe("More column", () => {
  it("renders a More header and one RowMenu trigger per row", async () => {
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM, DISABLED_FORM] })) }]));
    renderScreen(<FormsList />);

    expect(await screen.findByRole("columnheader", { name: "More" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Actions for form "Contact"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Actions for form "Newsletter"' })).toBeInTheDocument();
  });
});

describe("row menu contents", () => {
  it("an active form's menu offers Edit and Disable (not Enable), Disable carrying the warning tone", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) }]));
    renderScreen(<FormsList />);

    await user.click(await screen.findByRole("button", { name: 'Actions for form "Contact"' }));

    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    const disable = screen.getByRole("menuitem", { name: "Disable" });
    expect(disable).toHaveClass("btn-warning");
    expect(screen.queryByRole("menuitem", { name: "Enable" })).not.toBeInTheDocument();
  });

  it("a disabled form's menu offers Enable (not Disable), with no warning/danger tone", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [DISABLED_FORM] })) }]));
    renderScreen(<FormsList />);

    await user.click(await screen.findByRole("button", { name: 'Actions for form "Newsletter"' }));

    const enable = screen.getByRole("menuitem", { name: "Enable" });
    expect(enable).not.toHaveClass("btn-warning");
    expect(enable).not.toHaveClass("btn-danger");
    expect(screen.queryByRole("menuitem", { name: "Disable" })).not.toBeInTheDocument();
  });

  it("offers a Delete item with the danger tone — opens the confirm, no POST yet", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) }]));
    renderScreen(<FormsList />);

    await user.click(await screen.findByRole("button", { name: 'Actions for form "Contact"' }));
    const del = screen.getByRole("menuitem", { name: "Delete" });
    expect(del).toHaveClass("btn-danger");
    await user.click(del);

    expect(await screen.findByRole("heading", { name: "Move to trash?" })).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeUndefined();
  });
});

describe("delete (T7a, move to Trash)", () => {
  it("Cancel closes the dialog with no POST", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) }]));
    renderScreen(<FormsList />);

    await user.click(await screen.findByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("heading", { name: "Move to trash?" });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Move to trash?" })).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBeUndefined();
  });

  it("Confirm POSTs /trash/items with { type: 'form', id }, and the row disappears once the list refetches", async () => {
    const user = userEvent.setup();
    let deleted = false;
    fetchMock.mockImplementation(
      routeFetch([
        { match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: deleted ? [] : [ACTIVE_FORM] })) },
        {
          match: "/trash/items",
          method: "POST",
          handler: () => {
            deleted = true;
            return Promise.resolve(jsonResponse({ ok: true, version: 2 }));
          },
        },
      ])
    );
    renderScreen(<FormsList />);
    const row = await rowFor("Contact");

    await user.click(within(row).getByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("heading", { name: "Move to trash?" });
    await user.click(screen.getByRole("button", { name: "Move to trash" }));

    await waitFor(() => expect(screen.queryByRole("link", { name: "Contact" })).not.toBeInTheDocument());
    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({ type: "form", id: "f1" });
  });

  it("a 409 TRASH_VERSION_CHANGED shows the reload-and-retry copy inline", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(
      routeFetch([
        { match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) },
        {
          match: "/trash/items",
          method: "POST",
          handler: () => Promise.resolve(jsonResponse({ error: "the item changed since it was last read", code: "TRASH_VERSION_CHANGED" }, 409)),
        },
      ])
    );
    renderScreen(<FormsList />);
    const row = await rowFor("Contact");

    await user.click(within(row).getByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("heading", { name: "Move to trash?" });
    await user.click(screen.getByRole("button", { name: "Move to trash" }));

    expect(await screen.findByText("This item changed since you loaded it. Reload and try again.")).toBeInTheDocument();
    // Still on screen — the row was not optimistically removed for a failed delete.
    expect(screen.getByRole("link", { name: "Contact" })).toBeInTheDocument();
  });
});

describe("status toggle", () => {
  // The list no longer has a Status column (owner 2026-10-04: "Created / Updated" replaced it),
  // so the row's current status is observable through its own toggle item: "Disable" while
  // active, "Enable" while disabled. findByRole retries, so this also waits out the refetch.
  async function expectToggleItem(user: ReturnType<typeof userEvent.setup>, row: HTMLElement, formName: string, label: "Enable" | "Disable") {
    await user.click(within(row).getByRole("button", { name: `Actions for form "${formName}"` }));
    expect(await screen.findByRole("menuitem", { name: label })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: label === "Enable" ? "Disable" : "Enable" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
  }

  it("selecting Disable PUTs status: disabled and updates the row's badge via the invalidated list refetch", async () => {
    const user = userEvent.setup();
    // Stateful GET handler (2026-08-12, `lib/fetch-query` migration) — the toggle mutation no
    // longer patches `forms` locally from the PUT's own response; it `invalidates: [KEYS.list]`
    // and lets the cache's own background refetch update the view (`use-forms-list.hooks.ts`'s own
    // file header explains the trade: cross-screen consistency over one saved round trip). A
    // static GET handler that always returns `ACTIVE_FORM` would make that refetch show stale data
    // forever and this test would hang — a REAL server's list GET reflects a just-completed PUT,
    // so this fake needs to as well.
    let current: Omit<typeof ACTIVE_FORM, "status"> & { status: "active" | "disabled" } = { ...ACTIVE_FORM };
    fetchMock.mockImplementation(
      routeFetch([
        { match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [current] })) },
        {
          match: "/forms/f1",
          method: "PUT",
          handler: () => {
            current = { ...current, status: "disabled" };
            return Promise.resolve(jsonResponse({ data: current }));
          },
        },
      ])
    );
    renderScreen(<FormsList />);
    const row = await rowFor("Contact");

    await user.click(within(row).getByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Disable" }));

    await expectToggleItem(user, row, "Contact", "Enable");
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(putCall).toBeTruthy();
    const putBody = JSON.parse(String((putCall![1] as RequestInit).body));
    expect(putBody).toEqual({ status: "disabled" });
    // Two GETs now (initial load + the toggle's own `invalidates: [KEYS.list]` background
    // refetch) — NOT one. The pre-migration "only one GET" pin here described the old hand-rolled
    // `setForms((prev) => prev.map(...))` optimistic patch, which this migration deliberately
    // replaces; see this file's header and `use-forms-list.hooks.ts`'s own doc comment.
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === undefined || (init as RequestInit)?.method === "GET");
    expect(getCalls).toHaveLength(2);
  });

  it("selecting Enable PUTs status: active", async () => {
    const user = userEvent.setup();
    let current: Omit<typeof DISABLED_FORM, "status"> & { status: "active" | "disabled" } = { ...DISABLED_FORM };
    fetchMock.mockImplementation(
      routeFetch([
        { match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [current] })) },
        {
          match: "/forms/f2",
          method: "PUT",
          handler: () => {
            current = { ...current, status: "active" };
            return Promise.resolve(jsonResponse({ data: current }));
          },
        },
      ])
    );
    renderScreen(<FormsList />);
    const row = await rowFor("Newsletter");

    await user.click(within(row).getByRole("button", { name: 'Actions for form "Newsletter"' }));
    await user.click(screen.getByRole("menuitem", { name: "Enable" }));

    await expectToggleItem(user, row, "Newsletter", "Disable");
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((putCall![1] as RequestInit).body))).toEqual({ status: "active" });
  });

  it("a failed toggle keeps the table on screen and shows the error inline, rather than blanking it", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(
      routeFetch([
        { match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) },
        { match: "/forms/f1", method: "PUT", handler: () => Promise.resolve(jsonResponse({ error: "boom" }, 500)) },
      ])
    );
    renderScreen(<FormsList />);
    const row = await rowFor("Contact");

    await user.click(within(row).getByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Disable" }));

    // `request()` (api.ts) throws an `ApiError` carrying the server's own `body.error` verbatim
    // ("boom") — the `"failed to update form status"` fallback in `FormsList.tsx`'s catch block
    // only fires for a non-`Error` throw, which this isn't. Asserting the literal server message,
    // same as `FormEditor.unit.test.tsx`'s own "save failed" precedent, not the fallback text.
    expect(await screen.findByText("boom")).toBeInTheDocument();
    // Still on screen — the table did not disappear behind a full-page error.
    expect(screen.getByRole("link", { name: "Contact" })).toBeInTheDocument();
    await expectToggleItem(user, row, "Contact", "Disable");
  });

  it("guards against a second toggle firing while the first is still in flight (RowMenu has no per-item disabled, so the guard lives in useFormsList's own toggleStatus)", async () => {
    const user = userEvent.setup();
    let resolvePut!: (r: Response) => void;
    const putPromise = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    let putCallCount = 0;
    // Stateful GET handler — see the "Disable ... via the invalidated list refetch" test above for
    // why (the toggle's own `invalidates: [KEYS.list]` triggers a background refetch that must
    // reflect the completed PUT, not the pre-toggle snapshot).
    let current: Omit<typeof ACTIVE_FORM, "status"> & { status: "active" | "disabled" } = { ...ACTIVE_FORM };
    fetchMock.mockImplementation(
      routeFetch([
        { match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [current] })) },
        {
          match: "/forms/f1",
          method: "PUT",
          handler: () => {
            putCallCount += 1;
            return putPromise;
          },
        },
      ])
    );
    renderScreen(<FormsList />);
    const row = await rowFor("Contact");

    // First selection starts the (still-pending) PUT.
    await user.click(within(row).getByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Disable" }));
    expect(putCallCount).toBe(1);

    // Re-open the menu while the first PUT is still unresolved and select Disable again — the
    // row's status hasn't changed yet (still "active"), so without `toggleStatus`'s own
    // `if (rowSavingId) return;` guard this would fire a second identical PUT.
    await user.click(within(row).getByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Disable" }));
    expect(putCallCount).toBe(1);

    // Update the stateful snapshot BEFORE resolving — synchronous, so it lands before the
    // invalidation-triggered refetch's microtask reads it.
    current = { ...current, status: "disabled" };
    resolvePut(jsonResponse({ data: current }));
    await expectToggleItem(user, row, "Contact", "Enable");
  });
});

describe("Edit", () => {
  // Slug, not id (ui-fixes-backlog.md #8: a raw UUID in the URL bar was the reported bug) — the
  // GET route still resolves an id too, so an old id-based bookmark keeps working; this row link
  // is what changed. `ACTIVE_FORM.slug` is "contact", distinct from its id "f1", so this fails
  // loudly if either link reverts to `form.id`.
  it("navigates to /forms/:slug via the router (not a full page load)", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) }]));
    renderScreen(<FormsList />);
    const row = await rowFor("Contact");

    await user.click(within(row).getByRole("button", { name: 'Actions for form "Contact"' }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));

    expect(window.location.pathname).toBe("/admin/forms/contact");
  });

  it("the row's own title link also points at /forms/:slug", async () => {
    fetchMock.mockImplementation(routeFetch([{ match: "/forms", handler: () => Promise.resolve(jsonResponse({ data: [ACTIVE_FORM] })) }]));
    renderScreen(<FormsList />);

    expect(await screen.findByRole("link", { name: "Contact" })).toHaveAttribute("href", "/admin/forms/contact");
  });
});
