import { InfoTip } from "../../react/kit.js";

import type { AgentPluginListRow } from "../../agent-plugins/models.js";

import { type Translate } from '@jini-ai/core/text';
/** Why a "Soon" plugin is locked off (owner, 2026-11-10); shared by the tag and the disabled switch. */
export const SOON_PLUGIN_TIP = "Not ready for production use yet. You can still view its files.";

/** Reuse the shared tap/keyboard tooltip; native titles leave touch users without the warning.
 *  "untested" is a warning only; "soon" is locked off, so its tip says it can't be used yet. */
export function AgentPluginMaturity({ maturity, t }: { maturity: AgentPluginListRow["maturity"]; t: Translate }) {
  if (!maturity) return null;
  const label = maturity === "untested" ? t("Untested") : t("Soon");
  return (
    <span className="agent-plugin-maturity">
      <InfoTip
        triggerLabel={label}
        label={maturity === "untested" ? t("Not yet tested end to end. It may not work.") : t(SOON_PLUGIN_TIP)}
        icon={<span className="soon">{label}</span>}
      />
    </span>
  );
}
