/**
 * Media vendors as provider contributions: one `{ provider, models, adapters }` unit per vendor, held
 * in the shared keyed registry (`@jini-ai/core/provider-registry`, contract `media`).
 *
 * Why: the catalogue used to be closed consts (`providers.ts`) enforced by the engine, with adapters
 * registered somewhere else, so a plugin could not add a vendor. The consts are now only the data the
 * built-in contribution is made from; the engine validates against whatever this registry holds.
 *
 * Ids: the shared grammar forbids hyphens and one built-in id has one (`custom-image`), so the
 * registry KEY is the canonical id with `-` -> `_`. The public id on `provider.id` — the one saved
 * credentials, settings and env-var maps use — never changes.
 */
import {
  createProviderRegistry, type ProviderDefinition, type ProviderRegistry, type RegisteredProvider,
} from '@jini-ai/core/provider-registry';
import { AUDIO_MODELS_BY_KIND, IMAGE_MODELS, MEDIA_PROVIDERS, VIDEO_MODELS, canonicalMediaProviderId } from '../providers.js';
import type { AudioKind, MediaModel, MediaProvider, MediaSurface } from '../types.js';
import { registerBuiltinVendorAdapters } from './builtin-vendors.js';
import type { MediaModelCatalog, VendorAdapter, VendorAdapterLookup } from './types.js';

/** A catalogued model plus the surface (and audio kind) it is offered on. */
export interface MediaProviderModel extends MediaModel {
  readonly surface: MediaSurface;
  readonly audioKind?: AudioKind;
  /** Sort key within a surface; built-ins carry their catalogue index. Unset sorts after, in registration order. */
  readonly order?: number;
}

/** Everything one vendor brings, registered as one unit. */
export interface MediaProviderContribution {
  readonly provider: MediaProvider;
  readonly models: readonly MediaProviderModel[];
  /** Route key (`image`, `video`, `audio:speech`, …) -> the adapter serving it. */
  readonly adapters: Readonly<Record<string, VendorAdapter<never>>>;
}

export interface MediaProviderRegistry extends VendorAdapterLookup, MediaModelCatalog {
  /** The shared registry; plugin loaders contribute here (`contributeProviders`). */
  readonly providers: ProviderRegistry<MediaProviderContribution>;
  /** Every registered vendor, registration order. */
  listProviders(_required?: Record<string, never>): readonly MediaProvider[];
}

export const MEDIA_PROVIDER_CONTRACT = 'media';

/** The registry key for a public media provider id (aliases resolved, `-` -> `_`). @complexity O(n) in id length. */
export function mediaProviderRegistryId({ id }: { id: string }, _optional: Record<string, never> = {}): string {
  return canonicalMediaProviderId({ id }).replaceAll('-', '_');
}

/** Wraps one contribution as a shared-registry definition. @complexity O(1). */
export function mediaProviderDefinition(
  { contribution }: { contribution: MediaProviderContribution },
  _optional: Record<string, never> = {},
): ProviderDefinition<MediaProviderContribution> {
  return { id: mediaProviderRegistryId({ id: contribution.provider.id }), provider: contribution, label: contribution.provider.label };
}

function isAdapter(value: unknown): boolean {
  const candidate = value as Partial<VendorAdapter<never>> | null;
  return typeof candidate?.buildRequest === 'function' && typeof candidate.parseResponse === 'function';
}

function providerFault(provider: MediaProvider | undefined): string | undefined {
  const valid = typeof provider?.id === 'string' && typeof provider.label === 'string' && provider.label.trim() !== '';
  return valid ? undefined : 'provider needs a string id and a non-empty label';
}

function modelsFault(models: unknown, providerId: string): string | undefined {
  if (!Array.isArray(models)) return 'models must be an array';
  // findIndex, not find: a `find` hit on an `undefined` element is indistinguishable from no hit, which
  // let `models: [undefined]` pass here and then throw in the collision check.
  const at = (models as (Partial<MediaProviderModel> | undefined)[]).findIndex(model => model?.provider !== providerId || typeof model.id !== 'string' || !model.id);
  return at === -1 ? undefined : `model '${String(models[at]?.id)}' must have an id and belong to provider '${providerId}'`;
}

function adaptersFault(adapters: unknown): string | undefined {
  if (typeof adapters !== 'object' || adapters === null) return 'adapters must be an object';
  const byRoute = adapters as Record<string, unknown>;
  const broken = Object.keys(byRoute).find(routeKey => !isAdapter(byRoute[routeKey]));
  return broken === undefined ? undefined : `adapter for route '${broken}' needs buildRequest and parseResponse functions`;
}

/** Shape faults inside one contribution (plugin input is untrusted), independent of what else is registered. */
function ownFault(contribution: MediaProviderContribution): string | undefined {
  const { provider, models, adapters } = (contribution ?? {}) as Partial<MediaProviderContribution>;
  return providerFault(provider) ?? modelsFault(models, provider!.id) ?? adaptersFault(adapters);
}

/**
 * A model id another provider already offers on ANY route. Why not per route: `findModel` (and so
 * dispatch and credential selection) resolves a model by id alone, so a second vendor's `gpt-image-2`
 * on video would be routed to OpenAI — or, with a lower `order`, take OpenAI's image traffic.
 */
function collisionFault(contribution: MediaProviderContribution, registered: readonly RegisteredProvider<MediaProviderContribution>[]): string | undefined {
  const ownKey = mediaProviderRegistryId({ id: contribution.provider.id });
  const taken = new Set(registered.filter(entry => entry.id !== ownKey).flatMap(entry => entry.provider.models.map(model => model.id)));
  const clash = contribution.models.find(model => taken.has(model.id));
  return clash === undefined ? undefined : `model '${clash.id}' is already offered by another provider`;
}

function byOrder(left: { model: MediaProviderModel; index: number }, right: { model: MediaProviderModel; index: number }): number {
  const a = left.model.order ?? Number.MAX_SAFE_INTEGER;
  const b = right.model.order ?? Number.MAX_SAFE_INTEGER;
  return a === b ? left.index - right.index : a - b;
}

/** Strips the registry-only fields so callers see the same `MediaModel` shape as the static catalogue. */
function asMediaModel(model: MediaProviderModel): MediaModel {
  const { surface: _surface, audioKind: _audioKind, order: _order, ...rest } = model;
  return rest;
}

/**
 * Builds the media provider registry. Built-ins register with the throwing policy; plugins go through
 * `providers.contribute` (or agent-plugins' `contributeProviders`) and are refused, never thrown.
 * @param optional.contributions - Core contributions; defaults to {@link builtinMediaProviderContributions}.
 * @throws {ProviderRegistryError} When a core contribution is malformed or duplicated.
 * @complexity Lookups O(m) over registered models (tens), registration O(m).
 */
export function createMediaProviderRegistry(
  _required: Record<string, never> = {},
  { contributions = builtinMediaProviderContributions() }: { contributions?: readonly MediaProviderContribution[] } = {},
): MediaProviderRegistry {
  let current: ProviderRegistry<MediaProviderContribution> | undefined;
  const providers = createProviderRegistry<MediaProviderContribution>({ contract: MEDIA_PROVIDER_CONTRACT }, {
    // `current` is assigned before any registration below; validate only runs from register/contribute.
    validate: ({ provider }) => ownFault(provider) ?? collisionFault(provider, current!.list()),
  });
  current = providers;
  for (const contribution of contributions) providers.register({ definition: mediaProviderDefinition({ contribution }) });

  const entryFor = (id: string) => providers.get({ id: mediaProviderRegistryId({ id }) })?.provider;
  const allModels = () => providers.list().flatMap(entry => entry.provider.models).map((model, index) => ({ model, index })).sort(byOrder).map(({ model }) => model);

  return {
    providers,
    get: ({ providerId, routeKey }) => entryFor(providerId)?.adapters[routeKey],
    findModel: ({ id }) => {
      const found = allModels().find(model => model.id === id);
      return found === undefined ? null : asMediaModel(found);
    },
    findProvider: ({ id }) => entryFor(id)?.provider ?? null,
    modelsForSurface: ({ surface }, { audioKind } = {}) => {
      const kind = surface === 'audio' ? audioKind ?? 'music' : undefined;
      return allModels().filter(model => model.surface === surface && (kind === undefined || (model.audioKind ?? 'music') === kind)).map(asMediaModel);
    },
    listProviders: () => providers.list().map(entry => entry.provider.provider),
  };
}

/** The static catalogue with each model's surface and catalogue index attached. */
function builtinModels(): MediaProviderModel[] {
  const audio = (Object.keys(AUDIO_MODELS_BY_KIND) as AudioKind[]).flatMap(audioKind => AUDIO_MODELS_BY_KIND[audioKind].map(model => ({ ...model, surface: 'audio' as const, audioKind })));
  const all: MediaProviderModel[] = [
    ...IMAGE_MODELS.map(model => ({ ...model, surface: 'image' as const })),
    ...VIDEO_MODELS.map(model => ({ ...model, surface: 'video' as const })),
    ...audio,
  ];
  return all.map((model, order) => ({ ...model, order }));
}

/**
 * Today's built-in vendors as the default contribution set: one unit per `MEDIA_PROVIDERS` entry, its
 * catalogued models, and the adapters its `registerVendorAdapters` registers.
 * @returns Fresh contributions; adapters are the shared module-level adapter objects.
 * @complexity O(p + m + a) providers, models and adapters.
 */
export function builtinMediaProviderContributions(_required: Record<string, never> = {}): MediaProviderContribution[] {
  const adapters = new Map<string, Record<string, VendorAdapter<never>>>();
  registerBuiltinVendorAdapters({
    registry: {
      register: ({ providerId, routeKey, adapter }) => {
        const byRoute = adapters.get(providerId) ?? {};
        byRoute[routeKey] = adapter as unknown as VendorAdapter<never>;
        adapters.set(providerId, byRoute);
      },
    },
  });
  const models = builtinModels();
  return MEDIA_PROVIDERS.map(provider => ({
    provider,
    models: models.filter(model => model.provider === provider.id),
    adapters: adapters.get(provider.id) ?? {},
  }));
}
