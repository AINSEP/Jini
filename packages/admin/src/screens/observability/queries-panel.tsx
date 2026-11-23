import { Suspense, type ComponentType, type CSSProperties } from "react";

import { type Translate } from '@jini-ai/core/text';

/** The live cache panel the host embeds (its query library's devtools panel, typically lazy). */
export type QueryCachePanel = ComponentType<{ style?: CSSProperties; theme?: "light" | "dark" }>;

/** Embeds the live cache panel; the host injects the vendor panel, so this screen stays vendor-free.
 * SettingsDialogShell mounts only its selected panel, so a lazy `Panel` downloads nothing until an
 * authorized host opens Queries. */
export function QueriesPanel({ readOnly, t, Panel }: {
  readOnly: boolean;
  t: Translate;
  Panel: QueryCachePanel;
}) {
  return <section className="jini-settings-section" aria-label={t("Queries")}>
    {readOnly && <p className="jini-field-hint">{t("Live cache overview. Interaction is disabled in production.")}</p>}
    {/* TanStack has no read-only option. Native inert blocks both pointer and keyboard
        actions (including clear/refetch/offline), while subscriptions keep the view live.
        Production detail inspection/filtering needs an owner-approved read-only adapter. */}
    <div className="jini-observability-queries-scroll" inert={readOnly}>
      <Suspense fallback={<p role="status">{t("Loading queries…")}</p>}>
        <Panel theme="light" style={{ width: "100%" }} />
      </Suspense>
    </div>
  </section>;
}
