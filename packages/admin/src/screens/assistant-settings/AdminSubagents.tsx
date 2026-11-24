import { useId, type ComponentType } from "react";
import type { InfoTipProps } from "../../react/kit.js";
import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { AssistantToggleRow } from "./AssistantToggleRow.js";
import { OwnerGrantStatus } from "./OwnerGrantStatus.js";
import type { AdminSubagentsController, AdminSubagentsCopy, UseAdminSubagentsHook } from "./admin-subagents.types.js";

export interface AdminSubagentsProps {
  t: (key: string) => string;
  InfoTip: ComponentType<InfoTipProps>;
  /** The host's wired Full CLI access controller (its grant policy and port stay in the host). */
  useAdminSubagentsHook: UseAdminSubagentsHook;
  copy: AdminSubagentsCopy;
}

/** Pure switch state: which note explains a locked switch, and when the switch must stay locked.
 * @param required - The controller's server grant (null until loaded), load error and busy flag.
 * @returns checked, owner-only note, env-lock reason and the disabled flag for the toggle row.
 * @complexity O(1). */
function subagentsSwitch(required: Pick<AdminSubagentsController, "settings" | "loadError" | "busy">) {
  const settings = required.settings;
  // The owner's switch is still locked when the server names a local env lock (see the dock hook).
  const lockReason = settings?.canEdit ? settings.unavailableReason : undefined;
  return { checked: settings?.enabled === true, ownerOnly: !!settings && !settings.canEdit, lockReason,
    disabled: !settings?.canEdit || !!lockReason || !!required.loadError || required.busy };
}

/** Source choices patch one agent; connected host tools retain their existing gates.
 * @complexity O(a) for the fixed agent registry, with no extra reads. */
function AgentToolSources({ controller, disabled, t, InfoTip, copy }: Omit<AdminSubagentsProps, "useAdminSubagentsHook"> & { controller: AdminSubagentsController; disabled: boolean }) {
  return (
    <div className="jini-assistant-tool-sources">
      <p>{t("Tools provided here")}</p>
      <p className="jini-assistant-grant-note">{t(copy.toolSourcesHint)}</p>
      {controller.settings?.agents?.map(agent => <AssistantToggleRow key={agent.id} t={t} InfoTip={InfoTip}
        label={t(`Also use ${agent.name}'s personal MCP servers.`)}
        info={t(copy.agentMcpInfo({ name: agent.name }))}
        checked={controller.settings?.byAgent?.[agent.id]?.capabilities?.userMcp ?? controller.settings?.capabilities?.userMcp ?? false}
        disabled={disabled}
        onChange={enabled => { void controller.setAgentMcp({ agentId: agent.id, enabled }); }} />)}
    </div>
  );
}

/** Owner toggle rendered in the existing assistant/theme form language; lifecycle lives in hooks. */
export function AdminSubagents(props: AdminSubagentsProps) {
  const { t, InfoTip, copy } = props;
  const controller = props.useAdminSubagentsHook({ t });
  const ownerNoteId = useId();
  const view = subagentsSwitch(controller);
  return <section className="jini-assistant-switch jini-assistant-subagents">
    {/* No agent handle: only the human owner may change the assistant's own tool grant. */}
    <AssistantToggleRow t={t} InfoTip={InfoTip} label={t("Full CLI access")}
      info={t(copy.info)}
      checked={view.checked} describedBy={view.ownerOnly || view.lockReason ? ownerNoteId : undefined}
      disabled={view.disabled}
      onChange={(enabled) => { void controller.setEnabled({ enabled }); }} />
    {view.ownerOnly && <p id={ownerNoteId} className="jini-assistant-grant-note">{t("Only the owner can change Full CLI access.")}</p>}
    {view.lockReason && <p id={ownerNoteId} className="jini-assistant-grant-note">{t(view.lockReason)}</p>}
    <AgentToolSources controller={controller} disabled={view.disabled} t={t} InfoTip={InfoTip} copy={copy} />
    {!controller.settings && !controller.loadError && <p role="status">{t("Loading Full CLI access…")}</p>}
    <ConfirmDialog {...controller.dialog} agentMayConfirm={false} />
    <OwnerGrantStatus t={t} busyKey="Saving…" busy={controller.busy} loadError={controller.loadError} saveError={controller.saveError} />
  </section>;
}
