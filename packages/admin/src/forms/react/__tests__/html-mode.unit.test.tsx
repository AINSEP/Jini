import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, afterEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import type { AdminFormDefinition } from "../../models.js";
import { FormEditor } from "../pages/FormEditor.js";
import { useFormEditor } from "./legacy-ports.js";
import { createFakeFormsPort } from "./legacy-ports.js";
import { formHtmlEmbed, formHtmlStarter, formAnswerColumns } from "../../html-rules.js";

const form: AdminFormDefinition = {
  id: "f1", workspaceId: "ws", name: "Contact", slug: "contact", status: "active",
  fields: [{ id: "email", label: "Email", type: "email", required: true }],
  notify: { enabled: false, recipients: [] }, createdAt: "2026-10-04", updatedAt: "2026-10-04",
};
const wrapper = ({ children }: { children: React.ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
afterEach(() => vi.unstubAllGlobals());

describe("HTML form authoring — owner acceptance 2026-10-04", () => {
  it("toggle seeds current fields, preserves draft across toggles, and copies the real saved slug", async () => {
    const user = userEvent.setup();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const port = createFakeFormsPort({ forms: [form] });
    const controller = (props: { formId: string; tab: "fields" | "submissions" }) => useFormEditor(props, { port, navigate: vi.fn(), t: (key) => key, clipboard });
    render(<FormEditor formId="contact" tab="fields" useFormEditorHook={controller} />, { wrapper });
    await user.click(await screen.findByRole("button", { name: "HTML" }));
    const source = screen.getByRole("textbox", { name: "Form HTML" });
    expect(source).toHaveValue(formHtmlStarter({ fields: form.fields }));
    await user.clear(source);
    await user.type(source, '<input name="message">');
    await user.click(screen.getByRole("button", { name: "Builder" }));
    await user.click(screen.getByRole("button", { name: "HTML" }));
    expect(screen.getByRole("textbox", { name: "Form HTML" })).toHaveValue('<input name="message">');
    await user.click(screen.getByRole("button", { name: "Copy HTML embed" }));
    expect(clipboard.writeText).toHaveBeenCalledWith(`<div data-embed-config='{"type":"form","id":"contact","mode":"html"}'></div>`);
    expect(await screen.findByRole("status")).toHaveTextContent("Copied!");
  });

  it("HTML save carries mode/body through the port", async () => {
    const port = createFakeFormsPort({ forms: [{ ...form, mode: "html", html: '<input name="email">' }] });
    const update = vi.spyOn(port, "updateForm");
    const { result } = renderHook(() => useFormEditor({ formId: "contact", tab: "fields" }, { port, navigate: vi.fn(), t: (key) => key }), { wrapper });
    await waitFor(() => expect(result.current.mode).toBe("html"));
    await act(async () => { await result.current.handleSave(); });
    expect(update).toHaveBeenCalledWith({ id: "f1" }, expect.objectContaining({ mode: "html", html: '<input name="email">' }));
  });

  it("ordinary Builder save keeps its original payload and clipboard failure remains visible", async () => {
    const port = createFakeFormsPort({ forms: [form] });
    const update = vi.spyOn(port, "updateForm");
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    const { result } = renderHook(() => useFormEditor({ formId: "contact", tab: "fields" }, { port, navigate: vi.fn(), t: (key) => key, clipboard }), { wrapper });
    await waitFor(() => expect(result.current.form?.id).toBe("f1"));
    await act(async () => { await result.current.handleSave(); });
    expect(update).toHaveBeenCalledWith({ id: "f1" }, { name: form.name, fields: form.fields, notify: form.notify });
    await act(async () => { await result.current.copyEmbed(); });
    expect(result.current.copyFeedback).toBe("Could not copy embed");
  });

  it("HTML-derived descriptors supply submission columns and preserve falsy answers", () => {
    const columns = formAnswerColumns({ fields: [{ id: "accept", label: "Accepted", type: "checkbox", required: false }] });
    assert.isDefined(columns[0]);
    expect(columns[0].header).toBe("Accepted");
    const submission = { id: "s1", workspaceId: "ws", formDefinitionId: "f1", sourceIp: "127.0.0.1", submittedAt: "2026-10-04", data: { accept: false } };
    expect(columns[0].cell(submission)).toBe("false");
    expect(columns[0].cell({ ...submission, data: {} })).toBe("");
  });


});
