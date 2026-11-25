import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
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
