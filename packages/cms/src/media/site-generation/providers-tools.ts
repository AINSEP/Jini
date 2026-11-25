import { toolMetadata } from '@jini-ai/core/tool-metadata/media-generation';
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import { resolveOperatorLocale } from '@jini-ai/core/operator-locale';
import type { OperatorLocaleDeps } from '@jini-ai/core/contracts/headless/plugin-host';
import { type Clock } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, optionalString, requireInputRecord, requireNoInput, requireString, type DerivedRiskByToolId, type ToolRegistration } from "@jini-ai/core";
import { requireToolPermission } from "@jini-ai/core";
import { ToolInputError, type ToolExecutionOptions, type ToolExecutionContext } from '@jini-ai/core';
import type { MediaModel, MediaProvider } from "@jini-ai/core/contracts/site/media-providers-catalog";
import type { AuthorizeFn } from '@jini-ai/core/contracts/events';
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { ToolContributor } from '@jini-ai/core';
import type { MediaProviderCredentialRepoPort } from '../site/provider-credential-contracts.js';
import type { KeyringPort } from '@jini-ai/core/contracts/vault';
import type { SecretSealerPort } from '@jini-ai/core/contracts/vault';
import type { SurfaceCardSecretRun, SurfaceCardSecretSpec } from '@jini-ai/core/contracts/cards';
import type { AgentToolDefinition } from "@jini-ai/core";
import { saveMediaProviderKey } from './provider-credential-save.js';

/** Native credential setup uses the existing MCP-UI exchange; secrets never enter model input/result. */
export interface ProviderView { id: string; label: string; kinds: Array<'image' | 'video'>; integrated: boolean; configured: boolean }
export interface ProposalResult { saved: boolean; provider: string; configured: boolean; tokenHint?: CredentialTokenHint | null; message?: string; connection?: "not_tested" }
export interface MediaProviderToolDeps extends OperatorLocaleDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  mediaProviderCredentialRepo: MediaProviderCredentialRepoPort;
  siteAssistantSecretSealer: SecretSealerPort;
  siteAssistantSecretKeyring: KeyringPort;
  clock: Clock;
  /** The composition-built media provider registry (built-in + plugin vendors); listing and the
   *  credential form read it, so a plugin vendor can be listed and given a key like a built-in one. */
  mediaProviderRegistry: MediaProviderListing;
}

/** Structurally the part of `MediaProviderRegistry` this file reads (keeps the catalog-only import). */
export interface MediaProviderListing {
  listProviders(): readonly MediaProvider[];
  modelsForSurface(required: { surface: 'image' | 'video' }): readonly MediaModel[];
  findProvider(required: { id: string }): MediaProvider | null;
}

interface CatalogueProvider { id: string; label: string; integrated: boolean; kinds: Array<'image' | 'video'> }

/** Image/video providers in registry order, with the surfaces they offer.
 * @complexity Time/space O(p + m), registered providers plus image/video models. */
function catalogueProviders(catalog: MediaProviderListing): CatalogueProvider[] {
  const imageIds = new Set(catalog.modelsForSurface({ surface: 'image' }).map(model => model.provider));
  const videoIds = new Set(catalog.modelsForSurface({ surface: 'video' }).map(model => model.provider));
  return catalog.listProviders().flatMap(provider => {
    const kinds: Array<'image' | 'video'> = [];
    if (imageIds.has(provider.id)) kinds.push('image');
    if (videoIds.has(provider.id)) kinds.push('video');
    return kinds.length === 0 ? [] : [{ id: provider.id, label: provider.label, integrated: provider.integrated, kinds }];
  });
}

export const mediaProvidersAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: 'media_list_providers',
    description: 'Lists the catalogued image/video generation providers and which have a saved workspace key. Call to inspect media provider setup before generation or opening a credential form. Returns {providers:[{id,label,kinds,integrated,configured}]}; configured means saved key presence, not live verification or adapter support. Never returns keys, prefixes, suffixes or lengths. Uses the same media.read permission and saved credential source as the admin Media providers tab. Does not inspect process environment credentials. Permission denial refuses the call.',
    sideEffects: 'none', authorization: { permission: 'media.read' },
    inputSchema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },

];
export const mediaProvidersDerivedRisk: DerivedRiskByToolId = new Map([
  // -> getMediaProviderCredentials: marker-only repo read, no decrypt or writes.
  ['media_list_providers', 'none'],
  // -> saveMediaProviderKey -> saveMediaProviderCredentials: seals and writes after human submit.

]);
const CATALOG = indexCatalogById({ catalog: mediaProvidersAgentToolCatalog });

/** Marker-only listing with an explicit safe projection; same saved source as GET /media/providers.
 * @complexity Time/space O(p + s), catalogued providers plus saved rows. No decrypt.
 */
async function listProviders(deps: MediaProviderToolDeps, host: Pick<Parameters<typeof saveMediaCredential>[0]["host"], "getMediaProviderCredentials">): Promise<{ providers: ProviderView[] }> {
  const stored = await host.getMediaProviderCredentials({ repo: deps.mediaProviderCredentialRepo }, { workspaceId: deps.workspaceId });
  return { providers: catalogueProviders(deps.mediaProviderRegistry).map(provider => ({ id: provider.id, label: provider.label, kinds: [...provider.kinds], integrated: provider.integrated, configured: stored[provider.id]?.apiKeyConfigured === true })) };
}

/** Shared safe copy for the model result and human outcome; no submitted key is accepted.
 * @complexity Time/space O(m), the formatted message length; no I/O.
 */
function savedProviderMessage({ provider, tokenHint, locale, host }: {
  provider: { integrated: boolean }; tokenHint: CredentialTokenHint | null | undefined; locale: string;
  host: Pick<Parameters<typeof saveMediaCredential>[0]["host"], "credentialText" | "formatCredentialHint">;
}, _optional = {}): string {
  const hint = host.formatCredentialHint({ hint: tokenHint, locale });
  const unavailable = provider.integrated === false ? ` ${host.credentialText({ id: 'generationUnavailable', locale })}` : '';
  const hintPrefix = hint ? `${hint}. ` : '';
  return `${hintPrefix}${host.credentialText({ id: 'saved', locale })}${unavailable}`;
}

/** Strict non-secret model input; bound provider identity is never taken from the form submission.
 * @throws ToolInputError for unknown fields/providers or a missing interactive channel.
 * @complexity Time O(p + s) before a single store patch; space O(p + s).
 */
export async function saveMediaCredential(required: { ctx: ToolExecutionContext; deps: MediaProviderToolDeps; surfaces: AssistantSurfaceDeps;
  host: {
    getMediaProviderCredentials: (required: { repo: MediaProviderCredentialRepoPort }, optional: { workspaceId: string }) => Promise<Record<string, { apiKeyConfigured: boolean }>>;
    saveProviders: (required: { deps: { repo: Pick<MediaProviderCredentialRepoPort, 'replaceWorkspace' | 'vault'>; sealer: SecretSealerPort; keyring: KeyringPort; clock: Clock; providerCatalog: MediaProviderListing }; workspaceId: string }, optional: { providers: Record<string, { apiKey: string }> }) => Promise<Record<string, { apiKeyConfigured: boolean; apiKeyHint?: CredentialTokenHint | null }>>;
    assertCredentialFreeField: (required: { value: string; field: string }) => void;
    credentialText: (required: { id: 'saved' | 'blank' | 'generationUnavailable'; locale: string }) => string;
    formatCredentialHint: (required: { hint: CredentialTokenHint | null | undefined; locale: string }) => string;
    secureCard: (required: { ctx: ToolExecutionContext; surfaces: AssistantSurfaceDeps; prep: CredentialPrep;
      save: (required: { value: string; signal: AbortSignal }) => Promise<CredentialSaved>;
      result: SurfaceCardSecretSpec<CredentialPrep, CredentialSaved, ProposalResult>['result'];
      outcome: SurfaceCardSecretSpec<CredentialPrep, CredentialSaved, ProposalResult>['outcome'];
    }, optional: ToolExecutionOptions) => Promise<ProposalResult>;
  };
}, optional: ToolExecutionOptions = {}): Promise<ProposalResult> {
  const { ctx, deps, surfaces, host } = required;
  const { providerId, provider, reason } = parseCredentialRequest({ input: ctx.input, deps, host });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: 'admin.integrations.manage' }, { entityType: 'media' });
  const { providers } = await listProviders(deps, host);
  const listedProvider = providers.find(candidate => candidate.id === providerId);
  if (listedProvider === undefined) throw new Error('Media provider list has no selected provider');
  const configured = listedProvider.configured;
  const locale = await resolveOperatorLocale({ deps, workspaceId: deps.workspaceId, principalId: ctx.principal.id });
  // Strict non-secret validation and authorization retain their precedence over channel errors.
  return host.secureCard({ ctx, surfaces, prep: { provider, configured, reason, locale },
    save: ({ value, signal }) => saveMediaProviderKey({
      deps: { repo: abortableCredentialRepo({ store: deps.mediaProviderCredentialRepo, signal }), sealer: deps.siteAssistantSecretSealer, keyring: deps.siteAssistantSecretKeyring, clock: deps.clock, providerCatalog: deps.mediaProviderRegistry },
      workspaceId: deps.workspaceId, provider: provider.id, apiKey: value, saveProviders: host.saveProviders,
    }),
    result: ({ prep, run }) => credentialProposalResult({ prep, run, host }),
    outcome: ({ prep, run }) => credentialOutcomeCard({ prep, run, host }),
  }, optional);
}

const CREDENTIAL_SAVE_FAILURE = 'Nothing was saved. Check the key and the server credential store, then try again.';

export type CredentialPrep = { provider: CatalogueProvider; configured: boolean; reason: string | undefined; locale: string };
export type CredentialSaved = Awaited<ReturnType<typeof saveMediaProviderKey>>;
type CredentialRun = SurfaceCardSecretRun<CredentialSaved>;

/** Strict, non-secret request parsing: only `provider` and `reason`, a known provider, a credential-free bounded reason. */
function parseCredentialRequest(required: { input: unknown; deps: MediaProviderToolDeps; host: Pick<Parameters<typeof saveMediaCredential>[0]["host"], "assertCredentialFreeField"> }): { providerId: string; provider: CatalogueProvider; reason: string | undefined } {
  const raw = requireInputRecord({ input: required.input });
  if (Object.keys(raw).some(key => key !== 'provider' && key !== 'reason')) throw new ToolInputError({ message: 'media_propose_provider_credential accepts only provider and reason; enter the key in the human form.' });
  const providerId = requireString({ input: raw, key: 'provider' });
  const provider = catalogueProviders(required.deps.mediaProviderRegistry).find(candidate => candidate.id === providerId);
  if (!provider) throw new ToolInputError({ message: 'Unknown media provider. Call media_list_providers for supported provider ids.' });
  const reason = optionalString({ input: raw, key: 'reason' });
  if (reason !== undefined) required.host.assertCredentialFreeField({ value: reason, field: "reason" });
  if (reason !== undefined && reason.length > 1000) throw new ToolInputError({ message: 'Credential setup reason must be at most 1000 characters.' });
  return { providerId, provider, reason };
}

/** The credential repo with its workspace planner guarded by the form's abort signal. */
function abortableCredentialRepo(required: { store: MediaProviderToolDeps['mediaProviderCredentialRepo']; signal: AbortSignal }): MediaProviderCredentialRepoPort {
  const { store, signal } = required;
  return {
    ...(store.vault ? { vault: store.vault } : {}),
    listByWorkspaceId: input => store.listByWorkspaceId(input),
    upsert: record => store.upsert(record),
    deleteByProviderIds: input => store.deleteByProviderIds(input),
    // The planner runs inside the transaction, after sealing and any lock wait. Abort rolls it back.
    replaceWorkspace: input => store.replaceWorkspace({ ...input, plan: ({ existing: current }) => {
      signal.throwIfAborted();
      return input.plan({ existing: current });
    } }),
  };
}

function credentialProposalResult(required: { prep: CredentialPrep; run: CredentialRun; host: Pick<Parameters<typeof saveMediaCredential>[0]["host"], "credentialText" | "formatCredentialHint"> }): ProposalResult {
  const { prep, run, host } = required;
  const declined: ProposalResult = { saved: false, provider: prep.provider.id, configured: prep.configured };
  if (run.status === 'blank') return { ...declined, message: host.credentialText({ id: 'blank', locale: prep.locale }) };
  if (run.status === 'failed') return { ...declined, ...(run.safeMessage !== CREDENTIAL_SAVE_FAILURE ? { message: run.safeMessage } : {}) };
  if (run.status !== 'saved') return declined;
  const message = savedProviderMessage({ provider: prep.provider, tokenHint: run.saved.tokenHint, locale: prep.locale, host });
  return { saved: true, provider: prep.provider.id, configured: run.saved.configured, tokenHint: run.saved.tokenHint, connection: 'not_tested', message };
}

// Fixed outcome text cannot echo a submitted key or a raw persistence error.
function credentialOutcomeCard(required: { prep: CredentialPrep; run: CredentialRun; host: Pick<Parameters<typeof saveMediaCredential>[0]["host"], "credentialText" | "formatCredentialHint"> }) {
  const { prep, run, host } = required;
  if (run.status === 'cancelled' || run.status === 'expired' || run.status === 'abandoned') return undefined;
  const saved = run.status === 'saved';
  let message: string;
  if (run.status === 'saved') message = savedProviderMessage({ provider: prep.provider, tokenHint: run.saved.tokenHint, locale: prep.locale, host });
  else if (run.status === 'blank') message = host.credentialText({ id: 'blank', locale: prep.locale });
  else if (run.status === 'failed') message = run.safeMessage;
  else message = CREDENTIAL_SAVE_FAILURE;
  return { title: saved ? 'Provider key saved' : 'Provider key not saved', state: saved ? 'success' as const : 'failure' as const, message };
}

/** Wires read-only listing and human credential saves under a distinct contributor domain.
 * @example buildMediaProviderRegistrations(deps, { surfaceExchanges });
 * @complexity Registration time/space O(1); handlers document their own I/O costs.
 */
export function buildMediaProviderRegistrations({ deps, surfaces, host }: { deps: MediaProviderToolDeps; surfaces: AssistantSurfaceDeps; host: Parameters<typeof saveMediaCredential>[0]["host"] }, _optional = {}): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: 'media-providers', catalogModule: 'features/media-generation/providers-tools.ts', catalog: CATALOG,
    derivedRisk: mediaProvidersDerivedRisk, handlers: {
      media_list_providers: async ctx => {
        requireNoInput({ input: ctx.input });
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: 'media.read' }, { entityType: 'media' });
        return listProviders(deps, host);
      },
    } });
}

/** Composition-root entrypoint; type-only assistant dependency.
 * @example registerToolContributor(contributeMediaProviderTools());
 * @complexity Time/space O(1).
 */
export function contributeMediaProviderTools({ host }: { host: Parameters<typeof saveMediaCredential>[0]["host"] }, _optional = {}): ToolContributor<MediaProviderToolDeps, AssistantSurfaceDeps> {
  return { domain: 'media-providers', build: (deps, surfaces) => buildMediaProviderRegistrations({ deps, surfaces, host }), risk: mediaProvidersDerivedRisk };
}
