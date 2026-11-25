import { InfoTip } from "../../react/kit.js";

import type { AgentPluginListRow } from "../../agent-plugins/models.js";
import { navigate } from "../../shell/lib/router.js";
import { LockIcon } from "./agent-plugins-visuals.js";
import { linkedLockTip } from "./hooks/use-linked-lock-tip.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The state area of an agent plugin that follows a provider plugin's switch (posthog, sentry,
 * opentelemetry; owner 2026-10-25). It replaced an honest-disabled switch that read as a white
 * switch doing nothing: now the state word, then a red padlock. Hover, focus or a tap on the
 * padlock explains why (the shared `InfoTip`, its text also the padlock's name); pressing it opens
 * the Plugins page at that provider plugin's row (`?plugin=`, see `usePluginRowFocus`).
 */

export const LINKED_PLUGIN_TIP = "This is both an agent plugin and a regular plugin. It can only be turned on in the Plugins page.";

/** The Plugins page, Installed tab (it lists every installed plugin, on or off), at that plugin's row. */
export function linkedPluginHref({ providerPlugin }: { providerPlugin: string }, _options = {}): string {
  return `/addons/plugins?tab=installed&plugin=${encodeURIComponent(providerPlugin)}`;
}

export function AgentPluginLinkedLock({ plugin, providerPlugin, t, agentHandleBase }: { plugin: AgentPluginListRow; providerPlugin: string; t: Translate; agentHandleBase: string }) {
  return (
    <>
      {/* The word stays beside the padlock — see `AgentPluginRow`'s header (never colour or icon alone). */}
      <span className="jini-agent-plugin-state">{plugin.enabled ? t("Enabled") : t("Disabled")}</span>
      <span className="jini-agent-plugin-linked-lock">
        <InfoTip label={t(LINKED_PLUGIN_TIP)} icon={<LockIcon />} agentHandle={`${agentHandleBase}-linked`}
          useTip={linkedLockTip({ onFollow: () => navigate({ routePath: linkedPluginHref({ providerPlugin }) }) })} />
      </span>
    </>
  );
}
