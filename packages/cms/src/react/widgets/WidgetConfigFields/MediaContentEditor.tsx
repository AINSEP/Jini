import { useId, type AriaAttributes, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { interpolate, type Translate } from "@jini-ai/core/text";
import { useMediaContentEditor, type MediaContentEditorController, type MediaItemRow } from "./MediaContentEditor.hooks.js";
import type { MediaContentMode, MediaLayout, MediaSlugProblem } from "./media-content-rules.js";
import type { MediaPickerPort } from "../../media/MediaPickerDialog/MediaPickerDialog.hooks.js";

/**
 * @file `MediaContentEditor` — the owner-approved two-tab editor ("Media" structured / "Raw HTML")
 * for media content (2026-10-11). ONE component, two hosts: `WidgetConfigFields` renders it for
 * `media` and `gallery` widgets (the widget editor page and the "create new" picker form), and the
 * `widgetEmbed` node's Style dialog renders it for a per-placement "Custom for this post" override
 * (`widget-embed-extension.tsx`). Replaces the 10-09 `GalleryConfigFields` form the owner called
 * "terrible": loose label/inputs, big filled Move/Remove buttons, full-size thumbnails.
 *
 * Markup only — state lives in `MediaContentEditor.hooks.ts`, rules in `media-content-rules.ts`.
 * Design rules it follows (owner checklist): no control wider than its content, label + compact
 * control on one line, ⓘ tips instead of paragraphs, small icon buttons; rows reflow under the
 * `admin-content` container (`styles/media-content-editor.css`) for 390px and the open dock.
 *
 * ## Agent handles
 *
 * Given `agentHandle="widget-instance-config"`: `<base>-tab-media`, `<base>-tab-html`,
 * `<base>-layout-<layout>`, `<base>-columns`, `<base>-aspect-ratio`, `<base>-choose`,
 * `<base>-slug`, `<base>-slug-add`, `<base>-css-class`, `<base>-attribute-add`, `<base>-html`,
 * `<base>-insert-media`, `<base>-picker-add`. Item rows are reorderable and their slugs editable,
 * so they carry no per-row handle (no stable id to key one on). Omit the base to leave editor-owned
 * controls untagged; shared help triggers and dialog controls keep their default instance handles.
 */

const TABS: ReadonlyArray<{ id: MediaContentMode; label: string }> = [{ id: "media", label: "Media" }, { id: "html", label: "Raw HTML" }];

function handle({ base, suffix, role, label }: { base: string | undefined; suffix: string; role: "field" | "button"; label: string }, _options: Record<string, never> = {}) {
  return base ? agentHandle({ handle: `${base}-${suffix}` }, { role, label }) : {};
}

/** Literal keys (not `t(variable)`) so the i18n parity test can resolve every one statically. */
function layoutLabel(layout: MediaLayout, t: Translate): string {
  if (layout === "single") return t("Single");
  if (layout === "grid") return t("Grid");
  if (layout === "carousel") return t("Carousel");
  return t("Masonry");
}

function problemText({ problem, slug, t }: { problem: MediaSlugProblem; slug: string; t: Translate }, _options: Record<string, never> = {}): string {
  if (problem === "empty") return t("Type a media slug.");
  if (problem === "invalid") return t("Slugs can't contain spaces or slashes.");
  if (problem === "duplicate") return t("Already in this list.");
  if (problem === "full") return interpolate({ template: t("Up to {max} items."), vars: { max: 50 } });
  return interpolate({ template: t('No media with the slug "{slug}".'), vars: { slug } });
}

export interface MediaContentEditorProps {
  widgetType: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  t?: Translate;
  agentHandle?: string;
  port?: MediaPickerPort;
  hooks: {
    useEditor: typeof useMediaContentEditor;
    usePreview: (required: { widgetType: string; config: Record<string, unknown> }) => { loading: boolean; error: string | null; document: string; paneWidth: number; frameRef: (node: HTMLDivElement | null) => void };
    useMediaPickerItems: Parameters<typeof useMediaContentEditor>[0]["useMediaPickerItems"];
    useTabBarKeyboard: (required: { tabs: readonly { id: MediaContentMode; label: string }[]; activeId: string; onChange: (id: string) => void }) => { onKeyDown: (event: KeyboardEvent<HTMLElement>) => void };
  };
  kit: {
    Icon: ComponentType<{ name: "alert-triangle" | "play" | "volume" | "image" | "arrow-up" | "close" | "plus"; size: number } & AriaAttributes>;
    InfoTip: ComponentType<{ label: string }>;
    DockHeaderTip: ComponentType<{ label: string; children: ReactNode }>;
    Dialog: ComponentType<{ open: boolean; onClose: () => void; title: string; className: string; children: ReactNode }>;
    DevicePreviewFrame: ComponentType<{ width: number; frameRef: (node: HTMLDivElement | null) => void; paneWidth: number; expanded: boolean; children: ReactNode }>;
    HtmlAttributeRows: ComponentType<{ value: string; onChange: (value: string) => void; t: Translate; agentHandle: string | undefined }>;
  };
  deps: {
    port: MediaPickerPort; locale: string;
    acceptsMedia: Parameters<typeof useMediaContentEditor>[0]["acceptsMedia"];
    resolveTabBarTabIndex: (required: { tabs: readonly { id: MediaContentMode; label: string }[]; activeId: string; tab: { id: MediaContentMode; label: string } }) => number;
  };
}

export function MediaContentEditor({ widgetType, config, onChange, t = (key) => key, agentHandle: base, port, hooks, kit, deps }: MediaContentEditorProps) {
  const vm = hooks.useEditor({ config, onChange, widgetType, port: port ?? deps.port, locale: deps.locale, useMediaPickerItems: hooks.useMediaPickerItems, acceptsMedia: deps.acceptsMedia });
  const preview = hooks.usePreview({ widgetType, config });
  const panelId = useId();
  return (
    <div className="media-content-editor">
      <EditorTabs kit={kit} hooks={hooks} deps={deps} vm={vm} t={t} base={base} panelId={panelId} />
      <div id={panelId} role="tabpanel" className="media-content-editor__panel">
        {vm.mode === "media" ? <MediaTab kit={kit} vm={vm} t={t} base={base} /> : <HtmlTab kit={kit} vm={vm} t={t} base={base} />}
      </div>
      <PreviewSection kit={kit} preview={preview} t={t} />
      {vm.libraryError ? <p className="field-error" role="alert">{vm.libraryError}</p> : null}
      {vm.picker ? <LibraryPicker kit={kit} vm={vm} t={t} base={base} /> : null}
    </div>
  );
}

function EditorTabs({ vm, t, base, panelId, hooks, deps, kit }: { vm: MediaContentEditorController; t: Translate; base: string | undefined; panelId: string; hooks: MediaContentEditorProps["hooks"]; deps: MediaContentEditorProps["deps"]; kit: MediaContentEditorProps["kit"] }) {
  const { Icon } = kit;
  const { onKeyDown } = hooks.useTabBarKeyboard({ tabs: TABS, activeId: vm.mode, onChange: (id) => vm.setMode({ mode: id as MediaContentMode }) });
  return (
    <div className="media-content-editor__tabs">
      <div className="segmented" role="tablist" aria-label={t("Widget content")} onKeyDown={onKeyDown}>
        {TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={vm.mode === tab.id} aria-controls={panelId}
            className={vm.mode === tab.id ? "is-active" : undefined}
            tabIndex={deps.resolveTabBarTabIndex({ tabs: TABS, activeId: vm.mode, tab })}
            onClick={() => vm.setMode({ mode: tab.id })}
            {...handle({ base, suffix: `tab-${tab.id}`, role: "button", label: `Switch to the ${tab.label} tab` })}>
            {tab.id === "media" ? t("Media") : t("Raw HTML")}
          </button>
        ))}
      </div>
      {vm.inactiveHasContent ? (
        <span className="field-hint media-content-editor__notice" role="status">
          <Icon name="alert-triangle" size={14} aria-hidden="true" />
          {t("Saving keeps only this tab. The other tab's content will be dropped.")}
        </span>
      ) : null}
    </div>
  );
}

function previewStatus(preview: ReturnType<MediaContentEditorProps["hooks"]["usePreview"]>, t: Translate): string | null {
  if (preview.error) return t("Preview unavailable.");
  return preview.loading ? t("Loading preview…") : null;
}

function PreviewSection({ preview, t, kit }: { preview: ReturnType<MediaContentEditorProps["hooks"]["usePreview"]>; t: Translate; kit: MediaContentEditorProps["kit"] }) {
  const { DevicePreviewFrame } = kit;
  return (
    <section className="media-content-editor__preview" aria-label={t("Preview")}>
      <div className="media-content-editor__toolbar">
        <span className="field-label">{t("Preview")}</span>
        <span className={preview.error ? "field-error" : "field-hint"} role="status">
          {previewStatus(preview, t)}
        </span>
      </div>
      <DevicePreviewFrame width={preview.paneWidth} frameRef={preview.frameRef} paneWidth={preview.paneWidth} expanded>
        <iframe title={t("Preview")} className="page-preview-iframe" sandbox="" srcDoc={preview.document} />
      </DevicePreviewFrame>
    </section>
  );
}

function MediaTab({ vm, t, base, kit }: { vm: MediaContentEditorController; t: Translate; base: string | undefined; kit: MediaContentEditorProps["kit"] }) {
  const { InfoTip } = kit;
  const layoutLabelId = useId();
  return (
    <>
      <div className="media-content-editor__toolbar">
        <span className="media-content-editor__field">
          <span id={layoutLabelId}>{t("Layout")}</span>
          <span className="segmented media-content-editor__layouts" role="radiogroup" aria-labelledby={layoutLabelId}>
            {vm.layouts.map((layout) => (
              <button key={layout} type="button" role="radio" aria-checked={vm.media.layout === layout}
                className={vm.media.layout === layout ? "is-active" : undefined} onClick={() => vm.setLayout({ layout })}
                {...handle({ base, suffix: `layout-${layout}`, role: "button", label: `Use the ${layout} layout` })}>
                {layoutLabel(layout, t)}
              </button>
            ))}
          </span>
        </span>
        {vm.showColumns ? (
          <label className="media-content-editor__field">
            {t("Columns")}
            <input type="number" min={1} max={6} className="media-content-editor__number" value={vm.media.columns ?? 3}
              onChange={(event) => vm.setColumns({ value: event.target.value })} {...handle({ base, suffix: "columns", role: "field", label: "Number of columns" })} />
          </label>
        ) : null}
        <span className="media-content-editor__field">
          <label>
            {t("Aspect ratio")}
            <input className="field-mono media-content-editor__ratio" placeholder="4/3" value={vm.media.aspectRatio ?? ""}
              onChange={(event) => vm.setAspectRatio({ aspectRatio: event.target.value })} {...handle({ base, suffix: "aspect-ratio", role: "field", label: "Aspect ratio, e.g. 16/9" })} />
          </label>
          <InfoTip label={t("e.g. 1, 4/3, 16/9")} />
        </span>
      </div>

      {vm.rows.length === 0 ? (
        <p className="field-hint media-content-editor__empty">{t("No media yet. Choose from the library or add one by slug.")}</p>
      ) : (
        <ol className="media-content-editor__items">
          {/* Index keys: a row's slug is editable, so keying on it would remount the row (and drop
              focus) on every keystroke; values are controlled, so reordering stays correct. */}
          {vm.rows.map((row, index) => <MediaItemRowView kit={kit} key={index} row={row} index={index} vm={vm} t={t} />)}
        </ol>
      )}

      <AddMediaRow kit={kit} vm={vm} t={t} base={base} />
      <AttributesSection kit={kit} vm={vm} t={t} base={base} />
    </>
  );
}

function Thumbnail({ row, vm, t, kit }: { row: MediaItemRow; vm: MediaContentEditorController; t: Translate; kit: MediaContentEditorProps["kit"] }) {
  const { Icon } = kit;
  if (row.problem === "unknown") return <span className="media-content-editor__thumb is-missing"><Icon name="alert-triangle" size={18} aria-hidden="true" /></span>;
  if (row.asset && row.kind === "image") return <img className="media-content-editor__thumb" src={vm.mediaUrl({ asset: row.asset })} alt="" loading="lazy" width={48} height={48} />;
  if (row.kind === "video") return <span className="media-content-editor__thumb" title={t("Video file")}><Icon name="play" size={18} aria-label={t("Video file")} /></span>;
  if (row.kind === "audio") return <span className="media-content-editor__thumb" title={t("Audio file")}><Icon name="volume" size={18} aria-label={t("Audio file")} /></span>;
  return <span className="media-content-editor__thumb"><Icon name="image" size={18} aria-hidden="true" /></span>;
}

function MediaItemRowView({ row, index, vm, t, kit }: { row: MediaItemRow; index: number; vm: MediaContentEditorController; t: Translate; kit: MediaContentEditorProps["kit"] }) {
  const n = index + 1;
  return (
    <li className="media-content-editor__row">
      <Thumbnail kit={kit} row={row} vm={vm} t={t} />
      <input className={`field-mono media-content-editor__slug${row.showsSlugEnd ? " is-end-first" : ""}`} value={row.item.slug} spellCheck={false} autoComplete="off"
        aria-label={`${t("Media slug")} ${n}`} aria-invalid={row.problem ? true : undefined} title={row.item.slug}
        onChange={(event) => vm.updateItem({ index, patch: { slug: event.target.value.trim() } })} />
      {/* Clearing alt/caption omits the key, so the library's own text is used at render time
          (contract); the placeholder shows that fallback. */}
      <input className="media-content-editor__alt" value={row.item.alt ?? ""} placeholder={mediaTextPlaceholder({ row, field: "alt", t })}
        aria-label={`${t("Alt text")} ${n}`} onChange={(event) => vm.updateItem({ index, patch: { alt: event.target.value || undefined } })} />
      <input className="media-content-editor__caption" value={row.item.caption ?? ""} placeholder={mediaTextPlaceholder({ row, field: "caption", t })}
        aria-label={`${t("Caption")} ${n}`} onChange={(event) => vm.updateItem({ index, patch: { caption: event.target.value || undefined } })} />
      <RowActions kit={kit} index={index} vm={vm} t={t} />
      {row.problem ? <p className="field-error media-content-editor__row-error">{rowProblemText({ problem: row.problem, slug: row.item.slug, t })}</p> : null}
    </li>
  );
}

function rowProblemText({ problem, slug, t }: { problem: NonNullable<MediaItemRow["problem"]>; slug: string; t: Translate }, _options: Record<string, never> = {}): string {
  return problem === "unknown" ? t("Not in the media library") : problemText({ problem, slug, t });
}

function RowActions({ index, vm, t, kit }: { index: number; vm: MediaContentEditorController; t: Translate; kit: MediaContentEditorProps["kit"] }) {
  const { Icon, DockHeaderTip } = kit;
  const n = index + 1;
  const last = index === vm.rows.length - 1;
  return (
    // The admin's white tip, not the browser's dark `title` one (owner, 2026-10-11).
    <span className="media-content-editor__row-actions">
      <DockHeaderTip label={t("Move up")}>
        <button type="button" className="btn-ghost media-content-editor__icon" disabled={index === 0}
          aria-label={`${t("Move up")} ${n}`} onClick={() => vm.moveItem({ index, delta: -1 })}>
          <Icon name="arrow-up" size={14} aria-hidden="true" />
        </button>
      </DockHeaderTip>
      <DockHeaderTip label={t("Move down")}>
        <button type="button" className="btn-ghost media-content-editor__icon is-down" disabled={last}
          aria-label={`${t("Move down")} ${n}`} onClick={() => vm.moveItem({ index, delta: 1 })}>
          <Icon name="arrow-up" size={14} aria-hidden="true" />
        </button>
      </DockHeaderTip>
      <DockHeaderTip label={t("Remove")}>
        <button type="button" className="btn-ghost media-content-editor__icon"
          aria-label={`${t("Remove")} ${n}`} onClick={() => vm.removeItem({ index })}>
          <Icon name="close" size={14} aria-hidden="true" />
        </button>
      </DockHeaderTip>
    </span>
  );
}

function AddMediaRow({ vm, t, base, kit }: { vm: MediaContentEditorController; t: Translate; base: string | undefined; kit: MediaContentEditorProps["kit"] }) {
  const { Icon } = kit;
  const listId = useId();
  const full = vm.rows.length >= vm.maxItems;
  return (
    <>
      <div className="media-content-editor__add">
        <button type="button" className="btn-secondary media-content-editor__compact" disabled={full} onClick={() => vm.openPicker({ target: "items" })}
          {...handle({ base, suffix: "choose", role: "button", label: "Choose media from the library" })}>
          <Icon name="image" size={14} aria-hidden="true" />
          {t("Choose from library")}
        </button>
        <span className="media-content-editor__slug-add">
          <input className="field-mono" list={listId} value={vm.slugDraft} placeholder={t("Add by slug")} aria-label={t("Add by slug")}
            spellCheck={false} autoComplete="off" disabled={full} aria-invalid={vm.slugProblem ? true : undefined}
            onChange={(event) => vm.setSlugDraft({ value: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); vm.addSlug(); } }}
            {...handle({ base, suffix: "slug", role: "field", label: "Media slug to add" })} />
          <button type="button" className="btn-ghost media-content-editor__compact" disabled={full} onClick={vm.addSlug}
            {...handle({ base, suffix: "slug-add", role: "button", label: "Add the typed media slug" })}>
            <Icon name="plus" size={14} aria-hidden="true" />
            {t("Add")}
          </button>
        </span>
        <span className="field-hint media-content-editor__count">{vm.rows.length} / {vm.maxItems}</span>
        <datalist id={listId}>
          {(vm.pickable ?? []).map((asset) => <option key={asset.id} value={asset.slug}>{asset.title}</option>)}
        </datalist>
      </div>
      {vm.slugProblem ? <p className="field-error" role="alert">{problemText({ problem: vm.slugProblem.problem, slug: vm.slugProblem.slug, t })}</p> : null}
    </>
  );
}

function AttributesSection({ vm, t, base, kit }: { vm: MediaContentEditorController; t: Translate; base: string | undefined; kit: MediaContentEditorProps["kit"] }) {
  const { InfoTip, HtmlAttributeRows } = kit;
  return (
    <div className="media-content-editor__attrs">
      <div className="media-content-editor__toolbar">
        <label className="media-content-editor__field">
          {t("CSS class")}
          <input className="field-mono media-content-editor__class" value={vm.media.cssClass ?? ""} spellCheck={false}
            onChange={(event) => vm.setCssClass({ cssClass: event.target.value })} {...handle({ base, suffix: "css-class", role: "field", label: "CSS class on the layout root" })} />
        </label>
        <span className="media-content-editor__field">
          {t("HTML attributes")}
          <InfoTip label={t("data-*, aria-*, class, id, style. Unsafe ones are dropped.")} />
        </span>
      </div>
      <HtmlAttributeRows value={vm.media.htmlAttributes ?? ""} onChange={(htmlAttributes) => vm.setHtmlAttributes({ htmlAttributes })} t={t} agentHandle={base} />
    </div>
  );
}

function HtmlTab({ vm, t, base, kit }: { vm: MediaContentEditorController; t: Translate; base: string | undefined; kit: MediaContentEditorProps["kit"] }) {
  const { Icon, InfoTip } = kit;
  return (
    <>
      <div className="media-content-editor__toolbar">
        <button type="button" className="btn-secondary media-content-editor__compact" onClick={() => vm.openPicker({ target: "html" })}
          {...handle({ base, suffix: "insert-media", role: "button", label: "Insert library media at the cursor" })}>
          <Icon name="image" size={14} aria-hidden="true" />
          {t("Insert media…")}
        </button>
        <InfoTip label={t('Use {{media:slug}} for a file\'s URL, or data-media-slug="slug" on img, video, audio or source to fill in src, alt and size.')} />
        <span className={`field-hint media-content-editor__count${vm.htmlTooLong ? " is-over" : ""}`}>
          {vm.html.length.toLocaleString()} / {vm.maxHtmlLength.toLocaleString()}
        </span>
      </div>
      <div className="media-content-editor__code">
        <div ref={vm.gutterRef} className="media-content-editor__gutter" aria-hidden="true">
          {Array.from({ length: vm.htmlLines }, (_, i) => i + 1).join("\n")}
        </div>
        <textarea ref={vm.htmlRef} className="media-content-editor__source" value={vm.html} wrap="off" spellCheck={false}
          aria-label={t("HTML source")} aria-invalid={vm.htmlTooLong ? true : undefined} placeholder={'<img data-media-slug="…" alt="…">'}
          onChange={(event) => vm.setHtml({ html: event.target.value })} onScroll={vm.onHtmlScroll}
          {...handle({ base, suffix: "html", role: "field", label: "Raw HTML for this media content" })} />
      </div>
      {vm.htmlTooLong ? (
        <p className="field-error" role="alert">
          {interpolate({ template: t("HTML is longer than {max} characters and won't save."), vars: { max: vm.maxHtmlLength.toLocaleString() } })}
        </p>
      ) : null}
    </>
  );
}

function PickerThumb({ asset, vm, kit }: { asset: AdminMedia; vm: MediaContentEditorController; kit: MediaContentEditorProps["kit"] }) {
  const { Icon } = kit;
  if (asset.contentType?.startsWith("video/")) return <span className="media-content-editor__picker-icon"><Icon name="play" size={22} aria-hidden="true" /></span>;
  if (asset.contentType?.startsWith("audio/")) return <span className="media-content-editor__picker-icon"><Icon name="volume" size={22} aria-hidden="true" /></span>;
  return <img src={vm.mediaUrl({ asset })} alt="" loading="lazy" />;
}

/** Multi-select over the active library — images, video and audio. Same grid/item classes as
 *  `MediaPickerDialog`, checkbox per asset since several can be added at once. */
function LibraryPicker({ vm, t, base, kit }: { vm: MediaContentEditorController; t: Translate; base: string | undefined; kit: MediaContentEditorProps["kit"] }) {
  const { Dialog } = kit;
  return (
    <Dialog open onClose={vm.cancelPicker} title={t("Choose media")} className="settings-dialog jini-domain-dialog media-picker-dialog">
      <div className="media-picker-body">
        {vm.pickable === null ? <p className="notice">{t("Loading media…")}</p> : (
          <div className="media-picker-grid">
            {vm.pickable.map((asset) => (
              <label key={asset.id} className="media-picker-item" title={asset.slug}>
                <input type="checkbox" checked={vm.picked.includes(asset.slug)} onChange={() => vm.togglePicked({ slug: asset.slug })} />
                <PickerThumb kit={kit} asset={asset} vm={vm} />
                <span className="media-picker-item-title">{asset.title}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="widget-picker-footer">
        <span className="editor-actions">
          <button data-jini-autofocus="" type="button" className="btn-secondary" onClick={vm.cancelPicker}>{t("Cancel")}</button>
          <button type="button" className="btn-primary" disabled={vm.picked.length === 0} onClick={vm.confirmPicker}
            {...handle({ base, suffix: "picker-add", role: "button", label: "Add the checked media" })}>
            {t("Add selected")}
          </button>
        </span>
      </div>
    </Dialog>
  );
}

/** Empty item overrides fall back to the asset text before the translated field hint. */
function mediaTextPlaceholder({ row, field, t }: { row: MediaItemRow; field: "alt" | "caption"; t: Translate }): string {
  return row.asset?.[field] || t(field === "alt" ? "Alt text" : "Caption");
}


export function bindMediaContentEditor({ hooks, kit, deps }: Pick<MediaContentEditorProps, "hooks" | "kit" | "deps">, _optional = {}) {
  return function BoundMediaContentEditor(required: Omit<MediaContentEditorProps, "hooks" | "kit" | "deps">, _optional = {}) {
    return <MediaContentEditor {...required} hooks={hooks} kit={kit} deps={deps} />;
  };
}
