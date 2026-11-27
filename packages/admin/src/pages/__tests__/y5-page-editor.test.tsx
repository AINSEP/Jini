// @vitest-environment jsdom
import { writePage, PageBodyWriteError } from "@jini-ai/cms/react/pages/hooks/page-editor-save";
import type { ReactNode, ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { PagePreview } from "../PageEditorPreview.js";
import { PageAutosaveStaleBanner, PageVersionConflictBanner } from "../PageEditorNotices.js";
import {
  PAGE_PREVIEW_IFRAME_SANDBOX, THEME_DEFAULT_SENTINEL,
  pageAutosaveStaleBasisMessage, pageVersionConflictMessage, pageDirtyGuardBaseline,
  pageRefreshMayHaveUnsavedEdits, pageEditableHtml, pageAcceptsHtmlBody,
  pagePreviewFormTarget, buildPageAutosaveDraft, buildPageSavePlan, pagePartialSaveMessage,
  pageSaveSuccessMessage, pageUnchangedSaveMessage,
} from "../page-editor-rules.js";
import { pagePreviewYoutubeIds } from "../lib/page-preview-youtube.js";
import { isProtectedEmbedElement, createEmbedPlaceholderDescriber } from "../lib/embed-placeholder.js";
import { prettifyHtml } from "../lib/prettify-html.js";
import { DEVICE_PREVIEW_WIDTHS } from "../../shell/components/DevicePreview/DevicePreview.hooks.js";
import { DevicePreviewFrame } from "../../shell/components/DevicePreview/DevicePreviewFrame.js";
import { unchangedSaveHandlers } from "../../shell/lib/unchanged-save-warning.js";
import { slugRedirectPath } from "../../shell/lib/slug-redirect-path.js";
import { editorTemplateOptions } from "../../shell/lib/editor-template-options.rules.js";
import { expect, test, vi } from "vitest";
import { createPageRouteRules } from "../page-route-rules.js";

afterEach(cleanup);

test("root alias and real home collision keep distinct admin editor paths", () => {
  const rules = createPageRouteRules({ deps: { THEME_DEFAULT_SENTINEL, routeBase: "/pages", rootAlias: "home", shellNames: ["pages-default.html", "page-shell.html"], actions: { details: { key: "details", label: "Details" }, edit: { key: "edit", label: "Edit" } } } });
  expect(rules.pageAdminPath({ id: "root-id", slug: "/" })).toBe("/pages/home");
  expect(rules.pageAdminPath({ id: "home-id", slug: "home" })).toBe("/pages/home-id");
  expect(rules.pageAdminPath({ id: "ordinary-id", slug: "ordinary" })).toBe("/pages/ordinary");
  expect(rules.pagePickerValue({ templateChoice: null, availableTemplates: ["page-shell.html", "pages-default.html"] })).toBe("pages-default.html");
  expect(rules.pagePickerValue({ templateChoice: "", availableTemplates: [] })).toBe("");
  const custom = createPageRouteRules({ deps: { THEME_DEFAULT_SENTINEL: "host-default", routeBase: "/pages", rootAlias: "home", shellNames: [], actions: { details: { key: "details", label: "Details" }, edit: { key: "edit", label: "Edit" } } } });
  expect(custom.pagePickerValue({ templateChoice: null, availableTemplates: [] })).toBe("host-default");
  const handlers = { onOpenDetails: vi.fn(), onEdit: vi.fn() };
  const menu = rules.themePageRowMenuItems({ row: { pageId: "theme-page" }, handlers, t: key => key });
  menu[0]!.onSelect?.();
  menu[1]!.onSelect?.();
  expect(handlers.onOpenDetails).toHaveBeenCalledWith("theme-page");
  expect(handlers.onEdit).toHaveBeenCalledWith({ pageId: "theme-page" });
});

test("preview keeps draft HTML in the hidden POST form across refresh remounts and uses the saved GET identity", () => {
  const readYoutubeIds = vi.fn(pagePreviewYoutubeIds);
  const base = {
    html: '<p>unsaved</p><iframe src="https://www.youtube.com/embed/authored"></iframe>', width: 390, slug: "page", version: 1, status: "draft" as "draft" | "published", dirty: true, contentDirty: true,
    templatePreviewUrl: "/preview", previewFormRef: () => {}, previewFormTarget: "pending-page", frameRef: () => {}, paneWidth: 400,
    expanded: false, onToggleExpanded: () => {}, onFrameLoad: vi.fn(), pageId: "id", templateChoice: null,
    t: (key: string) => key,
    kit: { DevicePreviewFrame: ({ children }: { children: ReactNode }) => <div>{children}</div> },
    deps: { videoLink: ({ id }: { id: string }) => `https://www.youtube.com/watch?v=${id}`, pagePreviewYoutubeIds: readYoutubeIds, previewIframeSandbox: "allow-scripts" },
  };
  let revision = 1;
  const hooks = {
    usePreviewEmbedIds: () => ["video", "video"],
    useThemePreviewFrameHook: ({ canShowLiveSite }: { canShowLiveSite: boolean }) => ({ canShowLiveSite, revision, liveUrl: `/preview?r=${revision}`, templateUrl: `/preview?r=${revision}` }),
  };
  const mounted = render(<PagePreview {...base} hooks={hooks} />);
  const first = screen.getByTitle("Page preview");
  expect(first.getAttribute("sandbox")).toBe("allow-scripts");
  expect(first.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(first.getAttribute("src")).toBeNull();
  expect(first.getAttribute("name")).toBe("pending-page");
  expect(mounted.container.querySelector("form")?.getAttribute("method")).toBe("post");
  expect(mounted.container.querySelector("form")?.getAttribute("target")).toBe("pending-page");
  expect(mounted.container.querySelector("form")?.getAttribute("action")).toBe("/preview?r=1");
  expect(mounted.container.querySelector("input[name=bodyHtml]")?.getAttribute("value")).toBe(base.html);
  expect(screen.getAllByText("Watch on YouTube")).toHaveLength(2);
  expect(readYoutubeIds).toHaveBeenCalledWith({ html: base.html, bodyJson: undefined });
  expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
    "https://www.youtube.com/watch?v=authored", "https://www.youtube.com/watch?v=video",
  ]);
  revision = 2;
  mounted.rerender(<PagePreview {...base} hooks={hooks} />);
  const refreshed = screen.getByTitle("Page preview");
  expect(refreshed).not.toBe(first);
  expect(refreshed.getAttribute("name")).toBe("pending-page");
  expect(mounted.container.querySelector("form")?.getAttribute("target")).toBe("pending-page");
  expect(mounted.container.querySelector("form")?.getAttribute("action")).toBe("/preview?r=2");
  expect(mounted.container.querySelector("input[name=bodyHtml]")?.getAttribute("value")).toBe(base.html);
  mounted.rerender(<PagePreview {...base} hooks={hooks} status="published" dirty={false} />);
  const live = screen.getByTitle("Page preview");
  expect(live.getAttribute("src")).toBe("/preview?r=2");
  expect(live.getAttribute("sandbox")).toBe("allow-scripts");
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

import { useMemo } from "react";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { bindPageEditorHooks, type PageEditorDependencies, type PageEditorController } from "../hooks/use-page-editor.hooks.js";
import { bindPageEditor, type PageEditorProps } from "../PageEditor.js";
import { applySavedPage, applySaveFailure } from "@jini-ai/cms/react/pages/hooks/page-editor-save";
import { pageEditorSurface } from "@jini-ai/cms/react/pages/page-editor-rules";
import { useDirtyGuard, useSettlementGeneration } from "@jini-ai/ui/panel-kit";
import { useInteractiveEditorFlush } from "../hooks/use-interactive-flush.hooks.js";
import { useEditorHtmlJump } from "../hooks/use-editor-html-jump.hooks.js";
import { useExternalEntryRefresh } from "../../shell/hooks/use-external-entry-refresh.hooks.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { AdminPost } from "../../posts/api/posts-api.types.js";

const editorPage: AdminPost = {
  id: "page-id", workspaceId: "workspace", kind: "page", title: "Page", slug: "page", status: "draft",
  bodyFormat: "html", bodyHtml: "<p>saved</p>", bodyJson: {}, updatedAt: "2026-11-25T00:00:00Z", version: 3,
};

function editorBinding({ page = editorPage }: { page?: AdminPost } = {}) {
  let saved = page;
  let refresh: () => void = () => {};
  const scheduleAutosave = vi.fn();
  const port: PageEditorDependencies["port"] = {
    getPage: vi.fn(async () => ({ post: saved })),
    getPresentation: async () => ({ activeThemeTemplates: [], activeThemeId: "theme", activeThemeApiVersion: undefined, activeThemeTier: null }),
    updatePost: vi.fn(async ({ patch }) => ({ post: saved = { ...saved, ...patch, version: saved.version + 1 } })),
    updatePageHtml: vi.fn(async ({ html }) => ({ post: saved = { ...saved, bodyHtml: html, bodyFormat: "html", version: saved.version + 1 } })),
    deletePage: async () => ({ post: saved }), templatePreviewUrl: ({ id }) => `/preview/${id}`,
    putAutosave: async () => ({ applied: true }), getAutosave: async () => ({ autosave: null }), discardAutosave: async () => ({ ok: true }),
  };
  const hooks: PageEditorDependencies["hooks"] = {
    useCachedLoader: ({ fetch }) => useMemo(() => ({ load: (options?: { fetch: typeof fetch }) => (options?.fetch ?? fetch)() }), [fetch]),
    useInvalidate: () => () => {}, useFetchMutation: ({ run }) => ({ mutate: run }),
    useLocaleHook: () => "en", useDevicePreviewDevice: () => ({ device: "desktop", setDevice: () => {} }),
    usePreviewPaneWidth: () => ({ frameRef: () => {}, paneWidth: 900 }), useDirtyGuard, useSettlementGeneration,
    useAgentScreenEntry: () => {}, useExternalEntryRefresh,
    useContentRefreshSubscription: ({ onRefresh }) => { refresh = onRefresh; },
    useStandingDraftAutosave: () => ({ recoverableDraft: null, staleBasis: null, dismissRecoverable: () => {}, scheduleAutosave,
      clearStandingDraft: async () => ({ discarded: true }), supersedeBasis: () => {}, preserveFailedSave: () => {} }),
    useWiredInteractiveEditorFlush: ({ setHtml }) => useInteractiveEditorFlush({ setHtml, isEditorSourceError: () => false,
      normalizeEmbedMarkerQuoting: ({ html }) => html, logger: { warn: () => {} } }),
    useWiredEditorHtmlJump: (required, optional) => useEditorHtmlJump({ ...required, findEditorBlockOpening: () => undefined }, optional),
    useThemeCanvasStyling: () => ({ status: "ready", styling: {} }),
  };
  const deps = {
    port, themeCanvasPort: { fetchThemeTokens: async () => ({}), fetchTemplateMarkup: async () => "", warmStylesheet: async () => {} },
    navigate: vi.fn(), t: ({ key }: { key: string }) => key, HOME_PAGE_HANDLE: "home", PAGES_RESOURCE: "pages",
    pageAdminPath: ({ slug }: { slug: string }) => `/pages/${slug}`, resolveCanvasTemplateChoice: ({ templateChoice }: { templateChoice: string | null }) => templateChoice, isDevMode: false,
    parseEmbedMarkerConfig: () => ({ problem: "none" }), embedMarkerTarget: () => undefined,
    prettifyHtml, unchangedSaveHandlers, pageDirtyGuardBaseline, pageRefreshMayHaveUnsavedEdits,
    pageEditableHtml, pageAcceptsHtmlBody, createEmbedPlaceholderDescriber, slugRedirectPath,
    editorTemplateOptions, pagePreviewFormTarget, buildPageAutosaveDraft, buildPageSavePlan,
    pagePartialSaveMessage, pageSaveSuccessMessage, pageUnchangedSaveMessage,
    writePage, applySavedPage, applySaveFailure, PageBodyWriteError, readVersionConflict: () => null,
    isUnexpectedServerFailure: () => false, setTimeout, clearTimeout, document, window,
  } satisfies Omit<PageEditorDependencies, "locale" | "hooks">;
  const binding = bindPageEditorHooks({ hooks, deps });
  return { ...binding, port, deps, hooks, scheduleAutosave, refresh: () => refresh(), external: (next: AdminPost) => { saved = next; } };
}

test("controller keeps authored documents untouched and validates metadata before writing pending HTML", async () => {
  const doc = { ...editorPage, bodyFormat: "doc" as const, bodyJson: { type: "doc", content: [{ type: "paragraph" }] }, bodyHtml: null };
  const binding = editorBinding({ page: doc });
  const mounted = renderHook(() => binding.useWiredPageEditor({ routeSlug: "page" }));
  await waitFor(() => expect(mounted.result.current.page?.id).toBe(doc.id));
  await act(async () => { await mounted.result.current.save(); });
  expect(binding.port.updatePost).toHaveBeenCalledWith({ target: { id: doc.id }, patch: expect.objectContaining({ bodyJson: doc.bodyJson, expectedVersion: 3 }) });
  expect(binding.port.updatePageHtml).not.toHaveBeenCalled();
  mounted.unmount();
  const html = editorBinding();
  const partial = vi.spyOn(html.deps, "pagePartialSaveMessage");
  const refused = new Error("conflict");
  vi.mocked(html.port.updatePost).mockRejectedValue(refused);
  const editor = renderHook(() => html.useWiredPageEditor({ routeSlug: "page" }));
  await waitFor(() => expect(editor.result.current.page?.id).toBe(editorPage.id));
  act(() => editor.result.current.setHtml("<p>pending</p>"));
  await act(async () => { await editor.result.current.save(); });
  expect(html.port.updatePageHtml).not.toHaveBeenCalled();
  expect(editor.result.current.html).toBe("<p>pending</p>");
  vi.mocked(html.port.updatePost).mockResolvedValue({ post: { ...editorPage, version: 4 } });
  vi.mocked(html.port.updatePageHtml).mockRejectedValue(new Error("body failed"));
  await act(async () => { await editor.result.current.save(); });
  expect(editor.result.current.page?.version).toBe(4);
  expect(editor.result.current.html).toBe("<p>pending</p>");
  expect(editor.result.current.dirty).toBe(true);
  expect(editor.result.current.error).toContain("body failed");
  expect(partial).toHaveBeenCalledWith({ t: html.deps.t, locale: "en", reason: expect.objectContaining({ message: "body failed" }) });
});

test("pending canvas edits flush before save and external updates leave a dirty working copy intact", async () => {
  const binding = editorBinding();
  const editor = renderHook(() => binding.useWiredPageEditor({ routeSlug: "page" }));
  await waitFor(() => expect(editor.result.current.page?.id).toBe(editorPage.id));
  const flush = vi.fn(async () => "<p>pending canvas edit</p>");
  editor.result.current.interactiveEditorRef.current = { flush };
  await act(async () => { await editor.result.current.save(); });
  expect(flush).toHaveBeenCalledTimes(1);
  expect(binding.port.updatePageHtml).toHaveBeenCalledWith({ id: editorPage.id, html: "<p>pending canvas edit</p>", expectedVersion: 4 });
  act(() => editor.result.current.setHtml("<p>unsaved local</p>"));
  binding.external({ ...editorPage, version: 9, bodyHtml: "<p>remote</p>" });
  await act(async () => { binding.refresh(); });
  await waitFor(() => expect(editor.result.current.pendingExternalVersion).toBe(9));
  expect(editor.result.current.html).toBe("<p>unsaved local</p>");
});

test("HTML pane edits preserve exact source in both the displayed draft and the working copy", async () => {
  const binding = editorBinding();
  const current: { value: PageEditorController | null } = { value: null };
  let editorView: PageEditorController["view"] = "html";
  const view: Omit<PageEditorProps, "slug"> = {
    hooks: {
      usePageEditorHook: required => {
        const editor = binding.useWiredPageEditor(required);
        current.value = editor;
        return { ...editor, view: editorView, availableTemplates: ["page.html"] };
      },
      useTabBarKeyboardHook: () => ({ onKeyDown: () => {} }),
      useThemePreviewFrameHook: required => ({ ...required, revision: 0 }),
      usePreviewEmbedIds: () => [], useWiredTermPicker: vi.fn(), useTermListReveal: vi.fn(),
    },
    kit: {
      Icon: () => null, ConfirmDialog: () => null, InteractiveHtmlEditor: () => null,
      DevicePreviewFrame: ({ children }) => <div>{children}</div>, DevicePreviewToggle: () => null,
      ViewTemplateButton: () => null, WiredThemePreviewReloadButton: () => null, TermPicker: () => null,
      SuggestInput: () => null, TemplateSourceModal: () => null, PageExternalChangeBanner: () => null,
    },
    deps: {
      siteUrl: ({ path }) => path, pagePublicPath: ({ slug }) => `/${slug}`,
      pagePickerValue: ({ templateChoice }) => templateChoice ?? "host-default",
      resolveTabBarTabIndex: ({ activeId, tab }) => activeId === tab.id ? 0 : -1,
      standingDraftRecoveryMessage: () => "recover",
      pageExternalChangeBindings: { agentHandle, copy: { messageKey: "changed", regionAgentLabel: "changed", loadLatestAgentLabel: "load", keepEditsAgentLabel: "keep" } },
      pickerValueToChoice: vi.fn(({ value }: { value: string }) => value === "host-default" ? null : value),
      THEME_DEFAULT_SENTINEL: "host-default", pageAutosaveStaleBasisMessage, pageVersionConflictMessage,
      devicePreviewWidths: DEVICE_PREVIEW_WIDTHS, isProtectedEmbedElement: vi.fn(isProtectedEmbedElement), pagePreviewYoutubeIds,
      previewIframeSandbox: PAGE_PREVIEW_IFRAME_SANDBOX,
      pageEditorSurface, videoLink: ({ id }) => `https://www.youtube.com/watch?v=${id}`, isDevMode: false,
    },
  };
  const Editor = bindPageEditor(view);
  const mounted = render(<Editor slug="page" />);
  await screen.findByLabelText("Page HTML");
  const source = "<section> authored\n<strong>text</strong> </section>";
  fireEvent.change(screen.getByLabelText("Page HTML"), { target: { value: source } });
  expect(current.value?.draftHtml).toBe(source);
  expect(current.value?.html).toBe(source);
  expect(screen.getByLabelText<HTMLTextAreaElement>("Page HTML").value).toBe(source);
  expect(screen.getByRole<HTMLOptionElement>("option", { name: "Theme default" }).value).toBe("host-default");
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: "page.html" } });
  expect(view.deps.pickerValueToChoice).toHaveBeenCalledWith({ value: "page.html" });
  await waitFor(() => expect(current.value?.templateChoice).toBe("page.html"));
  // The sentinel option is offered only while it is the current choice (see PageEditorTemplateOptions),
  // so after picking a real template the way back is a real value: "No template" stores "".
  expect(screen.queryByRole("option", { name: "Theme default" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: "" } });
  expect(view.deps.pickerValueToChoice).toHaveBeenLastCalledWith({ value: "" });
  await waitFor(() => expect(current.value?.templateChoice).toBe(""));
  const frame = vi.fn(DevicePreviewFrame);
  view.kit.DevicePreviewFrame = frame;
  view.deps.devicePreviewWidths = { ...DEVICE_PREVIEW_WIDTHS, desktop: 1111 };
  view.deps.previewIframeSandbox = "allow-scripts";
  const videos = vi.fn(pagePreviewYoutubeIds);
  view.deps.pagePreviewYoutubeIds = videos;
  editorView = "preview";
  mounted.rerender(<Editor slug="page" />);
  expect(frame.mock.calls[0]![0].width).toBe(1111);
  expect(videos).toHaveBeenCalledWith({ html: source, bodyJson: undefined });
  expect(screen.getByTitle("Page preview").getAttribute("sandbox")).toBe("allow-scripts");
  const interactive = vi.fn((_props: ComponentProps<PageEditorProps["kit"]["InteractiveHtmlEditor"]>) => null);
  view.kit.InteractiveHtmlEditor = interactive;
  editorView = "interactive";
  mounted.rerender(<Editor slug="page" />);
  expect(interactive.mock.calls[0]![0].isProtectedElement).toBe(view.deps.isProtectedEmbedElement);
});

test("page editor uses host load, formatting, dirty, preview, recovery and save rules", async () => {
  const binding = editorBinding();
  const calls = {
    describe: vi.spyOn(binding.deps, "createEmbedPlaceholderDescriber"),
    redirect: vi.spyOn(binding.deps, "slugRedirectPath"),
    templates: vi.spyOn(binding.deps, "editorTemplateOptions"),
    editable: vi.spyOn(binding.deps, "pageEditableHtml"),
    accepts: vi.spyOn(binding.deps, "pageAcceptsHtmlBody"),
    baseline: vi.spyOn(binding.deps, "pageDirtyGuardBaseline"),
    refresh: vi.spyOn(binding.deps, "pageRefreshMayHaveUnsavedEdits"),
    unchanged: vi.spyOn(binding.deps, "unchangedSaveHandlers"),
    target: vi.spyOn(binding.deps, "pagePreviewFormTarget"),
    draft: vi.spyOn(binding.deps, "buildPageAutosaveDraft"),
    plan: vi.spyOn(binding.deps, "buildPageSavePlan"),
    success: vi.spyOn(binding.deps, "pageSaveSuccessMessage"),
    format: vi.spyOn(binding.deps, "prettifyHtml").mockImplementation(({ html }) => `display:${html}`),
  };
  const editor = renderHook(() => binding.useWiredPageEditor({ routeSlug: "page" }));
  await waitFor(() => expect(editor.result.current.page?.id).toBe(editorPage.id));
  expect(calls.describe).toHaveBeenCalledTimes(1);
  expect(calls.redirect).toHaveBeenCalledWith({ base: "/pages", requestedId: "page", item: editorPage });
  expect(calls.templates).toHaveBeenCalledWith({ templates: [], savedTemplate: undefined });
  expect(calls.editable).toHaveBeenCalledWith(editorPage);
  expect(calls.baseline).toHaveBeenCalledWith({ page: editorPage, savedHtml: editorPage.bodyHtml, savedTemplateChoice: null });
  expect(calls.unchanged).toHaveBeenCalled();
  expect(calls.target).toHaveBeenCalledWith({ page: editorPage });
  expect(editor.result.current.previewFormTarget).toBe("page-preview-pending-page-id");
  act(() => editor.result.current.setView("html"));
  await waitFor(() => expect(editor.result.current.view).toBe("html"));
  expect(editor.result.current.draftHtml).toBe(`display:${editorPage.bodyHtml}`);
  expect(editor.result.current.html).toBe(editorPage.bodyHtml);
  expect(editor.result.current.dirty).toBe(false);
  act(() => editor.result.current.setHtml("<p>pending</p>"));
  expect(calls.accepts).toHaveBeenCalledWith({ page: editorPage, html: "<p>pending</p>" });
  expect(calls.draft).toHaveBeenCalledWith({ page: editorPage, form: { title: "Page", slug: "page", html: "<p>pending</p>" } });
  expect(binding.scheduleAutosave).toHaveBeenCalledWith({ bodyFormat: "html", bodyHtml: "<p>pending</p>", title: "Page", slug: "page", baseVersion: 3 });
  await act(async () => { await editor.result.current.save(); });
  expect(calls.plan).toHaveBeenCalledWith({ page: editorPage, form: { title: "Page", slug: "page", status: "draft", templateChoice: null, html: "<p>pending</p>" } }, { nextStatus: undefined });
  expect(calls.success).toHaveBeenCalled();
  expect(editor.result.current.message).toBe("Saved");
  binding.external({ ...editorPage, version: 9, bodyHtml: "<p>remote</p>" });
  await act(async () => { binding.refresh(); });
  await waitFor(() => expect(editor.result.current.html).toBe("<p>remote</p>"));
  expect(editor.result.current.draftHtml).toBe("display:<p>remote</p>");
  expect(calls.editable).toHaveBeenCalledWith({ ...editorPage, version: 9, bodyHtml: "<p>remote</p>" });
  expect(calls.refresh).toHaveBeenCalled();
  expect(calls.describe).toHaveBeenCalledTimes(1);
});

test("restored drafts format only the display and unchanged saves use the host message", async () => {
  const binding = editorBinding();
  const autosave = {
    ...binding.hooks.useStandingDraftAutosave({ port: binding.port, entryId: editorPage.id, enabled: true }),
    recoverableDraft: { bodyFormat: "html" as const, bodyHtml: "<p>restored</p>", title: "Recovered", slug: "recovered", baseVersion: 3, savedAt: editorPage.updatedAt, savedByPrincipalId: "owner" },
  };
  binding.hooks.useStandingDraftAutosave = () => autosave;
  const format = vi.spyOn(binding.deps, "prettifyHtml").mockImplementation(({ html }) => `display:${html}`);
  const unchanged = vi.spyOn(binding.deps, "pageUnchangedSaveMessage");
  vi.mocked(binding.port.updatePost).mockResolvedValue({ post: editorPage });
  vi.mocked(binding.port.updatePageHtml).mockResolvedValue({ post: editorPage });
  const editor = renderHook(() => binding.useWiredPageEditor({ routeSlug: "page" }));
  await waitFor(() => expect(editor.result.current.page?.id).toBe(editorPage.id));
  await act(async () => { await editor.result.current.save(); });
  expect(unchanged).toHaveBeenCalledWith({ t: binding.deps.t, locale: "en", version: 3 });
  expect(editor.result.current.message).toBe("No changes found · nothing new saved (version 3)");
  act(() => editor.result.current.restoreRecoveredDraft());
  expect(format).toHaveBeenCalledWith({ html: "<p>restored</p>" });
  expect(editor.result.current.html).toBe("<p>restored</p>");
  expect(editor.result.current.draftHtml).toBe("display:<p>restored</p>");
  expect(editor.result.current.contentRevision).toBe(1);
});

test("page change notices use the host message functions", () => {
  const stale = vi.fn(pageAutosaveStaleBasisMessage).mockReturnValue("HOST STALE V3");
  const conflict = vi.fn(pageVersionConflictMessage).mockReturnValue("HOST CONFLICT V4");
  const draft = { bodyFormat: "html" as const, bodyHtml: "<p>pending</p>", title: "Page", slug: "page", baseVersion: 3 };
  const t = (key: string) => key;
  const mounted = render(<PageAutosaveStaleBanner staleBasis={{ baseVersion: 3, draft }} t={t} deps={{ pageAutosaveStaleBasisMessage: stale }} />);
  expect(stale).toHaveBeenCalledWith({ t, baseVersion: 3, draft });
  expect(screen.getByText("HOST STALE V3").textContent).toBe("HOST STALE V3");
  mounted.rerender(<PageVersionConflictBanner saveConflict={{ expectedVersion: 3, currentVersion: 4, attemptedStatus: undefined }}
    onSaveAnyway={() => {}} onLoadLatest={() => {}} onDismiss={() => {}} t={t} deps={{ pageVersionConflictMessage: conflict }} />);
  expect(conflict).toHaveBeenCalledWith({ t, expectedVersion: 3, currentVersion: 4, attemptedStatus: undefined });
  expect(screen.getByText("HOST CONFLICT V4").textContent).toBe("HOST CONFLICT V4");
});
