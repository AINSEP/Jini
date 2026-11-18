import { useWidgetInstanceEditorView } from '../hooks/page-views.hooks.js';
import { WidgetInstanceEditorHeader } from '../components/WidgetPageHeaders.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';

import { agentHandle } from "@jini-ai/core/agent-handles";
import { widgetTypeLabel } from "../../rules.js";
import { useWiredWidgetInstanceEditor } from "../hooks/use-widget-instance-editor.hooks.js";

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

import { type Translate } from '@jini-ai/core/text';
export interface WidgetInstanceEditorProps {
  widgetId: string | null;
  widgetType: string | null;
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useWidgetInstanceEditorHook?: typeof useWiredWidgetInstanceEditor | undefined;
  useWidgetInstanceEditorViewHook?: typeof useWidgetInstanceEditorView | undefined;
  useWidgetsOptionsHook?: typeof useWidgetsOptions | undefined;
}

export function WidgetInstanceEditor({ widgetId, widgetType: queryWidgetType, useWidgetInstanceEditorHook = useWiredWidgetInstanceEditor, useWidgetInstanceEditorViewHook = useWidgetInstanceEditorView, useWidgetsOptionsHook = useWidgetsOptions }: WidgetInstanceEditorProps) {
  const { slots: { ConfigFields: WidgetConfigFields }, widgetTypes } = useWidgetsOptionsHook();
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
    saving,
    save,
    t,
    gate,
    onBackClick,
  } = useWidgetInstanceEditorViewHook({ widgetId, widgetType: queryWidgetType, useWidgetInstanceEditorHook, widgetTypes });

  if (gate.guard !== null) return <WidgetInstanceGuardNotice guard={gate.guard} t={t} />;
  // `widgetInstanceGuard`'s "no-type" case already covers a null `widgetType` above, but TS can't
  // see through that opaque function call; `widgetEditorGate` hands back the narrowed type so the
  // JSX below needs neither a `!` assertion nor a never-taken null check.
  const { widgetType } = gate;

  // The host slot binds shared-component translations; screen copy uses the module t.
  const sharedT: Translate = t;

  return (
    <div className="page">
      <WidgetInstanceEditorHeader t={t} isNew={isNew} message={message} error={error} saving={saving} save={save} onBackClick={onBackClick} />

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
