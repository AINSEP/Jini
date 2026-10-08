import type { AdminWidgetWhereUsed, WidgetsTranslate as Translate } from "../../models.js";
/** REQ-34/`ui.spec.md` §3.5 — rendered only when `references.length > 0`, before the config form. */
export function WhereUsedBanner(props: { whereUsed: AdminWidgetWhereUsed; t: Translate }) {
  const { t } = props;
  if (props.whereUsed.count === 0) return null;
  return (
    <div className="notice widget-where-used-banner">
      <strong>
        {props.whereUsed.count === 1
          ? t("Used in 1 place:")
          : t("Used in {count} places:").replace("{count}", String(props.whereUsed.count))}
      </strong>
      <ul>
        {props.whereUsed.references.map((ref, i) => (
          <li key={i}>
            {ref.kind === "region" ? t("Region area") : t("Inline embed")} ({ref.sourceEntryId})
          </li>
        ))}
      </ul>
    </div>
  );
}

import type { WidgetInstanceGuard } from '../../rules.js';
/** Renders the notice for whichever guard applies — split from `widgetInstanceGuard` itself so the
 *  decision (data in, data out) and the rendering stay separately testable. */
export function WidgetInstanceGuardNotice({ guard, t }: { guard: WidgetInstanceGuard; t: (key: string) => string }) {
  switch (guard.kind) {
    case "fetch-error":
      return <div className="notice error">{guard.message}</div>;
    case "loading":
      return <div className="notice">{t("Loading widget…")}</div>;
    case "no-type":
      return <div className="notice error">{t("No widget type specified.")}</div>;
    case "unknown-type":
      return <div className="notice error">{t('Unknown widget type "')}{guard.widgetType}".</div>;
  }
}

