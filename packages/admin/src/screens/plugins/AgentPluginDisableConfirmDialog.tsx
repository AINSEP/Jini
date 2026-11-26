import { ConfirmActionDialog } from "../../shell/components/ConfirmActionDialog.js";

import { useAgentPluginDisableConfirm } from "./hooks/use-agent-plugin-disable-confirm.hooks.js";
import type { PluginRules } from "./rules.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Confirmation gate in front of the SAME underlying operation from two different controls.
 * There is no admin uninstall route — the only two agent-plugins routes are `GET .../agent-plugins`
 * (list) and `PATCH .../agent-plugins/:pluginId` (set-enabled); `uninstallAgentPlugin()`
 * (`Jini packages/agent-plugins/src/lifecycle/uninstall.ts`) is reachable only from an assistant tool and refuses every
 * bundled package outright — see `AgentPluginRow`'s own header for why its trash icon is honestly
 * disabled for that reason. So "remove this plugin", mechanically, is what turning it off already
 * does: `resolveAgentPluginRefs()` refuses to pin a disabled plugin into a run, which is the only
 * lever an operator actually has over a bundled package. This dialog exists because that lever has a
 * real cost (the assistant loses those skills on its very next run) and, before it landed, a single
 * click fired that cost with no way to reconsider.
 *
 * Two `variant`s, same mechanism, added when Downloaded's row lost its Enable/Disable switch in
 * favor of a single Remove/Enable action (2026-09-09 — see `AgentPlugins.tsx`'s own header):
 *   - `"disable"` — Installed's switch. Confirm reads "Disable", matching the verb the switch itself
 *     already shows via the row's "Enabled"/"Disabled" word — the owner's explicit call against
 *     renaming that control to "Add to site / Remove from site".
 *   - `"remove"` — Downloaded's action button. Confirm reads "Remove" to match that button's own
 *     label; the body still discloses, honestly, that this can't delete anything the backend can't
 *     already refuse to delete — see `buildAgentPluginDisableConfirmCopy`'s own header.
 *
 * Enabling stays a plain one-click action in both places — see `AgentPlugins.tsx`'s own
 * `onRequestToggleEnabled`/`onRequestRemove` — because turning a plugin ON has no comparable cost to
 * interrupt: nothing an operator already depends on stops working.
 *
 * Markup, classes (`settings-dialog`/`settings-dialog-backdrop`, `btn-secondary`/`btn-danger`), and
 * behaviour (Escape-to-cancel via the paired hook, Cancel default-focused so the destructive-leaning
 * action is never the default) mirror `@jini-ai/admin/screens/settings/ExternalMcpRemoveConfirmDialog` — the
 * most recent precedent for exactly this shape of dialog in this app, reused rather than
 * re-invented.
 */

export interface AgentPluginDisableConfirmDialogProps {
  /** The plugin's own human-readable display name (`agentPluginDisplayName(plugin)`) —
   *  must name the exact plugin being disabled, not a generic "this plugin". */
  name: string;
  /** Which control opened this dialog — see this file's own header for what each reads and why. */
  variant: "disable" | "remove";
  /** The row's recorded provenance; picks the body's last sentence (`buildAgentPluginDisableConfirmCopy`). */
  origin?: "bundled" | "operator-installed" | undefined;
  /** Enabled plugins that need a capability this one provides, as the server listed them. */
  requiredBy?: readonly string[] | undefined;
  /** This plugin row's own agent-handle base (e.g. `agent-plugin-row-site-compliance`) — Confirm/
   *  Cancel publish as `<rowHandle>-<variant>-confirm` / `<rowHandle>-<variant>-cancel`, nesting
   *  under the row's own control (`<rowHandle>-enabled` or `<rowHandle>-remove`) the same way
   *  `ExternalMcpRemoveConfirmDialog` nests its own controls under its card's handle. */
  agentHandleBase: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The screen's own bound translator, threaded down rather than called again here — same
   *  convention `ExternalMcpRemoveConfirmDialog` uses for its own `t`. */
  t: Translate;
  /** The host's bound rule functions (it owns the product name and the translator). */
  rules: Pick<PluginRules, "buildAgentPluginDisableConfirmCopy">;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useAgentPluginDisableConfirmHook?: typeof useAgentPluginDisableConfirm;
}

export function AgentPluginDisableConfirmDialog({
  name,
  variant,
  origin,
  requiredBy,
  agentHandleBase,
  onConfirm,
  onCancel,
  t,
  rules,
  useAgentPluginDisableConfirmHook = useAgentPluginDisableConfirm,
}: AgentPluginDisableConfirmDialogProps) {
  const { copy, dialogRef } = useAgentPluginDisableConfirmHook({ name, variant, origin, requiredBy, onCancel, t, rules });
  const titleId = `${agentHandleBase}-${variant}-confirm-title`;
  const confirmWord = variant === "remove" ? "Turn off" : "Disable";

  return (
    /* Cancel is the default-focused control, matching `ExternalMcpRemoveConfirmDialog`'s own
       "the interrupting action is never the default" precedent. */
    <ConfirmActionDialog
      dialogRef={dialogRef}
      titleId={titleId}
      title={copy.title}
      body={copy.body}
      onCancel={onCancel}
      onConfirm={onConfirm}
      extra={copy.dependents ?? null}
      cancelText={t("Cancel")}
      confirmText={t(confirmWord)}
      cancelHandle={`${agentHandleBase}-${variant}-cancel`}
      cancelAgentLabel={`Close this dialog without ${variant === "remove" ? "turning off" : "disabling"} ${name}`}
      confirmHandle={`${agentHandleBase}-${variant}-confirm`}
      confirmAgentLabel={variant === "remove" ? `Turn off ${name}` : `Disable ${name} for this site`}
    />
  );
}
