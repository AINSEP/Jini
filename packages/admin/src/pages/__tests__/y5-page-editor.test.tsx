import { writePage, PageBodyWriteError } from "@jini-ai/cms/react/pages/hooks/page-editor-save";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { PagePreview } from "../PageEditorPreview.js";
import { PAGE_PREVIEW_IFRAME_SANDBOX } from "../page-editor-rules.js";
import { expect, test, vi } from "vitest";
import { createPageRouteRules } from "../page-route-rules.js";

afterEach(cleanup);

test("root alias and real home collision keep distinct admin editor paths", () => {
  const rules = createPageRouteRules({ deps: { routeBase: "/pages", rootAlias: "home", shellNames: ["pages-default.html", "page-shell.html"], actions: { details: { key: "details", label: "Details" }, edit: { key: "edit", label: "Edit" } } } });
  expect(rules.pageAdminPath({ id: "root-id", slug: "/" })).toBe("/pages/home");
  expect(rules.pageAdminPath({ id: "home-id", slug: "home" })).toBe("/pages/home-id");
  expect(rules.pageAdminPath({ id: "ordinary-id", slug: "ordinary" })).toBe("/pages/ordinary");
  expect(rules.pagePickerValue({ templateChoice: null, availableTemplates: ["page-shell.html", "pages-default.html"] })).toBe("pages-default.html");
  expect(rules.pagePickerValue({ templateChoice: "", availableTemplates: [] })).toBe("");
  const handlers = { onOpenDetails: vi.fn(), onEdit: vi.fn() };
  const menu = rules.themePageRowMenuItems({ row: { pageId: "theme-page" }, handlers, t: key => key });
  menu[0]!.onSelect?.();
  menu[1]!.onSelect?.();
  expect(handlers.onOpenDetails).toHaveBeenCalledWith("theme-page");
  expect(handlers.onEdit).toHaveBeenCalledWith({ pageId: "theme-page" });
});

test("preview keeps draft HTML in the hidden POST form across refresh remounts and uses the saved GET identity", () => {
  const base = {
    html: "<p>unsaved</p>", width: 390, slug: "page", version: 1, status: "draft" as "draft" | "published", dirty: true, contentDirty: true,
    templatePreviewUrl: "/preview", previewFormRef: () => {}, previewFormTarget: "pending-page", frameRef: () => {}, paneWidth: 400,
    expanded: false, onToggleExpanded: () => {}, onFrameLoad: vi.fn(), pageId: "id", templateChoice: null,
    t: (key: string) => key,
    kit: { DevicePreviewFrame: ({ children }: { children: ReactNode }) => <div>{children}</div> },
    deps: { videoLink: ({ id }: { id: string }) => `https://www.youtube.com/watch?v=${id}` },
  };
  let revision = 1;
  const hooks = {
    usePreviewEmbedIds: () => ["video", "video"],
    useThemePreviewFrameHook: ({ canShowLiveSite }: { canShowLiveSite: boolean }) => ({ canShowLiveSite, revision, liveUrl: `/preview?r=${revision}`, templateUrl: `/preview?r=${revision}` }),
  };
  const mounted = render(<PagePreview {...base} hooks={hooks} />);
  const first = screen.getByTitle("Page preview");
  expect(first.getAttribute("sandbox")).toBe(PAGE_PREVIEW_IFRAME_SANDBOX);
  expect(first.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(first.getAttribute("src")).toBeNull();
  expect(mounted.container.querySelector("form")?.getAttribute("method")).toBe("post");
  expect(mounted.container.querySelector("form")?.getAttribute("target")).toBe("pending-page");
  expect(mounted.container.querySelector("input[name=bodyHtml]")?.getAttribute("value")).toBe("<p>unsaved</p>");
  expect(screen.getAllByText("Watch on YouTube")).toHaveLength(1);
  revision = 2;
  mounted.rerender(<PagePreview {...base} hooks={hooks} />);
  expect(screen.getByTitle("Page preview")).not.toBe(first);
  expect(mounted.container.querySelector("input[name=bodyHtml]")?.getAttribute("value")).toBe("<p>unsaved</p>");
  mounted.rerender(<PagePreview {...base} hooks={hooks} status="published" dirty={false} />);
  const live = screen.getByTitle("Page preview");
  expect(live.getAttribute("src")).toBe("/preview?r=2");
  expect(mounted.container.querySelector("form")).toBeNull();
  mounted.rerender(<PagePreview {...base} hooks={hooks} status="published" dirty={false} version={2} />);
  expect(screen.getByTitle("Page preview")).not.toBe(live);
});

test("metadata conflict prevents the body write and partial HTML failure preserves the saved metadata row", async () => {
  const plan = { canSaveHtml: true, statusToWrite: "draft" as const, updatePostPayload: { title: "Page", slug: "page", status: "draft" as const, templateChoice: null, expectedVersion: 3 } };
  const conflict = new Error("version conflict");
  const updatePageHtml = vi.fn(async () => ({ post: { slug: "page", status: "draft" as const, version: 5 } }));
  await expect(writePage({ port: { updatePost: async () => { throw conflict; }, updatePageHtml }, pageId: "page-id", plan, html: "<p>draft</p>" })).rejects.toBe(conflict);
  expect(updatePageHtml).not.toHaveBeenCalled();
  const savedRow = { slug: "page", status: "draft" as const, version: 4 };
  const bodyFailure = new Error("body failed");
  const events: string[] = [];
  const pending = writePage({ port: {
    updatePost: async () => { events.push("metadata"); return { post: savedRow }; },
    updatePageHtml: async required => { events.push("body"); expect(required.expectedVersion).toBe(4); throw bodyFailure; },
  }, pageId: "page-id", plan, html: "<p>draft</p>" });
  await expect(pending).rejects.toBeInstanceOf(PageBodyWriteError);
  await expect(pending).rejects.toMatchObject({ savedRow, reason: bodyFailure });
  expect(events).toEqual(["metadata", "body"]);
});
