import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormsTestProvider } from "./harness.js";
import { FormEditor } from "../pages/FormEditor.js";

/**
 * @file `FormEditor` — pins the fix for the audit's live-verified blocker (exec summary #3): a
 * bogus form id previously rendered `"form definition 'X' was not found"` AND, underneath it, a
 * fully live, empty, saveable form with a working Save button — because the original guard
 * (`if (!isNew && !form && !error) return <Loading/>`) only covered the pre-error state, and fell
 * through once `error` was set. Follows the RTL harness `Plugins.unit.test.tsx` established for
 * this package.
 *
 * `renderScreen` wraps every render in `FetchQueryProvider` (2026-08-12, `@jini-ai/ui/fetch-query`
 * migration) — `FormEditor`'s hooks are now backed by `useFetchQuery`/`useFetchMutation`, which
 * throw without a `FetchQueryProvider` ancestor. `main.tsx` provides this in production; here it
 * is one `FetchQueryProvider` per render, matching `taxonomy`'s own component-test precedent.
 * Its returned `rerender` re-wraps in the SAME way, for the ADR-063 "does not remount on tab
 * switch" test below, which needs to change only the `tab` prop across renders — `FetchQueryProvider`
 * itself must stay mounted throughout so the query cache (and the seeded, in-progress edit) survives.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderScreen(node: React.ReactElement) {
  const utils = render(<FormsTestProvider>{node}</FormsTestProvider>);
  return { ...utils, rerender: (next: React.ReactElement) => utils.rerender(<FormsTestProvider>{next}</FormsTestProvider>) };
}

let fetchMock: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

beforeEach(() => {
  fetchMock = vi.fn();
  // `FormEditor` now also reads `core.language.locale` (via `useAdminLocale`) to translate its own
  // chrome — a real `fetch` call this file's tests never queued for. Routed here, ahead of
  // `fetchMock`, so it never consumes a slot from the `mockResolvedValueOnce` sequence every test
  // below still queues on `fetchMock` itself unchanged.
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
  // The Fields/Submissions tab strip now drives real `history.pushState` (ADR-063) — reset between
  // tests so one test's tab click can't leak a route into a later test in this file, same
  // convention `FormsList.unit.test.tsx`'s own afterEach documents for the identical reason.
  window.history.pushState(null, "", "/");
});

describe("a form id that does not resolve", () => {
  it("renders only the not-found error, never a live Save button underneath it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "form definition 'bogus' was not found" }, 404));

    renderScreen(<FormEditor formId="bogus" tab="fields" />);

    expect(await screen.findByText(/was not found/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create form/i })).not.toBeInTheDocument();
    // The fields table (`Add field` control) must not be reachable either — the whole editor body.
    expect(screen.queryByRole("button", { name: /add field/i })).not.toBeInTheDocument();
  });
});

describe("a later save failure, after the form already loaded", () => {
  it("keeps the editor on screen and shows the error inline, rather than blanking it", async () => {
    const form = {
      id: "f1",
      name: "Contact",
      slug: "contact",
      status: "active",
      fields: [],
      notify: { enabled: false, recipients: [] },
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: form }))
      .mockResolvedValueOnce(jsonResponse({ error: "save failed" }, 500));

    renderScreen(<FormEditor formId="f1" tab="fields" />);

    const saveButton = await screen.findByRole("button", { name: /^save$/i });
    saveButton.click();

    expect(await screen.findByText("save failed")).toBeInTheDocument();
    // Still on screen, not replaced by an error-only view.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });
});

describe("field attributes modal", () => {
  function formWithOneField() {
    return {
      id: "f1",
      name: "Contact",
      slug: "contact",
      status: "active",
      fields: [{ id: "email", label: "Email", type: "text", required: false }],
      notify: { enabled: false, recipients: [] },
    };
  }

  it("opens from the row's kebab trigger, and round-trips a CSS class + an allowlisted attribute into the save payload", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: formWithOneField() }))
      .mockResolvedValueOnce(jsonResponse({ data: formWithOneField() }));

    renderScreen(<FormEditor formId="f1" tab="fields" />);

    const trigger = await screen.findByRole("button", { name: /attributes for field "email"/i });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: /field attributes/i });
    const dialogScope = within(dialog);

    await user.type(dialogScope.getByLabelText(/css classes/i), "md:col-span-2 w-1/2");
    await user.click(dialogScope.getByRole("button", { name: /add attribute/i }));
    await user.type(dialogScope.getByLabelText(/^name$/i), "aria-label");
    await user.type(dialogScope.getByLabelText(/^value$/i), "Work email");
    await user.click(dialogScope.getByRole("button", { name: /^save$/i }));

    // Modal closed, back to the field table.
    expect(screen.queryByRole("dialog", { name: /field attributes/i })).not.toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveButton);

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse((putCall as [string, RequestInit])[1].body as string);
    expect(body.fields[0].className).toBe("md:col-span-2 w-1/2");
    expect(body.fields[0].attributes).toEqual({ "aria-label": "Work email" });
  });

  it("rejects a non-allowlisted attribute name client-side, keeping the modal open with an error", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: formWithOneField() }));

    renderScreen(<FormEditor formId="f1" tab="fields" />);

    const trigger = await screen.findByRole("button", { name: /attributes for field "email"/i });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: /field attributes/i });
    const dialogScope = within(dialog);

    await user.click(dialogScope.getByRole("button", { name: /add attribute/i }));
    await user.type(dialogScope.getByLabelText(/^name$/i), "onclick");
    await user.type(dialogScope.getByLabelText(/^value$/i), "alert(1)");
    await user.click(dialogScope.getByRole("button", { name: /^save$/i }));

    expect(await dialogScope.findByRole("alert")).toHaveTextContent(/onclick.*isn't allowed/i);
    // Still open — the save did not go through.
    expect(screen.getByRole("dialog", { name: /field attributes/i })).toBeInTheDocument();
  });

  it("Cancel discards edits without touching the field", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: formWithOneField() }));

    renderScreen(<FormEditor formId="f1" tab="fields" />);

    const trigger = await screen.findByRole("button", { name: /attributes for field "email"/i });
    await user.click(trigger);

    let dialog = await screen.findByRole("dialog", { name: /field attributes/i });
    await user.type(within(dialog).getByLabelText(/css classes/i), "should-not-persist");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog", { name: /field attributes/i })).not.toBeInTheDocument();
    // WCAG 2.1 AA — focus returns to the trigger that opened the dialog.
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    dialog = await screen.findByRole("dialog", { name: /field attributes/i });
    expect(within(dialog).getByLabelText(/css classes/i)).toHaveValue("");
  });
});

/**
 * @file (cont'd) Direct coverage for `FormEditorFieldsBody`, `FormEditorTabStrip`, and
 * `FormEditorMainPanel` — extracted out of `FormEditor` by the complexity-ceiling pass. None of
 * these branches (the Enable/Disable status toggle, the Fields/Submissions tab switch, and the
 * new-form "Create form" vs existing-form "Save" label) were exercised by the tests above, which
 * only drove the load-error guards and the field-attributes modal. Added per the refactor brief's
 * "every extracted unit gets its own direct unit test" rule.
 *
 * The notify checkbox/recipients-input UI this describe block used to also cover was removed
 * (owner ask 2026-09-22 — dead until an outside mail integration exists; see
 * `use-form-editor.hooks.ts`'s own `notify` state comment for the pass-through that replaced it,
 * pinned by `use-form-editor.unit.test.tsx`'s "preserves an existing form's notify setting" test).
 */
describe("new form — no tabs, Create form label", () => {
  it("renders no tab strip for a new form, and the Save button reads 'Create form'", async () => {
    renderScreen(<FormEditor formId="new" tab="fields" />);

    expect(screen.getByRole("button", { name: /create form/i })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("never renders the removed notify checkbox or recipients input", async () => {
    renderScreen(<FormEditor formId="new" tab="fields" />);

    await screen.findByRole("button", { name: /create form/i });
    expect(screen.queryByRole("checkbox", { name: /notification/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/recipients/i)).not.toBeInTheDocument();
  });
});

describe("existing form — tab strip, status toggle, submissions panel", () => {
  function activeForm() {
    return {
      id: "f1",
      name: "Contact",
      slug: "contact",
      status: "active",
      fields: [],
      notify: { enabled: false, recipients: [] },
    };
  }

  it("shows the tab strip and opens directly on the Submissions panel when tab=\"submissions\" (route-derived, ADR-063)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: activeForm() }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })); // FormSubmissions' own load on mount

    renderScreen(<FormEditor formId="f1" tab="submissions" />);

    const tablist = await screen.findByRole("tablist");
    expect(tablist).toBeInTheDocument();
    expect(await screen.findByRole("tabpanel", { name: /submissions/i })).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: /fields/i })).not.toBeInTheDocument();
  });

  it("clicking the Submissions tab navigates to this form's /submissions route, not local state", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: activeForm() }));

    renderScreen(<FormEditor formId="f1" tab="fields" />);

    const tablist = await screen.findByRole("tablist");
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: /fields/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /submissions/i }));

    // `tab` is a controlled prop here (this render never gets a new one), so the visible panel
    // does NOT switch in this harness — see the `tab="submissions"` test above for that. What this
    // proves is the click drove the real router, the same split `Deployment.unit.test.tsx`'s own
    // "?tab= deep linking" describe block uses for its `navigate()`-backed tab strip.
    expect(window.location.pathname).toBe("/admin/forms/f1/submissions");
    expect(screen.getByRole("tabpanel", { name: /fields/i })).toBeInTheDocument();
  });

  it("clicking the Fields tab from Submissions navigates back to this form's base route", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: activeForm() }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })); // FormSubmissions' own load on mount

    renderScreen(<FormEditor formId="f1" tab="submissions" />);
    await screen.findByRole("tablist");

    await user.click(screen.getByRole("tab", { name: /^fields$/i }));

    expect(window.location.pathname).toBe("/admin/forms/f1");
  });

  it("switching Fields -> Submissions -> Fields does NOT remount FormEditor — an in-progress Name edit survives (ADR-063)", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: activeForm() })) // initial form load
      .mockResolvedValueOnce(jsonResponse({ data: [] })); // FormSubmissions' own load, once mounted

    // Same `key={ctx.params.formId}` `panels.tsx` passes on BOTH routes — `rerender` with that same
    // key, changing only `tab`, simulates the route change a real Submissions-tab click drives,
    // without tearing the component down and remounting it (which a naive `key={view}` or a fresh
    // `<FormEditor>` at a different tree position would do instead).
    const { rerender } = renderScreen(<FormEditor key="f1" formId="f1" tab="fields" />);

    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Contact (editing)");
    expect(nameInput).toHaveValue("Contact (editing)");

    rerender(<FormEditor key="f1" formId="f1" tab="submissions" />);
    expect(await screen.findByRole("tabpanel", { name: /submissions/i })).toBeInTheDocument();

    rerender(<FormEditor key="f1" formId="f1" tab="fields" />);

    // A remount would reset `useFormEditor`'s local `name` state to `""`, then re-seed it from the
    // form-load query's already-cached response — the ORIGINAL "Contact", never this in-progress
    // edit. Only a live, never-torn-down component instance can still be holding it here.
    expect(await screen.findByLabelText(/^name$/i)).toHaveValue("Contact (editing)");
    // Only the two queued responses were ever consumed (initial load + Submissions' own list) — no
    // extra GET /forms/f1 fired, which is what a remount's fresh `useFetchQuery` mount would cause.
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it("an active form's status button reads 'Disable' (btn-warning) and flips the form to disabled", async () => {
    const user = userEvent.setup();
    // Two mocked responses, not three (2026-08-12, `@jini-ai/ui/fetch-query` migration): `handleStatusToggle`
    // now sets `form` directly from the PUT's OWN response rather than following it with a separate
    // reload GET — see `use-form-editor.hooks.ts`'s own doc comment on why `statusMutation` doesn't
    // invalidate its own `KEYS.form(id)` read. The PUT response therefore needs to carry the real
    // updated `data`, not the empty body the pre-migration reload-based flow could get away with.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: activeForm() }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...activeForm(), status: "disabled" } })); // PUT status update

    renderScreen(<FormEditor formId="f1" tab="fields" />);

    const disableButton = await screen.findByRole("button", { name: /^disable$/i });
    expect(disableButton).toHaveClass("btn-warning");

    await user.click(disableButton);

    expect(await screen.findByRole("button", { name: /^enable$/i })).toBeInTheDocument();
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse((putCall as [string, RequestInit])[1].body as string);
    expect(body.status).toBe("disabled");
  });
});

describe("form submission delete — confirm modal (S5 fix, 2026-09-20)", () => {
  function activeForm() {
    return {
      id: "f1",
      name: "Contact",
      slug: "contact",
      status: "active",
      fields: [],
      notify: { enabled: false, recipients: [] },
    };
  }

  function submissionFixture() {
    return {
      id: "s1",
      formDefinitionId: "f1",
      workspaceId: "ws1",
      data: { email: "a@example.com" },
      sourceIp: "127.0.0.1",
      submittedAt: "2026-08-01T00:00:00.000Z",
    };
  }

  it("Delete submission opens a confirm dialog; only confirmation trashes the submission and refreshes the list", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: activeForm() })) // form load
      .mockResolvedValueOnce(jsonResponse({ data: [submissionFixture()], nextCursor: null })) // submissions list
      .mockResolvedValueOnce(jsonResponse({ data: submissionFixture() })); // submission detail

    renderScreen(<FormEditor formId="f1" tab="submissions" />);

    await user.click(await screen.findByRole("button", { name: /view/i }));
    const deleteButton = await screen.findByRole("button", { name: /^delete submission$/i });

    // A real double-click, same as an operator clicking twice in a hurry — the old inline
    // two-click confirm deleted outright on the second click.
    await user.click(deleteButton);
    await user.click(deleteButton);

    // T7a (2026-09-21): submission delete now moves it to the Trash (`api.trash`) rather than a
    // hard `DELETE` — see `form-submissions-dependencies.hooks.ts`'s own doc.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => ["POST", "PUT", "PATCH", "DELETE"].includes(init?.method))).toEqual([]);
    const dialog = await screen.findByRole("dialog", { name: "Move to trash?" });
    expect(within(dialog).getByText("It will disappear from this list. You can restore it from the Trash.")).toBeInTheDocument();

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, version: null }))
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }));
    await user.click(within(dialog).getByRole("button", { name: "Move to trash" }));

    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(5));
    const trashCall = fetchMock.mock.calls[3];
    assert.isDefined(trashCall);
    const [url, init] = trashCall;
    expect(url).toMatch(/\/trash\/items$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ type: "form_submission", id: "s1" });
    expect(await screen.findByText("No submissions yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view/i })).not.toBeInTheDocument();
  });
});

/**
 * #3/#5/S2 (`ADS-memory/.local-artifacts/terra-admin-review-2026-09-20/plan-content2.md`) — the
 * button-visible half of `use-form-submissions.hooks.ts`'s paging fix. `use-form-submissions
 * .unit.test.tsx` covers the hook's request-serialization/staleness behavior directly; this test
 * only pins the button's `disabled`/label reaction to `loadingMore`.
 *
 * `useFormSubmissionsHook` (the DI seam `FormSubmissions` accepts) isn't reachable from here —
 * `FormEditor.tsx` mounts `<FormSubmissions formId={formId} t={t} />` with no seam of its own to
 * forward one through, unlike `useFormEditorHook` on `FormEditor` itself. So this drives the real
 * wired hook through a deferred `fetch`, the same idiom every other test in this file already
 * uses, rather than stubbing the hook.
 */
describe("form submissions — Load more paging (2026-09-20)", () => {
  function activeForm() {
    return {
      id: "f1",
      name: "Contact",
      slug: "contact",
      status: "active",
      fields: [],
      notify: { enabled: false, recipients: [] },
    };
  }

  function submissionFixture(id: string) {
    return {
      id,
      formDefinitionId: "f1",
      workspaceId: "ws1",
      data: { email: "a@example.com" },
      sourceIp: "127.0.0.1",
      submittedAt: "2026-08-01T00:00:00.000Z",
    };
  }

  it("disables Load more and shows Loading… while a page is in flight", async () => {
    const user = userEvent.setup();
    let resolveSecondPage: (() => void) | undefined;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: activeForm() })) // form load
      .mockResolvedValueOnce(jsonResponse({ data: [submissionFixture("s1")], nextCursor: "c2" })) // submissions list, page 1
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            // Manually resolved, never a timer — same deferred idiom as `use-form-submissions
            // .unit.test.tsx`'s `createControlledPort`.
            resolveSecondPage = () => resolve(jsonResponse({ data: [submissionFixture("s2")], nextCursor: "c3" }));
          }),
      );

    renderScreen(<FormEditor formId="f1" tab="submissions" />);

    const loadMoreButton = await screen.findByRole("button", { name: /^load more$/i });
    expect(loadMoreButton).not.toBeDisabled();

    await user.click(loadMoreButton);

    const loadingButton = await screen.findByRole("button", { name: /^loading…$/i });
    expect(loadingButton).toBeDisabled();

    resolveSecondPage?.();

    await waitFor(() => expect(screen.getByRole("button", { name: /^load more$/i })).not.toBeDisabled());
  });
});
