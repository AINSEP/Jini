/** Editor diagnostics; CMS deliberately exposes only public fallback. */
import { ToolInputError } from "@jini-ai/core";
import { validateAgentPluginExportProps } from "../../core/export-props.js";
import type { PluginExportPackage } from "./source.js";
import type { AgentPluginExport } from "@jini-ai/core/contracts/site/agent-plugins-manifest";

import type { PluginEmbedDiagnostic } from "@jini-ai/core/contracts/site/page-html-store";
export interface SelectedPluginExport { readonly owner: PluginExportPackage; readonly component: string; readonly definition: AgentPluginExport }
export type PluginExportSelection = { readonly selected: SelectedPluginExport } | { readonly diagnostic: PluginEmbedDiagnostic };

/** A typed, safe input error works in both assistant tools and the authenticated HTML route. */
export class PluginEmbedValidationError extends ToolInputError {
  readonly code = "PLUGIN_EMBED_INVALID_PROPS";
  constructor(required: { message: string }, _options = {}) {
    super({ message: required.message });
    this.name = "PluginEmbedValidationError";
  }
}

/** Canonical names and declared aliases share one ambiguity rule; never guess a rename.
 * Disabled trusted packages still reserve their canonical identity. O(p + a) catalog and aliases.
 */
export function selectPluginExport(required: { packages: readonly PluginExportPackage[]; config: Readonly<Record<string, unknown>> }, _options = {}): PluginExportSelection {
  const { packages, config } = required;
  const owners = packages.filter(item => item.id === config.plugin || item.renamedFrom?.includes(config.plugin as string));
  const owner = owners[0];
  if (owners.length !== 1 || owner === undefined) return { diagnostic: { code: "PLUGIN_UNAVAILABLE", message: owners.length > 1 ? "Plugin identity is ambiguous; visitors see your fallback." : "Plugin is unknown or unavailable; visitors see your fallback." } };
  if (!owner.enabled) return { diagnostic: { code: "PLUGIN_DISABLED", message: "Plugin is off; visitors see your fallback." } };
  const entries = Object.entries(owner.exports).filter(([name, entry]) => name === config.component || entry.aliases?.includes(config.component as string));
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) return { diagnostic: { code: "COMPONENT_UNAVAILABLE", message: "Plugin component is unknown or ambiguous; visitors see your fallback." } };
  const [component, definition] = entry;
  return { selected: { owner, component, definition } };
}

/** Schema ownership stays in Jini; version messages stay in the authenticated host. O(props).
 * No prop values, file paths or underlying I/O errors appear in these messages.
 */
export function checkPluginExportConfig(required: { selected: SelectedPluginExport; config: Readonly<Record<string, unknown>> }, _options = {}): PluginEmbedDiagnostic | undefined {
  const { definition } = required.selected;
  // Version first: a retired or newer embed was written against another contract's props, so the
  // current schema cannot judge them; it gets the savable version warning, not a blocking props error.
  const versionDiagnostic = checkVersion({ definition, version: required.config.version === undefined ? 1 : required.config.version });
  if (versionDiagnostic) return versionDiagnostic;
  const propsReason = validateAgentPluginExportProps({ definition, props: required.config.props === undefined ? {} : required.config.props });
  if (propsReason) return { code: "PLUGIN_EMBED_INVALID_PROPS", message: `Plugin component props are invalid: ${propsReason}. Nothing was written.` };
  return undefined;
}

/** Version compatibility is independent of props validity. No side effects. O(1). */
function checkVersion({ definition, version }: { definition: AgentPluginExport; version: unknown }, _options = {}): PluginEmbedDiagnostic | undefined {
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) return { code: "PLUGIN_VERSION_INVALID", message: "Plugin contract version must be a positive integer; visitors see your fallback." };
  if (version > definition.version) return { code: "PLUGIN_VERSION_NEWER", message: `Page needs plugin v${version}; visitors see your fallback.` };
  if (version < (definition.minVersion ?? 1)) return { code: "PLUGIN_VERSION_RETIRED", message: `Contract v${version} retired; visitors see your fallback.` };
  return undefined;
}
