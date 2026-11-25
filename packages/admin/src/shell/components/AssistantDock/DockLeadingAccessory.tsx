import { Icon, useChatT } from "../../../react/kit.js";

import { FolderDropNotice, type FolderDropNoticeProps } from "./FolderDropNotice.js";
import { SelectedAgentPluginTray, type SelectedAgentPluginTrayProps } from "./SelectedAgentPluginTray.js";

export interface DockLeadingAccessoryProps {
  /** The execution policy's deployed-site note (`executionPolicy.note`); null when none applies. */
  readonly note: string | null;
  /** The selected agent's sign-in warning (`useSelectedAgentAuthWarning`); null when none applies. */
  readonly warning: string | null;
  /** The folder-drop notice slot and its two actions (`useFolderDropBridge`). */
  readonly folderDrop: { readonly notice: FolderDropNoticeProps["notice"]; readonly dismiss: () => void; readonly retry: () => void };
  /** Whether the composer's folder button is showing, so the paste hint can point at it. */
  readonly canPickFolder?: boolean;
  /** A browser tab's folder dialog is open on the computer running the host (`folderWindowOpenElsewhere`). */
  readonly folderWindowOpenElsewhere?: boolean;
  /** The host's chat-dictionary key for the folder-window note (its text names the host product). */
  readonly folderWindowNoteKey: string;
  /** The pinned Agent Plugin chips and their remove action. */
  readonly pluginChips: SelectedAgentPluginTrayProps["chips"];
  readonly onRemovePlugin: SelectedAgentPluginTrayProps["onRemove"];
  /** The selected skill chips and their remove action (`useSelectedSkills`). */
  readonly skills: { readonly chips: SelectedAgentPluginTrayProps["chips"]; readonly removeSkill: (toolId: string) => void };
  /** The skill-only send action (`useSkillOnlySend`); offered only while it can send. */
  readonly skillOnlySend: { readonly canSendSkills: boolean; readonly sendSkills: () => void };
}

/**
 * What the dock renders in `ChatPane`'s `leadingAccessory` slot, directly above the composer's
 * textarea: the execution note, the agent sign-in warning, the folder-drop notice, and the plugin
 * and skill chip trays. See the `leadingAccessory` prop's doc in `AssistantDock.tsx` for why the
 * top-level prop is used rather than `composerSlots.leadingAccessories`.
 *
 * Owner constraint: a persistent chip for a capability most sessions never use clutters
 * the composer. `FolderDropNotice` (SPEC-053) renders only after a folder drop and clears
 * on auto-dismiss or explicit dismiss. The drop flow uses the route and `custom` fs root
 * in `features/fs-files/`. A fragment here adds no DOM node of its
 * own, so `assistant.css`'s `.admin-chat-dock > * { flex: 1 }` selector still reaches
 * `ChatPane`'s own root exactly as before (see `App.tsx`'s own comment on why a real wrapper
 * element in this position is a layout trap).
 *
 * @returns A fragment of the parts that currently apply; each tray renders nothing when empty.
 * @complexity O(n) in the number of chips.
 */
export function DockLeadingAccessory({ note, warning, folderDrop, canPickFolder = false, folderWindowOpenElsewhere = false, folderWindowNoteKey, pluginChips, onRemovePlugin, skills, skillOnlySend }: DockLeadingAccessoryProps) {
  return (
    <>
      {note && <p className="assistant-agent-auth-warning" role="status">{note}</p>}
      {/* Jini's AgentRuntimePicker has no warning slot yet, so this rides the slot directly
          above the input: seen before a send, cleared on sign-in + Rescan or a switch. */}
      {warning ? (
        <p className="assistant-agent-auth-warning" role="status" aria-live="polite">{warning}</p>
      ) : null}
      {/* In this in-flow row, not beside the footer's folder button: floated there it covered the
          text area (owner bug 11-01). Cleared when a folder is picked or the dialog is cancelled. */}
      {folderWindowOpenElsewhere ? <FolderWindowNote noteKey={folderWindowNoteKey} /> : null}
      <FolderDropNotice notice={folderDrop.notice} onDismiss={folderDrop.dismiss} onRetry={folderDrop.retry} canPickFolder={canPickFolder} />
      <SelectedAgentPluginTray useTHook={useChatT} chips={pluginChips} onRemove={onRemovePlugin} />
      <SelectedAgentPluginTray useTHook={useChatT} chips={skills.chips} onRemove={skills.removeSkill} {...(skillOnlySend.canSendSkills ? { onSendSkills: skillOnlySend.sendSkills } : {})} />
    </>
  );
}

/** The one-line "folder window opened on the computer running the host" status, styled like the folder-drop notices. */
function FolderWindowNote({ noteKey, useTHook = useChatT }: {
  noteKey: string; useTHook?: typeof useChatT; }) {
  const t = useTHook();
  return (
    <div className="jini-folder-drop-notice jini-folder-window-note" role="status">
      <span className="jini-folder-drop-notice__icon" aria-hidden="true"><Icon name="folder" size={14} /></span>
      <span className="jini-folder-drop-notice__label">{t(noteKey)}</span>
    </div>
  );
}
