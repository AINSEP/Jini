import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { AdminWidgetPlacement, WidgetTypeOption } from "../../models.js";
import { widgetTypeLabel } from "../../rules.js";

/** One placement of a region: reference state, enable toggle and the move / remove controls. */
export function RegionPlacementRow(
  { placement, handle, widgetTypes, t, toggleEnabled, moveUp, moveDown, remove }: {
    placement: AdminWidgetPlacement; handle: string | undefined; widgetTypes: readonly WidgetTypeOption[]; t: Translate;
    toggleEnabled: (placementId: string) => void; moveUp: () => void; moveDown: () => void; remove: (placementId: string) => void;
  },
  _optional: Record<string, never> = {},
) {
  return (
  <div className="menu-item-row">
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
          {...agentHandle({ handle: `${handle}-enabled` }, { role: "field", label: `Whether "${placement.widgetTitle}" is enabled` })}
        />
        {t("Enabled")}
      </label>
      <button
        className="tb-btn"
        onClick={moveUp}
        title={t("Move up")}
        aria-label={t("Move up")}
        {...agentHandle({ handle: `${handle}-move-up` }, { role: "button", label: `Move "${placement.widgetTitle}" up` })}
      >
        ↑
      </button>
      <button
        className="tb-btn"
        onClick={moveDown}
        title={t("Move down")}
        aria-label={t("Move down")}
        {...agentHandle({ handle: `${handle}-move-down` }, { role: "button", label: `Move "${placement.widgetTitle}" down` })}
      >
        ↓
      </button>
      <button
        className="tb-btn"
        onClick={() => remove(placement.placementId)}
        title={t("Remove")}
        aria-label={t("Remove")}
        {...agentHandle({ handle: `${handle}-remove` }, { role: "button", label: `Remove "${placement.widgetTitle}" from this region` })}
      >
        ✕
      </button>
    </div>
  </div>
  );
}
