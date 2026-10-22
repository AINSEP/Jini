import { useWidgetRegionsView } from '../hooks/page-views.hooks.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';
import { DataTable } from "../../../react/components/DataTable.js";
import { agentHandle } from "@jini-ai/agentic";
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
}

export function WidgetRegions({ useWidgetRegionsHook = useWiredWidgetRegions }: WidgetRegionsProps = {}) {
  const { headerActions } = useWidgetsOptions();
  const { regions, error, newRegionKey, setNewRegionKey, binding, bind, t, rowHandleByKey } = useWidgetRegionsView({ useWidgetRegionsHook });

  if (error && !regions) return <div className="notice error">{error}</div>;
  if (!regions) return <div className="notice">{t("Loading regions…")}</div>;

  return (
    <div className="page">
      {/* `page-header-split` (`styles.css`) — same shared idiom every editor with a back button
          now uses: back link alone at the left rail, title block centred. This screen's own
          right-rail action isn't a Save button but the bind-a-region control (input + Bind
          button); `.page-header-actions` treats it exactly the same way (owner, 2026-09-22 — the
          back link used to float above the header entirely, uncoordinated with the title, and
          read "← Widgets"; it now reads the shared "← Back" every other editor got in the same
          pass). */}
      <div
        className="page-header page-header-split"
        {...agentHandle({ handle: "widget-regions-header" }, {
          role: "region",
          label: "Widget Regions header — the back link, the screen's title, and the bind-a-region control",
        })}
      >
        <div className="page-header-lead">
          {/* Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
              button reads the same short way now). `aria-label` keeps "Back: Widgets" —
              colon-joined rather than concatenated into a sentence so it needs no new per-locale
              phrase key and still starts with the exact visible text (WCAG 2.5.3 Label in Name). */}
          <a
            className="btn-secondary"
            href="/admin/widgets"
            aria-label={`${t("Back")}: ${t("Widgets")}`}
            {...agentHandle({ handle: "widget-regions-back" }, { role: "link", label: "Back to Widgets" })}
          >
            ← {t("Back")}
          </a>
        </div>
        <div className="page-header-text">
          <p className="page-kicker">{t("Content")}</p>
          <h1 className="page-title">{t("Widget Regions")}</h1>
          <p className="page-description">
            {t(
              'A region is a theme-declared placement area (e.g. "header", "footer", "sidebar"). Bind a region by its key to start placing widgets in it.',
            )}
          </p>
        </div>
        <div className="page-header-actions page-actions">
          {headerActions}
          {/* One group, so a wrapping row keeps the key field beside its own Bind button instead
              of beside Publish (mobile sweep 2026-10-07). */}
          <div className="widget-regions-bind">
            <input
              value={newRegionKey}
              onChange={(e) => setNewRegionKey(e.target.value)}
              placeholder="e.g. footer"
              {...agentHandle({ handle: "widget-regions-new-key" }, { role: "field", label: "New region key to bind, e.g. footer" })}
            />
            <button
              onClick={bind}
              disabled={binding || !newRegionKey.trim()}
              {...agentHandle({ handle: "widget-regions-bind" }, { role: "button", label: "Bind this region key" })}
            >
              {binding ? t("Binding…") : t("Bind region")}
            </button>
          </div>
        </div>
      </div>
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
