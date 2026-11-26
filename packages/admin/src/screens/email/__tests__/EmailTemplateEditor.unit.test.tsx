// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
