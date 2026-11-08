import { buildDomainRegistrations, indexCatalogById, requireInputRecord, ToolInputError, type AgentToolDefinition, type DerivedRiskByToolId, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import type { ToolMetadataById } from '@jini-ai/core';
export const PROVIDER_STATUS_TOOL_ID = "provider_status";
/** Manifest display metadata only; no stored setting value is accepted. */
export interface ProviderSettingFieldProjection {
 readonly name: string; readonly label: string; readonly secret?: boolean; readonly required?: boolean;
 readonly requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
 readonly requiredWhen?: { readonly field: string; readonly in: readonly string[] };
 readonly hint?: string; readonly default?: string; readonly options?: readonly { readonly value: string; readonly label: string }[]; readonly allowCustom?: boolean;
}


/** One provider plugin's status row; the composition root fills it from discovery, activation and the settings store. */
export interface ProviderStatusRow {
  readonly pluginId: string;
  /** Manifest declarations only; never saved values. */
  readonly fields?: readonly ProviderSettingFieldProjection[];
  readonly settingsCard?: { readonly tool: "credential_save"; readonly input: { readonly kind: "provider-settings"; readonly target: string } };
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly missing: readonly string[];
  readonly store: "project" | "site";
  readonly appliesAt: "now" | "restart" | "failed";
  readonly keyId?: string;
  readonly usedByThisSite: boolean;
  readonly usedBy: readonly string[];
  readonly unreadable?: true;
  readonly quarantine?: string;
}


export interface ProviderStatusPorts {
  /** Every discovered plugin that declares provider settings; presence only. */
  readonly list: (required: Record<string, never>) => Promise<readonly ProviderStatusRow[]>;
  readonly authorize: (ctx: ToolExecutionContext) => Promise<void>;
}
/** @agent-note The host supplies the permission name, reviewed metadata and an authorization port from the same host instance. */
export function createProviderStatusTools({ metadata: toolMetadata, authorization }: { metadata: ToolMetadataById; authorization: { permission: string } }, _optional: Record<string, never> = {}) {


/**
 * @file `provider_status` (2026-10-25): a read-only, vendor-neutral answer to "is my analytics /
 * error tracking / tracing provider set up?" for every provider plugin (a plugin whose manifest
 * declares provider settings). Presence only: configured or not, which required fields are missing,
 * where it is saved, whether the plugin is on, its quarantine reason if the host quarantined it.
 * Never a setting value: hosts and endpoints can carry private tenant URLs, and secrets never leave
 * the server. Agent plugins (content/agent-plugins/<vendor>/) name the vendor; this tool names none.
 */



const providerStatusAgentToolCatalog: AgentToolDefinition[] = [{
  name: PROVIDER_STATUS_TOOL_ID,
  description: "Read-only status of provider plugins (product analytics, error tracking, observability/tracing): for each, pluginId, enabled, configured (every required setting has a value), missing (labels of required settings without one), store (site = this site's own key; project = a key saved in your project), usedByThisSite (false = saved but not used here; ask before project_key_use), keyId, usedBy, appliesAt (now; restart when the provider cannot re-start live; failed when it could not start with the saved settings), unreadable (saved but cannot be opened on this machine; enter it again) and quarantine (the host's reason, when it switched the plugin off). Returns fields from the manifest with required, requiredUnless, requiredWhen, options, defaults and hints; use these declarations to explain requirements. Never returns a saved setting value or secret. Pass pluginId for one plugin. When asked to show or open settings, call the returned settingsCard tool and input to open the human card. Requires " + authorization.permission + ".",
  sideEffects: "none",
  authorization: { permission: authorization.permission },
  inputSchema: { type: "object", additionalProperties: false, properties: { pluginId: { type: "string", minLength: 1, description: "Optional provider plugin id, e.g. from plugins_list." } } },
}];

const providerStatusDerivedRisk: DerivedRiskByToolId = new Map([[PROVIDER_STATUS_TOOL_ID, "none"]]);

/** Optional pluginId filter; an unknown id is refused so the model never reads "not configured" for a typo. */
function selectRows({ rows, pluginId }: { rows: readonly ProviderStatusRow[]; pluginId: unknown }): { providers: readonly ProviderStatusRow[] } {
  if (pluginId === undefined) return { providers: rows };
  const row = rows.find((candidate) => candidate.pluginId === pluginId);
  if (!row) throw new ToolInputError({ message: `No installed provider plugin '${String(pluginId)}'. Call provider_status without pluginId, or plugins_list.` });
  return { providers: [row] };
}

/** @complexity O(p) provider plugins; one settings read each in the port. */
function buildProviderStatusRegistrations({ ports }: { ports: ProviderStatusPorts }, _optional = {}): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "provider-status",
    catalogModule: "features/plugin-runtime/provider-status-tool.ts", catalog: indexCatalogById({ catalog: providerStatusAgentToolCatalog }), derivedRisk: providerStatusDerivedRisk,
    handlers: { [PROVIDER_STATUS_TOOL_ID]: async (ctx) => {
      const input = ctx.input === undefined ? {} : requireInputRecord({ input: ctx.input });
      if (Object.keys(input).some((key) => key !== "pluginId")) throw new ToolInputError({ message: "provider_status takes only an optional pluginId." });
      await ports.authorize(ctx);
      return selectRows({ rows: await ports.list({}), pluginId: input.pluginId });
    } },
  });
}

return { providerStatusAgentToolCatalog, providerStatusDerivedRisk, buildProviderStatusRegistrations };
}
