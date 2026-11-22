import { useWidgetRegionEditorView } from '../hooks/page-views.hooks.js';
import { RegionPlacementRow } from '../components/RegionPlacementRow.js';
import { WidgetRegionEditorHeader } from '../components/WidgetPageHeaders.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';

import { agentHandle } from "@jini-ai/core/agent-handles";
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
  useWidgetRegionEditorViewHook?: typeof useWidgetRegionEditorView | undefined;
  useWidgetsOptionsHook?: typeof useWidgetsOptions | undefined;
}

export { WidgetRegionEditorHeaderActions } from '../components/WidgetRegionEditorHeaderActions.js';
import { WidgetRegionEditorHeaderActions } from '../components/WidgetRegionEditorHeaderActions.js';

export function WidgetRegionEditor({ regionKey, useWidgetRegionEditorHook = useWiredWidgetRegionEditor, useWidgetRegionEditorViewHook = useWidgetRegionEditorView, useWidgetsOptionsHook = useWidgetsOptions }: WidgetRegionEditorProps) {
  const { slots: { AddControl: WidgetAddControl }, widgetTypes } = useWidgetsOptionsHook();
  const { area, placements, message, error, loading, saving, removeAt, moveAt, toggleEnabled, addPlacement, save, t, placementHandles } =
    useWidgetRegionEditorViewHook({ regionKey, useWidgetRegionEditorHook });

  if (error && !area) return <div className="notice error">{error}</div>;
  if (loading) return <div className="notice">{t("Loading region…")}</div>;
  if (!area) return null;

  return (
    <div className="page">
      <WidgetRegionEditorHeader t={t} regionKey={regionKey} message={message} error={error} saving={saving} onSave={save} />

      <div className="jini-widget-region-placements">
        {placements.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <p>{t("No widgets placed in this region yet.")}</p>
            </div>
          </div>
        ) : (
          placements.map((placement, i) => (
            <RegionPlacementRow
              key={placement.placementId}
              placement={placement}
              handle={placementHandles[i]}
              widgetTypes={widgetTypes}
              t={t}
              toggleEnabled={toggleEnabled}
              moveUp={() => moveAt(i, -1)}
              moveDown={() => moveAt(i, 1)}
              remove={removeAt}
            />
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
