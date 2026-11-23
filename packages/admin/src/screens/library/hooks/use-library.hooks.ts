import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasPermission } from "@jini-ai/core/admin-runtime";
import { useFetchMutation, useFetchQuery, useInvalidate } from "../../../react/kit.js";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { useContentRefreshSubscription } from "@jini-ai/admin/shell/hooks/use-content-refresh-subscription.hooks";
import {
  LIBRARY_KEYS,
  documentPreviewKind,
  libraryFileProblem,
  sortDocuments,
  validDocumentStem,
  type LibraryPreviewKind,
} from "../rules.js";
import type { LibraryPort } from "./library-port.hooks.js";

/**
 * @file State and API calls for the Library screen (`Library.tsx` is markup only). Uploads run one
 * file at a time — the server caps each body at 10 MiB and the admin request seam is a single JSON
 * POST per file — so each queued row moves Waiting → Uploading → Uploaded / failed on its own.
 *
 * Permissions are read from `/auth/me` and only hide or disable controls; the server re-checks
 * every request (`media.read` / `media.upload` / `media.update` / `media.delete`).
 */

export type LibraryUploadStatus = "waiting" | "uploading" | "done" | "failed";

export interface LibraryUploadRow {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly status: LibraryUploadStatus;
  readonly error: string | null;
}

export interface LibraryPermissions {
  /** `false` until `/auth/me` answers, so a control never flashes in and disappears. */
  readonly known: boolean;
  readonly canUpload: boolean;
  readonly canRename: boolean;
  readonly canTrash: boolean;
}

export interface LibraryPreviewState {
  readonly item: AdminMedia;
  readonly kind: LibraryPreviewKind;
  readonly loading: boolean;
  readonly error: string | null;
  /** Escaped source for text/CSV/JSON. */
  readonly text: string | null;
  /** Safe HTML (raw HTML off) for Markdown — rendered only inside a scriptless sandboxed frame. */
  readonly html: string | null;
  /** A `blob:` URL of the PDF bytes, typed `application/pdf`, for the browser's PDF viewer. */
  readonly pdfUrl: string | null;
  readonly truncated: boolean;
}

export interface LibraryController {
  documents: AdminMedia[] | undefined;
  listError: string | null;
  permissions: LibraryPermissions;
  userNames: ReadonlyMap<string, string>;
  uploads: LibraryUploadRow[];
  uploadedCount: number;
  addFiles: (files: File[]) => void;
  clearUploads: () => void;
  rename: {
    editingId: string | null;
    draft: string;
    setDraft: (draft: string) => void;
    start: (item: AdminMedia) => void;
    cancel: () => void;
    save: () => Promise<void>;
    saving: boolean;
    invalid: boolean;
  };
  trash: (item: AdminMedia) => Promise<void>;
  trashingId: string | null;
  rowError: string | null;
  /** "Moved to Trash." after a trash, shown as a toast that links to Trash for restore; cleared by
   *  `dismissNotice` (the toast's timer or its X) or the next action. */
  notice: string | null;
  dismissNotice: () => void;
  preview: LibraryPreviewState | null;
  openPreview: (item: AdminMedia) => void;
  closePreview: () => void;
  downloadUrl: (required: { item: AdminMedia }, optional?: Record<string, never>) => string;
  t: (key: string) => string;
  locale: string;
}

export interface LibraryDependencies {
  port: LibraryPort;
  locale: string;
  t: (key: string) => string;
  /** Host error-copy policy: turns a thrown request failure into operator text, `fallback` otherwise. */
  describeApiError: (required: { e: unknown; fallback: string }) => string;
  /** Host file reader: a browser `File` as base64 (no data: URL prefix). */
  readFileAsBase64: (required: { file: File }) => Promise<string>;
  /** Host Markdown renderer: safe HTML with raw HTML off, shown only inside a scriptless sandboxed frame. */
  renderMarkdownToSafeHtml: (markdown: string) => string;
}

const NO_USERS: ReadonlyMap<string, string> = new Map();

function fileProblemMessage({ problem, t }: { problem: ReturnType<typeof libraryFileProblem>; t: (key: string) => string }, _optional = {}): string | null {
  switch (problem) {
    case "type":
      return t("This file type isn't supported.");
    case "size":
      return t("Larger than 10 MiB.");
    case "package":
      return t("Folder package: in Pages/Keynote, save as a single file, then upload again.");
    case "empty":
      return t("This file is empty.");
    default:
      return null;
  }
}

function useLibraryUploads({ port, t, describeApiError, readFileAsBase64 }: { port: LibraryPort; t: (key: string) => string; describeApiError: LibraryDependencies["describeApiError"]; readFileAsBase64: LibraryDependencies["readFileAsBase64"] }, _optional = {}) {
  const invalidate = useInvalidate();
  const [uploads, setUploads] = useState<LibraryUploadRow[]>([]);
  const queue = useRef<{ key: string; file: File }[]>([]);
  const running = useRef(false);
  // Instance-owned upload key counter: keys only need to be unique among this screen's rows.
  const uploadKeySeq = useRef(0);

  const patch = useCallback((key: string, next: Partial<LibraryUploadRow>) => {
    setUploads((rows) => rows.map((row) => (row.key === key ? { ...row, ...next } : row)));
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) {
        patch(next.key, { status: "uploading" });
        try {
          const dataBase64 = await readFileAsBase64({ file: next.file });
          await port.uploadDocument({ filename: next.file.name, dataBase64 });
          patch(next.key, { status: "done", error: null });
          invalidate({ key: LIBRARY_KEYS.documents });
        } catch (failure) {
          patch(next.key, { status: "failed", error: describeApiError({ e: failure, fallback: t("Upload failed.") }) });
        }
      }
    } finally {
      running.current = false;
    }
  }, [invalidate, patch, port, t, describeApiError, readFileAsBase64]);

  const addFiles = useCallback((files: File[]) => {
    const rows: LibraryUploadRow[] = files.map((file) => {
      uploadKeySeq.current += 1;
      const key = `upload-${uploadKeySeq.current}`;
      const error = fileProblemMessage({ problem: libraryFileProblem(file), t: t });
      if (!error) queue.current.push({ key, file });
      return { key, name: file.name, size: file.size, status: error ? "failed" : "waiting", error };
    });
    setUploads((current) => [...rows, ...current]);
    void drain();
  }, [drain, t]);

  const clearUploads = useCallback(() => {
    setUploads((rows) => rows.filter((row) => row.status === "waiting" || row.status === "uploading"));
  }, []);

  return { uploads, addFiles, clearUploads, uploadedCount: uploads.filter((row) => row.status === "done").length };
}

function useLibraryPreview({ port, t, describeApiError, renderMarkdownToSafeHtml }: { port: LibraryPort; t: (key: string) => string; describeApiError: LibraryDependencies["describeApiError"]; renderMarkdownToSafeHtml: LibraryDependencies["renderMarkdownToSafeHtml"] }, _optional = {}) {
  const [preview, setPreview] = useState<LibraryPreviewState | null>(null);
  const request = useRef(0);

  // Revoke the PDF's blob URL whenever it is replaced or the preview closes.
  const pdfUrl = preview?.pdfUrl ?? null;
  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  const closePreview = useCallback(() => {
    request.current += 1;
    setPreview(null);
  }, []);

  const openPreview = useCallback((item: AdminMedia) => {
    request.current += 1;
    const ticket = request.current;
    const kind = documentPreviewKind(item);
    const base: LibraryPreviewState = { item, kind, loading: kind !== "download", error: null, text: null, html: null, pdfUrl: null, truncated: false };
    setPreview(base);
    if (kind === "download") return;
    const settle = (next: Partial<LibraryPreviewState>) => {
      if (request.current === ticket) setPreview({ ...base, loading: false, ...next });
    };
    const fail = (failure: unknown) => settle({ error: describeApiError({ e: failure, fallback: t("Preview failed.") }) });
    if (kind === "pdf") {
      port.fetchDocumentBlob({ id: item.id })
        .then((blob) => {
          if (request.current !== ticket) return;
          settle({ pdfUrl: URL.createObjectURL(new Blob([blob], { type: "application/pdf" })) });
        })
        .catch(fail);
      return;
    }
    port.readDocumentText({ id: item.id })
      .then(({ text, truncated }) => settle(kind === "markdown"
        ? { html: renderMarkdownToSafeHtml(text), truncated }
        : { text, truncated }))
      .catch(fail);
  }, [port, t, describeApiError, renderMarkdownToSafeHtml]);

  return { preview, openPreview, closePreview };
}

/** The document list, the caller's permissions and the principal-id → username map, kept fresh by content refreshes. */
function useLibraryData({ port }: { port: LibraryDependencies["port"] }) {
  const list = useFetchQuery({ key: LIBRARY_KEYS.documents, fetch: () => port.listDocuments() });
  const me = useFetchQuery({ key: LIBRARY_KEYS.permissions, fetch: () => port.me() });
  const users = useFetchQuery({
    key: LIBRARY_KEYS.users,
    fetch: () => (port.listUsers ? port.listUsers() : Promise.resolve({ users: [] })),
  });
  const invalidate = useInvalidate();
  const invalidateList = useCallback(() => invalidate({ key: LIBRARY_KEYS.documents }), [invalidate]);
  useContentRefreshSubscription({ resource: "media", onRefresh: invalidateList });

  const granted = me.data?.effectivePermissions;
  const permissions: LibraryPermissions = {
    known: granted !== undefined,
    canUpload: hasPermission({ permissions: granted ?? [], permission: "media.upload" }),
    canRename: hasPermission({ permissions: granted ?? [], permission: "media.update" }),
    canTrash: hasPermission({ permissions: granted ?? [], permission: "media.delete" }),
  };
  const userNames = useMemo(
    () => (users.data ? new Map(users.data.users.map((user) => [user.principalId, user.username])) : NO_USERS),
    [users.data],
  );
  return { list, permissions, userNames };
}

type LibraryPreview = ReturnType<typeof useLibraryPreview>;

/** Moves one document to Trash, closing its preview and reporting through the row's shared feedback state. */
function useLibraryTrash({ port, t, describeApiError, preview, closePreview, feedback }: { port: LibraryDependencies["port"]; t: LibraryDependencies["t"]; describeApiError: LibraryDependencies["describeApiError"]; preview: LibraryPreview["preview"]; closePreview: LibraryPreview["closePreview"]; feedback: { setRowError: (value: string | null) => void; setNotice: (value: string | null) => void } }) {
  const { setRowError, setNotice } = feedback;
  const [trashingId, setTrashingId] = useState<string | null>(null);
  const trashMutation = useFetchMutation({
    run: ({ input: id }: { input: string }) => port.trashDocument({ id }),
  }, { invalidates: [LIBRARY_KEYS.documents] });

  async function trash(item: AdminMedia) {
    if (trashingId) return;
    setRowError(null);
    setNotice(null);
    setTrashingId(item.id);
    try {
      await trashMutation.mutate({ input: item.id });
      if (preview?.item.id === item.id) closePreview();
      setNotice(t("Moved to Trash."));
    } catch (failure) {
      setRowError(describeApiError({ e: failure, fallback: t("Move to Trash failed.") }));
    } finally {
      setTrashingId(null);
    }
  }

  return { trash, trashingId };
}

/** Inline rename and move-to-Trash, which share one row error and one notice. */
function useLibraryRowActions({ port, t, describeApiError, preview, closePreview }: { port: LibraryDependencies["port"]; t: LibraryDependencies["t"]; describeApiError: LibraryDependencies["describeApiError"]; preview: LibraryPreview["preview"]; closePreview: LibraryPreview["closePreview"] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const renameMutation = useFetchMutation({
    run: ({ input }: { input: { id: string; title: string } }) => port.renameDocument({ target: { id: input.id }, input: { title: input.title } }),
  }, { invalidates: [LIBRARY_KEYS.documents] });

  const start = useCallback((item: AdminMedia) => {
    setRowError(null);
    setNotice(null);
    setEditingId(item.id);
    setDraft(item.title);
  }, []);
  const cancel = useCallback(() => setEditingId(null), []);

  async function save() {
    if (!editingId || renameMutation.status === "pending") return;
    const stem = validDocumentStem({ draft: draft });
    if (!stem) return;
    setRowError(null);
    try {
      await renameMutation.mutate({ input: { id: editingId, title: stem } });
      setEditingId(null);
    } catch (failure) {
      setRowError(describeApiError({ e: failure, fallback: t("Rename failed.") }));
    }
  }

  const rename = {
    editingId,
    draft,
    setDraft,
    start,
    cancel,
    save,
    saving: renameMutation.status === "pending",
    invalid: validDocumentStem({ draft: draft }) === null,
  };
  const { trash, trashingId } = useLibraryTrash({ port, t, describeApiError, preview, closePreview, feedback: { setRowError, setNotice } });
  return { rename, trash, trashingId, rowError, notice, dismissNotice: () => setNotice(null) };
}

export function useLibrary({ port, locale, t, describeApiError, readFileAsBase64, renderMarkdownToSafeHtml }: LibraryDependencies): LibraryController {
  const { list, permissions, userNames } = useLibraryData({ port });
  const { uploads, addFiles, clearUploads, uploadedCount } = useLibraryUploads({ port: port, t: t, describeApiError, readFileAsBase64 });
  const { preview, openPreview, closePreview } = useLibraryPreview({ port: port, t: t, describeApiError, renderMarkdownToSafeHtml });
  const rowActions = useLibraryRowActions({ port, t, describeApiError, preview, closePreview });

  return {
    documents: list.data ? sortDocuments({ items: list.data.media }) : undefined,
    listError: list.error ? describeApiError({ e: list.error, fallback: t("Couldn't load documents.") }) : null,
    permissions,
    userNames,
    uploads,
    uploadedCount,
    addFiles,
    clearUploads,
    ...rowActions,
    preview,
    openPreview,
    closePreview,
    downloadUrl: ({ item }, _optional = {}) => port.documentDownloadUrl({ id: item.id }),
    t,
    locale,
  };
}
