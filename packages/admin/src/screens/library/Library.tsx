import { createRenameKeyDown, createPreviewKeyDown, goToLibraryTab, resolveLibraryTabId, resolveLibraryTabs } from "./Library.hooks.js";
import { useLayoutEffect, useRef, useState } from "react";
import { DataTable } from "../../react/components/DataTable.js";
import { RowMenu, type RowMenuItem } from "../../react/components/RowMenu/RowMenu.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { FileDropzone, Icon, Toast } from "@jini-ai/ui";

import { TabBar } from "@jini-ai/ui/tab-strip";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { navigate } from "../../shell/lib/router.js";
import type { LibraryController, LibraryPreviewState, LibraryUploadRow } from "./hooks/use-library.hooks.js";
import {
  LIBRARY_ACCEPT,
  documentExtensionSuffix,
  documentName,
  documentPreviewKind,
  documentTypeLabel,
  documentUploaderLabel,
  formatLibraryBytes,
} from "./rules.js";

import { formatTimestamp } from '@jini-ai/core/text';
import { VIEWER_TIME_ZONE } from "../../shell/lib/viewer-time-zone.js";
/**
 * @file The Library screen (`/admin/library`) — markup only; state lives in
 * `hooks/use-library.hooks.ts`. Private documents for this site that the assistant can read
 * (`library_list` / `library_read`) and visitors never see. Two `?tab=` tabs: Upload and
 * Documents (owner, 2026-10-18). The Upload tab leads with an "Upload documents" button that opens
 * the drop zone's own file picker; Documents is only the list (owner, 2026-10-18).
 *
 * A thin page rather than the `@jini-ai/admin/media` one: the media page is parked
 * (`media-panel.ts`) and the legacy Media screen this sits beside is a host feature too, so a
 * media-page version would need the parked module's ports wired first.
 *
 * Previews never run document content: Markdown renders with raw HTML off inside a scriptless,
 * network-blocked frame; text is React-escaped; PDF opens in the browser's PDF viewer from a blob
 * typed `application/pdf`; Office/iWork/RTF documents download.
 */
export interface LibraryProps {
  /** The `?tab=` query value; guarded by `resolveLibraryTabId`. */
  tabId?: string | null;
  /** The host's controller binding (a test passes a controller over a fake port). */
  useLibraryHook: () => LibraryController;
}

export function Library({ tabId, useLibraryHook }: LibraryProps) {
  const controller = useLibraryHook();
  const { t, documents, rowError, notice } = controller;
  const activeTabId = resolveLibraryTabId({ tabId: tabId });
  return (
    <div className="jini-page jini-library-page">
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker">{t("Content")}</p>
          <h1 className="jini-page-title">{t("Library")}</h1>
          <p className="jini-page-description">{t("Private documents the assistant can read. Visitors never see them.")}</p>
        </div>
      </div>
      {rowError ? <div className="jini-notice jini-notice-error" role="alert">{rowError}</div> : null}
      <TabBar
        ariaLabel={t("Library")}
        tabs={resolveLibraryTabs({ t }, documents ? { documentCount: documents.length } : {})}
        activeId={activeTabId}
        onChange={(tabId) => goToLibraryTab({ tabId, navigate })}
        containerHandle="library-tab-bar"
      />
      {activeTabId === "upload" ? <UploadTab controller={controller} /> : <DocumentsTab controller={controller} />}
      {controller.preview ? <PreviewDialog controller={controller} preview={controller.preview} /> : null}
      {/* A toast, not a banner above the tabs (owner, 2026-10-18): it confirms something the owner just
          did, so it clears itself, like the Themes trash toast. Open Trash stays inside it for restore. */}
      {notice ? (
        <Toast
          message={notice}
          role="status"
          tone="success"
          ttlMs={6000}
          actionLabel={t("Open Trash")}
          onAction={() => navigate({ routePath: "/trash" })}
          onDismiss={controller.dismissNotice}
        />
      ) : null}
    </div>
  );
}

function uploadStatusLabel({ row, t }: { row: LibraryUploadRow; t: (key: string) => string }, _optional = {}): string {
  switch (row.status) {
    case "waiting":
      return t("Waiting…");
    case "uploading":
      return t("Uploading…");
    case "done":
      return t("Uploaded");
    default:
      return row.error ?? t("Upload failed.");
  }
}

export function UploadTab({ controller }: { controller: LibraryController }) {
  const { t, permissions, uploads, uploadedCount, addFiles, clearUploads } = controller;
  const zoneRef = useRef<HTMLDivElement>(null);
  if (permissions.known && !permissions.canUpload) {
    return <div className="jini-notice">{t("You don't have permission to upload documents.")}</div>;
  }
  const finished = uploads.some((row) => row.status === "done" || row.status === "failed");
  return (
    <section className="jini-library-upload" aria-label={t("Upload")}>
      {/* Opens the drop zone's own file input, so both paths share its accept list and upload path. */}
      <button
        type="button"
        className="jini-btn-primary jini-library-upload-button"
        onClick={() => zoneRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
        {...agentHandle({ handle: "library-upload-documents" }, { role: "button", label: "Open the file picker to upload documents to the Library" })}
      >
        <Icon name="tray-upload" size={16} strokeWidth={1.5} />
        {t("Upload documents")}
      </button>
      <div ref={zoneRef} onDropCapture={(event) => {
        const items = Array.from(event.dataTransfer.items ?? []);
        const packages = items.map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry =>
          Boolean(entry?.isDirectory && /\.(pages|key)$/i.test(entry.name)));
        if (!packages.length) return;
        // A macOS package is a directory. Stop expansion so its internals cannot become uploads.
        event.preventDefault();
        event.stopPropagation();
        addFiles([...packages.map(entry => new File([], entry.name)),
          ...items.map(item => item.getAsFile()).filter((file): file is File => !!file && !packages.some(entry => entry.name === file.name))]);
      }}>
        <FileDropzone
          accept={LIBRARY_ACCEPT}
          prompt={t("Drop documents here, or click to browse")}
          helper={t("Documents: Markdown, text, PDF, Word, Excel, PowerPoint, Pages, Keynote, RTF, CSV, JSON · up to 10 MiB each")}
          onFiles={addFiles}
        />
        <p className="jini-library-upload-warning">{t("Do not load any sensitive keys, tokens, or secrets here.")}</p>
      </div>
      {uploads.length > 0 ? (
        <ul className="jini-library-upload-list" aria-label={t("Uploads")}>
          {uploads.map((row) => (
            <li key={row.key} className={`jini-library-upload-row is-${row.status}`}>
              <span className="jini-library-upload-name">{row.name}</span>
              <span className="jini-library-upload-size">{formatLibraryBytes({ bytes: row.size })}</span>
              <span className="jini-library-upload-status" role={row.status === "failed" ? "alert" : undefined}>
                {row.status === "uploading" ? <span className="jini-library-spinner" aria-hidden="true" /> : null}
                {uploadStatusLabel({ row: row, t: t })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {finished ? (
        <div className="jini-library-upload-actions">
          {uploadedCount > 0 ? (
            <button
              type="button"
              onClick={() => goToLibraryTab({ tabId: "documents", navigate })}
              {...agentHandle({ handle: "library-view-documents" }, { role: "button", label: "Open the Documents tab to see the uploaded documents" })}
            >
              {t("View in Documents")}
            </button>
          ) : null}
          <button type="button" className="jini-btn-secondary" onClick={clearUploads}>
            {t("Clear list")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function downloadDocument({ url }: { url: string }, _optional = {}) {
  // The original route answers `Content-Disposition: attachment`, so this saves the file and the
  // admin page stays where it is.
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function documentMenuItems({ item, controller }: { item: AdminMedia; controller: LibraryController }, _optional: Record<string, never> = {}): RowMenuItem[] {
  const { t, permissions } = controller;
  // Download-only documents have no preview in v1, so their menu leads with Download (the name still opens the details).
  const items: RowMenuItem[] = documentPreviewKind(item) === "download"
    ? []
    : [{ key: "preview", label: t("Preview"), onSelect: () => controller.openPreview(item) }];
  items.push({ key: "download", label: t("Download"), onSelect: () => downloadDocument({ url: controller.downloadUrl({ item }) }) });
  if (permissions.canRename) items.push({ key: "rename", label: t("Rename"), onSelect: () => controller.rename.start(item) });
  if (permissions.canTrash) items.push({ key: "trash", label: t("Move to Trash"), tone: "warning", onSelect: () => void controller.trash(item) });
  return items;
}

function RenameField({ item, controller }: { item: AdminMedia; controller: LibraryController }) {
  const { t, rename } = controller;
  const onKeyDown = createRenameKeyDown({ rename });
  return (
    <span className="jini-library-rename">
      <span className="jini-library-rename-field">
        <input
          type="text"
          value={rename.draft}
          onChange={(event) => rename.setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          aria-label={t("New name")}
          aria-invalid={rename.invalid || undefined}
          maxLength={240}
          autoFocus
        />
        <span className="jini-library-rename-ext">{documentExtensionSuffix(item)}</span>
      </span>
      <button type="button" className="jini-btn-primary" onClick={() => void rename.save()} disabled={rename.saving || rename.invalid}>
        {rename.saving ? t("Saving…") : t("Save")}
      </button>
      <button type="button" className="jini-btn-secondary" onClick={rename.cancel} disabled={rename.saving}>
        {t("Cancel")}
      </button>
    </span>
  );
}

export function DocumentsTab({ controller }: { controller: LibraryController }) {
  const { t, documents, listError, userNames, trashingId } = controller;
  if (listError) return <div className="jini-notice jini-notice-error">{listError}</div>;
  if (!documents) return <div className="jini-notice">{t("Loading documents…")}</div>;
  return (
    <section className="jini-library-documents" aria-label={t("Documents")}>
      <DataTable
        rows={documents}
        rowKey={(item) => item.id}
        label={t("Documents")}
        empty={<p className="jini-library-documents-empty">{t("No documents yet.")}</p>}
        columns={[
          {
            key: "name",
            header: t("Name"),
            // Agent handles use the row position: ids are not handle-safe words.
            cell: (item, index) =>
              controller.rename.editingId === item.id ? (
                <RenameField item={item} controller={controller} />
              ) : (
                <button
                  type="button"
                  className="jini-link-button jini-library-name-button"
                  onClick={() => controller.openPreview(item)}
                  {...agentHandle({ handle: `library-doc-${index + 1}-preview` }, { role: "button", label: "Preview this document" })}
                >
                  {documentName(item)}
                </button>
              ),
          },
          { key: "type", header: t("Type"), cell: (item) => <span className="jini-library-type">{documentTypeLabel(item)}</span> },
          { key: "size", header: t("Size"), cellClassName: "library-num", cell: (item) => formatLibraryBytes({ bytes: item.byteSize }) },
          { key: "uploaded", header: t("Upload date"), cellClassName: "library-num", cell: (item) => formatTimestamp({ iso: item.createdAt }, { viewerTimeZone: VIEWER_TIME_ZONE }) },
          {
            key: "by",
            header: t("Uploaded by"),
            cell: (item) => documentUploaderLabel({ item, unknownLabel: t("Unknown") }, { userNames }),
          },
          {
            key: "actions",
            header: t("More"),
            cell: (item, index) =>
              trashingId === item.id ? (
                <span className="jini-muted-cell">{t("Moving…")}</span>
              ) : (
                <RowMenu
                  triggerLabel={t('Actions for "{title}"').replace("{title}", () => documentName(item))}
                  agentHandle={`library-doc-${index + 1}-menu`}
                  items={documentMenuItems({ item, controller })}
                />
              ),
          },
        ]}
      />
    </section>
  );
}

/** Builds the scriptless, network-blocked document a Markdown preview renders in. Colours come
 *  from the admin theme around the frame so light and dark both read. */
export function markdownFrameDocument({ html, colors }: { html: string; colors: { text: string; link: string; border: string } }, _optional = {}): string {
  const style = `:root{color-scheme:light dark}body{margin:0;padding:16px 20px;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:${colors.text};background:transparent;overflow-wrap:anywhere}a{color:${colors.link}}pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}pre{padding:10px 12px;border:1px solid ${colors.border};border-radius:6px;overflow:auto}table{border-collapse:collapse}th,td{border:1px solid ${colors.border};padding:4px 8px}img{max-width:100%}h1,h2,h3{line-height:1.25}blockquote{margin:0;padding-left:12px;border-left:3px solid ${colors.border}}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${style}</style></head><body>${html}</body></html>`;
}

function MarkdownFrame({ html, title }: { html: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [colors, setColors] = useState<{ text: string; link: string; border: string } | null>(null);
  useLayoutEffect(() => {
    // The host div always renders, and React attaches its ref before layout effects run, so the
    // ref is set here (the old `if (!host) return` guard could never fire).
    const host = hostRef.current;
    if (!host) throw new Error("library markdown preview has no host element");
    const computed = getComputedStyle(host);
    setColors({
      text: computed.color || "CanvasText",
      link: computed.getPropertyValue("--link").trim() || computed.color || "LinkText",
      border: computed.getPropertyValue("--border").trim() || "GrayText",
    });
  }, []);
  return (
    <div ref={hostRef} className="jini-library-preview-frame-host">
      {colors ? (
        <iframe className="jini-library-preview-frame" title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={markdownFrameDocument({ html: html, colors: colors })} />
      ) : null}
    </div>
  );
}

function PreviewBody({ preview, controller }: { preview: LibraryPreviewState; controller: LibraryController }) {
  const { t } = controller;
  const name = documentName(preview.item);
  if (preview.loading) return <p className="jini-muted-cell">{t("Loading preview…")}</p>;
  if (preview.error) return <div className="jini-notice jini-notice-error">{preview.error}</div>;
  if (preview.kind === "markdown" && preview.html !== null) return <MarkdownFrame html={preview.html} title={name} />;
  if (preview.kind === "text" && preview.text !== null) return <pre className="jini-library-preview-text">{preview.text}</pre>;
  if (preview.kind === "pdf" && preview.pdfUrl) {
    // Not a sandboxed iframe: Chrome shows "This page has been blocked" for a PDF inside
    // `sandbox=""` (seen 2026-10-18). `<object>` hands the bytes to the browser's own PDF viewer;
    // the hook re-types the blob as `application/pdf`, so it can never load as an HTML page. The
    // fallback shows when the browser has no inline PDF viewer.
    return (
      <object className="jini-library-preview-frame jini-library-preview-pdf" title={name} type="application/pdf" data={preview.pdfUrl}>
        <p className="jini-library-preview-none">{t("No preview for this file type. Download it to open it.")}</p>
      </object>
    );
  }
  return <p className="jini-library-preview-none">{t("No preview for this file type. Download it to open it.")}</p>;
}

function PreviewDialog({ controller, preview }: { controller: LibraryController; preview: LibraryPreviewState }) {
  const { t, closePreview } = controller;
  const name = documentName(preview.item);
  const titleId = "library-preview-title";
  const onKeyDown = createPreviewKeyDown({ closePreview });
  return (
    <div className="jini-settings-dialog-backdrop" onClick={closePreview}>
      <div
        className="jini-settings-dialog jini-library-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="jini-library-preview-head">
          <div className="jini-library-preview-heading">
            <h2 id={titleId}>{name}</h2>
            <p className="jini-library-preview-meta">
              {documentTypeLabel(preview.item)} · {formatLibraryBytes({ bytes: preview.item.byteSize })}
            </p>
          </div>
          <a className="jini-btn-secondary jini-library-preview-download" href={controller.downloadUrl({ item: preview.item })} download>
            {t("Download")}
          </a>
          <button type="button" className="jini-btn-ghost jini-library-preview-close" aria-label={t("Close")} onClick={closePreview} autoFocus>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="jini-library-preview-body">
          <PreviewBody preview={preview} controller={controller} />
          {preview.truncated ? <p className="jini-muted-cell jini-library-preview-truncated">{t("Showing the first 64 KB. Download the file to see all of it.")}</p> : null}
        </div>
      </div>
    </div>
  );
}
