import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { EditMediaPanelController } from "./hooks/use-edit-media-panel.hooks.js";
import type { MediaProps } from "./Media.js";
import { MediaEditFields } from "./MediaEditFields.js";

interface EditMediaPanelProps {
  item: AdminMedia;
  onSaved: () => void;
  onCancel: () => void;
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useEditMediaPanelHook: MediaProps["hooks"]["useEditMediaPanelHook"];
  /** Translator closure — see `Media()`'s own `t`. */
  t: (key: string) => string;
  /** Applied to this panel's own `<h2>` so `EditMediaModal`'s wrapping `<dialog>` can point its
   *  `aria-labelledby` at a real heading. Optional so this component still renders a valid (if
   *  unlabeled-by-id) heading if ever mounted standalone, e.g. in a unit test. */
  titleId?: string;
}

/** The metadata edit form for one media item's title/alt/caption/credit (REQ-01) plus the
 *  quick-and-dirty sizing/class/HTML-attributes overrides. Presented inside `EditMediaModal`'s `<dialog>` (owner
 *  ask, 2026-09-07 — see this file's header for why this moved off the grid) rather than rendering
 *  its own card chrome: the dialog itself supplies the surface/border/shadow (`media.css`'s
 *  `.media-edit-dialog`), so this component's own root is a plain content wrapper. */
export function EditMediaPanel(props: EditMediaPanelProps, _optional = {}) {
  const { item, onSaved, onCancel, useEditMediaPanelHook, t, titleId } = props;
  const {
    draft,
    setTitle,
    setSlug,
    setAlt,
    setCaption,
    setCredit,
    setWidth,
    setHeight,
    setCssClass,
    setHtmlAttributes,
    htmlAttributesError,
    saving,
    error,
    hashCopied,
    urlCopied,
    embedCopied,
    publicUrl,
    embedSnippet,
    copyHash,
    copyUrl,
    copyEmbedCode,
    createdByLabel,
    save,
  } = useEditMediaPanelHook({ item, onSaved, onCancel });

  return (
    <MediaEditForm titleId={titleId} t={t} item={item} createdByLabel={createdByLabel} draft={draft} setTitle={setTitle} setAlt={setAlt} setSlug={setSlug} setCaption={setCaption} setCredit={setCredit} setWidth={setWidth} setHeight={setHeight} setCssClass={setCssClass} setHtmlAttributes={setHtmlAttributes} htmlAttributesError={htmlAttributesError} publicUrl={publicUrl} urlCopied={urlCopied} copyUrl={copyUrl} embedCopied={embedCopied} copyEmbedCode={copyEmbedCode} embedSnippet={embedSnippet} hashCopied={hashCopied} copyHash={copyHash} save={save} saving={saving} onCancel={onCancel} error={error} />
  );
}

function MediaEditForm({ titleId, t, item, createdByLabel, draft, setTitle, setAlt, setSlug, setCaption, setCredit, setWidth, setHeight, setCssClass, setHtmlAttributes, htmlAttributesError, publicUrl, urlCopied, copyUrl, embedCopied, copyEmbedCode, embedSnippet, hashCopied, copyHash, save, saving, onCancel, error }: { titleId: EditMediaPanelProps["titleId"]; t: (key: string) => string; item: AdminMedia; createdByLabel: EditMediaPanelController["createdByLabel"]; draft: EditMediaPanelController["draft"]; setTitle: EditMediaPanelController["setTitle"]; setAlt: EditMediaPanelController["setAlt"]; setSlug: EditMediaPanelController["setSlug"]; setCaption: EditMediaPanelController["setCaption"]; setCredit: EditMediaPanelController["setCredit"]; setWidth: EditMediaPanelController["setWidth"]; setHeight: EditMediaPanelController["setHeight"]; setCssClass: EditMediaPanelController["setCssClass"]; setHtmlAttributes: EditMediaPanelController["setHtmlAttributes"]; htmlAttributesError: EditMediaPanelController["htmlAttributesError"]; publicUrl: EditMediaPanelController["publicUrl"]; urlCopied: EditMediaPanelController["urlCopied"]; copyUrl: EditMediaPanelController["copyUrl"]; embedCopied: EditMediaPanelController["embedCopied"]; copyEmbedCode: EditMediaPanelController["copyEmbedCode"]; embedSnippet: EditMediaPanelController["embedSnippet"]; hashCopied: EditMediaPanelController["hashCopied"]; copyHash: EditMediaPanelController["copyHash"]; save: EditMediaPanelController["save"]; saving: EditMediaPanelController["saving"]; onCancel: () => void; error: EditMediaPanelController["error"] }, _optional = {}) {
  return (
<div
      className="media-edit-modal-body"
      {...agentHandle({ handle: "media-edit-panel" }, {
        role: "region",
        label: "Edit media metadata — title, alt text, caption, credit, size, CSS class and HTML attributes",
      })}
    >
      <div className="editor-header">
        <h2 id={titleId}>
          {t("Editing")} "{item.title}"
        </h2>
      </div>
      <p className="jini-hint media-edit-created-by">
        <span>{t("Created by")}</span>: <span>{createdByLabel}</span>
      </p>
      {/* Field layout per the OD reference (od-settings-external-mcp-customform.png): uppercase
          letterspaced label above its control (`.field-label`), short fields pairing into a
          row (`.field-row`) instead of every field stacking full-width regardless of length. */}
      <MediaEditFields item={item} t={t} draft={draft} setTitle={setTitle} setAlt={setAlt} setSlug={setSlug} setCaption={setCaption} setCredit={setCredit} setWidth={setWidth} setHeight={setHeight} setCssClass={setCssClass} setHtmlAttributes={setHtmlAttributes} htmlAttributesError={htmlAttributesError} publicUrl={publicUrl} urlCopied={urlCopied} copyUrl={copyUrl} embedCopied={embedCopied} copyEmbedCode={copyEmbedCode} embedSnippet={embedSnippet} hashCopied={hashCopied} copyHash={copyHash} save={save} saving={saving} onCancel={onCancel} />
      {error ? (
        <span className="save-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
