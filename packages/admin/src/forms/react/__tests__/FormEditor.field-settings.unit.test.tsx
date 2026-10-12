import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FormsTestProvider } from "./harness.js";
import { FormEditor } from "../pages/FormEditor.js";

/**
 * @file Field settings round trip through the real `FormEditor`: the type picker's grouped names,
 * then the settings dialog for a choice field (add an option, pick it as the default) reaching the
 * PUT body. Same fetch harness as `FormEditor.unit.test.tsx`.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function topicForm() {
  return {
    id: "f1", name: "Contact", slug: "contact", status: "active",
    fields: [{ id: "topic", label: "Topic", type: "select", required: true, options: [{ value: "press", label: "Press" }, { value: "issue", label: "Issue" }] }],
    notify: { enabled: false, recipients: [] },
  };
}

let fetchMock: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/settings/effective")) return Promise.resolve(jsonResponse({ data: [] }));
    return fetchMock(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, "", "/");
});

describe("field settings in the form editor", () => {
  it("the type picker groups every type under a plain-language name", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: topicForm() }));
    render(<FormsTestProvider><FormEditor formId="f1" tab="fields" /></FormsTestProvider>);
    const picker = await screen.findByRole("combobox", { name: /field 1 type/i });
    expect([...picker.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(["Text", "Choices", "Numbers and dates", "Other"]);
    expect(within(picker).getByRole("option", { name: "Dropdown" })).toHaveProperty("selected", true);
    expect(within(picker).getByRole("option", { name: "Toggle switch" })).toHaveValue("toggle");
    // A choice field has no max length; the cell shows a dash instead of an input.
    expect(screen.queryByRole("spinbutton", { name: /field 1 max length/i })).not.toBeInTheDocument();
  });

  it("adds an option, makes it the default, and saves both in the PUT body", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: topicForm() }))
      .mockResolvedValueOnce(jsonResponse({ data: topicForm() }));
    render(<FormsTestProvider><FormEditor formId="f1" tab="fields" /></FormsTestProvider>);

    await user.click(await screen.findByRole("button", { name: /settings for field "topic"/i }));
    const dialog = within(await screen.findByRole("dialog", { name: /field settings/i }));
    await user.click(dialog.getByRole("button", { name: /add option/i }));
    await user.type(dialog.getByLabelText("Option 3 label"), "Other");
    expect(dialog.getByLabelText("Option 3 value")).toHaveValue("Other");
    await user.click(dialog.getByRole("button", { name: "Move option 3 up" }));
    await user.selectOptions(dialog.getByLabelText(/^default$/i), "Other");
    await user.type(dialog.getByLabelText(/help text/i), "Pick the closest one");
    await user.click(dialog.getByRole("button", { name: /^save$/i }));
    expect(screen.queryByRole("dialog", { name: /field settings/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT") as [string, RequestInit];
    const [topic] = JSON.parse(putCall[1].body as string).fields;
    expect(topic).toMatchObject({
      id: "topic", type: "select", helpText: "Pick the closest one", default: "Other",
      options: [{ value: "press", label: "Press" }, { value: "Other", label: "Other" }, { value: "issue", label: "Issue" }],
    });
  });

  it("an option without a label keeps the dialog open with the error", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: topicForm() }));
    render(<FormsTestProvider><FormEditor formId="f1" tab="fields" /></FormsTestProvider>);

    await user.click(await screen.findByRole("button", { name: /settings for field "topic"/i }));
    const dialog = within(await screen.findByRole("dialog", { name: /field settings/i }));
    await user.clear(dialog.getByLabelText("Option 1 label"));
    await user.click(dialog.getByRole("button", { name: /^save$/i }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Each option needs a label and a unique value.");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toEqual([]);
  });
});
