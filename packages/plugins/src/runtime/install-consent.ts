import type { PluginInstallPreview } from "../host/node/index.js";

/** What installing does to this computer, in one sentence. The CLI prompt shows it before the human
 *  approves; the assistant's `plugins_install` returns it as its result's `warning`. */
export function pluginInstallRiskSentence(required: { preview: PluginInstallPreview }, _optional = {}): string {
  const p = required.preview;
  // A tier-1 package has nothing to run (install.ts refuses one that ships a code file), so the
  // full-access warning would be false; say what it does instead.
  if (p.hasCode) return "This plugin runs code with full access to this computer and every site on it.";
  const contentTypes = p.contentTypes.length > 0 ? ` It adds content types: ${p.contentTypes.join(", ")}.` : "";
  return `This plugin contains no code.${contentTypes}`;
}

export const PLUGIN_INSTALL_STAYS_OFF = "It stays off in every workspace until you turn it on.";

/** The full trust disclosure a human reviews before a site plugin is installed. */
export function pluginInstallConsent(required: { preview: PluginInstallPreview }, _optional = {}): string {
  const p = required.preview;
  return [
    `${p.name} (${p.id}) ${p.version}`,
    `Trust: ${p.tier} (local / unverified publisher)`,
    `Capabilities: ${p.capabilities.join(", ") || "—"}`,
    `Hooks: ${p.hooks.join(", ") || "—"}`,
    ...(p.warnings ?? []),
    ...(p.upgradeFrom ? [`Replaces installed version ${p.upgradeFrom}.`] : []),
    pluginInstallRiskSentence({ preview: p }),
    PLUGIN_INSTALL_STAYS_OFF, "",
  ].join("\n");
}
