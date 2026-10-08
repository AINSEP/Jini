import { useWidgetInstanceEditorView } from '../hooks/page-views.hooks.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';

import { agentHandle } from "@jini-ai/agentic";
import { widgetTypeLabel } from "../../rules.js";
import { useWiredWidgetInstanceEditor } from "../hooks/use-widget-instance-editor.hooks.js";
import type { AdminWidget, AdminWidgetWhereUsed } from "../../models.js";
import type { Translate } from "@jini-ai/ui/panel-kit";

/**
 * @file `WidgetInstanceEditorScreen` (`ui.spec.md` §2.2/§3.3/§4.3) — create/edit one widget
 * instance, `/admin/widgets/new?type=X` and `/admin/widgets/{id}` — markup only. Mirrors
 * `MenuEditor.tsx`'s editor-shell shape; config editing delegates to the shared
 * `WidgetConfigFields` (§3.4).
 *
 * State, the fetch, and save live in `../hooks/use-widget-instance-editor.hooks.ts`; the field-error
 * extraction, the known-type check, and the type label live in `../../rules.ts`.
 */

export { widgetInstanceGuard } from '../../rules.js';
import { WhereUsedBanner, WidgetInstanceGuardNotice } from '../components/WidgetInstanceNotices.js';

export interface WidgetInstanceEditorProps {
  widgetId: string | null;
  widgetType: string | null;
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useWidgetInstanceEditorHook?: typeof useWiredWidgetInstanceEditor | undefined;
}

export function WidgetInstanceEditor(props: WidgetInstanceEditorProps) {
  const { slots: { ConfigFields: WidgetConfigFields }, widgetTypes } = useWidgetsOptions();
  const { widgetId, widgetType: queryWidgetType, useWidgetInstanceEditorHook = useWiredWidgetInstanceEditor } = props;
  const {
    isNew,
    widget,
    whereUsed,
    title,
    setTitle,
    config,
    setConfig,
    message,
    error,
    fieldErrors,
    loading,
    saving,
    widgetType,
    save,
    confirmLeave,
    t,
    locale,
    guard,
    onBackClick,
  } = useWidgetInstanceEditorView({ widgetId, widgetType: queryWidgetType, useWidgetInstanceEditorHook, widgetTypes });

  if (guard) return <WidgetInstanceGuardNotice guard={guard} t={t} />;
  // Unreachable in practice — `widgetInstanceGuard`'s "no-type" case already covers a null
  // `widgetType` above — but TS can't see through that opaque function call, so this narrows the
  // type for the JSX below rather than asserting it with `!`.
  if (!widgetType) return null;

  // The host slot binds shared-component translations; screen copy uses the module t.
  const sharedT: Translate = t;

  return (
    <div className="page">
      {/* `page-header-split` (`styles.css`) — same shared idiom Pages/Posts/Forms already use:
          back link alone at the left rail, title block centred. Widgets never grew a separate
          `.editor-action-row` below a toolbar, so Save/status stay IN the header instead of an
          empty third rail — `.page-header-actions` (`styles.css`) pins that rail to the right and
          gives it its own narrow-container stacking row alongside the back link (owner,
          2026-09-22: "put the back button on the left, like the other editors" — this used to be a
          plain `.page-header`/`.page-actions` row with Back and Save both crowded at the right;
          the narrow-viewport "title, then a button row underneath" layout it already had is kept
          as-is, since that's the layout the owner said they liked). */}
      <div
        className="page-header page-header-split"
        {...agentHandle({ handle: "widget-instance-header" }, {
          role: "region",
          label: "Widget editor header — the back link, the widget's title, and the Save button",
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
            onClick={onBackClick}
            aria-label={`${t("Back")}: ${t("Widgets")}`}
            {...agentHandle({ handle: "widget-instance-back" }, { role: "link", label: "Back to Widgets" })}
          >
            ← {t("Back")}
          </a>
        </div>
        <div className="page-header-text">
          <p className="page-kicker">{t("Content")}</p>
          <h1 className="page-title">{t(isNew ? "New widget" : "Edit widget")}</h1>
          <p className="page-description">{t("Configure this widget's title and settings.")}</p>
        </div>
        <div className="page-header-actions page-actions">
          {message ? <span className="save-ok">{message}</span> : null}
          {error ? (
            <span className="save-error" role="alert">
              {error}
            </span>
          ) : null}
          <button
            onClick={save}
            disabled={saving}
            {...agentHandle({ handle: "widget-instance-save" }, { role: "button", label: "Save this widget" })}
          >
            {saving ? t("Saving…") : t("Save")}
          </button>
        </div>
      </div>

      {widget ? <WhereUsedBanner whereUsed={whereUsed} t={t} /> : null}

      {/* Audit finding: placeholder-only, no `<label>` — same fix as `PostEditor.tsx`'s title field
          (see `styles/editor.css`'s `.a11y-label-wrap` comment). */}
      <label className="a11y-label-wrap">
        <span className="visually-hidden">{t("Widget title")}</span>
        <input
          className="editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("Widget title")}
          {...agentHandle({ handle: "widget-instance-title" }, { role: "field", label: "This widget's title" })}
        />
      </label>
      <p className="muted-cell">{t("Type:")} {widgetTypeLabel({ widgetType, types: widgetTypes }, { t })}</p>

      <div className="widget-config-form">
        <WidgetConfigFields
          widgetType={widgetType}
          config={config}
          onChange={setConfig}
          agentHandle="widget-instance-config"
          t={sharedT}
        />
        {fieldErrors.map((fe, i) => (
          <p key={i} className="save-error" role="alert">
            {fe.field}: {fe.reason}
          </p>
        ))}
      </div>
    </div>
  );
}

export default WidgetInstanceEditor;
