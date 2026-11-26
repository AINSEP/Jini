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
    useStandingDraftAutosave: () => ({ recoverableDraft: null, staleBasis: null, dismissRecoverable: () => {}, scheduleAutosave: () => {},
      clearStandingDraft: async () => ({ discarded: true }), supersedeBasis: () => {}, preserveFailedSave: () => {} }),
    useWiredInteractiveEditorFlush: ({ setHtml }) => useInteractiveEditorFlush({ setHtml, isEditorSourceError: () => false,
      normalizeEmbedMarkerQuoting: ({ html }) => html, logger: { warn: () => {} } }),
    useWiredEditorHtmlJump: (required, optional) => useEditorHtmlJump({ ...required, findEditorBlockOpening: () => undefined }, optional),
    useThemeCanvasStyling: () => ({ status: "ready", styling: {} }),
  };
  const deps = {
    port, themeCanvasPort: { fetchThemeTokens: async () => ({}), fetchTemplateMarkup: async () => "", warmStylesheet: async () => {} },
    navigate: vi.fn(), t: ({ key }: { key: string }) => key, HOME_PAGE_HANDLE: "home", PAGES_RESOURCE: "pages",
    pageAdminPath: ({ slug }: { slug: string }) => `/pages/${slug}`, resolveCanvasTemplateChoice: ({ templateChoice }: { templateChoice: string | null }) => templateChoice,
    parseEmbedMarkerConfig: () => ({ problem: "none" }), embedMarkerTarget: () => undefined,
    writePage, applySavedPage, applySaveFailure, PageBodyWriteError, readVersionConflict: () => null,
    isUnexpectedServerFailure: () => false, setTimeout, clearTimeout, document, window,
  } satisfies Omit<PageEditorDependencies, "locale" | "hooks">;
  const binding = bindPageEditorHooks({ hooks, deps });
  return { ...binding, port, refresh: () => refresh(), external: (next: AdminPost) => { saved = next; } };
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
  const view: Omit<PageEditorProps, "slug"> = {
    hooks: {
      usePageEditorHook: required => {
        const editor = binding.useWiredPageEditor(required);
        current.value = editor;
        return { ...editor, view: "html" };
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
      pagePickerValue: ({ templateChoice }) => templateChoice ?? "__theme-default__",
      resolveTabBarTabIndex: ({ activeId, tab }) => activeId === tab.id ? 0 : -1,
      standingDraftRecoveryMessage: () => "recover",
      pageExternalChangeBindings: { agentHandle, copy: { messageKey: "changed", regionAgentLabel: "changed", loadLatestAgentLabel: "load", keepEditsAgentLabel: "keep" } },
      pageEditorSurface, videoLink: ({ id }) => `https://www.youtube.com/watch?v=${id}`,
    },
  };
  const Editor = bindPageEditor(view);
  render(<Editor slug="page" />);
  await screen.findByLabelText("Page HTML");
  const source = "<section> authored\n<strong>text</strong> </section>";
  fireEvent.change(screen.getByLabelText("Page HTML"), { target: { value: source } });
  expect(current.value?.draftHtml).toBe(source);
  expect(current.value?.html).toBe(source);
  expect(screen.getByLabelText<HTMLTextAreaElement>("Page HTML").value).toBe(source);
});
