import { useWidgetRegionEditorView } from '../hooks/page-views.hooks.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';

import { agentHandle } from "@jini-ai/agentic";
import { useWiredWidgetRegionEditor } from "../hooks/use-widget-region-editor.hooks.js";
import { widgetTypeLabel } from "../../rules.js";

/**
 * @file `RegionPlacementEditorScreen` + `RegionPlacementList` (`ui.spec.md` §2.5/§2.6/§3.7/§3.8/
 * §4.6/§4.7) — `/admin/widgets/regions/{regionKey}` — markup only. Flat ordered list, ↑/↓ move
 * controls, mirrors `MenuEditor.tsx`'s `ItemRow`/`moveAtPath` reorder UX exactly, without the
 * nesting a menu tree has (a region's placement list has no parent/child structure, REQ-15).
 *
 * State, the fetch, and save live in `../hooks/use-widget-region-editor.hooks.ts`; the reorder swap
 * and the draft-placement builder live in `../../rules.ts`.
 */
export interface WidgetRegionEditorProps {
  regionKey: string;
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useWidgetRegionEditorHook?: typeof useWiredWidgetRegionEditor | undefined;
}

export { WidgetRegionEditorHeaderActions } from '../components/WidgetRegionEditorHeaderActions.js';
import { WidgetRegionEditorHeaderActions } from '../components/WidgetRegionEditorHeaderActions.js';

export function WidgetRegionEditor(props: WidgetRegionEditorProps) {
  const { slots: { AddControl: WidgetAddControl }, widgetTypes } = useWidgetsOptions();
  const { regionKey, useWidgetRegionEditorHook = useWiredWidgetRegionEditor } = props;
  const { area, placements, message, error, loading, saving, removeAt, moveAt, toggleEnabled, addPlacement, save, t, locale, placementHandles } =
    useWidgetRegionEditorView({ regionKey, useWidgetRegionEditorHook });

  if (error && !area) return <div className="notice error">{error}</div>;
  if (loading) return <div className="notice">{t("Loading region…")}</div>;
  if (!area) return null;

  return (
    <div className="page">
      {/* `page-header-split` (`styles.css`) — same shared idiom Pages/Posts/Forms already use:
          back link alone at the left rail, title block centred. Widget Regions never grew a
          separate `.editor-action-row` below a toolbar, so Save/status (`.page-header-actions`)
          stay IN the header instead of an empty third rail (owner, 2026-09-22: "put the back
          button on the left, like the other editors" — see `WidgetRegionEditorHeaderActions`'s own
          comment for why the back link moved out of that component). */}
      <div
        className="page-header page-header-split"
        {...agentHandle({ handle: "widget-region-editor-header" }, {
          role: "region",
          label: "Widget region editor header — the back link, the region's title, and the Save button",
        })}
      >
        <div className="page-header-lead">
          {/* Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
              button reads the same short way now). `aria-label` keeps "Back: Regions" —
              colon-joined rather than concatenated into a sentence so it needs no new per-locale
              phrase key and still starts with the exact visible text (WCAG 2.5.3 Label in Name). */}
          <a
            className="btn-secondary"
            href="/admin/widgets/regions"
            aria-label={`${t("Back")}: ${t("Regions")}`}
            {...agentHandle({ handle: "widget-region-editor-back" }, { role: "link", label: "Back to Widget Regions" })}
          >
            ← {t("Back")}
          </a>
        </div>
        <div className="page-header-text">
          <p className="page-kicker">{t("Content")}</p>
          <h1 className="page-title">{t("Region:")} {regionKey}</h1>
          <p className="page-description">{t("Manage which widgets appear in this region and their order.")}</p>
        </div>
        <WidgetRegionEditorHeaderActions message={message} error={error} saving={saving} onSave={save} t={t} />
      </div>

      <div className="widget-region-placements">
        {placements.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <p>{t("No widgets placed in this region yet.")}</p>
            </div>
          </div>
        ) : (
          placements.map((placement, i) => (
            <div key={placement.placementId} className="menu-item-row">
              <div className="menu-item-fields">
                {placement.broken ? (
                  <span className="widget-embed-node--broken">{t("⚠ Broken reference")}</span>
                ) : (
                  <span>
                    <strong>{placement.widgetTitle}</strong>
                    {placement.widgetType ? (
                      <>
                        {" "}
                        <span className="muted-cell">({widgetTypeLabel({ widgetType: placement.widgetType, types: widgetTypes }, { t })})</span>
                      </>
                    ) : null}
                  </span>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={placement.enabled}
                    onChange={() => toggleEnabled(placement.placementId)}
                    {...agentHandle({ handle: `${placementHandles[i]}-enabled` }, { role: "field", label: `Whether "${placement.widgetTitle}" is enabled` })}
                  />
                  {t("Enabled")}
                </label>
                <button
                  className="tb-btn"
                  onClick={() => moveAt(i, -1)}
                  title={t("Move up")}
                  aria-label={t("Move up")}
                  {...agentHandle({ handle: `${placementHandles[i]}-move-up` }, { role: "button", label: `Move "${placement.widgetTitle}" up` })}
                >
                  ↑
                </button>
                <button
                  className="tb-btn"
                  onClick={() => moveAt(i, 1)}
                  title={t("Move down")}
                  aria-label={t("Move down")}
                  {...agentHandle({ handle: `${placementHandles[i]}-move-down` }, { role: "button", label: `Move "${placement.widgetTitle}" down` })}
                >
                  ↓
                </button>
                <button
                  className="tb-btn"
                  onClick={() => removeAt(placement.placementId)}
                  title={t("Remove")}
                  aria-label={t("Remove")}
                  {...agentHandle({ handle: `${placementHandles[i]}-remove` }, { role: "button", label: `Remove "${placement.widgetTitle}" from this region` })}
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
        <WidgetAddControl
          triggerLabel={t("+ Add widget")}
          onResolved={(widgetInstanceId) => addPlacement(widgetInstanceId)}
          agentHandle="widget-region-add"
        />
      </div>
    </div>
  );
}

export default WidgetRegionEditor;
