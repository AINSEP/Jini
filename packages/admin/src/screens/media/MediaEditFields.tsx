import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { EditMediaPanelController } from "./hooks/use-edit-media-panel.hooks.js";
import type { ReactNode } from "react";

export function MediaEditFields({ item, t, draft, setTitle, setAlt, setSlug, setCaption, setCredit, setWidth, setHeight, setCssClass, setHtmlAttributes, htmlAttributesError, publicUrl, urlCopied, copyUrl, embedCopied, copyEmbedCode, embedSnippet, hashCopied, copyHash, save, saving, onCancel }: { item: AdminMedia; t: (key: string) => string; draft: EditMediaPanelController["draft"]; setTitle: EditMediaPanelController["setTitle"]; setAlt: EditMediaPanelController["setAlt"]; setSlug: EditMediaPanelController["setSlug"]; setCaption: EditMediaPanelController["setCaption"]; setCredit: EditMediaPanelController["setCredit"]; setWidth: EditMediaPanelController["setWidth"]; setHeight: EditMediaPanelController["setHeight"]; setCssClass: EditMediaPanelController["setCssClass"]; setHtmlAttributes: EditMediaPanelController["setHtmlAttributes"]; htmlAttributesError: EditMediaPanelController["htmlAttributesError"]; publicUrl: EditMediaPanelController["publicUrl"]; urlCopied: EditMediaPanelController["urlCopied"]; copyUrl: EditMediaPanelController["copyUrl"]; embedCopied: EditMediaPanelController["embedCopied"]; copyEmbedCode: EditMediaPanelController["copyEmbedCode"]; embedSnippet: EditMediaPanelController["embedSnippet"]; hashCopied: EditMediaPanelController["hashCopied"]; copyHash: EditMediaPanelController["copyHash"]; save: EditMediaPanelController["save"]; saving: EditMediaPanelController["saving"]; onCancel: () => void }, _optional = {}) {
  return (
<div className="field-group">
        <MediaEditTitleFields item={item} t={t} draft={draft} setTitle={setTitle} setAlt={setAlt} />
        {/* Slug (2026-09-07, owner-directed): a SEPARATE field from Title, own row — auto-derived
            from Title at upload, then edited deliberately here. Renaming Title above never changes
            this value (see `AdminMedia.slug`'s own doc); a duplicate slug is rejected server-side
            (409) and surfaces through the same `error` banner every other save failure uses, rather
            than a client-side pre-check duplicating the server's own uniqueness rule. */}
        <MediaEditSlugField item={item} t={t} draft={draft} setSlug={setSlug} />
        <MediaEditCaptionFields item={item} t={t} draft={draft} setCaption={setCaption} setCredit={setCredit} />
        <MediaEditRenderOverrideFields
          item={item}
          draft={draft}
          setWidth={setWidth}
          setHeight={setHeight}
          setCssClass={setCssClass}
          setHtmlAttributes={setHtmlAttributes}
          htmlAttributesError={htmlAttributesError}
          t={t}
        />
        <MediaEditCopyFields publicUrl={publicUrl} t={t} urlCopied={urlCopied} copyUrl={copyUrl} embedCopied={embedCopied} copyEmbedCode={copyEmbedCode} embedSnippet={embedSnippet} hashCopied={hashCopied} copyHash={copyHash} item={item} />
        <MediaEditActions save={save} saving={saving} t={t} onCancel={onCancel} />
      </div>
  );
}

function MediaEditTitleFields({ item, t, draft, setTitle, setAlt }: { item: AdminMedia; t: (key: string) => string; draft: EditMediaPanelController["draft"]; setTitle: EditMediaPanelController["setTitle"]; setAlt: EditMediaPanelController["setAlt"] }, _optional = {}) {
  return (
<div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor={`media-edit-title-${item.id}`}>
              {t("Title")}
            </label>
            <input
              id={`media-edit-title-${item.id}`}
              value={draft.title}
              onChange={(e) => setTitle(e.target.value)}
              {...agentHandle({ handle: "media-edit-title" }, { role: "field", label: "This asset's title" })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`media-edit-alt-${item.id}`}>
              {t("Alt")}
            </label>
            <input
              id={`media-edit-alt-${item.id}`}
              value={draft.alt}
              onChange={(e) => setAlt(e.target.value)}
              {...agentHandle({ handle: "media-edit-alt" }, { role: "field", label: "This asset's alt text, for screen readers" })}
            />
          </div>
        </div>
  );
}

function MediaEditSlugField({ item, t, draft, setSlug }: { item: AdminMedia; t: (key: string) => string; draft: EditMediaPanelController["draft"]; setSlug: EditMediaPanelController["setSlug"] }, _optional = {}) {
  return (
<div className="field">
          <label className="field-label" htmlFor={`media-edit-slug-${item.id}`}>
            {t("Slug")}
          </label>
          <input
            id={`media-edit-slug-${item.id}`}
            value={draft.slug}
            onChange={(e) => setSlug(e.target.value)}
            {...agentHandle({ handle: "media-edit-slug" }, {
              role: "field",
              label: "This asset's unique lookup slug — separate from Title, must be unique in this workspace",
            })}
          />
        </div>
  );
}

function MediaEditCaptionFields({ item, t, draft, setCaption, setCredit }: { item: AdminMedia; t: (key: string) => string; draft: EditMediaPanelController["draft"]; setCaption: EditMediaPanelController["setCaption"]; setCredit: EditMediaPanelController["setCredit"] }, _optional = {}) {
  return (
<div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor={`media-edit-caption-${item.id}`}>
              {t("Caption")}
            </label>
            <input
              id={`media-edit-caption-${item.id}`}
              value={draft.caption}
              onChange={(e) => setCaption(e.target.value)}
              {...agentHandle({ handle: "media-edit-caption" }, { role: "field", label: "This asset's caption" })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`media-edit-credit-${item.id}`}>
              {t("Credit")}
            </label>
            <input
              id={`media-edit-credit-${item.id}`}
              value={draft.credit}
              onChange={(e) => setCredit(e.target.value)}
              {...agentHandle({ handle: "media-edit-credit" }, { role: "field", label: "This asset's credit / attribution" })}
            />
          </div>
        </div>
  );
}

/** {@link EditMediaPanel}'s public-render override fields: width/height, CSS class and HTML
 *  attributes. A top-level component so the panel's own branch count stays under the complexity
 *  ceiling — these fields' `??` and ternary reads were half of it. */
function MediaEditRenderOverrideFields(
  props: Pick<EditMediaPanelController, "draft" | "setWidth" | "setHeight" | "setCssClass" | "setHtmlAttributes" | "htmlAttributesError"> & {
    item: AdminMedia;
    t: (key: string) => string;
  }
, _optional = {}) {
  const { item, draft, setWidth, setHeight, setCssClass, setHtmlAttributes, htmlAttributesError, t } = props;
  return (
    <>
      {/* Quick-and-dirty public-render sizing fields (owner-directed skip-the-ADR fix — images
          inserted into post bodies were rendering at full native pixel width with no way to
          control size). Both optional, pixel-size numeric inputs: leaving either (or both) blank
          means "render at native/as-is size" — the public renderer omits the attribute entirely
          rather than defaulting to a computed value. Own row directly under Caption/Credit, per
          owner's explicit placement instruction. */}
      <MediaEditDimensions item={item} t={t} draft={draft} setWidth={setWidth} setHeight={setHeight} />
      <MediaEditCssClass item={item} t={t} draft={draft} setCssClass={setCssClass} />
      {/* HTML attributes (2026-09-07, owner-directed — animations, custom WebMCP hooks on the
          emitted tag). `htmlAttributesError` below is a LIVE, as-you-type hint only — it must
          never disable Save (see `use-edit-media-panel.hooks.ts`'s own header for the regression
          this rule prevents, `a7cce060`): an invalid value here still lets every other field save,
          and the server's own 400 (already enforced independently, not just by this hint) surfaces
          through the `error` banner below exactly like a malformed slug already does. */}
      <MediaEditHtmlAttributes item={item} t={t} draft={draft} setHtmlAttributes={setHtmlAttributes} htmlAttributesError={htmlAttributesError} />
    </>
  );
}

function MediaEditDimensions({ item, t, draft, setWidth, setHeight }: { item: AdminMedia; t: (key: string) => string; draft: EditMediaPanelController["draft"]; setWidth: EditMediaPanelController["setWidth"]; setHeight: EditMediaPanelController["setHeight"] }, _optional = {}) {
  return (
<div className="field-row">
        <div className="field">
          <label className="field-label" htmlFor={`media-edit-width-${item.id}`}>
            {t("Width (px)")}
          </label>
          <input
            id={`media-edit-width-${item.id}`}
            type="number"
            min={1}
            placeholder={t("native")}
            value={draft.width ?? ""}
            onChange={(e) => setWidth(e.target.value)}
            {...agentHandle({ handle: "media-edit-width" }, {
              role: "field",
              label: "Render width in pixels for this asset in post bodies — blank means native size",
            })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`media-edit-height-${item.id}`}>
            {t("Height (px)")}
          </label>
          <input
            id={`media-edit-height-${item.id}`}
            type="number"
            min={1}
            placeholder={t("native")}
            value={draft.height ?? ""}
            onChange={(e) => setHeight(e.target.value)}
            {...agentHandle({ handle: "media-edit-height" }, {
              role: "field",
              label: "Render height in pixels for this asset in post bodies — blank means native size",
            })}
          />
        </div>
      </div>
  );
}

function MediaEditCssClass({ item, t, draft, setCssClass }: { item: AdminMedia; t: (key: string) => string; draft: EditMediaPanelController["draft"]; setCssClass: EditMediaPanelController["setCssClass"] }, _optional = {}) {
  return (
<div className="field">
        <label className="field-label" htmlFor={`media-edit-css-class-${item.id}`}>
          {t("CSS class (optional)")}
        </label>
        <input
          id={`media-edit-css-class-${item.id}`}
          value={draft.cssClass ?? ""}
          onChange={(e) => setCssClass(e.target.value)}
          {...agentHandle({ handle: "media-edit-css-class" }, { role: "field", label: "Optional CSS class applied to this asset in post bodies" })}
        />
      </div>
  );
}

function MediaEditHtmlAttributes({ item, t, draft, setHtmlAttributes, htmlAttributesError }: { item: AdminMedia; t: (key: string) => string; draft: EditMediaPanelController["draft"]; setHtmlAttributes: EditMediaPanelController["setHtmlAttributes"]; htmlAttributesError: EditMediaPanelController["htmlAttributesError"] }, _optional = {}) {
  return (
<div className="field">
        <label className="field-label" htmlFor={`media-edit-html-attributes-${item.id}`}>
          {t("HTML attributes (optional)")}
        </label>
        <input
          id={`media-edit-html-attributes-${item.id}`}
          value={draft.htmlAttributes ?? ""}
          onChange={(e) => setHtmlAttributes(e.target.value)}
          aria-invalid={htmlAttributesError ? true : undefined}
          {...agentHandle({ handle: "media-edit-html-attributes" }, {
            role: "field",
            label: "Optional HTML attributes applied to this asset's rendered tag on the public site",
          })}
        />
        {htmlAttributesError ? <p className="field-error">{htmlAttributesError}</p> : null}
      </div>
  );
}

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

