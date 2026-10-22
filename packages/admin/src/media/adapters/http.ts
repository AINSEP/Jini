import type { MediaApiPort } from '../ports.js';
import type { MediaAsset, MediaRequestOptions } from '../models.js';
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
