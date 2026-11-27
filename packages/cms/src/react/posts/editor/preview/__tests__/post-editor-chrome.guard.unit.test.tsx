import type { ReactNode } from "react";
import { PostEditorActions } from "../../header/PostEditorActions.js";
import { PostEditorViewBar } from "../../view-bar/PostEditorViewBar.js";
import { useState } from "react";
import { resolvePostPreviewBranches } from "../../../post-editor-rules.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PostPreview } from "../PostPreview.js";
import { PostEditorHeader } from "../../header/PostEditorHeader.js";

afterEach(cleanup);

test("unsaved identity shows neither live link nor preview; first save reveals the original pending/live transition", () => {
  const header = render(<PostEditorHeader kindLabel="post" confirmLeave={() => true} title="Title" setTitle={() => {}} slug="draft" setSlug={() => {}} post={{ id: "", slug: "draft" }} t={key => key} Icon={() => null} siteUrl={({ path }) => path} />);
  expect(header.container.querySelector("a[target='_blank']")).toBeNull();
  header.unmount();
  const props = { postId: "", bodyJson: { type: "doc" }, slug: "draft", status: "draft" as const, scheduled: false, dirty: false, contentDirty: false, templatePreviewUrl: "/preview/id", previewFormRef: () => {}, previewFormTarget: "pending-id", t: (key: string) => key, width: 800, expanded: false, onToggleExpanded: () => {}, DevicePreviewFrame: ({ children }: { children: ReactNode }) => <>{children}</>, usePreviewPaneWidthHook: () => ({ frameRef: () => {}, paneWidth: 800 }), resolvePostPreviewBranches: ({ status, dirty, contentDirty }: { status: "draft" | "published"; dirty: boolean; contentDirty: boolean }) => ({ canShowLiveSite: status === "published" && !dirty, canShowTemplatePreview: status === "published" && dirty && !contentDirty, canShowPendingContentPreview: status !== "published" || contentDirty }), sandbox: "allow-forms", usePostPreviewIframeEscapeHook: () => () => {}, useThemePreviewFrameHook: (input: { liveUrl: string; templateUrl: string; canShowLiveSite: boolean }) => input };
  const preview = render(<PostPreview {...props} />);
  expect(preview.container.textContent).toContain("Save this post to preview it.");
  expect(preview.container.querySelector("iframe")).toBeNull();
  preview.rerender(<PostPreview {...props} postId="id" />);
  expect(preview.container.querySelector("form")?.target).toBe("pending-id");
  expect(preview.container.querySelector("iframe")?.name).toBe("pending-id");
  expect(preview.container.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-forms");
  expect(preview.container.querySelector("iframe")?.getAttribute("referrerpolicy")).toBe("no-referrer");
  preview.rerender(<PostPreview {...props} postId="id" status="published" />);
  expect(preview.container.querySelector("form")).toBeNull();
  expect(preview.container.querySelector("iframe")?.getAttribute("src")).toBe("/preview/id");
});

test("header vetoes back navigation and targets the saved slug rather than the working one", () => {
  const confirmLeave = vi.fn(() => false);
  const setTitle = vi.fn(), setSlug = vi.fn();
  const siteUrl = vi.fn(({ path }: { path: string }) => `https://site.example${path}`);
  render(<PostEditorHeader kindLabel="page" {...{ confirmLeave, setTitle, setSlug, siteUrl }}
    title="Unsaved title" slug="unsaved-route" post={{ id: "row-id", slug: "saved-route" }} t={key => key} Icon={() => null} />);
  expect(screen.getByRole("heading", { name: "Edit page" }).textContent).toBe("Edit page");
  const back = screen.getByRole("link", { name: "Back: Pages" });
  expect(back.getAttribute("href")).toBe("/admin/pages");
  expect(fireEvent.click(back)).toBe(false);
  expect(confirmLeave).toHaveBeenCalledExactlyOnceWith();
  confirmLeave.mockReturnValue(true);
  const browserDefault = vi.fn();
  const checkDefault = (event: MouseEvent) => {
    browserDefault(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener("click", checkDefault, { once: true });
  try {
    fireEvent.click(back);
  } finally {
    document.removeEventListener("click", checkDefault);
  }
  expect(browserDefault).toHaveBeenCalledExactlyOnceWith(false);
  const title = screen.getByRole("textbox", { name: "Post title" });
  fireEvent.change(title, { target: { value: "Line one\nLine two" } });
  expect(setTitle).toHaveBeenCalledExactlyOnceWith({ next: "Line one Line two" });
  expect(fireEvent.keyDown(title, { key: "Enter" })).toBe(false);
  expect(fireEvent.keyDown(title, { key: "a" })).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "URL slug" }), { target: { value: "new-route" } });
  expect(setSlug).toHaveBeenCalledExactlyOnceWith({ value: "new-route" });
  const live = screen.getByRole("link", { name: "view ↗" });
  expect(live.getAttribute("href")).toBe("https://site.example/saved-route");
  expect(live.getAttribute("rel")).toBe("noreferrer");
  expect(siteUrl).toHaveBeenCalledExactlyOnceWith({ path: "/saved-route" }, {});
});

test("template-only changes use the refreshed GET iframe and the fullscreen control remains available to exit", () => {
  const url = "/admin/preview/row?template=alternate";
  const escape = vi.fn();
  const resolvedFrame = vi.fn(() => ({ canShowLiveSite: false, liveUrl: "/unused-live", templateUrl: `${url}&refresh=4` }));
  const bodyJson = { type: "doc", content: [] };
  function Preview() {
    const [expanded, setExpanded] = useState(false);
    return <PostPreview postId="row" slug="saved" bodyJson={bodyJson} status="published" scheduled={false} dirty contentDirty={false}
      templatePreviewUrl={url} previewFormTarget="pending-row" previewFormRef={() => {}} width={375} expanded={expanded}
      onToggleExpanded={() => setExpanded(current => !current)} t={key => key}
      DevicePreviewFrame={({ children }) => <>{children}</>} usePreviewPaneWidthHook={() => ({ frameRef: () => {}, paneWidth: 700 })}
      resolvePostPreviewBranches={resolvePostPreviewBranches} sandbox="allow-forms"
      usePostPreviewIframeEscapeHook={({ expanded, onCollapse }) => { escape({ expanded, onCollapse }); return () => {}; }}
      useThemePreviewFrameHook={resolvedFrame} />;
  }
  const { container } = render(<Preview />);
  const enter = screen.getByRole("button", { name: "Show full screen" });
  expect(enter.closest(".post-preview-expanded")).toBeNull();
  fireEvent.click(enter);
  const exit = screen.getByRole("button", { name: "Exit full screen" });
  expect(exit.getAttribute("data-agent-label")).toContain("exit fullscreen to collapse");
  const frame = screen.getByTitle("Post preview");
  expect(frame.closest(".post-preview-expanded")).toBe(exit.closest(".post-preview-expanded"));
  expect(exit.closest(".post-preview-expanded")).not.toBeNull();
  expect(frame.getAttribute("src")).toBe(`${url}&refresh=4`);
  expect(frame.getAttribute("sandbox")).toBe("allow-forms");
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(container.querySelector("form")).toBeNull();
  expect(resolvedFrame).toHaveBeenLastCalledWith({ liveUrl: url, templateUrl: url, canShowLiveSite: false }, { navigation: "entry" });
  expect(escape).toHaveBeenLastCalledWith({ expanded: true, onCollapse: expect.any(Function) });
  fireEvent.click(exit);
  expect(screen.getByRole("button", { name: "Show full screen" }).closest(".post-preview-expanded")).toBeNull();
});

test("post actions route draft changes and suppress overlapping saves or publishes", () => {
  const setStatus = vi.fn(), onPublish = vi.fn(), onSave = vi.fn(), onDeleteClick = vi.fn(), onOpenSettings = vi.fn();
  const props = { setStatus, onPublish, onSave, onDeleteClick, onOpenSettings, t: (key: string) => key, Icon: () => null };
  const { rerender } = render(<PostEditorActions {...props} status="draft" saving={false} kindLabel="post" message="Saved version 7" error="Wrong slug" />);
  const status = screen.getByRole<HTMLSelectElement>("combobox", { name: "Status" });
  expect(status.value).toBe("draft");
  fireEvent.change(status, { target: { value: "published" } });
  expect(setStatus).toHaveBeenCalledExactlyOnceWith("published");
  expect(screen.getByText("Saved version 7").classList.contains("save-ok")).toBe(true);
  expect(screen.getByText("Wrong slug").classList.contains("save-error")).toBe(true);
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save" });
  const publish = screen.getByRole<HTMLButtonElement>("button", { name: "Publish" });
  expect(save.classList.contains("btn-secondary")).toBe(true);
  fireEvent.click(publish);
  expect(onPublish).toHaveBeenCalledExactlyOnceWith();
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(save);
  expect(onSave).toHaveBeenCalledExactlyOnceWith();
  fireEvent.click(screen.getByRole("button", { name: "Post settings" }));
  expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith();
  rerender(<PostEditorActions {...props} status="draft" saving kindLabel="post" message={null} error={null} />);
  expect(publish.disabled).toBe(true);
  expect(save.disabled).toBe(true);
  fireEvent.click(publish);
  fireEvent.click(save);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onPublish).toHaveBeenCalledExactlyOnceWith();
  expect(onSave).toHaveBeenCalledExactlyOnceWith();
  expect(onDeleteClick).toHaveBeenCalledExactlyOnceWith();
  rerender(<PostEditorActions {...props} status="published" saving={false} kindLabel="page" message={null} error={null} />);
  expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  expect(screen.queryByText("Saved version 7")).toBeNull();
  expect(screen.queryByText("Wrong slug")).toBeNull();
  expect(screen.getByRole("button", { name: "Page settings" }).getAttribute("title")).toBe("Page settings");
  expect(save.classList.contains("btn-secondary")).toBe(false);
});

const viewTabs = [
  { key: "edit", label: "Edit", handle: "post-mode-edit", agentLabel: "Edit this post" },
  { key: "preview", label: "Preview", handle: "post-mode-preview", agentLabel: "Preview this post" },
] as const;

test("view tabs activate preview, expose its width control and forward the selected template", () => {
  const onTemplate = vi.fn();
  function Probe() {
    const [view, setView] = useState<"edit" | "preview">("edit");
    const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("tablet");
    const [templateChoice, setTemplateChoice] = useState("article");
    return <PostEditorViewBar {...{ view, setView, device, setDevice, templateChoice, setTemplateChoice }}
      onViewTabsKeyDown={event => { if (event.key === "ArrowLeft") setView("edit"); }} t={key => key} bodyFormat="doc"
      availableTemplates={["article", "brief"]} onViewTemplateClick={() => onTemplate(templateChoice)}
      viewTabs={viewTabs} resolveTabBarTabIndex={({ activeId, tab }) => activeId === tab.key ? 0 : -1}
      DevicePreviewToggle={({ device, setDevice, handlePrefix }) =>
        <button data-agent-element={handlePrefix} onClick={() => setDevice("mobile")}>Width {device}</button>}
      PostEditorToolbarEnd={({ view, bodyFormat, availableTemplates, templateChoice, setTemplateChoice, onViewTemplateClick }) =>
        <div>
          <select aria-label={`${view} ${bodyFormat} template`} value={templateChoice ?? ""} onChange={event => setTemplateChoice(event.target.value)}>
            {availableTemplates.map(template => <option key={template} value={template}>{template}</option>)}
          </select>
          <button onClick={onViewTemplateClick}>View template</button>
        </div>} />;
  }
  render(<Probe />);
  const edit = screen.getByRole("tab", { name: "Edit", selected: true });
  const preview = screen.getByRole("tab", { name: "Preview", selected: false });
  expect(edit.tabIndex).toBe(0);
  expect(preview.tabIndex).toBe(-1);
  expect(screen.queryByRole("button", { name: "Width tablet" })).toBeNull();
  fireEvent.click(preview);
  expect(preview.getAttribute("aria-selected")).toBe("true");
  expect(preview.tabIndex).toBe(0);
  expect(edit.tabIndex).toBe(-1);
  const width = screen.getByRole("button", { name: "Width tablet" });
  expect(width.getAttribute("data-agent-element")).toBe("post-preview-width");
  fireEvent.click(width);
  expect(screen.getByRole("button", { name: "Width mobile" }).textContent).toBe("Width mobile");
  fireEvent.change(screen.getByRole("combobox", { name: "preview doc template" }), { target: { value: "brief" } });
  fireEvent.click(screen.getByRole("button", { name: "View template" }));
  expect(onTemplate).toHaveBeenCalledExactlyOnceWith("brief");
  fireEvent.keyDown(preview, { key: "ArrowLeft" });
  expect(edit.getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("button", { name: "Width mobile" })).toBeNull();
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "edit doc template" }).value).toBe("brief");
});
