import { ConfirmActionDialog } from "../../shell/components/ConfirmActionDialog.js";

import { usePluginRemoveConfirm } from "./hooks/use-plugin-remove-confirm.hooks.js";
import type { PluginRules } from "./rules.js";

import { type Translate } from '@jini-ai/core/text';
/** @file Confirmation gate before a site plugin moves to the 60-day Trash. */

export interface PluginRemoveConfirmDialogProps {
  /** The plugin's own display name (`plugin.name`) — must name the exact plugin being removed, not
   *  a generic "this plugin". */
  name: string;
  /** This plugin row's own agent-handle base — Confirm/Cancel publish as
   *  `<rowHandle>-remove-confirm` / `<rowHandle>-remove-cancel`, nesting under the row's own handle
   *  the same way `AgentPluginDisableConfirmDialog` nests under its row's `-enabled` switch. */
  agentHandleBase: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The screen's own bound translator, threaded down rather than called again here — same
   *  convention `AgentPluginDisableConfirmDialog` uses for its own `t`. */
  t: Translate;
  /** The host's bound rule functions (it owns the product name and the translator). */
  rules: Pick<PluginRules, "buildPluginRemoveConfirmCopy">;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  usePluginRemoveConfirmHook?: typeof usePluginRemoveConfirm;
}

export function PluginRemoveConfirmDialog({
  name,
  agentHandleBase,
  onConfirm,
  onCancel,
  t,
  rules,
  usePluginRemoveConfirmHook = usePluginRemoveConfirm,
}: PluginRemoveConfirmDialogProps) {
  const { copy, dialogRef } = usePluginRemoveConfirmHook({ name, onCancel, t, rules });
  const titleId = `${agentHandleBase}-remove-confirm-title`;

  return (
    /* Cancel stays default-focused because moving a shared package affects every workspace. */
    <ConfirmActionDialog
      dialogRef={dialogRef}
      titleId={titleId}
      title={copy.title}
      body={copy.body}
      onCancel={onCancel}
      onConfirm={onConfirm}
      cancelText={t("Cancel")}
      confirmText={t("Move to trash")}
      cancelHandle={`${agentHandleBase}-remove-cancel`}
      cancelAgentLabel={`Close this dialog without moving ${name} to the Trash`}
      confirmHandle={`${agentHandleBase}-remove-confirm`}
      confirmAgentLabel={`Move ${name} to the Trash`}
    />
  );
}
