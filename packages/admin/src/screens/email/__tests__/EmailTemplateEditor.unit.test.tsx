// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEvent } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Icon } from "@jini-ai/ui";
import { useDirtyGuard } from "@jini-ai/ui/panel-kit";
import { resolveTabBarTabIndex, useTabBarKeyboard } from "@jini-ai/ui/tab-strip";
import { DevicePreviewFrame } from "../../../shell/components/DevicePreview/DevicePreviewFrame.js";
import { DevicePreviewToggle } from "../../../shell/components/DevicePreview/DevicePreviewToggle.js";
import { DEVICE_PREVIEW_WIDTHS } from "../../../shell/components/DevicePreview/DevicePreview.hooks.js";
import { PAGE_PREVIEW_IFRAME_SANDBOX } from "../../../pages/page-editor-rules.js";
import { EmailTemplateEditor } from "../EmailTemplateEditor.js";
import type { EmailTemplateEditorController } from "../hooks/use-email-template-editor.hooks.js";

const originalUrl = window.location.href;
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", originalUrl); });

it("guards a plain same-window anchor click while the template is dirty", () => {
  window.history.replaceState(null, "", "/admin/email/templates/template-1");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const controller: EmailTemplateEditorController = {
    view: { kind: "loaded", data: { id: "template-1", name: "Welcome", subject: "Welcome", fields: [], version: 1, updatedAt: "2026-11-25", html: "<p>Saved</p>", undeclaredFields: [] } },
    html: "<p>Keep my edits</p>", setHtml: vi.fn(), dirty: true, values: {}, setValue: vi.fn(), fieldNames: [],
    mode: "admin", setMode: vi.fn(), preview: { data: null, error: null, pending: false },
    saving: false, saveError: null, savedAt: null, save: vi.fn(async () => {}),
    name: "Welcome", setName: vi.fn(), commitName: vi.fn(async () => {}), renameError: null,
  };
  const mounted = render(<><a href="/admin/pages">Leave</a><EmailTemplateEditor useEditorHook={() => controller}
    useAdminLocaleHook={() => "en"} pageEditorT={key => key} useDirtyGuardHook={useDirtyGuard}
    useTabBarKeyboardHook={useTabBarKeyboard} useEmailTemplateViewHook={() => ({ tab: "html", setTab: vi.fn(), device: "desktop", setDevice: vi.fn(), frameRef: vi.fn(), paneWidth: 1000 })}
    kit={{ Icon, resolveTabBarTabIndex, DevicePreviewFrame, DevicePreviewToggle }} deps={{ devicePreviewWidths: DEVICE_PREVIEW_WIDTHS, previewIframeSandbox: PAGE_PREVIEW_IFRAME_SANDBOX }} /></>);
  expect(fireEvent.click(screen.getByRole("link", { name: "Leave" }))).toBe(false);
  expect(confirm).toHaveBeenCalledExactlyOnceWith("You have unsaved changes. Leave without saving?");
  expect(window.location.pathname).toBe("/admin/email/templates/template-1");
  expect((screen.getByLabelText("Template HTML") as HTMLTextAreaElement).value).toBe("<p>Keep my edits</p>");
  const frame = vi.fn(DevicePreviewFrame);
  const toggle = vi.fn(DevicePreviewToggle);
  controller.preview.data = { html: "<p>Preview</p>", subject: "Welcome", missingFields: [], undeclaredFields: [], mode: "admin", scriptsStripped: false };
  mounted.rerender(<EmailTemplateEditor useEditorHook={() => controller}
    useAdminLocaleHook={() => "en"} pageEditorT={key => key} useDirtyGuardHook={useDirtyGuard}
    useTabBarKeyboardHook={useTabBarKeyboard} useEmailTemplateViewHook={() => ({ tab: "preview", setTab: vi.fn(), device: "mobile", setDevice: vi.fn(), frameRef: vi.fn(), paneWidth: 1000 })}
    kit={{ Icon, resolveTabBarTabIndex, DevicePreviewFrame: frame, DevicePreviewToggle: toggle }}
    deps={{ devicePreviewWidths: { ...DEVICE_PREVIEW_WIDTHS, mobile: 411 }, previewIframeSandbox: "allow-scripts" }} />);
  expect(frame.mock.calls[0]![0].width).toBe(411);
  expect(toggle.mock.calls[0]![0].device).toBe("mobile");
  expect(screen.getByTitle("Email preview").getAttribute("sandbox")).toBe("allow-scripts");
  expect(screen.getByTitle("Email preview").getAttribute("srcdoc")).toBe("<p>Preview</p>");
});

function previewEditor(controller: EmailTemplateEditorController, tab: "html" | "preview" = "preview") {
  return <EmailTemplateEditor useEditorHook={() => controller}
    useAdminLocaleHook={() => "en"} pageEditorT={key => key} useDirtyGuardHook={useDirtyGuard}
    useTabBarKeyboardHook={useTabBarKeyboard}
    useEmailTemplateViewHook={() => ({ tab, setTab: vi.fn(), device: "desktop", setDevice: vi.fn(), frameRef: vi.fn(), paneWidth: 1000 })}
    kit={{ Icon, resolveTabBarTabIndex, DevicePreviewFrame, DevicePreviewToggle }}
    deps={{ devicePreviewWidths: DEVICE_PREVIEW_WIDTHS, previewIframeSandbox: PAGE_PREVIEW_IFRAME_SANDBOX }} />;
}

function draft(overrides: Partial<EmailTemplateEditorController> = {}): EmailTemplateEditorController {
  return {
    view: { kind: "loaded", data: { id: "template-1", name: "Welcome", subject: "Stored subject", fields: [], version: 1, updatedAt: "2026-11-25", html: "<p>Saved</p>", undeclaredFields: [] } },
    html: "<p>Keep my edits</p>", setHtml: vi.fn(), dirty: true, values: {}, setValue: vi.fn(), fieldNames: [],
    mode: "admin", setMode: vi.fn(), preview: { data: null, error: null, pending: false },
    saving: false, saveError: null, savedAt: null, save: vi.fn(async () => {}),
    name: "Welcome", setName: vi.fn(), commitName: vi.fn(async () => {}), renameError: null,
    ...overrides,
  };
}

it("renders missing and undeclared fields for the right tokens and forwards edited preview values", async () => {
  const user = userEvent.setup();
  const setValue = vi.fn();
  const setMode = vi.fn();
  render(previewEditor(draft({
    fieldNames: ["name", "site"], values: { site: "Oak" }, setValue, setMode, mode: "sent",
    preview: { data: { html: "<p>Sent</p>", subject: "Rendered subject", missingFields: ["name"], undeclaredFields: ["site"],
      mode: "sent", scriptsStripped: true }, error: null, pending: false },
  })));
  const name = screen.getByRole("textbox", { name: "{{name}}" });
  const site = screen.getByRole("textbox", { name: /\{\{site\}\}/ });
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveValue("");
  expect(site).toHaveAttribute("aria-invalid", "false");
  expect(site).toHaveValue("Oak");
  expect(screen.getByText("Not declared").closest("label")).toHaveAttribute("for", site.id);
  expect(screen.getByText("Rendered subject")).toHaveAttribute("title", "Rendered subject");
  expect(screen.getByText("Mail apps don't run scripts, so they are removed when it sends.")).toBeInTheDocument();
  await user.type(name, "A");
  expect(setValue.mock.calls).toEqual([["name", "A"]]);
  const toggle = screen.getByRole("button", { name: "As sent" });
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  await user.click(toggle);
  expect(setMode.mock.calls).toEqual([["admin"]]);
});

it("preserves separate rename, save and preview errors and never claims a failed preview rendered", async () => {
  const controller = draft({ renameError: "Name is already in use.", saveError: "Save was refused.",
    preview: { data: null, error: "Preview was refused.", pending: true },
  });
  const view = render(previewEditor(controller));
  expect(screen.getAllByRole("alert").map(alert => alert.textContent)).toEqual([
    "Name is already in use.", "Save was refused.", "Preview was refused.",
  ]);
  expect(screen.getByText("No fill-in fields. Add {{name}} to the HTML to make one.")).toBeInTheDocument();
  expect(screen.getByText("Loading…")).toBeInTheDocument();
  expect(screen.queryByTitle("Email preview")).not.toBeInTheDocument();
  view.rerender(previewEditor({ ...controller, preview: { ...controller.preview, pending: false } }));
  expect(screen.getByText("Write some HTML to see it here.")).toBeInTheDocument();
});

it("commits the name on Enter, routes Ctrl+S to Save, and removes the shortcut on unmount", async () => {
  const user = userEvent.setup();
  const commitName = vi.fn(async () => {});
  const save = vi.fn(async () => {});
  const view = render(previewEditor(draft({ commitName, save }), "html"));
  await user.click(screen.getByRole("textbox", { name: "Template name" }));
  await user.keyboard("{Enter}");
  expect(commitName.mock.calls).toEqual([[]]);
  expect(screen.getByRole("textbox", { name: "Template name" })).not.toHaveFocus();
  await user.keyboard("{Control>}s{/Control}");
  expect(save.mock.calls).toEqual([[]]);
  view.unmount();
  await user.keyboard("{Control>}s{/Control}");
  expect(save.mock.calls).toEqual([[]]);
});

it("allows downloads, other tabs and modified navigation without prompting on unsaved edits", async () => {
  window.history.replaceState(null, "", "/admin/email/templates/template-1");
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  // Consume allowed default actions after the document guard sees them so jsdom never navigates.
  const allowed = vi.fn((event: MouseEvent<HTMLAnchorElement>) => {
    expect(event.defaultPrevented).toBe(false);
    event.preventDefault();
  });
  render(<>
    <a href="/admin/export" download onClick={allowed}>Download</a>
    <a href="/admin/settings" target="_blank" onClick={allowed}>Other tab</a>
    <a href="/admin/settings?tab=mail" onClick={allowed}>Modified</a>
    <a href="/admin/email/templates/template-1#content" onClick={allowed}>Same editor</a>
    {previewEditor(draft(), "html")}
  </>);
  await user.click(screen.getByRole("link", { name: "Download" }));
  await user.click(screen.getByRole("link", { name: "Other tab" }));
  await user.keyboard("{Control>}");
  await user.click(screen.getByRole("link", { name: "Modified" }));
  await user.keyboard("{/Control}");
  await user.click(screen.getByRole("link", { name: "Same editor" }));
  expect(allowed).toHaveBeenCalledTimes(4);
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Template HTML")).toHaveValue("<p>Keep my edits</p>");
});

it("keeps the saved subject when no rendered subject is available and lets the operator enter As sent", async () => {
  const setMode = vi.fn();
  const controller = draft({ setMode });
  const view = render(previewEditor(controller));
  expect(screen.getByText("Stored subject")).toHaveAttribute("title", "Stored subject");
  const asSent = screen.getByRole("button", { name: "As sent" });
  expect(asSent).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(asSent);
  expect(setMode.mock.calls).toEqual([["sent"]]);
  view.rerender(previewEditor({ ...controller, view: { kind: "forbidden" } }));
  expect(screen.getByRole("textbox", { name: "Template name" })).toBeDisabled();
  expect(screen.queryByText("Stored subject")).not.toBeInTheDocument();
  expect(screen.getByText("You don't have permission to see this.")).toBeInTheDocument();
});
