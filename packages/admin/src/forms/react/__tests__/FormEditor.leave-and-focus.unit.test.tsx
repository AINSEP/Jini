import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import type { AdminFormDefinition } from "../../models.js";
import { FormEditor } from "../pages/FormEditor.js";
import { createFakeFormsPort, useFormEditor } from "./legacy-ports.js";

/**
 * @file Chrome check, 2026-10-11: Back from an edited, unsaved form discarded it silently, and the
 * slider/file field dialogs opened with focus (and its tip) on the Help text ⓘ. Back now asks in
 * the admin's confirm modal only when something changed; the dialogs focus their first input.
 * Real `FormEditor` + real hook; only the forms port and `navigate` are fakes.
 */

const form: AdminFormDefinition = {
  id: "f1", workspaceId: "ws", name: "Contact", slug: "contact", status: "active",
  fields: [{ id: "level", label: "Level", type: "range", required: false }],
  notify: { enabled: false, recipients: [] }, createdAt: "2026-10-11", updatedAt: "2026-10-11",
};
const wrapper = ({ children }: { children: React.ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
afterEach(() => vi.unstubAllGlobals());

function renderEditor(formId = "contact") {
  const navigate = vi.fn();
  const port = createFakeFormsPort({ forms: [form] });
  const hook = (props: { formId: string; tab: "fields" | "submissions" }) => useFormEditor(props, { port, navigate, t: (key) => key });
  render(<FormEditor formId={formId} tab="fields" useFormEditorHook={hook} />, { wrapper });
  return { navigate };
}

describe("FormEditor Back with unsaved edits", () => {
  it("leaves at once through the navigation port when nothing changed", async () => {
    const { navigate } = renderEditor();
    const back = await screen.findByRole("link", { name: "Back to forms" });
    expect(fireEvent.click(back)).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).not.toBeInTheDocument();
    expect(navigate.mock.calls).toEqual([["/forms"]]);
  });

  it("asks first after an edit; Keep editing stays, Discard changes leaves", async () => {
    const user = userEvent.setup();
    const { navigate } = renderEditor();
    const name = await screen.findByDisplayValue("Contact");
    await user.type(name, " us");

    const back = screen.getByRole("link", { name: "Back to forms" });
    expect(fireEvent.click(back)).toBe(false);
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Contact us")).toBeInTheDocument();

    fireEvent.click(back);
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(navigate).toHaveBeenCalledWith("/forms");
  });

  it("guards a new form once anything is typed", async () => {
    const user = userEvent.setup();
    const { navigate } = renderEditor("new");
    const back = await screen.findByRole("link", { name: "Back to forms" });
    expect(fireEvent.click(back)).toBe(false);
    expect(navigate.mock.calls).toEqual([["/forms"]]);
    await user.type(screen.getAllByRole("textbox")[0]!, "Signup");
    expect(fireEvent.click(back)).toBe(false);
    expect(navigate.mock.calls).toEqual([["/forms"]]);
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
  });
});

describe("field settings dialog initial focus", () => {
  it("focuses the first input, never the Help text ⓘ, for a slider field", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole("button", { name: /settings for field "level"/i }));
    const dialog = within(await screen.findByRole("dialog", { name: /field settings/i }));
    expect(document.activeElement).toBe(dialog.getByLabelText(/help text/i));
  });
});
