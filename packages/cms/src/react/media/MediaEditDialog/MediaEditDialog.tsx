import { useId, type ReactNode, type ComponentType } from "react";


interface MediaEditDialogValue { alt: string | null; cssClass: string | null; htmlAttributes: string | null }

/**
 * @file `MediaEditDialog` — the `media` doc node's `Edit` action (2026-09-11, owner-directed
 * per-post styling, then a same-day UI revision: renamed from `Style…`/`MediaStyleDialog`, moved
 * BEFORE `Replace` in the node view's action row, and widened to edit `alt` too, alongside
 * `cssClass`/`htmlAttributes` — layered over the referenced asset's own same-named defaults for the
 * latter two at render time (`render.ts`'s `mediaNodeStyleOverride`); `alt` has no such asset-level
 * counterpart, it is purely per-node).
 *
 * A MODAL, not a popover or a right-click context menu (the owner asked about a context menu and
 * it was ruled out: fights the native browser menu, undiscoverable, no touch support). Mirrors
 * `MediaPickerDialog.tsx`'s native Jini modal owner (accessible title, Escape-to-close,
 * backdrop-click-to-cancel,
 * `useDialog` injection seam) — the SAME modal pattern `MediaEmbedNodeView` already uses for its
 * own `Replace` action, per the owner's explicit direction to follow that established pattern
 * rather than invent a new one.
 *
 * The three fields and the `htmlAttributes` live validation hint are the SAME shape
 * `EditMediaPanel`'s asset-level fields use (`Media.tsx`, same `"Alt text (optional)"`/`"CSS class
 * (optional)"`/`"HTML attributes (optional)"` i18n keys from `MEDIA_DICT`) — an operator who has
 * already used the asset-level fields sees an identical control here, not a second UI to learn.
 * Every string goes through the controller's `t`, so the locale is read once, in the hook.
 */

export interface MediaEditDialogProps {
  /** The `media` node's CURRENT `alt`/`cssClass`/`htmlAttributes` attrs — seeds the draft. */
  initial: MediaEditDialogValue;
  /** Called with the new value on Save — the caller (`MediaEmbedNodeView`) forwards this straight
   *  into `props.updateAttributes`. */
  onSave: (value: MediaEditDialogValue) => void;
  onCancel: () => void;
  /** `false` hides the Alt field and titles the dialog "Style" instead of "Edit this instance" —
   *  the `widgetEmbed` node's own Style action (`widget-embed-extension.tsx`), which has no `alt`
   *  concept of its own. Defaults to `true` (the `media` node's original "Edit" dialog, unchanged).
   *  `save()` still returns whatever `initial.alt` was — hiding the field never touches it. */
  showAlt?: boolean;
  /** Injectable seam for the dialog's draft/validation/Escape hook. Defaults to the real
   *  {@link useWiredMediaEditDialog}; a test can pass a fake here to exercise this component's
   *  rendering without a real `useAdminLocale()` fetch or a real `document` keydown listener. */
  useDialog: (required: { initial: MediaEditDialogValue; onSave: (value: MediaEditDialogValue) => void; onCancel: () => void }) => {
    alt: string; cssClass: string; htmlAttributes: string;
    setAlt: (value: string) => void; setCssClass: (value: string) => void; setHtmlAttributes: (value: string) => void;
    htmlAttributesError: string | null; save: () => void;
    t: (required: { key: string }, optional?: Record<string, never>) => string;
  };
  Dialog: ComponentType<{ open: boolean; title: string; onClose: () => void; className: string; children?: ReactNode }>;
  /** Extra fields rendered after the style fields, before Cancel/Save — the `widgetEmbed` node's
   *  "Content for this spot" override (2026-10-11). The caller owns their state and reads it in its
   *  own `onSave`; this dialog only lays them out. */
  children?: ReactNode;
  /** Replaces the HTML attributes text box with the caller's own control over the same string —
   *  the `widgetEmbed` node passes `HtmlAttributeRows`, the key = value rows its widget editor uses
   *  (owner, 2026-10-11). Omitted: the text box, as the `media` node's Edit dialog has always had. */
  renderHtmlAttributes?: (field: { value: string; onChange: (value: string) => void }) => ReactNode;
}

export function MediaEditDialog({ initial, onSave, onCancel, showAlt = true, useDialog, Dialog, children, renderHtmlAttributes }: MediaEditDialogProps) {
  const { alt, cssClass, htmlAttributes, setAlt, setCssClass, setHtmlAttributes, htmlAttributesError, save, t } = useDialog({ initial, onSave, onCancel });
  // Native modality keeps Tab inside; Jini also restores the opener when this dialog unmounts.
  const altId = useId();
  const cssClassId = useId();
  const htmlAttributesId = useId();

  return (
    <Dialog open title={showAlt ? t({ key: "Edit this instance" }) : t({ key: "Style" })} onClose={() => onCancel()}
      className="settings-dialog jini-domain-dialog media-node-edit-dialog">
      {/* `media-node-edit-dialog`, NOT `media-edit-dialog` — that exact class name is already
          taken by `Media.tsx`'s unrelated native `<dialog>` asset-metadata editor
          (`styles/media.css`'s EDIT MODAL block), which sets its own `border`/`padding`/
          `max-width`/`width` on the bare class. Reusing that name here would leak those rules
          onto this instance editor (an extra border, a wider max-width, altered padding),
          producing chrome that silently drifts from `MediaPickerDialog`'s clean `.settings-dialog`
          + unique-marker-class pattern this file's header says it mirrors. */}

        {showAlt ? (
          <div className="field">
            <label className="field-label" htmlFor={altId}>
              {t({ key: "Alt text (optional)" })}
            </label>
            <input data-jini-autofocus="" id={altId} value={alt} onChange={(e) => setAlt(e.target.value)} />
          </div>
        ) : null}

        <div className="field">
          <label className="field-label" htmlFor={cssClassId}>
            {t({ key: "CSS class (optional)" })}
          </label>
          {/* When Alt is hidden (`showAlt={false}`), this is the first field in the dialog, so it
              takes the always-present native focus target otherwise marked on Alt — see
              `MediaEditDialog.hooks.tsx`'s own header on why a focus target must always exist. */}
          <input data-jini-autofocus={showAlt ? undefined : ""} id={cssClassId} value={cssClass} onChange={(e) => setCssClass(e.target.value)} />
        </div>

        {/* Same live, as-you-type hint `EditMediaPanel`'s asset-level field shows — never gates
            Save, see `MediaEditDialog.hooks.tsx`'s own header for why. */}
        <HtmlAttributesField htmlAttributesId={htmlAttributesId} htmlAttributes={htmlAttributes}
          setHtmlAttributes={setHtmlAttributes} htmlAttributesError={htmlAttributesError}
          {...(renderHtmlAttributes !== undefined ? { renderHtmlAttributes } : {})} t={t} />

        {children}

        <div className="widget-picker-footer">
          <span className="editor-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {t({ key: "Cancel" })}
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              {t({ key: "Save" })}
            </button>
          </span>
        </div>
    </Dialog>
  );
}

/** Both editor variants present the same validation feedback and field identity. */
function HtmlAttributesField({ htmlAttributesId, htmlAttributes, setHtmlAttributes, htmlAttributesError, renderHtmlAttributes, t }:
  Pick<ReturnType<MediaEditDialogProps["useDialog"]>, "htmlAttributes" | "setHtmlAttributes" | "htmlAttributesError" | "t"> &
  Pick<MediaEditDialogProps, "renderHtmlAttributes"> & { htmlAttributesId: string }) {
  return (
    renderHtmlAttributes ? (
      <div className="field" role="group" aria-labelledby={htmlAttributesId}>
        <span className="field-label" id={htmlAttributesId}>
          {t({ key: "HTML attributes (optional)" })}
        </span>
        {renderHtmlAttributes({ value: htmlAttributes, onChange: setHtmlAttributes })}
        {htmlAttributesError ? <p className="field-error">{htmlAttributesError}</p> : null}
      </div>
    ) : (
      <div className="field">
        <label className="field-label" htmlFor={htmlAttributesId}>
          {t({ key: "HTML attributes (optional)" })}
        </label>
        <input
          id={htmlAttributesId}
          value={htmlAttributes}
          onChange={(e) => setHtmlAttributes(e.target.value)}
          aria-invalid={htmlAttributesError ? true : undefined}
        />
        {htmlAttributesError ? <p className="field-error">{htmlAttributesError}</p> : null}
      </div>
    )
  );
}
