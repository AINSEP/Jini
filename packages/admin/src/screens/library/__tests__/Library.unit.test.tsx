// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FileDropzone, Toast } from "@jini-ai/ui";
import { TabBar } from "@jini-ai/ui/tab-strip";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

import { render, testAdminKit } from "../../../__tests__/fetch-query-support.js";
import { AdminKitProvider, type AdminKit } from "../../../react/kit.js";
import { useRouteLocation } from "../../../shell/lib/router.js";
import { deferred } from "../../../widgets/__tests__/fixtures/controller-harness.js";
import { Library } from "../Library.js";
import { type LibraryController, type LibraryDependencies, type LibraryPreviewState, useLibrary } from "../hooks/use-library.hooks.js";
import type { LibraryPort } from "../hooks/library-port.hooks.js";
import { libraryDocument } from "./library-document-fixture.js";

const kit: AdminKit = {
  ...testAdminKit,
  components: {
    ...testAdminKit.components,
    TabBar,
    Toast,
    FileDropzone: ({ onFiles, accept, prompt, helper }) => (
      <FileDropzone onFiles={onFiles} {...(accept === undefined ? {} : { accept })}
        {...(prompt === undefined ? {} : { prompt })} {...(helper === undefined ? {} : { helper })} />
    ),
  },
};

function Kit({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
}
const inKit = (node: ReactNode) => render(node, { wrapper: Kit });
const t = (key: string) => key;
const guide = libraryDocument({ id: "guide/1", title: "Field guide", extension: "md", createdAt: "2026-11-20T09:30:00" });
const policy = libraryDocument({ id: "policy/2", title: "Refund policy", extension: "docx", createdBy: null });
const permissions = { known: true, canUpload: true, canRename: true, canTrash: true };
const initialUrl = window.location.href;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", initialUrl);
});

function controller(overrides: Partial<LibraryController> = {}): LibraryController {
  return {
    t, locale: "en", documents: [guide, policy], listError: null, permissions, userNames: new Map([["author-7", "Lina"]]),
    uploads: [], uploadedCount: 0, addFiles: vi.fn(), clearUploads: vi.fn(),
    rename: { editingId: null, draft: "", invalid: false, saving: false, setDraft: vi.fn(), start: vi.fn(), cancel: vi.fn(), save: vi.fn(async () => {}) },
    trash: vi.fn(async () => {}), trashingId: null, rowError: null, notice: null, dismissNotice: vi.fn(),
    preview: null, openPreview: vi.fn(), closePreview: vi.fn(),
    downloadUrl: ({ item }) => `/admin/media/${encodeURIComponent(item.id)}/original`,
    ...overrides,
  };
}

function RoutedLibrary({ useController }: { useController: () => LibraryController }) {
  const route = useRouteLocation();
  return <Library tabId={new URL(route, window.location.origin).searchParams.get("tab")} useLibraryHook={useController} />;
}

function documentMenu(name: string) {
  const menuName = `Actions for "${name}"`;
  fireEvent.click(screen.getByRole("button", { name: menuName }));
  return within(screen.getByRole("menu", { name: menuName }));
}

it("falls back to Upload, labels and counts the Documents tab, and replaces the route when switching tabs", () => {
  window.history.replaceState(null, "", "/admin/library?tab=retired");
  const count = window.history.length;
  const model = controller({ rowError: "Rename was refused" });
  inKit(<RoutedLibrary useController={() => model} />);
  expect(screen.getByRole("heading", { name: "Library" }).textContent).toBe("Library");
  expect(screen.getByRole("alert").textContent).toBe("Rename was refused");
  expect(screen.getByRole("tab", { name: "Upload" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("table", { name: "Documents" })).toBeNull();
  const docsTab = screen.getByRole("tab", { name: /^Documents/ });
  expect(docsTab.textContent).toBe("Documents2");
  fireEvent.click(docsTab);
  expect(window.location.pathname + window.location.search).toBe("/admin/library?tab=documents");
  expect(window.history.length).toBe(count);
  expect(docsTab).toHaveAttribute("aria-selected", "true");

  const row = within(screen.getByRole("row", { name: /Field guide\.md/ }));
  for (const name of ["MD", "1.5 KB", "2026-11-20 09:30", "Lina"]) expect(row.getByRole("cell", { name })).toHaveTextContent(name);
  expect(within(screen.getByRole("row", { name: /Refund policy\.docx/ })).getByRole("cell", { name: "Unknown" })).toHaveTextContent("Unknown");
  fireEvent.click(row.getByRole("button", { name: "Field guide.md" }));
  expect(model.openPreview).toHaveBeenCalledExactlyOnceWith(guide);
});

it("distinguishes a loading list, a failed list and an empty library", () => {
  const view = inKit(<Library tabId="documents" useLibraryHook={() => controller({ documents: undefined })} />);
  expect(screen.getByText("Loading documents…")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Documents" }).textContent).toBe("Documents");
  expect(screen.queryByText("No documents yet.")).toBeNull();
  view.rerender(<Library tabId="documents" useLibraryHook={() => controller({ documents: undefined, listError: "Documents request was refused" })} />);
  expect(screen.getByText("Documents request was refused")).toBeInTheDocument();
  expect(screen.queryByText("Loading documents…")).toBeNull();
  view.rerender(<Library tabId="documents" useLibraryHook={() => controller({ documents: [] })} />);
  expect(screen.getByText("No documents yet.")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /^Documents/ }).textContent).toBe("Documents0");
  expect(screen.queryByText("Documents request was refused")).toBeNull();
});

it("opens the real dropzone picker and forwards selected files, but hides it when upload is denied", async () => {
  const addFiles = vi.fn<LibraryController["addFiles"]>();
  const client = userEvent.setup();
  const { container, rerender } = inKit(<Library useLibraryHook={() => controller({ addFiles })} />);
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!picker) throw new Error("No native document picker");
  const picked = new File(["Notes"], "Agenda.md", { type: "text/markdown" });
  const open = vi.spyOn(picker, "click");
  expect(picker.accept.split(",")).toContain(".md");
  fireEvent.click(screen.getByRole("button", { name: "Upload documents" }));
  expect(open).toHaveBeenCalledExactlyOnceWith();
  await client.upload(picker, picked);
  expect(addFiles).toHaveBeenCalledExactlyOnceWith([picked]);

  rerender(<Library useLibraryHook={() => controller({ addFiles, permissions: { ...permissions, canUpload: false } })} />);
  expect(screen.getByText("You don't have permission to upload documents.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Upload documents" })).toBeNull();
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

it("leaves ordinary drops to the dropzone rather than consuming them as macOS packages", async () => {
  const addFiles = vi.fn<LibraryController["addFiles"]>();
  inKit(<Library useLibraryHook={() => controller({ addFiles })} />);
  const zone = screen.getByRole("button", { name: /Add files/ });
  const notes = new File(["private notes"], "idea.txt", { type: "text/plain" });
  fireEvent.drop(zone, { dataTransfer: { files: [notes] } });
  await waitFor(() => expect(addFiles).toHaveBeenCalledExactlyOnceWith([notes]));
});

it("treats dropped iWork folders as single rejected-package candidates and keeps loose documents", async () => {
  const addFiles = vi.fn<LibraryController["addFiles"]>();
  inKit(<Library useLibraryHook={() => controller({ addFiles })} />);
  const zone = screen.getByRole("button", { name: /Add files/ });
  const loose = new File(["keep"], "notes.txt", { type: "text/plain" });
  const directoryReader = vi.fn(() => { throw new Error("Package contents must not be read"); });
  const packageItem = (name: string, file: File | null) => ({
    kind: "file", getAsFile: () => file,
    webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name, createReader: directoryReader }),
  });
  const items = [
    packageItem("Quarterly.KEY", new File(["folder placeholder"], "Quarterly.KEY")),
    packageItem("Ordinary folder", null),
    packageItem("Memo.pages", null),
    { kind: "file", getAsFile: () => loose },
  ];
  await act(async () => { expect(fireEvent.drop(zone, { dataTransfer: { items, files: [loose] } })).toBe(false); });
  expect(directoryReader).not.toHaveBeenCalled();
  expect(addFiles).toHaveBeenCalledTimes(1);
  const [candidates] = addFiles.mock.calls[0]!;
  expect(candidates.map(({ name, size }) => [name, size])).toEqual([["Quarterly.KEY", 0], ["Memo.pages", 0], ["notes.txt", 4]]);
  expect(candidates[2]).toBe(loose);
});

it("announces each upload status on its own row and keeps unfinished work when clearing the list", () => {
  window.history.replaceState(null, "", "/admin/library");
  const uploads: LibraryController["uploads"] = [
    { key: "queued", name: "queued.txt", size: 12, status: "waiting", error: null },
    { key: "active", name: "working.txt", size: 1536, status: "uploading", error: null },
    { key: "done", name: "uploaded.txt", size: 1, status: "done", error: null },
    { key: "denied", name: "denied.txt", size: 7, status: "failed", error: "Storage quota exceeded" },
    { key: "lost", name: "lost.txt", size: 6, status: "failed", error: null },
  ];
  function Harness() {
    const [rows, setRows] = useState(uploads);
    return <Library useLibraryHook={() => controller({
      uploads: rows, uploadedCount: rows.filter((row) => row.status === "done").length,
      clearUploads: () => setRows(rows.filter((row) => row.status === "waiting" || row.status === "uploading")),
    })} />;
  }
  inKit(<Harness />);
  const row = (filename: string) => within(screen.getByText(filename).closest("li")!);
  expect(row("queued.txt").getByText("Waiting…")).toBeInTheDocument();
  expect(row("working.txt").getByText("Uploading…")).toBeInTheDocument();
  expect(row("working.txt").getByText("1.5 KB")).toBeInTheDocument();
  expect(row("uploaded.txt").getByText("Uploaded")).toBeInTheDocument();
  expect(row("denied.txt").getByRole("alert").textContent).toBe("Storage quota exceeded");
  expect(row("lost.txt").getByRole("alert").textContent).toBe("Upload failed.");
  const length = window.history.length;
  fireEvent.click(screen.getByRole("button", { name: "View in Documents" }));
  expect(window.location.pathname + window.location.search).toBe("/admin/library?tab=documents");
  expect(window.history.length).toBe(length);
  fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
  expect(within(screen.getByRole("list", { name: "Uploads" })).getAllByRole("listitem")).toHaveLength(2);
  expect(row("queued.txt").getByText("Waiting…")).toBeInTheDocument();
  expect(row("working.txt").getByText("Uploading…")).toBeInTheDocument();
  expect(screen.queryByText("uploaded.txt")).toBeNull();
  expect(screen.queryByRole("button", { name: "View in Documents" })).toBeNull();
});

it("offers cleanup but not the Documents shortcut when every finished upload failed", () => {
  const clearUploads = vi.fn();
  inKit(<Library useLibraryHook={() => controller({
    uploads: [{ key: "failure", name: "invalid.txt", size: 0, status: "failed", error: "This file is empty." }],
    clearUploads,
  })} />);
  expect(screen.getByRole("alert").textContent).toBe("This file is empty.");
  expect(screen.queryByRole("button", { name: "View in Documents" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
  expect(clearUploads).toHaveBeenCalledExactlyOnceWith();
});

it("offers only Download for a read-only Office document, and downloads the exact attachment", () => {
  const clicked: { href: string | null; rel: string; download: string | null; attached: boolean }[] = [];
  let anchor: HTMLAnchorElement | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    anchor = this;
    clicked.push({ href: this.getAttribute("href"), rel: this.rel, download: this.getAttribute("download"), attached: this.isConnected });
  });
  const model = controller({ permissions: { ...permissions, canRename: false, canTrash: false } });
  inKit(<Library tabId="documents" useLibraryHook={() => model} />);
  const menu = documentMenu("Refund policy.docx");
  expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Download"]);
  fireEvent.click(menu.getByRole("menuitem", { name: "Download" }));
  expect(clicked).toEqual([{ href: "/admin/media/policy%2F2/original", rel: "noopener", download: "", attached: true }]);
  expect(anchor?.isConnected).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Refund policy.docx" }));
  expect(model.openPreview).toHaveBeenCalledExactlyOnceWith(policy);
});

function mountedLibrary() {
  const rows = new Map([[guide.id, guide], [policy.id, policy]]);
  function lookup(id: string) {
    const item = rows.get(id);
    if (!item || item.status !== "active") throw new Error(`Document ${id} is not active`);
    return item;
  }
  const renameReply = deferred<void>();
  const trashReply = deferred<void>();
  const port = {
    listDocuments: vi.fn<LibraryPort["listDocuments"]>(async () => ({ media: [...rows.values()].filter((item) => item.status === "active") })),
    me: vi.fn<LibraryPort["me"]>(async () => ({ effectivePermissions: ["media.read", "media.update", "media.delete"] })),
    documentDownloadUrl: vi.fn<LibraryPort["documentDownloadUrl"]>(({ id }) => `/admin/media/${encodeURIComponent(lookup(id).id)}/original`),
    renameDocument: vi.fn<LibraryPort["renameDocument"]>(async ({ target: { id }, input: { title } }) => {
      const before = lookup(id);
      await renameReply.promise;
      const media = { ...before, title, displayFilename: `${title}.md`, version: before.version + 1 };
      rows.set(id, media);
      return { media };
    }),
    trashDocument: vi.fn<LibraryPort["trashDocument"]>(async ({ id }) => {
      const before = lookup(id);
      await trashReply.promise;
      const media = { ...before, status: "trashed" } as const;
      rows.set(id, media);
      return { media };
    }),
    uploadDocument: vi.fn<LibraryPort["uploadDocument"]>().mockRejectedValue(new Error("Unexpected upload")),
    readDocumentText: vi.fn<LibraryPort["readDocumentText"]>().mockRejectedValue(new Error("Unexpected text read")),
    fetchDocumentBlob: vi.fn<LibraryPort["fetchDocumentBlob"]>().mockRejectedValue(new Error("Unexpected blob read")),
  };
  const deps: LibraryDependencies = {
    port, t, locale: "en", describeApiError: ({ e, fallback }) => e instanceof Error ? e.message : fallback,
    readFileAsBase64: async () => { throw new Error("Unexpected file read"); },
    renderMarkdownToSafeHtml: () => { throw new Error("Unexpected Markdown render"); },
    useContentRefreshSubscription: () => {},
  };
  const view = inKit(<Library tabId="documents" useLibraryHook={() => useLibrary(deps)} />);
  return { ...view, port, renameReply, trashReply };
}

it("renames the intended row with Enter, preserves its extension, and exposes the saved change on the list", async () => {
  const { port, renameReply } = mountedLibrary();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Field guide.md" });
  fireEvent.click(await documentMenu("Field guide.md").findByRole("menuitem", { name: "Rename" }));
  const input = screen.getByRole("textbox", { name: "New name" });
  const editor = within(input.closest("tr")!);
  expect(input).toHaveFocus();
  expect(input).toHaveValue("Field guide");
  expect(editor.getByText(".md")).toBeInTheDocument();

  fireEvent.change(input, { target: { value: " " } });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.keyboard("{Enter}");
  expect(port.renameDocument).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "  Operations handbook  " } });
  expect(input).not.toHaveAttribute("aria-invalid");
  await user.keyboard("{ArrowLeft}");
  expect(port.renameDocument).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(editor.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(port.renameDocument).toHaveBeenCalledExactlyOnceWith({ target: { id: "guide/1" }, input: { title: "Operations handbook" } });
  await act(async () => { renameReply.resolve(); });
  expect(await screen.findByRole("button", { name: "Operations handbook.md" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Field guide.md" })).toBeNull();
  expect(screen.getByRole("button", { name: "Refund policy.docx" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "New name" })).toBeNull();
});

it("cancels inline rename on Escape or Cancel and supports saving a new draft by clicking Save", async () => {
  const { port, renameReply } = mountedLibrary();
  await screen.findByRole("button", { name: "Field guide.md" });
  const rename = async () => fireEvent.click(await documentMenu("Field guide.md").findByRole("menuitem", { name: "Rename" }));

  await rename();
  const first = screen.getByRole("textbox", { name: "New name" });
  fireEvent.change(first, { target: { value: "Discard me" } });
  expect(fireEvent.keyDown(first, { key: "Escape" })).toBe(false);
  expect(screen.getByRole("button", { name: "Field guide.md" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "New name" })).toBeNull();
  expect(port.renameDocument).not.toHaveBeenCalled();

  await rename();
  expect(screen.getByRole("textbox", { name: "New name" })).toHaveValue("Field guide");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox", { name: "New name" })).toBeNull();
  expect(port.renameDocument).not.toHaveBeenCalled();

  await rename();
  fireEvent.change(screen.getByRole("textbox", { name: "New name" }), { target: { value: "Published guide" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(port.renameDocument).toHaveBeenCalledExactlyOnceWith({ target: { id: "guide/1" }, input: { title: "Published guide" } }));
  await act(async () => { renameReply.resolve(); });
  expect(await screen.findByRole("button", { name: "Published guide.md" })).toBeInTheDocument();
});

it("moves only the selected document to Trash and offers a dismissible restore shortcut", async () => {
  window.history.replaceState(null, "", "/admin/library?tab=documents");
  const { port, trashReply } = mountedLibrary();
  await screen.findByRole("button", { name: "Field guide.md" });
  fireEvent.click(await documentMenu("Refund policy.docx").findByRole("menuitem", { name: "Move to Trash" }));
  const row = within(screen.getByRole("row", { name: /Refund policy\.docx/ }));
  expect(row.getByText("Moving…")).toBeInTheDocument();
  expect(row.queryByRole("button", { name: 'Actions for "Refund policy.docx"' })).toBeNull();
  expect(port.trashDocument).toHaveBeenCalledExactlyOnceWith({ id: "policy/2" });
  await act(async () => { trashReply.resolve(); });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Refund policy.docx" })).toBeNull());
  expect(screen.getByRole("button", { name: "Field guide.md" })).toBeInTheDocument();
  const toast = within(await screen.findByRole("status"));
  expect(toast.getByText("Moved to Trash.")).toBeInTheDocument();
  fireEvent.click(toast.getByRole("button", { name: "Open Trash" }));
  expect(window.location.pathname + window.location.search).toBe("/admin/trash");
  fireEvent.click(toast.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
});

function previewOf(item: AdminMedia, kind: LibraryPreviewState["kind"], overrides: Partial<LibraryPreviewState> = {}): LibraryPreviewState {
  return { item, kind, loading: false, error: null, text: null, html: null, pdfUrl: null, truncated: false, ...overrides };
}

it("opens the Markdown row's Preview action and renders the answer in a themed, network-blocked scriptless frame", () => {
  function Harness() {
    const [preview, setPreview] = useState<LibraryPreviewState | null>(null);
    const model = controller({
      preview, openPreview: (item) => setPreview(previewOf(item, "markdown", { html: "<h1>Field notes</h1><p>Chapter one</p>" })),
      closePreview: () => setPreview(null),
    });
    return <>
      <style>{".jini-library-preview-frame-host { color: rgb(25, 40, 55); --link: lime; --border: navy; }"}</style>
      <Library tabId="documents" useLibraryHook={() => model} />
    </>;
  }
  inKit(<Harness />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(documentMenu("Field guide.md").getByRole("menuitem", { name: "Preview" }));
  const dialog = screen.getByRole("dialog", { name: "Field guide.md" });
  const frame = within(dialog).getByTitle("Field guide.md");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  const html = frame.getAttribute("srcdoc");
  if (!html) throw new Error("Markdown frame did not receive the document");
  const srcDoc = new DOMParser().parseFromString(html, "text/html");
  expect(srcDoc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"))
    .toBe("default-src 'none'; style-src 'unsafe-inline'");
  expect(srcDoc.querySelector("h1")?.textContent).toBe("Field notes");
  expect(srcDoc.querySelector("p")?.textContent).toBe("Chapter one");
  const style = srcDoc.querySelector("style")?.textContent ?? "";
  expect(style).toContain("color:rgb(25, 40, 55)");
  expect(style).toContain("a{color:lime}");
  expect(style).toContain("border-left:3px solid navy");

  expect(within(dialog).getByRole("link", { name: "Download" })).toHaveAttribute("href", "/admin/media/guide%2F1/original");
  expect(within(dialog).getByRole("link", { name: "Download" })).toHaveAttribute("download", "");
  expect(within(dialog).getByText("MD · 1.5 KB")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("heading"));
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  expect(dialog).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

function PreviewHarness({ preview }: { preview: LibraryPreviewState }) {
  const [closed, setClosed] = useState(false);
  return <Library useLibraryHook={() => controller({ preview: closed ? null : preview, closePreview: () => setClosed(true) })} />;
}

it("shows text preview progress, error and escaped truncated output without changing the attachment", () => {
  const log = libraryDocument({ id: "log/3", title: "Upload log", extension: "txt" });
  const view = inKit(<PreviewHarness preview={previewOf(log, "text", { loading: true })} />);
  const dialog = () => within(screen.getByRole("dialog", { name: "Upload log.txt" }));
  expect(dialog().getByText("Loading preview…")).toBeInTheDocument();
  view.rerender(<PreviewHarness preview={previewOf(log, "text", { error: "The document was deleted" })} />);
  expect(dialog().getByText("The document was deleted")).toBeInTheDocument();
  expect(dialog().queryByText("Loading preview…")).toBeNull();

  const text = '<strong data-log="1">raw</strong>';
  view.rerender(<PreviewHarness preview={previewOf(log, "text", { text, truncated: true })} />);
  expect(dialog().getByText(text).textContent).toBe(text);
  expect(screen.getByRole("dialog").querySelector("strong[data-log]")).toBeNull();
  expect(dialog().getByText("Showing the first 64 KB. Download the file to see all of it.")).toBeInTheDocument();
  expect(dialog().getByRole("link", { name: "Download" })).toHaveAttribute("href", "/admin/media/log%2F3/original");
  fireEvent.click(dialog().getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("hands a PDF blob to the embedded PDF viewer and keeps download guidance for Office documents", () => {
  const pdf = libraryDocument({ id: "pdf/4", title: "Invoices", extension: "pdf" });
  const pdfUrl = "blob:https://example.test/invoices";
  const view = inKit(<PreviewHarness key="pdf" preview={previewOf(pdf, "pdf", { pdfUrl })} />);
  const dialog = screen.getByRole("dialog", { name: "Invoices.pdf" });
  const embedded = within(dialog).getByTitle("Invoices.pdf");
  expect(embedded.tagName).toBe("OBJECT");
  expect(embedded).toHaveAttribute("type", "application/pdf");
  expect(embedded).toHaveAttribute("data", pdfUrl);
  const noPreview = "No preview for this file type. Download it to open it.";
  expect(within(embedded).getByText(noPreview)).toBeInTheDocument();
  expect(dialog.parentElement).not.toBeNull();
  fireEvent.click(dialog.parentElement!);
  expect(screen.queryByRole("dialog")).toBeNull();

  view.rerender(<PreviewHarness key="office" preview={previewOf(policy, "download")} />);
  const office = screen.getByRole("dialog", { name: "Refund policy.docx" });
  expect(within(office).getByText(noPreview)).toBeInTheDocument();
  expect(within(office).getByRole("link", { name: "Download" })).toHaveAttribute("href", "/admin/media/policy%2F2/original");
  expect(office.querySelector("object,iframe")).toBeNull();
});

it("falls back to the surrounding text color and a visible border when the theme has no preview tokens", () => {
  inKit(<>
    <style>{".jini-library-preview-frame-host { color: rgb(85, 75, 65); }"}</style>
    <PreviewHarness preview={previewOf(guide, "markdown", { html: '<p><a href="#section">Section</a></p>' })} />
  </>);
  const frame = within(screen.getByRole("dialog", { name: "Field guide.md" })).getByTitle("Field guide.md");
  const html = frame.getAttribute("srcdoc");
  if (!html) throw new Error("Markdown frame did not receive the document");
  const page = new DOMParser().parseFromString(html, "text/html");
  expect(page.querySelector("a")?.textContent).toBe("Section");
  const style = page.querySelector("style")?.textContent ?? "";
  expect(style).toContain("a{color:rgb(85, 75, 65)}");
  expect(style).toContain("border-left:3px solid GrayText");
});

it.each([
  { kind: "markdown", item: guide },
  { kind: "text", item: libraryDocument({ id: "report/5", title: "Report", extension: "txt" }) },
  { kind: "pdf", item: libraryDocument({ id: "terms/6", title: "Terms", extension: "pdf" }) },
] as const)("offers the original attachment if the controller has no $kind preview data", ({ kind, item }) => {
  inKit(<PreviewHarness preview={previewOf(item, kind)} />);
  const dialog = screen.getByRole("dialog", { name: item.displayFilename! });
  expect(within(dialog).getByText("No preview for this file type. Download it to open it.")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Download" })).toHaveAttribute("download", "");
  expect(dialog.querySelector("object,iframe,pre")).toBeNull();
});

it("localizes both tabs and leaves the uploader available before permissions are known", () => {
  const copy: Record<string, string> = { Upload: "Subir", Documents: "Documentos", Library: "Biblioteca" };
  const model = controller({
    permissions: { known: false, canUpload: false, canRename: false, canTrash: false },
    t: (key) => copy[key] ?? key,
  });
  inKit(<Library useLibraryHook={() => model} />);
  const tabs = within(screen.getByRole("tablist", { name: "Biblioteca" }));
  expect(tabs.getByRole("tab", { name: "Subir" })).toHaveAttribute("aria-selected", "true");
  expect(tabs.getByRole("tab", { name: /^Documentos/ }).textContent).toBe("Documentos2");
  expect(screen.getByRole("button", { name: "Upload documents" })).toBeEnabled();
  expect(screen.queryByText("You don't have permission to upload documents.")).toBeNull();
});
