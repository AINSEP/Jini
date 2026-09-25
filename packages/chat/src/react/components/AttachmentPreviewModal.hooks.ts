/**
 * @file `AttachmentPreviewModal`'s open/close, focus-management, and content-derivation state,
 * split out of the component per this package's own hooks-file convention (mirrors
 * `packages/admin/src/react/components/ConfirmDialog/ConfirmDialog.hooks.tsx` and
 * `usePreviewModalShell.ts`).
 *
 * **Dialog lifecycle.** Native `<dialog>` + `showModal()`, the same primitive already used one file
 * over in `Markdown.tsx`'s `TableBlock` for its wide-table pop-out (`openTableDialog`/
 * `closeTableDialog`) — reused here rather than a third hand-rolled overlay. That gives Tab-cycling
 * focus containment for free from the browser; this hook only adds the two things `TableBlock`
 * does not need: an explicit focus-restore-to-opener (native `close()` does return focus in a real
 * browser, but jsdom's `showModal`/`close` are both unimplemented — see the guard below — so a test
 * asserting the restore has nothing to observe without doing it by hand, the same reason
 * `ConfirmDialog.hooks.tsx` does it explicitly rather than trusting the platform), and the
 * image/text/unsupported content derivation an attachment preview needs that a table pop-out does
 * not.
 *
 * **Why content can be missing entirely.** `attachment-preview-cache.ts` only ever holds bytes this
 * browser itself staged for upload, in this page session (see that module's doc for why the server
 * cannot hand them back). A cache miss - a reload, a different session, the eviction cap - degrades
 * to the honest "unsupported" status rather than a broken image or an empty text pane.
 *
 * **Why image-ness is not decided by `attachment.kind` alone.** `@jini-ai/http-kit`'s
 * `detectAttachmentKind` (`attachments.ts`) now sniffs PNG/JPEG/GIF/WEBP/AVIF signatures - AVIF was
 * added specifically for the bug that motivated this task, brand-checked against the same ISO-BMFF
 * `ftyp` box `@jini-ai/cms`'s media sniffer uses, so a real `.avif` upload now carries `kind:
 * 'image'` from the server. This module's extension fallback stays anyway, for two reasons that are
 * still true even with AVIF fixed: BMP/ICO/SVG are in `IMAGE_PREVIEW_EXTENSIONS` but are not sniffed
 * server-side at all (no `hasBmpSignature`/etc. exists), so `kind` alone would still misclassify
 * those as `'file'`; and gating on `kind` would make ANY future sniffer gap fail the same way this
 * one did, whereas the extension guess plus the `<img>`'s own `onError` (wired by the component) is
 * self-correcting - if the browser cannot actually decode what got attempted, `imageFailed` flips
 * this back to a text/unsupported status rather than showing a broken-image icon or trusting a wrong
 * guess. The two checks cannot disagree in a way that matters: `looksLikeImageAttachment` is an OR,
 * so a server `kind: 'image'` is decisive on its own, and the extension guess is only ever a
 * fallback that `onError` can retract - never a second, competing source of truth for a format the
 * server already classified.
 */
import { useEffect, useRef, useState, type MouseEvent, type RefObject, type SyntheticEvent } from 'react';
import type { ChatAttachment } from '../../core/index.js';
import { getAttachmentPreviewSource } from '../hooks/attachment-preview-cache.js';
import { formatAttachmentSize } from './AttachmentTray.js';

export type AttachmentPreviewStatus = 'image' | 'text' | 'unsupported';

/** Extensions attempted as an `<img>` even when `attachment.kind` says otherwise — see module doc. */
const IMAGE_PREVIEW_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);

/** Extensions shown in a scrollable monospace pane. Deliberately narrow — see task scope: "txt, md, json, csv, and similar", not every source-code language. */
const TEXT_PREVIEW_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'xml']);

/** Hard cap on rendered text-preview characters, so a large attached log/CSV cannot hang the tab painting one giant `<pre>`. */
export const MAX_TEXT_PREVIEW_CHARS = 200_000;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Exported for the component's own render branch, which needs the same answer without re-deriving it from `status`. */
export function looksLikeImageAttachment(attachment: Pick<ChatAttachment, 'kind' | 'name'>): boolean {
  return attachment.kind === 'image' || IMAGE_PREVIEW_EXTENSIONS.has(extensionOf(attachment.name));
}

function looksLikeTextAttachment(name: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.has(extensionOf(name));
}

/**
 * Reads `file` as text via `FileReader`, not the newer `Blob.prototype.text()` promise API: both
 * are supported in every real evergreen browser, but jsdom (this package's test environment,
 * verified directly - `File`/`Blob` here has no `.text`/`.arrayBuffer` at all) implements
 * `FileReader.readAsText` while leaving `.text()` unimplemented. Choosing the form the test
 * environment can actually exercise avoids a test-only monkeypatch of a browser primitive whose
 * production behavior isn't in question - only its jsdom coverage was.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment as text'));
    reader.readAsText(file);
  });
}

/**
 * `false` in an environment with no Blob-URL support — real browsers have shipped this for well
 * over a decade, but jsdom (this package's own test environment) never implemented it, and this
 * package cannot assume every embedding host is a browser tab. Feature-detected the same way this
 * file already feature-detects `<dialog>`'s `showModal`/`close`, rather than assumed.
 */
function canCreateObjectUrl(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

export interface AttachmentTextPreview {
  content: string;
  truncated: boolean;
}

export interface AttachmentPreviewController {
  dialogRef: RefObject<HTMLDialogElement | null>;
  status: AttachmentPreviewStatus;
  imageUrl: string | undefined;
  onImageError: () => void;
  textLoading: boolean;
  text: AttachmentTextPreview | undefined;
  sizeLabel: string | null;
  handleNativeCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  handleBackdropClick: (event: MouseEvent<HTMLDialogElement>) => void;
}

/**
 * Drives one `AttachmentPreviewModal` instance for `attachment`. The caller conditionally mounts
 * this (one open attachment at a time per `MessageRow`), so mount = open and unmount = close; there
 * is no `open` boolean to track separately.
 * @complexity Time/space: O(1) plus O(n) in the cached file's byte length for the one-time text
 * read on mount (bounded in practice by the upload route's own 20 MB per-attachment cap, and by
 * {@link MAX_TEXT_PREVIEW_CHARS} for what actually renders).
 */
export function useAttachmentPreviewModal(
  attachment: ChatAttachment,
  onClose: () => void,
): AttachmentPreviewController {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [text, setText] = useState<AttachmentTextPreview | undefined>(undefined);
  const [textLoading, setTextLoading] = useState(false);

  const cachedFile = getAttachmentPreviewSource(attachment.path);
  const attemptImage =
    !imageFailed && cachedFile !== undefined && looksLikeImageAttachment(attachment) && canCreateObjectUrl();
  const attemptText = !attemptImage && cachedFile !== undefined && looksLikeTextAttachment(attachment.name);
  const status: AttachmentPreviewStatus = attemptImage ? 'image' : attemptText ? 'text' : 'unsupported';

  // Object URL: created/revoked in an effect (not `useMemo`) so a React 18 Strict Mode double-render
  // can never create two URLs and revoke only one — the cleanup below always pairs with the create
  // that produced the URL currently in state.
  useEffect(() => {
    if (!attemptImage || !cachedFile) {
      setImageUrl(undefined);
      return undefined;
    }
    const url = URL.createObjectURL(cachedFile);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptImage, cachedFile]);

  useEffect(() => {
    if (!attemptText || !cachedFile) {
      setText(undefined);
      return undefined;
    }
    let canceled = false;
    setTextLoading(true);
    readFileAsText(cachedFile)
      .then((full) => {
        if (canceled) return;
        const truncated = full.length > MAX_TEXT_PREVIEW_CHARS;
        setText({ content: truncated ? full.slice(0, MAX_TEXT_PREVIEW_CHARS) : full, truncated });
      })
      .catch(() => {
        // A file this extension-list called "text-ish" that fails to decode as text falls back to
        // the honest unsupported view via `text` staying `undefined`, rather than showing garbage.
        if (!canceled) setText(undefined);
      })
      .finally(() => {
        if (!canceled) setTextLoading(false);
      });
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptText, cachedFile]);

  // Open on mount, close + restore focus on unmount — see this module's doc on why the restore is
  // explicit rather than left to the browser's own (jsdom-absent) default.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    triggerRef.current = document.activeElement;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    return () => {
      if (typeof dialog.close === 'function') {
        if (dialog.open) dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
    // Mount/unmount only: the caller mounts a fresh instance per opened attachment (never reuses one
    // instance across two different open attachments), so there is no "attachment changed while
    // still open" transition for this effect to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNativeCancel(event: SyntheticEvent<HTMLDialogElement>): void {
    // Always prevented, same reasoning as `ConfirmDialog.hooks.tsx`: the effect above is the single
    // source of truth for open/closed, so Escape still closes — it just does so through `onClose`
    // (which unmounts this controller) rather than letting the browser desync from React state.
    event.preventDefault();
    onClose();
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>): void {
    // A `<dialog>` element's own box is sized to its content; a click landing on the `<dialog>`
    // element itself (rather than a descendant) is a click on the backdrop area outside that box.
    if (event.target === dialogRef.current) onClose();
  }

  return {
    dialogRef,
    status,
    imageUrl,
    onImageError: () => setImageFailed(true),
    textLoading,
    text,
    sizeLabel: formatAttachmentSize(attachment.size),
    handleNativeCancel,
    handleBackdropClick,
  };
}
