import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { MouseEvent, ReactNode } from "react";
import type { AdminWidgetType, WidgetTypeOption } from "../../models.js";
import { widgetTypeLabel } from "../../rules.js";
import { WidgetRegionEditorHeaderActions } from "./WidgetRegionEditorHeaderActions.js";

/** @file The header block of each widgets page — markup only, moved out of the page components so each
 * page function stays within the size limit. State and translation arrive as props. */

/** Back link, title and the bind-a-region control of the regions list. */
export function WidgetRegionsHeader({ t, headerActions, newRegionKey, setNewRegionKey, binding, bind }: { t: Translate; headerActions: ReactNode; newRegionKey: string; setNewRegionKey: (value: string) => void; binding: boolean; bind: () => void }, _optional: Record<string, never> = {}) {
  // `page-header-split` (`styles.css`) — same shared idiom every editor with a back button
  // now uses: back link alone at the left rail, title block centred. This screen's own
  // right-rail action isn't a Save button but the bind-a-region control (input + Bind
  // button); `.page-header-actions` treats it exactly the same way (owner, 2026-09-22 — the
  // back link used to float above the header entirely, uncoordinated with the title, and
  // read "← Widgets"; it now reads the shared "← Back" every other editor got in the same
  // pass).
  return (
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
  );
}

/** Title and the create controls of the widgets library. */
export function WidgetsLibraryHeader({ t, headerActions, createType, setCreateType, widgetTypes }: { t: Translate; headerActions: ReactNode; createType: AdminWidgetType; setCreateType: (type: AdminWidgetType) => void; widgetTypes: readonly WidgetTypeOption[] }, _optional: Record<string, never> = {}) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <p className="page-kicker">{t("Content")}</p>
        <h1 className="page-title">{t("Widgets")}</h1>
        <p className="page-description">
          {t("Create reusable content blocks and place them into your theme's widget regions.")}
        </p>
      </div>
      <div className="page-actions">
        {headerActions}
        <a
          href="/admin/widgets/regions"
          {...agentHandle({ handle: "widgets-regions-link" }, { role: "link", label: "Go to Widget Regions" })}
        >
          {t("Regions →")}
        </a>
        <select
          value={createType}
          onChange={(e) => setCreateType(e.target.value as AdminWidgetType)}
          aria-label={t("Widget type to create")}
          {...agentHandle({ handle: "widgets-create-type" }, { role: "field", label: "Widget type to create" })}
        >
          {widgetTypes.map((o) => (
            <option key={o.value} value={o.value}>
              {widgetTypeLabel({ widgetType: o.value, types: widgetTypes }, { t })}
            </option>
          ))}
        </select>
        <a
          className="btn-primary"
          href={`/admin/widgets/new?type=${createType}`}
          {...agentHandle({ handle: "widgets-add-new" }, { role: "link", label: "Create a new widget of the selected type" })}
        >
          {t("Add New")}
        </a>
      </div>
    </div>
  );
}

/** Back link, title and Save of the widget instance editor. */
export function WidgetInstanceEditorHeader({ t, isNew, message, error, saving, save, onBackClick }: { t: Translate; isNew: boolean; message: string | null; error: string | null; saving: boolean; save: () => void; onBackClick: (event: MouseEvent<HTMLAnchorElement>) => void }, _optional: Record<string, never> = {}) {
  // `page-header-split` (`styles.css`) — same shared idiom Pages/Posts/Forms already use:
  // back link alone at the left rail, title block centred. Widgets never grew a separate
  // `.editor-action-row` below a toolbar, so Save/status stay IN the header instead of an
  // empty third rail — `.page-header-actions` (`styles.css`) pins that rail to the right and
  // gives it its own narrow-container stacking row alongside the back link (owner,
  // 2026-09-22: "put the back button on the left, like the other editors" — this used to be a
  // plain `.page-header`/`.page-actions` row with Back and Save both crowded at the right;
  // the narrow-viewport "title, then a button row underneath" layout it already had is kept
  // as-is, since that's the layout the owner said they liked).
  return (
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
  );
}

/** Back link, title and Save of the region editor. */
export function WidgetRegionEditorHeader({ t, regionKey, message, error, saving, onSave }: { t: Translate; regionKey: string; message: string | null; error: string | null; saving: boolean; onSave: () => void }, _optional: Record<string, never> = {}) {
  // `page-header-split` (`styles.css`) — same shared idiom Pages/Posts/Forms already use:
  // back link alone at the left rail, title block centred. Widget Regions never grew a
  // separate `.editor-action-row` below a toolbar, so Save/status (`.page-header-actions`)
  // stay IN the header instead of an empty third rail (owner, 2026-09-22: "put the back
  // button on the left, like the other editors" — see `WidgetRegionEditorHeaderActions`'s own
  // comment for why the back link moved out of that component).
  return (
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
      <WidgetRegionEditorHeaderActions message={message} error={error} saving={saving} onSave={onSave} t={t} />
    </div>
  );
}
