import type { MediaApiPort, MediaProvidersPort } from '../ports.js';
import type { MediaAsset, MediaProvider, MediaProviderConfiguration, MediaProviderConfigurationMap, MediaProviderOption, MediaRequestOptions } from '../models.js';
import { queryMedia } from '../rules.js';
/** Authentication, workspace addressing, transport retries and error decoding belong to the host.
 * Retryable errors remain intact so the library can recover automatically after an outage.
 * The adapter never reaches for global fetch, tokens or a hardcoded workspace. */
export interface MediaTransportPort {
  request<T>(
    required: { path: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
    optional?: MediaRequestOptions,
  ): Promise<T>;
  url(required: { path: string }, optional?: Record<string, never>): string;
}
export function createHttpMediaApi(
  { transport, basePath }: { transport: MediaTransportPort; basePath: string },
  {
    replacePath,
    restorePath,
  }: { replacePath?: (required: { id: string }, optional?: Record<string, never>) => string;
    restorePath?: (required: { id: string }, optional?: Record<string, never>) => string } = {},
): MediaApiPort {
  const base = basePath.replace(/\/$/, '');
  const path = (id: string) => `${base}/${encodeURIComponent(id)}`;
  async function asset(
    method: 'POST' | 'PATCH',
    target: string,
    body: unknown,
    options: MediaRequestOptions,
  ) {
    options.signal?.throwIfAborted();
    const response = await transport.request<{ media: MediaAsset }>(
      { path: target, method, ...(body === undefined ? {} : { body }) },
      options,
    );
    return response.media;
  }
  return {
    replaceSupported: !!replacePath,
    restoreSupported: !!restorePath,
    async list(query, options = {}) {
      options.signal?.throwIfAborted();
      const response = await transport.request<{ media: readonly MediaAsset[] }>(
        { path: base, method: 'GET' },
        options,
      );
      return queryMedia({ media: response.media, query });
    },
    upload(input, { signal, ...metadata } = {}) {
      return asset('POST', base, { ...input, ...metadata }, signal ? { signal } : {});
    },
    update({ id, patch }, options = {}) {
      return asset('PATCH', path(id), patch, options);
    },
    ...(replacePath ? { replace({ id, upload }, options = {}) {
      return asset('POST', replacePath({ id }), upload, options);
    } } satisfies Pick<MediaApiPort, 'replace'> : {}),
    trash({ id }, options = {}) {
      return asset('POST', `${path(id)}/trash`, undefined, options);
    },
    ...(restorePath ? { restore({ id }, options = {}) {
      return asset('POST', restorePath({ id }), undefined, options);
    } } satisfies Pick<MediaApiPort, 'restore'> : {}),
    delete({ id }, options = {}) {
      options.signal?.throwIfAborted();
      return transport.request<{ purged: boolean }>({ path: path(id), method: 'DELETE' }, options);
    },
    originalUrl({ id, version }, _optional: Record<string, never> = {}) {
      // Replacement preserves the id; the refreshed version must identify its new bytes.
      const revision = version === undefined ? '' : `?v=${encodeURIComponent(version)}`;
      return transport.url({ path: `${path(id)}/original${revision}` });
    },
  };
}

/** The host's whole-map provider settings route: GET returns the stored map, PUT replaces it and
 * returns the stored map with public markers only (never key material). */
export interface MediaProvidersTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'PUT'; body?: unknown }, optional?: MediaRequestOptions): Promise<T>;
}
/** `exactOptionalPropertyTypes` forbids passing `signal: undefined`; omit the key instead. */
function signalOptions({ signal }: { signal?: AbortSignal | undefined }): MediaRequestOptions {
  return signal ? { signal } : {};
}
type ProviderChange = (input: { current: MediaProviderConfigurationMap }) => MediaProviderConfigurationMap;

function catalogProvider({ catalog, id }: { catalog: readonly MediaProviderOption[]; id: string }): MediaProviderOption {
  const provider = catalog.find(entry => entry.id === id);
  if (!provider) throw new Error(`Unknown media provider "${id}": it is not in this host's provider catalog`);
  return provider;
}
/** Never return key material to the view: only markers, endpoint and model leave this port. */
function providerView({ provider, values }: { provider: MediaProviderOption; values: MediaProviderConfigurationMap }): MediaProvider {
  const saved = values[provider.id] ?? {};
  return { id: provider.id, label: provider.label,
    configured: saved.apiKeyConfigured === true,
    ...(saved.apiKeyTail ? { apiKeyTail: saved.apiKeyTail.slice(-4) } : {}),
    ...(saved.baseUrl === undefined ? {} : { baseUrl: saved.baseUrl }),
    ...(saved.model === undefined ? {} : { model: saved.model }) };
}
function withoutProvider({ current, id }: { current: MediaProviderConfigurationMap; id: string }): MediaProviderConfigurationMap {
  const next = { ...current };
  // The server keeps blank keys; omission is its only supported clear operation.
  delete next[id];
  return next;
}
function withCredential({ current, id, credential }: { current: MediaProviderConfigurationMap; id: string; credential: string }): MediaProviderConfigurationMap {
  return { ...current, [id]: { ...current[id], apiKey: credential } };
}
function withSettings({ current, id, settings }: { current: MediaProviderConfigurationMap; id: string; settings: { baseUrl: string; model: string } }): MediaProviderConfigurationMap {
  const entry: MediaProviderConfiguration = { ...current[id], ...settings };
  // Blank settings clear their fields. Omit a provider only after its last
  // setting is gone and no saved credential needs the server's keep-key path.
  if (!settings.baseUrl.trim()) delete entry.baseUrl;
  if (!settings.model.trim()) delete entry.model;
  const next = { ...current, [id]: entry };
  if (!entry.baseUrl && !entry.model && !entry.apiKeyConfigured && !entry.apiKey) delete next[id];
  return next;
}
function trimmedEntry({ entry }: { entry: MediaProviderConfiguration }): MediaProviderConfiguration {
  const baseUrl = entry.baseUrl?.trim();
  const model = entry.model?.trim();
  const apiKey = entry.apiKey?.trim();
  return {
    ...(baseUrl ? { baseUrl } : {}), ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(entry.apiKeyConfigured ? { apiKeyConfigured: true } : {}),
  };
}
function withCatalogEntries({ catalog, current, providers }: { catalog: readonly MediaProviderOption[]; current: MediaProviderConfigurationMap; providers: MediaProviderConfigurationMap }): MediaProviderConfigurationMap {
  const next = { ...current };
  for (const { id } of catalog) {
    const entry = providers[id];
    const kept = entry ? trimmedEntry({ entry }) : {};
    // Blank keys use the server's keep-key path. Explicit omission (Clear) is
    // the only supported removal; markers are never recoverable key material.
    if (Object.keys(kept).length > 0 || entry?.apiKeyTail) next[id] = kept;
    else delete next[id];
  }
  return next;
}

/**
 * A `MediaProvidersPort` over a whole-map settings route. Every write is read-modify-write of the
 * whole map, serialized behind the previous write, and refused for a provider outside `catalog`
 * before anything is written. Providers outside the catalog are kept untouched.
 * @complexity O(catalog) per call.
 */
export function createHttpMediaProvidersPort(
  { transport, path, catalog }: { transport: MediaProvidersTransportPort; path: string; catalog: readonly MediaProviderOption[] },
  { pinnedProviderIds }: { pinnedProviderIds?: readonly string[] | undefined } = {},
): MediaProvidersPort {
  let writes: Promise<unknown> = Promise.resolve();
  const read = ({ signal }: { signal?: AbortSignal | undefined }) => transport.request<MediaProviderConfigurationMap>({ path, method: 'GET' }, signalOptions({ signal }));
  const views = ({ values }: { values: MediaProviderConfigurationMap }) => catalog.map(provider => providerView({ provider, values }));
  function replaceAll<T>({ change, present }: { change: ProviderChange; present: (input: { values: MediaProviderConfigurationMap }) => T }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<T> {
    const operation = writes.then(async () => {
      signal?.throwIfAborted();
      const next = change({ current: await read({ signal }) });
      return present({ values: await transport.request<MediaProviderConfigurationMap>({ path, method: 'PUT', body: next }, signalOptions({ signal })) });
    });
    // The caller receives operation, while this recovery keeps later writes runnable.
    writes = operation.catch(() => undefined);
    return operation;
  }
  const writeProvider = ({ id, change }: { id: string; change: ProviderChange }, options: MediaRequestOptions = {}) => replaceAll({
    change: ({ current }) => { catalogProvider({ catalog, id }); return change({ current }); },
    present: ({ values }) => providerView({ provider: catalogProvider({ catalog, id }), values }),
  }, options);
  return {
    catalog,
    ...(pinnedProviderIds === undefined ? {} : { pinnedProviderIds }),
    saveChanges({ providers }, options = {}) {
      return replaceAll({
        change: ({ current }) => {
          for (const id of Object.keys(providers)) catalogProvider({ catalog, id });
          // One save replaces the catalog's working set. Reread first to retain providers outside
          // this host's catalog; no intermediate per-provider PUT can erase them.
          return withCatalogEntries({ catalog, current, providers });
        },
        present: views,
      }, options);
    },
    async list(_required, { signal } = {}) {
      try {
        return views({ values: await read({ signal }) });
      } catch (error) {
        if (signal?.aborted) throw error;
        // An unreachable read is not evidence that the server manages no providers.
        return null;
      }
    },
    saveSettings({ id, baseUrl, model }, options = {}) { return writeProvider({ id, change: ({ current }) => withSettings({ current, id, settings: { baseUrl, model } }) }, options); },
    saveCredential({ id, credential }, options = {}) { return writeProvider({ id, change: ({ current }) => withCredential({ current, id, credential }) }, options); },
    removeCredential({ id }, options = {}) { return writeProvider({ id, change: ({ current }) => withoutProvider({ current, id }) }, options); },
  };
}
