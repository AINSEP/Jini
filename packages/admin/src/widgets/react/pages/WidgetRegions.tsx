import { useWidgetRegionsView } from '../hooks/page-views.hooks.js';
import { WidgetRegionsHeader } from '../components/WidgetPageHeaders.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';
import { DataTable } from "../../../react/components/DataTable.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { useWiredWidgetRegions } from "../hooks/use-widget-regions.hooks.js";

/**
 * @file `WidgetRegionsScreen` (`ui.spec.md` §2.4/§3.6/§4.5/§9) — `/admin/widgets/regions` — markup
 * only. Lists currently-bound regions; the bind-new-region control is a free-text `regionKey`
 * input, mirroring `Menus.tsx`'s location-assign control exactly (no "theme declares regions" list
 * API exists to source a dropdown from — `ThemeManifest.regions` is read server-side at render
 * time, not exposed as an admin-listable registry; see `ui.spec.md` §9's disclosed dependency-gap
 * note).
 *
 * State, the fetch, and bind live in `../hooks/use-widget-regions.hooks.ts`.
 */
export interface WidgetRegionsProps {
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useWidgetRegionsHook?: typeof useWiredWidgetRegions | undefined;
  useWidgetRegionsViewHook?: typeof useWidgetRegionsView | undefined;
  useWidgetsOptionsHook?: typeof useWidgetsOptions | undefined;
}

export function WidgetRegions({ useWidgetRegionsHook = useWiredWidgetRegions, useWidgetRegionsViewHook = useWidgetRegionsView, useWidgetsOptionsHook = useWidgetsOptions }: WidgetRegionsProps = {}) {
  const { headerActions } = useWidgetsOptionsHook();
  const { regions, error, newRegionKey, setNewRegionKey, binding, bind, t, rowHandleByKey } = useWidgetRegionsViewHook({ useWidgetRegionsHook });

  if (error && !regions) return <div className="notice error">{error}</div>;
  if (!regions) return <div className="notice">{t("Loading regions…")}</div>;

  return (
    <div className="page">
      <WidgetRegionsHeader t={t} headerActions={headerActions} newRegionKey={newRegionKey} setNewRegionKey={setNewRegionKey} binding={binding} bind={bind} />
      {error ? <div className="notice error">{error}</div> : null}
      <DataTable
        rows={regions}
        rowKey={(region) => region.regionKey}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t("No regions bound yet.")}</p>
            </div>
          </div>
        }
        columns={[
          {
            key: "region-key",
            header: t("Region key"),
            cell: (region) => (
              <a
                href={`/admin/widgets/regions/${region.regionKey}`}
                {...agentHandle({ handle: `${rowHandleByKey.get(region.regionKey)}-key` }, { role: "link", label: `Manage the "${region.regionKey}" region` })}
              >
                {region.regionKey}
              </a>
            ),
          },
          { key: "placements", header: t("Placements"), cell: (region) => region.placementCount },
          {
            key: "manage",
            cell: (region) => (
              <a
                className="btn-primary"
                href={`/admin/widgets/regions/${region.regionKey}`}
                {...agentHandle({ handle: `${rowHandleByKey.get(region.regionKey)}-manage` }, { role: "link", label: `Manage the "${region.regionKey}" region` })}
              >
                {t("Manage")}
              </a>
            ),
          },
        ]}
      />
    </div>
  );
}

export default WidgetRegions;
