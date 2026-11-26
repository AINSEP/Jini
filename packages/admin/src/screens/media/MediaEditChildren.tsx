import type { ReactNode } from "react";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { EditMediaPanelController } from "./hooks/use-edit-media-panel.hooks.js";
import type { useEditMediaModal } from "./hooks/use-edit-media-modal.hooks.js";
import type { MediaProps } from "./Media.js";
import { EditMediaPanel } from "./MediaEditPanel.js";

/** A read-only value plus its Copy button — {@link EditMediaPanel}'s File URL and sha256 rows share
 *  this shape. `copyButtonHandle` is the button's `agentHandle(...)` spread, built at the call site so
 *  each handle id stays a literal in `EditMediaPanel`. */
function MediaEditCopyRow(props: {
  label: string;
  copied: boolean;
  onCopy: () => void;
  copyButtonHandle: ReturnType<typeof agentHandle>;
  t: (key: string) => string;
  children: ReactNode;
}, _optional = {}) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="field-readonly-row">
        {props.children}
        <button type="button" className="btn-ghost" onClick={props.onCopy} {...props.copyButtonHandle}>
          {props.copied ? props.t("Copied") : props.t("Copy")}
        </button>
      </div>
    </div>
  );
}

export function MediaEditCopyFields({ publicUrl, t, urlCopied, copyUrl, embedCopied, copyEmbedCode, embedSnippet, hashCopied, copyHash, item }: { publicUrl: EditMediaPanelController["publicUrl"]; t: (key: string) => string; urlCopied: EditMediaPanelController["urlCopied"]; copyUrl: EditMediaPanelController["copyUrl"]; embedCopied: EditMediaPanelController["embedCopied"]; copyEmbedCode: EditMediaPanelController["copyEmbedCode"]; embedSnippet: EditMediaPanelController["embedSnippet"]; hashCopied: EditMediaPanelController["hashCopied"]; copyHash: EditMediaPanelController["copyHash"]; item: AdminMedia }, _optional = {}) {
  return (<>
        {/* User report: "where is the location of the asset? I dont see the location data" — there
            was no answer to that anywhere in this panel. Same read-only+Copy shape as the sha256
            row below (this component's own established idiom for "show it, let it be copied, it
            isn't something you type into"), but a clickable `<a>` instead of `<code>` since this
            value is a real, followable URL, not an opaque identifier.
            `publicUrl` (readable-slugs S5a) can be `null` — trashed asset, or no public transform
            registered yet — and the row is hidden rather than showing a dead link. */}
        {publicUrl !== null && (
          <MediaEditPublicUrl t={t} urlCopied={urlCopied} copyUrl={copyUrl} publicUrl={publicUrl} />
        )}
        {/* readable-slugs S5a: the embed marker other admin screens (posts/pages body HTML) would
            reference this asset by. Always shown — `item.slug` is never empty, unlike `publicUrl`
            above. */}
        <MediaEditCopyRow
          label={t("Embed code")}
          copied={embedCopied}
          onCopy={copyEmbedCode}
          copyButtonHandle={agentHandle({ handle: "media-edit-copy-embed" }, { role: "button", label: "Copy this asset's embed code to the clipboard" })}
          t={t}
        >
          <code className="field-mono field-readonly">{embedSnippet}</code>
        </MediaEditCopyRow>
        {/* Integrity/dedupe metadata, demoted out of the main view — genuinely useful when
            chasing a duplicate upload or verifying a file, noise the rest of the time. Read-only:
            this is a content hash, not something an operator edits. Monospace per the OD idiom
            for values that are code/identifiers, not prose. */}
        <MediaEditCopyRow
          label={t("sha256")}
          copied={hashCopied}
          onCopy={copyHash}
          copyButtonHandle={agentHandle({ handle: "media-edit-copy-hash" }, { role: "button", label: "Copy this asset's sha256 hash to the clipboard" })}
          t={t}
        >
          <code className="field-mono field-readonly">{item.sha256}</code>
        </MediaEditCopyRow>

  </>);
}

function MediaEditPublicUrl({ t, urlCopied, copyUrl, publicUrl }: { t: (key: string) => string; urlCopied: EditMediaPanelController["urlCopied"]; copyUrl: EditMediaPanelController["copyUrl"]; publicUrl: NonNullable<EditMediaPanelController["publicUrl"]> }, _optional = {}) {
  return (
<MediaEditCopyRow
            label={t("File URL")}
            copied={urlCopied}
            onCopy={copyUrl}
            copyButtonHandle={agentHandle({ handle: "media-edit-copy-url" }, { role: "button", label: "Copy this asset's file URL to the clipboard" })}
            t={t}
          >
            <a className="field-mono field-readonly" href={publicUrl} target="_blank" rel="noreferrer">
              {publicUrl}
            </a>
          </MediaEditCopyRow>
  );
}

export function MediaEditActions({ save, saving, t, onCancel }: { save: EditMediaPanelController["save"]; saving: EditMediaPanelController["saving"]; t: (key: string) => string; onCancel: () => void }, _optional = {}) {
  return (
<span className="editor-actions">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            {...agentHandle({ handle: "media-edit-save" }, { role: "button", label: "Save this asset's metadata" })}
          >
            {saving ? t("Saving…") : t("Save")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={saving}
            {...agentHandle({ handle: "media-edit-cancel" }, { role: "button", label: "Close this panel without saving" })}
          >
            {t("Cancel")}
          </button>
        </span>
  );
}

/** Stable id for `EditMediaModal`'s own accessible name — a static constant, not a generated one,
 *  since exactly one instance is ever mounted at a time (see this component's own doc comment,
 *  same reasoning `ThemePageDetailsModal.tsx`'s `TITLE_ID` documents for its own single instance). */
const EDIT_MEDIA_MODAL_TITLE_ID = "media-edit-modal-title";

interface EditMediaModalProps {
  useEditMediaPanelHook: MediaProps["hooks"]["useEditMediaPanelHook"];
  /** The item currently being edited, or `null` while closed — mirrors
   *  `ThemePageDetailsModalProps.row`'s null-is-closed convention. */
  item: AdminMedia | null;
  onSaved: () => void;
  onCancel: () => void;
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useEditMediaModalHook: typeof useEditMediaModal;
  /** Host kit values hook (injected so tests can supply the native-dialog helpers). */
  useAdminKitValuesHook: MediaProps["hooks"]["useAdminKitValuesHook"];
  /** Translator closure — see `Media()`'s own `t`; forwarded to the `EditMediaPanel` this wraps. */
  t: (key: string) => string;
}

/**
 * Single shared `<dialog>` wrapping `EditMediaPanel` — owner ask (2026-09-07): reach the metadata
 * edit form from an eye icon on the card, as a modal, instead of an inline panel pushing the grid
 * down. Same "controlled, never conditionally unmounted" shape as `MediaLightbox`/`ConfirmDialog`
 * (`MediaLibraryPanel` below renders exactly one `<EditMediaModal>`, toggling only its `item` prop),
 * and the same native-`<dialog>` foundation/lifecycle as `ThemePageDetailsModal.tsx` — see
 * `use-edit-media-modal.hooks.ts`'s own header for why that lifecycle hook is a local copy rather
 * than a shared import.
 *
 * `EditMediaPanel` itself still gets `key={item.id}` here, not on the `<dialog>` — the dialog BOX
 * stays mounted across an edit-target switch (so its own open/close transition is never disturbed
 * by which item is inside it), but the form content must still remount and reseed its draft from
 * the new item, preserving the 2026-08-12 audit fix (`MediaLibraryPanel`'s own comment on this same
 * `key` has the full incident writeup).
 */
export function EditMediaModal({ item, onSaved, onCancel, useEditMediaPanelHook, useEditMediaModalHook, useAdminKitValuesHook, t }: EditMediaModalProps, _optional = {}) {
  // The Jini hook takes the native-dialog helpers as required args; bind them from the host kit here.
  const { openLightboxDialog, closeLightboxDialog } = useAdminKitValuesHook();
  const { dialogRef, handleNativeCancel, handleBackdropClick } = useEditMediaModalHook({
    open: item !== null, onClose: onCancel, openLightboxDialog, closeLightboxDialog,
  });

  return (
    <dialog
      ref={dialogRef}
      className="media-edit-dialog"
      aria-labelledby={item ? EDIT_MEDIA_MODAL_TITLE_ID : undefined}
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
      {...agentHandle({ handle: "media-edit-dialog" }, { role: "region", label: "Edit this asset's metadata, presented as a modal" })}
    >
      {item ? (
        <EditMediaPanel useEditMediaPanelHook={useEditMediaPanelHook} key={item.id} item={item} onSaved={onSaved} onCancel={onCancel} t={t} titleId={EDIT_MEDIA_MODAL_TITLE_ID} />
      ) : null}
    </dialog>
  );
}
