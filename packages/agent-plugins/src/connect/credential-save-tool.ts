import type { ToolExecutionOptions } from "@jini-ai/core";
import { loadPluginCredentialCardsSafely } from "./plugin-credential-card.js";
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { ToolMetadataById } from '@jini-ai/core';
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, ToolInputError, type AgentToolDefinition, type DerivedRiskByToolId, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from '@jini-ai/core';


/** Host credential kinds delegate to the existing domain authorization and sealed-store owners.
 * Jini owns the secret-card lifecycle; this module only routes non-secret model metadata.
 */
export interface CredentialSaveAdapters {
  readonly apiCreate: ToolHandler;
  readonly apiRotate: ToolHandler;
  readonly mediaProvider: ToolHandler;
  readonly sourceControl: ToolHandler;
  readonly publishHost: ToolHandler;
  readonly agentPluginToken: ToolHandler;
  readonly pluginProvider: ToolHandler;
  /** A provider plugin's settings card (`saveKind: "provider-settings"`); absent where no settings store is wired. */
  readonly providerSettings?: ToolHandler;
}

/** @agent-note The host supplies its reviewed metadata, public tool id and credential categories. Save adapters keep authorization and persistence in that host. */
export function createCredentialSaveTools({ metadata: toolMetadata, toolId: CREDENTIAL_SAVE_TOOL_ID, categories: CUSTOM_CREDENTIAL_CATEGORIES }: {
  metadata: ToolMetadataById; toolId: string; categories: readonly string[];
}, _optional: Record<string, never> = {}) {

const KINDS = ['api', 'media-provider', 'source-control', 'publish-host', 'agent-plugin-token', 'plugin-provider', 'provider-settings'] as const;
type CredentialKind = typeof KINDS[number];

/** Model input carries non-secret metadata only. Schema additionalProperties is descriptive:
 * selectSave and each domain handler enforce the allowed keys independently, so no model-issued
 * argument can smuggle a token into the human-form path. Creation and rotation have distinct
 * contracts: optional creation hints make a new row; target addresses an existing credential.
 */
const credentialSaveCatalog: AgentToolDefinition[] = [{
  name: CREDENTIAL_SAVE_TOOL_ID,
  description: 'Save, add, connect or rotate a credential through a secure human form. The person types the API key, token or password in a masked card; it is sealed server-side and never enters chat or model input. This one call waits for submit, cancel, expiry or abandonment. ' +
    'Choose kind: api for any third-party API, such as a payments or email API, DNS registrar or hosting API; media-provider for image/video generation keys; source-control for git repository commit and backup tokens; publish-host for static site hosting or object storage credentials; agent-plugin-token for an installed plugin personal access token fallback after agent_plugin_connect could not start OAuth sign-in; provider-settings to show a provider plugin’s manifest settings card (target is the pluginId from provider_status); plugin-provider for a provider whose installed plugin ships its own key card, which asks for the key and required public connection fields and saves through that domain’s existing owner. Prefer a plugin-declared card whenever one covers the task. ' +
    'Examples: create an API credential with {kind:"api",label:"payments",baseUrl:"https://api.example.test",category:"general"}; rotate a saved API token with {kind:"api",target:"hosting-prod"} (target is the exact saved label, username is preserved); save an image generation key with {kind:"media-provider",target:"image-provider"}; connect repository backups with {kind:"source-control",target:"<repository provider id>",label:"default"}; save a hosting connection with {kind:"publish-host",target:"<storage provider id>",prefill:{bucket:"my-site",region:"us-east-1"}}; use a plugin token with {kind:"agent-plugin-token",target:"<plugin id>"}; open a plugin’s own key card with {kind:"plugin-provider",target:"<provider id>"}. ' +
    'Discover targets first with content_read.custom_credential, media_list_providers, source_control_get_capabilities or deployment_get_static_publish_capabilities. Choose the card or saved key whose usedFor covers the task; do not ask the person. usedFor is display text, not permission or verification. API creation accepts optional label/baseUrl/category/worksFor prefill; without target it creates a new row and refuses a duplicate label. Publish prefill accepts only provider-declared non-secret fields. Never supply a secret in any argument. ' +
    'Before opening any key card, explain which service and purpose it is for. Refuse to open a replacement-token card for a saved working credential unless the person explicitly asked to replace that key. When explicitly asked to show provider settings, open kind provider-settings; opening the card does not save anything until the person submits. Never open secret-entry cards during a read-only request or to answer what a token is. Read saved metadata and answer in words first. Account-management access may require a separate plugin connection; do not overwrite a working sending key to obtain broader access. ' +
    'Permissions stay per kind: custom-credentials.write, admin.integrations.manage (media/plugin), source-control.credentials.write, deployments.credentials.write, admin.plugins.enable (provider-settings). Results retain each kind’s safe save status and errors; only API creation returns created/credential. Saving a media key does not verify it or add adapter support. External MCP server config, user creation, database destinations and app environment secrets use their own action tools. Saving a project key on a card attaches it to this site. After success retry the original request once.',
  sideEffects: 'mutates-durable-state',
  authorization: { permission: 'resolved-per-kind' },
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['kind'],
    properties: {
      kind: { type: 'string', enum: [...KINDS] },
      target: { type: 'string', minLength: 1, description: 'Existing API credential label to rotate, media/source-control/publish/plugin provider id, or installed plugin id.' },
      label: { type: 'string', description: 'Optional new API or source-control credential label; never a secret.' },
      baseUrl: { type: 'string', description: 'API creation only: non-secret base URL prefill.' },
      worksFor: { type: "array", items: { type: "string" }, description: "API creation only: explicit host or vendor IDs to preselect in the secure form." },
      category: { type: 'string', enum: [...CUSTOM_CREDENTIAL_CATEGORIES], description: 'API creation only: category prefill.' },
      reason: { type: 'string', maxLength: 1000, description: 'Media only: non-secret reason shown on the form.' },
      prefill: { type: 'object', additionalProperties: { type: 'string' }, description: 'Publish only: provider-declared non-secret credential fields. Never tokens, keys or passwords.' },
    },
  },
}];

const credentialSaveDerivedRisk: DerivedRiskByToolId = new Map([[CREDENTIAL_SAVE_TOOL_ID, 'mutates-durable-state']]);

/** Select one domain owner without authorizing, opening a card, or inspecting secret fields.
 * @param required - Kind, non-secret metadata and injected domain handlers.
 * @returns The selected handler and its original input contract.
 * @throws ToolInputError for unknown kinds, cross-kind fields or malformed prefill.
 * @complexity Time/space O(k + f), input keys plus publish prefill fields.
 */
function selectSave({ input, adapters }: { input: Record<string, unknown>; adapters: CredentialSaveAdapters }, _optional = {}): { handler: ToolHandler; input: Record<string, unknown> } {
  const kind = requireString({ input, key: 'kind' });
  if (!KINDS.includes(kind as CredentialKind)) throw new ToolInputError({ message: 'Unknown credential kind. Use api, media-provider, source-control, publish-host, agent-plugin-token, plugin-provider or provider-settings.' });
  const selectedKind = kind as CredentialKind;
  const { kind: _kind, ...metadata } = input;
  const targetOnly = ['plugin-provider', 'provider-settings'].includes(selectedKind);
  const providerFields = targetOnly ? ['target'] : ['target', 'prefill'];
  const fields = selectedKind === 'api'
    ? ['target', 'label', 'baseUrl', 'category', 'worksFor'] : providerFields;
  // A plugin card fixes its row on the server, so no label, base URL or category may ride along.
  const validateHere = selectedKind === 'publish-host' || targetOnly || (selectedKind === 'api' && !('target' in metadata));
  if (validateHere && Object.keys(metadata).some(key => !fields.includes(key))) {
    // Creation previously ignored unknown hints. Refuse them here; other owners already validate
    // their entire input and retain their exact per-kind errors. Never silently drop an extra key.
    throw new ToolInputError({ message: 'credential_save accepts only non-secret metadata for the selected kind; enter secrets in the human form.' });
  }
  return routeSave({ selectedKind, metadata, adapters });
}

function routeSave({ selectedKind, metadata, adapters }: {
  selectedKind: CredentialKind; metadata: Record<string, unknown>; adapters: CredentialSaveAdapters;
}, _options = {}): { handler: ToolHandler; input: Record<string, unknown> } {
  const { target: _target, ...hints } = metadata;
  // Forward the raw target under the owner's field name. Its validation retains the exact
  // per-kind error and ordering; a generic target validator would change both.
  switch (selectedKind) {
    case 'api': return selectApiSave({ metadata, hints, adapters });
    case 'media-provider':
    case 'source-control': return selectProviderSave({ selectedKind, metadata, hints, adapters });
    case 'agent-plugin-token': {
      if ('pluginId' in hints) throw new ToolInputError({ message: 'Use target for the installed plugin id.' });
      return { handler: adapters.agentPluginToken, input: { ...hints, pluginId: metadata.target } };
    }
    case 'publish-host': return selectPublishSave({ metadata, adapters });
    case 'provider-settings': return selectProviderSettingsSave({ adapters, target: metadata.target });
    case 'plugin-provider': return { handler: adapters.pluginProvider, input: { provider: metadata.target } };
    // selectSave refuses any kind outside KINDS before routing. The default protects the
    // internal boundary if a future caller bypasses that check.
    default: throw new ToolInputError({ message: 'Unknown credential kind.' });
  }
}

function selectProviderSettingsSave({ adapters, target }: { adapters: CredentialSaveAdapters; target: unknown }, _options = {}): { handler: ToolHandler; input: Record<string, unknown> } {
  if (!adapters.providerSettings) throw new ToolInputError({ message: 'Provider settings are not available here.' });
  return { handler: adapters.providerSettings, input: { pluginId: target } };
}

/** Forward a provider target to its existing domain, retaining that domain's validation.
 * @throws ToolInputError on an attempted target override. @complexity O(k) metadata keys. */
function selectProviderSave({ selectedKind, metadata, hints, adapters }: { selectedKind: 'media-provider' | 'source-control'; metadata: Record<string, unknown>; hints: Record<string, unknown>; adapters: CredentialSaveAdapters }, _options = {}): { handler: ToolHandler; input: Record<string, unknown> } {
  if ('provider' in hints) throw new ToolInputError({ message: 'Use target for the credential provider.' });
  return { handler: selectedKind === 'media-provider' ? adapters.mediaProvider : adapters.sourceControl, input: { ...hints, provider: metadata.target } };
}

function selectApiSave({ metadata, hints, adapters }: { metadata: Record<string, unknown>; hints: Record<string, unknown>; adapters: CredentialSaveAdapters; }, _options = {}): { handler: ToolHandler; input: Record<string, unknown> } {
  if (!('target' in metadata)) return { handler: adapters.apiCreate, input: metadata };
  if ('label' in hints) throw new ToolInputError({ message: 'API token rotation accepts target rather than a creation label.' });
  return { handler: adapters.apiRotate, input: { ...hints, label: metadata.target } };
}

function selectPublishSave({ metadata, adapters }: { metadata: Record<string, unknown>; adapters: CredentialSaveAdapters; }, _options = {}): { handler: ToolHandler; input: Record<string, unknown> } {
  // requireInputRecord intentionally accepts arrays; publish prefill requires named fields.
  if (Array.isArray(metadata.prefill)) throw new ToolInputError({ message: 'Credential prefill must be an object.' });
  const prefill = metadata.prefill === undefined ? {} : requireInputRecord({ input: metadata.prefill });
  // Keep the resolved target binding authoritative; provider validation owns all other field names.
  if ('target' in prefill) throw new ToolInputError({ message: 'Credential prefill cannot replace target.' });
  return { handler: adapters.publishHost, input: { ...prefill, target: metadata.target } };
}

/** Register the sole credential save tool through the existing registry, forwarding options intact.
 * @param required - Domain adapters, each retaining its own authorization, validation and save port.
 * @returns One registration; no executable aliases for the retired tools.
 * @example buildCredentialSaveRegistrations({ adapters });
 * @complexity Registration O(1); each invocation performs O(k + f) routing before one domain save.
 */
function buildCredentialSaveRegistrations({ adapters, loadPluginCredentialCards, authorizePluginProvider, adaptersForCards, savedResult }: { savedResult?: (input: { result: unknown }) => Promise<unknown>; adapters: CredentialSaveAdapters; loadPluginCredentialCards?: () => Promise<readonly PluginCredentialCard[]>; authorizePluginProvider?: (ctx: ToolExecutionContext) => Promise<void>; adaptersForCards?: (required: { cards: readonly PluginCredentialCard[] }) => CredentialSaveAdapters }, _optional = {}): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: 'credential-save', catalogModule: 'features/custom-credentials/credential-save-tool.ts',
    catalog: indexCatalogById({ catalog: credentialSaveCatalog }), derivedRisk: credentialSaveDerivedRisk,
    handlers: { [CREDENTIAL_SAVE_TOOL_ID]: async (ctx, optional = {}) => {
      const selected = selectSave({ input: requireInputRecord({ input: ctx.input }), adapters });
      if (selected.handler !== adapters.pluginProvider || !loadPluginCredentialCards) {
        return invokeSaveAdapter({ selected, ctx, options: optional, savedResult });
      }
      // A card can choose a domain, so require the entry permission before reading plugin data.
      if (!authorizePluginProvider) throw new ToolInputError({ message: 'Plugin credential card authorization is unavailable. Use the credential kind directly.' });
      await authorizePluginProvider(ctx);
      const cards = await loadPluginCredentialCardsSafely({ loadCards: loadPluginCredentialCards, workspaceId: '' });
      const resolvedAdapters = adaptersForCards?.({ cards }) ?? adapters;
      const card = cards.find(entry => entry.providerId === selected.input.provider);
      const resolved = { ...selected, handler: resolvedAdapters.pluginProvider };
      const routed = routePluginCard({ card, selected: resolved, adapters: resolvedAdapters });
      const result = await routed.handler({ ...ctx, input: routed.input }, optional);
      return savedResult ? savedResult({ result }) : result;
    } },
  });
}

/** A declared destination reuses the existing permission, validation, probe and sealed-store owner. */
function routePluginCard({ card, selected, adapters }: { card?: PluginCredentialCard | undefined; selected: { handler: ToolHandler; input: Record<string, unknown> }; adapters: CredentialSaveAdapters }, _options = {}): { handler: ToolHandler; input: Record<string, unknown> } {
  if (!card) return selected;
  const target = card.saveTarget ?? card.providerId;
  switch (card.saveKind) {
    case 'publish-host': return { handler: adapters.publishHost, input: { target } };
    case 'source-control': return { handler: adapters.sourceControl, input: { provider: target } };
    case 'agent-plugin-token': return { handler: adapters.agentPluginToken, input: { pluginId: target } };
    case 'provider-settings': return selectProviderSettingsSave({ adapters, target });
    case 'oauth': throw new ToolInputError({ message: 'This plugin connects by browser sign-in. Use agent_plugin_connect with its pluginId.' });
    default: return selected;
  }
}


/** Domain saves own the human exchange; one shared result hook attaches successful project saves. */
async function invokeSaveAdapter({ selected, ctx, options, savedResult }: {
  selected: { handler: ToolHandler; input: Record<string, unknown> }; ctx: ToolExecutionContext; options: ToolExecutionOptions;
  savedResult?: ((input: { result: unknown }) => Promise<unknown>) | undefined;
}, _optional = {}): Promise<unknown> {
  const result = await selected.handler({ ...ctx, input: selected.input }, options);
  return savedResult ? savedResult({ result }) : result;
}

return { credentialSaveCatalog, credentialSaveDerivedRisk, buildCredentialSaveRegistrations };
}
