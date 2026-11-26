import { useId } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { MEDIA_ORDER_OPTIONS, mediaUploadAccept, mediaUploadLabel } from "./rules.js";
import type { MediaOrderBy } from "./rules.js";
import { MEDIA_GRID_SIZES, parseMediaGridSize } from "./grid-size.js";
import type { MediaGridSize } from "./grid-size.js";
import type { MediaController } from "./hooks/use-media.hooks.js";
import type { MediaContentTabId } from "./hooks/use-media-tabs.hooks.js";
import type { MediaProps } from "./Media.js";

/** The "Upload image" button and its dialog — file picker, alt-text draft, and the Upload button.
 *  Extracted out of `Media` because its "Uploading…"/"Upload" label ternary was one of that
 *  component's independent branches; as a top-level function it's scored in its own scope instead.
 *
 *  Dialog (owner item #9, 2026-10-13): the page row became one button; the fields moved into Jini's
 *  native `Dialog`, styled like `PostUrlDialog`. The dialog stays mounted while closed so a chosen
 *  file survives Cancel and reopen; `useMedia` closes it only after a successful upload.
 *
 *  The file picker has no visible `<label>` of its own (its "Choose file" button IS its label) and a
 *  bare `<input type="file">` has no accessible name at all. `agentHandle(..., { label })` is a
 *  `data-agent-label` attribute invisible to a real screen reader or a generic browser agent's
 *  accessibility tree (only the host's own `data-agent-*` convention reads it) — so it gets an explicit
 *  `aria-label` too. */
export function MediaToolbar({ fileInputRef, altDraft, setAltDraft, selectedFileName, onFileChange, upload, uploading, uploadOpen, openUpload, closeUpload, uploadError, canUpload, activeTab, t, kit }: { activeTab: MediaContentTabId } & Pick<MediaController, "fileInputRef" | "altDraft" | "setAltDraft" | "selectedFileName" | "onFileChange" | "upload" | "uploading"
  | "uploadOpen" | "openUpload" | "closeUpload" | "uploadError" | "canUpload" | "t"> & Pick<MediaProps, "kit">, _optional = {}) {
  const { Dialog, UploadIcon, DockHeaderTip } = kit;
  const fileInputId = useId();
  // Icon button (owner, 2026-11-01): the tooltip and the accessible name are the same tab-aware text.
  const uploadLabel = t(mediaUploadLabel({ tab: activeTab }));

  return (
    <>
      {/* The admin's tooltip bubble (not a bare `title`, which does not show reliably), also on focus. */}
      <DockHeaderTip label={uploadLabel}>
        <button type="button" className="media-icon-btn" aria-label={uploadLabel} onClick={openUpload}
          {...agentHandle({ handle: "media-upload-open" }, { role: "button", label: "Open the Upload dialog" })}>
          <UploadIcon />
        </button>
      </DockHeaderTip>
      <Dialog open={uploadOpen} title={uploadLabel} pending={uploading} onClose={closeUpload}
        className="settings-dialog jini-domain-dialog media-upload-dialog">
        <MediaUploadForm kit={kit} upload={upload} fileInputId={fileInputId} fileInputRef={fileInputRef} uploading={uploading} activeTab={activeTab} t={t} onFileChange={onFileChange} selectedFileName={selectedFileName} altDraft={altDraft} setAltDraft={setAltDraft} uploadError={uploadError} closeUpload={closeUpload} canUpload={canUpload} />
      </Dialog>
    </>
  );
}

function MediaUploadForm({ upload, fileInputId, fileInputRef, uploading, activeTab, t, onFileChange, selectedFileName, altDraft, setAltDraft, uploadError, closeUpload, canUpload, kit }: { upload: MediaController["upload"]; fileInputId: string; fileInputRef: MediaController["fileInputRef"]; uploading: MediaController["uploading"]; activeTab: MediaContentTabId; t: MediaController["t"]; onFileChange: MediaController["onFileChange"]; selectedFileName: MediaController["selectedFileName"]; altDraft: MediaController["altDraft"]; setAltDraft: MediaController["setAltDraft"]; uploadError: MediaController["uploadError"]; closeUpload: MediaController["closeUpload"]; canUpload: MediaController["canUpload"] } & Pick<MediaProps, "kit">, _optional = {}) {
  const { Button, TextField } = kit;
  return (
<form
          onSubmit={upload}
          noValidate
          {...agentHandle({ handle: "media-upload-toolbar" }, { role: "region", label: "Upload — choose a file, optional alt text, and Upload" })}
        >
          <MediaUploadFileField fileInputId={fileInputId} fileInputRef={fileInputRef} uploading={uploading} activeTab={activeTab} t={t} onFileChange={onFileChange} selectedFileName={selectedFileName} />
          <TextField label={t("Alt text (optional)")} value={altDraft} disabled={uploading} onValueChange={({ value }) => setAltDraft(value)}
            attrs={agentHandle({ handle: "media-upload-alt" }, { role: "field", label: "Alt text for the file being uploaded" })} />
          {uploadError ? <div role="alert" className="notice error">{uploadError}</div> : null}
          <div className="jini-dialog-footer">
            <Button variant="secondary" className="btn-secondary" disabled={uploading} onPress={closeUpload}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" disabled={!canUpload}
              attrs={agentHandle({ handle: "media-upload-submit" }, { role: "button", label: "Upload the chosen file" })}>
              {uploading ? t("Uploading…") : t("Upload")}
            </Button>
          </div>
        </form>
  );
}

function MediaUploadFileField({ fileInputId, fileInputRef, uploading, activeTab, t, onFileChange, selectedFileName }: { fileInputId: string; fileInputRef: MediaController["fileInputRef"]; uploading: MediaController["uploading"]; activeTab: MediaContentTabId; t: MediaController["t"]; onFileChange: MediaController["onFileChange"]; selectedFileName: MediaController["selectedFileName"] }, _optional = {}) {
  return (
<div className="media-file-field">
            <MediaUploadInput fileInputId={fileInputId} fileInputRef={fileInputRef} uploading={uploading} activeTab={activeTab} t={t} onFileChange={onFileChange} />
            <label className="btn-secondary" htmlFor={fileInputId}>
              {t("Choose file")}
            </label>
            <span className="media-file-name" aria-live="polite">
              {selectedFileName || t("No file chosen")}
            </span>
          </div>
  );
}

// Hand-copied, not imported — same "kept in sync manually with the server's real ceiling"
// pattern as `FILE_HANDLER_ALLOWED_MIME_TYPES` (`admin src/features/posts/hooks/
// use-post-editor.hooks.ts`) and `IMPORTABLE_CONTENT_TYPES` (`host src/features/
// media-import/fetch-image.ts`): mirrors `DEFAULT_ALLOWED_MIME_TYPES`
// (`@jini-ai/cms/media`'s `media-service.ts`), which has accepted `video/mp4`/`video/webm`
// since 2026-08-24 — this attribute drifted out of sync with that until 2026-09-07 (see the
// regression test pinning this exact set). Advisory only: `port.uploadMedia` still enforces
// the real allowlist server-side regardless of what this lets past the file picker.

function MediaUploadInput({ fileInputId, fileInputRef, uploading, activeTab, t, onFileChange }: { fileInputId: string; fileInputRef: MediaController["fileInputRef"]; uploading: MediaController["uploading"]; activeTab: MediaContentTabId; t: MediaController["t"]; onFileChange: MediaController["onFileChange"] }, _optional = {}) {
  return (
<input
              id={fileInputId}
              ref={fileInputRef}
              className="file-input"
              type="file"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
              data-jini-autofocus=""
              disabled={uploading}
              accept={mediaUploadAccept({ tab: activeTab })}
              aria-label={t("File to upload")}
              onChange={onFileChange}
              {...agentHandle({ handle: "media-upload-file" }, {
                role: "field",
                label: "The file to upload — image/jpeg, png, webp, gif, avif, mp4 or webm",
              })}
            />
  );
}

/**
 * The "Order by" dropdown (owner-directed, 2026-09-11) — a plain `<select>`, matching this
 * screen's existing "no new form-control primitive for one field" bar (`MediaToolbar`'s file
 * input is plain too). Options come from `MEDIA_ORDER_OPTIONS` (`rules.ts`) so this component and
 * `sortMediaByOrder` can never disagree about which order ids exist. A real `<label htmlFor>`
 * rather than only an `agentHandle`, for the same reason `MediaToolbar`'s own fields get one
 * (see that component's header comment): a bare `<select>` needs an accessible name for a screen
 * reader or a generic browser agent, and `data-agent-label` is invisible to both.
 */
function MediaOrderControl({
  orderBy,
  setOrderBy,
  t,
}: {
  orderBy: MediaOrderBy;
  setOrderBy: (value: MediaOrderBy) => void;
  t: (key: string) => string;
}, _optional = {}) {
  return (
    <div
      className="media-order-control"
      {...agentHandle({ handle: "media-order-by" }, { role: "field", label: "Order the media grid by Created or Alphabetical" })}
    >
      <label htmlFor="media-order-by-select">{t("Order by")}</label>
      <select id="media-order-by-select" value={orderBy} onChange={(e) => setOrderBy(e.target.value as MediaOrderBy)}>
        {MEDIA_ORDER_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {t(option.label)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The "Size" dropdown next to "Order by": same markup and styles, moves only the grid's column minimum. */
function MediaSizeControl({ size, setSize, t }: { size: MediaGridSize; setSize: (value: MediaGridSize) => void; t: (key: string) => string }, _optional = {}) {
  return (
    <div
      className="media-order-control"
      {...agentHandle({ handle: "media-grid-size" }, { role: "field", label: "Set the media grid card size: Small, Medium or Large" })}
    >
      <label htmlFor="media-grid-size-select">{t("Size")}</label>
      <select id="media-grid-size-select" value={size} onChange={(e) => setSize(parseMediaGridSize({ value: e.target.value }))}>
        {MEDIA_GRID_SIZES.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
      </select>
    </div>
  );
}

/** The "Order by" and "Size" dropdowns side by side, split out of `MediaLibraryPanel`'s toolbar row. */
export function MediaOrderControls({ orderBy, setOrderBy, size, setSize, t }: {
  orderBy: MediaOrderBy;
  setOrderBy: (value: MediaOrderBy) => void;
  size: MediaGridSize;
  setSize: (value: MediaGridSize) => void;
  t: (key: string) => string;
}, _optional = {}) {
  return (
    <div className="media-order-controls">
      <MediaOrderControl orderBy={orderBy} setOrderBy={setOrderBy} t={t} />
      <MediaSizeControl size={size} setSize={setSize} t={t} />
    </div>
  );
}
