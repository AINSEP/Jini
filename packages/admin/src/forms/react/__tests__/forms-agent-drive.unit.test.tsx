import { render, screen, waitFor } from "@testing-library/react";
import { assert, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePageCapability } from "@jini-ai/agentic/core";
import { createDomPageDriver } from "@jini-ai/agentic/dom";

import { FormsTestProvider } from "./harness.js";
import { FormEditor } from "../pages/FormEditor.js";
import { FormsList } from "../pages/FormsList.js";

/**
 * @file Regression test for this batch's agent-control tagging on the `forms` feature
 * (`FormEditor.tsx`/`FormsList.tsx`) — same shape as `settings/__tests__/external-mcp-agent-drive
 * .unit.test.tsx`, which this workstream's spec names as the reference: every verb below runs
 * through the real `executePageCapability` and the real `createDomPageDriver`, not `userEvent`, so
 * this exercises the same code path the agent bridge does rather than only the component's own
 * event handlers.
 *
 * Three properties, chosen because reasoning about the markup alone could not settle them:
 *
 * 1. `page.fill` on the name/slug fields reaches React state, not just the DOM node.
 * 2. A second `find_elements` after `page.click("form-fields-add")` discovers the new row's field
 *    handles — proving `buildAgentListHandles`' index fallback (a fresh field has no `id` yet)
 *    produces a *resolvable* handle immediately, not just a non-throwing one.
 * 3. `page.select_option` changing a field's type to `"checkbox"` removes that row's max-length
 *    handle from the very next `find_elements` — the conditional `{field.type === "checkbox" ? ...}`
 *    branch in `FormEditor.tsx` is a live re-render, not a one-time computation.
 *
 * `FormsList` gets its own, narrower case: `page.find_elements` with `role: "link"` returns exactly
 * the row's edit link and the header's "New form" link — never the `RowMenu` trigger, which is
 * Jini's own component and, per this batch's report, publishes no agent handle of its own.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderScreen(node: React.ReactElement) {
  return render(<FormsTestProvider>{node}</FormsTestProvider>);
}

interface FoundElement {
  handle: string;
  role?: string;
  label: string;
}

async function findElements(
  driver: ReturnType<typeof createDomPageDriver>,
  filter: { role?: string } = {},
): Promise<FoundElement[]> {
  const result = (await executePageCapability({ driver, capabilityId: "page.find_elements", input: filter })) as { elements: FoundElement[] };
  return result.elements;
}

async function handlesOf(driver: ReturnType<typeof createDomPageDriver>, filter: { role?: string } = {}) {
  return (await findElements(driver, filter)).map((element) => element.handle);
}

let fetchMock: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

beforeEach(() => {
  fetchMock = vi.fn();
  // Same locale-settings stub every other test in this feature routes ahead of `fetchMock` — see
  // `FormEditor.unit.test.tsx`/`FormsList.unit.test.tsx`'s identical `beforeEach` for why.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/settings/effective")) return Promise.resolve(jsonResponse({ data: [] }));
    return fetchMock(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("driving a new form's field editor through page.* verbs", () => {
  it("page.fill on the name and slug fields reaches React state", async () => {
    const { container } = renderScreen(<FormEditor formId="new" tab="fields" />);
    await screen.findByRole("heading", { name: "New form" });
    const driver = createDomPageDriver({ root: container, pages: {} });

    await executePageCapability({ driver, capabilityId: "page.fill", input: { handle: "form-editor-name", text: "Contact us" } });
    await executePageCapability({ driver, capabilityId: "page.fill", input: { handle: "form-editor-slug", text: "contact-us" } });

    expect((screen.getByLabelText(/^Name$/) as HTMLInputElement).value).toBe("Contact us");
    expect((screen.getByLabelText(/^Slug$/) as HTMLInputElement).value).toBe("contact-us");

    // A separate state change re-renders the controlled fields before Save reads their state.
    await executePageCapability({ driver, capabilityId: "page.click", input: { handle: "form-fields-add" } });
    await driver.settle?.({});
    expect(await handlesOf(driver)).toContain("form-field-2-id");
    expect(screen.getByLabelText(/^Name$/)).toHaveValue("Contact us");
    expect(screen.getByLabelText(/^Slug$/)).toHaveValue("contact-us");

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { slug: "contact-us" } }));
    await executePageCapability({ driver, capabilityId: "page.click", input: { handle: "form-editor-save" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const saveCall = fetchMock.mock.calls[0];
    assert.isDefined(saveCall);
    const [url, init] = saveCall;
    expect(String(url)).toMatch(/\/forms$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ name: "Contact us", slug: "contact-us" });
  });

  it("a second find_elements after page.click(\"form-fields-add\") discovers the new row's handles", async () => {
    // `useFormEditor` seeds a brand-new form with one blank field already (`blankField()`), so
    // that first row (`form-field-1-*`) is present from the start — the row this test watches for
    // is the SECOND one `page.click` adds, which starts with no id either and so falls back to its
    // own position (`form-field-2-*`, not a repeat of `-1`) via `buildAgentListHandles`.
    const { container } = renderScreen(<FormEditor formId="new" tab="fields" />);
    await screen.findByRole("heading", { name: "New form" });
    const driver = createDomPageDriver({ root: container, pages: {} });

    const before = await handlesOf(driver);
    expect(before).toContain("form-field-1-id");
    expect(before).not.toContain("form-field-2-id");

    await executePageCapability({ driver, capabilityId: "page.click", input: { handle: "form-fields-add" } });
    await driver.settle?.({});

    const after = await handlesOf(driver);
    expect(after).toContain("form-field-2-id");
    expect(after).toContain("form-field-2-label");
    expect(after).toContain("form-field-2-type");
    expect(after).toContain("form-field-2-required");
    // A brand-new field is not `checkbox`, so the max-length input renders — see the next test for
    // the reverse.
    expect(after).toContain("form-field-2-max-length");
  });

  it("page.select_option to \"checkbox\" removes that row's max-length handle from the next find_elements", async () => {
    const { container } = renderScreen(<FormEditor formId="new" tab="fields" />);
    await screen.findByRole("heading", { name: "New form" });
    const driver = createDomPageDriver({ root: container, pages: {} });

    expect(await handlesOf(driver)).toContain("form-field-1-max-length");

    await executePageCapability({ driver, capabilityId: "page.select_option", input: { handle: "form-field-1-type", option: "checkbox" } });
    await driver.settle?.({});

    expect(await handlesOf(driver)).not.toContain("form-field-1-max-length");
  });
});

describe("addressing the forms list", () => {
  it("find_elements with role: \"link\" returns the header's New form link and each row's edit link — never the RowMenu trigger", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/forms")) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: "f1",
                workspaceId: "workspace-local",
                name: "Contact",
                slug: "contact",
                fields: [],
                notify: { enabled: false, recipients: [] },
                status: "active",
                createdAt: "2026-07-01T09:00:00.000Z",
                updatedAt: "2026-07-01T09:00:00.000Z",
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`forms-agent-drive test: no mocked route for ${url}`));
    });
    const { container } = renderScreen(<FormsList />);
    await screen.findByRole("link", { name: "Contact" });
    const driver = createDomPageDriver({ root: container, pages: {} });

    const links = await findElements(driver, { role: "link" });
    const linkHandles = links.map((link) => link.handle);
    expect(linkHandles).toContain("forms-new");
    expect(linkHandles).toContain("forms-row-f1-edit");
    expect(linkHandles).toEqual(["forms-new", "forms-row-f1-edit"]);
    // `RowMenu`'s own trigger button ("Actions for form ...") is real markup on this page, but it
    // carries no `data-agent-element` of its own — see this file's header. Confirmed here by role,
    // not by absence-of-handle alone, since a bare handle search can't distinguish "not tagged"
    // from "tagged under a name this test didn't think to check".
    expect(links.every((link) => !link.label.toLowerCase().includes("actions for"))).toBe(true);
  });
});
