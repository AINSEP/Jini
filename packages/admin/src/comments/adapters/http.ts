import type { AdminCommentsPort, AdminCommentsQueuePage, CommentsSettings } from '../../core/ports/comments.js';
import type { CommentsSessionPort } from '../ports.js';
import { AdminApiError } from '../../core/transport/errors.js';

/** The host owns auth, URL prefixes, retries, serialization, and decoded status/body errors. */
export interface CommentsTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'POST' | 'PUT'; body?: unknown }, optional?: { signal?: AbortSignal }): Promise<T>;
  url(required: { path: string }, optional?: Record<string, never>): string;
}

/** Preserve the host's decoded fields while adopting the shared core error owner. */
async function request<T>(
  { transport, ...required }: { transport: CommentsTransportPort; path: string; method: 'GET' | 'POST' | 'PUT'; body?: unknown },
  optional: { signal?: AbortSignal } = {},
): Promise<T> {
  try {
    return await transport.request<T>(required, optional);
  } catch (error) {
    if (error instanceof AdminApiError || !(error instanceof Error) || !('status' in error) || typeof error.status !== 'number') throw error;
    const decoded = error as Error & { status: number; code?: string; body?: Record<string, unknown> };
    throw new AdminApiError({ message: decoded.message, status: decoded.status }, { code: decoded.code, body: decoded.body });
  }
}

/** Adapt the existing workspace comments routes to the core port, unwrapping settings only.
 * @param required Host transport and comments base path, e.g. `/workspaces/<id>/comments`.
 * @returns The core comments API. Decoded status/body fields adopt the shared core error type.
 */
export function createHttpCommentsApi(
  { transport, basePath }: { transport: CommentsTransportPort; basePath: string },
  _optional: Record<string, never> = {},
): AdminCommentsPort {
  const base = basePath.replace(/\/$/, '');
  return {
    listCommentsQueue(_required, options = {}) {
      const params = new URLSearchParams();
      if (options.status) params.set('status', options.status);
      if (options.cursor) params.set('cursor', options.cursor);
      if (options.limit) params.set('limit', String(options.limit));
      const qs = params.toString();
      return request<AdminCommentsQueuePage>({ transport, path: `${base}/queue${qs ? `?${qs}` : ''}`, method: 'GET' });
    },
    async moderateComment({ commentId, action, expectedVersion }, options = {}) {
      await request<void>({ transport, path: `${base}/${encodeURIComponent(commentId)}/${action}`, method: 'POST', body: { expectedVersion, note: options.note } });
    },
    async purgeComment({ commentId }, options = {}) {
      await request<void>({ transport, path: `${base}/${encodeURIComponent(commentId)}/purge`, method: 'POST', body: { note: options.note } });
    },
    async getCommentsSettings(_required: Record<string, never>, _options: Record<string, never> = {}) {
      return (await request<{ data: CommentsSettings }>({ transport, path: `${base}/settings`, method: 'GET' })).data;
    },
    async putCommentsSettings(_required, patch = {}) {
      return (await request<{ data: CommentsSettings }>({ transport, path: `${base}/settings`, method: 'PUT', body: patch })).data;
    },
  };
}

/** Reuse the core auth `me` contract over the host's existing auth path. */
export function createHttpCommentsSession(
  { transport, path }: { transport: CommentsTransportPort; path: string },
  _optional: Record<string, never> = {},
): CommentsSessionPort {
  return { me: (_required: Record<string, never>, _options: Record<string, never> = {}) => request<Awaited<ReturnType<CommentsSessionPort['me']>>>({ transport, path, method: 'GET' }) };
}
