import { agentHandle } from "@jini-ai/agentic";

/** The page header's Save-side actions cluster — the save-status message/error and the Save
 *  button — pulled out of `WidgetRegionEditor`'s own render body as a top-level component under
 *  the tightened ≤9/≤9 pass. Each of the three spans below is its own independent conditional (a
 *  save succeeded, a save failed, the save is in flight); extracting the whole cluster moves all
 *  three out of the parent's own scope at once.
 *
 * The "back to regions" link used to live in this same cluster (both sat together at the header's
 * right edge). It moved out to `WidgetRegionEditor`'s own `.page-header-lead` (2026-09-22, split
 * header pass — see that render's own comment) because the split header needs the back link and
 * this actions cluster on OPPOSITE rails, not adjacent — a single component can't render into two
 * non-adjacent grid cells with the title between them without breaking DOM/tab order, so the
 * cluster shed the one piece that had to move. */
export function WidgetRegionEditorHeaderActions({
  message,
  error,
  saving,
  onSave,
  t = (key: string) => key,
}: {
  message: string | null;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  /** Translator closure — see `WidgetRegionEditor()`'s own `t`. Optional (identity default) since
   *  this component is exported and unit-tested directly without one. */
  t?: ((key: string) => string) | undefined;
}) {
  return (
    <div className="page-header-actions page-actions">
      {message ? <span className="save-ok">{message}</span> : null}
      {error ? (
        <span className="save-error" role="alert">
          {error}
        </span>
      ) : null}
      <button
        onClick={onSave}
        disabled={saving}
        {...agentHandle({ handle: "widget-region-editor-save" }, { role: "button", label: "Save this region's placements" })}
      >
        {saving ? t("Saving…") : t("Save")}
      </button>
    </div>
  );
}

