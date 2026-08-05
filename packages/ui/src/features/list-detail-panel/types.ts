/**
 * Generic "master-detail (list+preview) navigator" primitive — a sidebar list
 * of summary items with a selection state, and a detail pane rendering
 * whichever item is selected. Host-injected for the actual data/rendering of
 * both summary rows and detail content; this feature only owns the
 * selection-interaction chrome and the selection-validity rule.
 *
 * Origin: `DesignSystemsTab.tsx` in the real OD source (the confirmed
 * instance of this shape — see `packages/ui/source-map.md` for why
 * `PluginsView.tsx`'s detail modal and `ProjectView.tsx`'s composition were
 * verified NOT to share it despite the surface-level "conceptually related"
 * flag in `ADS-memory/reports/jini-port/recon/r6-god-component-internals.md`).
 */

/** The minimum shape a summary item must carry: a stable identity. */
export interface ListDetailItem {
  id: string;
}

/** Render-time state handed to a row's `renderItem` callback. */
export interface ListDetailItemRenderState {
  active: boolean;
}
