import type { ComponentType } from "react";
import type { InfoTipProps } from "../../react/kit.js";
import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { AssistantToggleRow } from "./AssistantToggleRow.js";
import { OwnerGrantStatus } from "./OwnerGrantStatus.js";
import type { PermanentDeletesController, PermanentDeletesSettings, UseAdminPermanentDeletesHook } from "./use-admin-permanent-deletes.hooks.js";

/** The host's product copy: the master's ⓘ explainer and the note for a tool with no admin screen. */
export interface AdminPermanentDeletesCopy { info: string; noAdminScreen: string }
export interface AdminPermanentDeletesProps {
  t: (key: string) => string;
  InfoTip: ComponentType<InfoTipProps>;
  /** The host's wired controller (normally `useAdminPermanentDeletes` from this folder bound to its policy). */
  useAdminPermanentDeletesHook: UseAdminPermanentDeletesHook;
  copy: AdminPermanentDeletesCopy;
}

/** Pure master-switch state. While the consent dialog is open the master stays enabled even though
 * the controller is busy, so the dialog can return focus to it on cancel.
 * @param required - The controller's server grant (null until loaded), errors, busy flag and dialog.
 * @returns checked, disabled, owner-only note and loading flags for the master row.
 * @complexity O(1). */
function permanentDeletesMaster(required: Pick<PermanentDeletesController, "settings" | "loadError" | "busy" | "dialog">) {
  const settings = required.settings;
  return { checked: settings?.enabled === true, ownerOnly: !!settings && !settings.canEdit, loading: !settings && !required.loadError,
    disabled: !settings?.canEdit || !!required.loadError || (required.busy && !required.dialog.open) };
}

/** Per-tool allow list, shown only while the master is ON; every change autosaves through the controller.
 * @param required - Translation port, the controller, its loaded settings and the no-screen note. */
function PermanentDeleteChecklist({ t, controller, settings, noAdminScreen }: {
  t: (key: string) => string; controller: PermanentDeletesController; settings: PermanentDeletesSettings; noAdminScreen: string;
}) {
  return <fieldset disabled={!settings.canEdit || controller.busy || !!controller.loadError}>
    <legend>{t("Allowed permanent deletes")}</legend>
    <div className="jini-permanent-delete-actions"><button type="button" className="btn-ghost" onClick={() => { void controller.selectAll({}); }}>{t("Select all")}</button>
      <button type="button" className="btn-ghost" onClick={() => { void controller.selectNone({}); }}>{t("Select none")}</button></div>
    {controller.groups.map(group => <fieldset key={group.label}><legend>{t(group.label)}</legend>
      {group.tools.map(tool => <div className="jini-permanent-delete-option" key={tool.id}>
        <label><input type="checkbox" checked={settings.allowedToolIds.includes(tool.id)}
          onChange={event => { void controller.setTool({ toolId: tool.id, checked: event.target.checked }); }} />{t(tool.label)}</label>
        {tool.adminPath ? <a href={tool.adminPath}>{t("Open admin screen")}</a> : <span className="jini-assistant-grant-note">{t(noAdminScreen)}</span>}
      </div>)}
    </fieldset>)}
  </fieldset>;
}

/** Native controls use the adjacent subagents form language; logic lives in the hook. */
export function AdminPermanentDeletes(props: AdminPermanentDeletesProps) {
  const { t, InfoTip, copy } = props;
  const controller = props.useAdminPermanentDeletesHook({ t });
  const master = permanentDeletesMaster(controller);
  return <section className="jini-assistant-switch jini-assistant-permanent-deletes">
    <AssistantToggleRow t={t} InfoTip={InfoTip} label={t("Allow permanent deletes from chat")}
      info={t(copy.info)}
      checked={master.checked} disabled={master.disabled}
      onChange={(enabled) => { void controller.setEnabled({ enabled }); }} />
    {master.ownerOnly && <p className="jini-assistant-grant-note">{t("Only the owner can change permanent delete access.")}</p>}
    {master.loading && <p role="status">{t("Loading permanent delete settings…")}</p>}
    {controller.settings?.enabled && <PermanentDeleteChecklist t={t} controller={controller} settings={controller.settings} noAdminScreen={copy.noAdminScreen} />}
    <OwnerGrantStatus t={t} busyKey="Waiting for confirmation or saving…" busy={controller.busy} loadError={controller.loadError} saveError={controller.saveError} />
    <ConfirmDialog {...controller.dialog} agentMayConfirm={false}
      body={<ul>{controller.dangers.map(danger => <li key={danger}>{t(danger)}</li>)}</ul>} />
  </section>;
}
