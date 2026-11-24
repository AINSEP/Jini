import { InfoTip, RemixIcon } from "../../../react/kit.js";

/** The settings hook's input and the one field this indicator reads (structural slice of the host's subagents-settings hook). */
export type UseSubagentsIndicatorSettings = (required: { mode: string; agentId: string | null }) => { tooltipKey: string | null };

/**
 * Runtime/grant visibility comes from the hook. The tip is the shared white `InfoTip` bubble, opening
 * BELOW the icon (owner, 2026-10-10: the native `title` tooltip was dark, slow and came with a
 * question-mark cursor). The icon sits beside the conversation switcher in the dock header.
 * `useSettings` is the host's subagents-settings hook (its runtime and grant reads), injected.
 */
export function SubagentsIndicator({ mode, agentId, t = (key: string) => key, useSettings }: {
  mode: string; agentId: string | null;
  t?: (key: string) => string; useSettings: UseSubagentsIndicatorSettings;
}) {
  const { tooltipKey } = useSettings({ mode, agentId });
  return tooltipKey
    ? <span className="jini-chat-pane__subagents" role="status">
        <InfoTip label={t(tooltipKey)} placement="bottom" agentHandle="assistant-subagents-indicator"
          icon={<RemixIcon name="group-line" size={16} />} />
      </span>
    : null;
}
