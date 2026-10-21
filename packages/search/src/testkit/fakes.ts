/**
 * @file DI fakes for testing search providers and the search runtime without a network, a database
 * or a host: an HTTP client that records requests, one that is always down, an in-memory index
 * state + target pointer store, and access ports.
 */
import type { HttpClientPort, HttpRequest, HttpResponse, RequestRedirect } from '@jini-ai/core/primitives';
import { encodeSearchKey, type SearchDocumentKey } from '../contract.js';
import type {
  SearchAccessPort, SearchIndexStatePort, SearchIndexStateRow, SearchIndexStatus, SearchSiteTargets,
  SearchStatusCounts, SearchTarget, SearchTargetPort,
} from '../ports.js';

export interface FakeHttpClient extends HttpClientPort {
  /** Every request sent, in order. */
  readonly requests: readonly HttpRequest[];
}

/**
 * An {@link HttpClientPort} answering from `handle` (which may throw or reject to simulate a
 * transport fault) and recording each request before handling it.
 * @complexity O(1) per request plus `handle`.
 */
export function createFakeHttpClient(
  required: { readonly handle: (required: { readonly request: HttpRequest; readonly redirect?: RequestRedirect }) => HttpResponse | Promise<HttpResponse> },
  _optional: Record<string, never> = {},
): FakeHttpClient {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async send({ request }, optional = {}) {
      requests.push(request);
      return required.handle({ request, ...(optional.redirect === undefined ? {} : { redirect: optional.redirect }) });
    },
  };
}

/** An {@link HttpClientPort} whose every send rejects, as a down network does. */
export function createUnavailableHttpClient(_required: Record<string, never> = {}, optional: { readonly message?: string } = {}): HttpClientPort {
  const message = optional.message ?? 'network unavailable';
  return { send: async () => { throw new Error(message); } };
}

const STATUSES: readonly SearchIndexStatus[] = ['pending', 'indexed', 'unknown', 'failed'];

const targetId = (target: SearchTarget): string => JSON.stringify([target.siteId, target.providerId, target.generation]);
const sameTarget = (a: SearchTarget | null, b: SearchTarget): boolean => a !== null && targetId(a) === targetId(b);

export interface InMemorySearchState {
  readonly indexState: SearchIndexStatePort;
  readonly targets: SearchTargetPort;
}

function createIndexState(): SearchIndexStatePort {
  const rows = new Map<string, SearchIndexStateRow>();
  const watermarks = new Map<string, { readonly cursor?: string; readonly done: boolean }>();
  const rowId = (target: SearchTarget, key: SearchDocumentKey) => `${targetId(target)}|${encodeSearchKey({ key })}`;
  const rowsOf = (target: SearchTarget) => [...rows.values()].filter(row => sameTarget(row.target, target));
  return {
    async get({ target, key }) { return rows.get(rowId(target, key)) ?? null; },
    async put({ row }) { rows.set(rowId(row.target, row.key), Object.freeze({ ...row })); },
    async settle({ row, expected }) {
      const stored = rows.get(rowId(row.target, row.key));
      // Compare-and-swap: only the settle that still sees the row it observed may replace it.
      if (stored?.revision !== expected.revision || (stored.taskId ?? null) !== expected.taskId) return false;
      rows.set(rowId(row.target, row.key), Object.freeze({ ...row }));
      return true;
    },
    async listByStatus({ target, statuses, limit }, { failedBelowAttempts = Infinity } = {}) {
      const actionable = (row: SearchIndexStateRow) => !(row.status === 'failed' && row.attempts >= failedBelowAttempts);
      return rowsOf(target).filter(row => statuses.includes(row.status) && actionable(row)).slice(0, limit);
    },
    async counts({ target }) {
      const counts = Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<SearchIndexStatus, number>;
      for (const row of rowsOf(target)) counts[row.status] += 1;
      return counts as SearchStatusCounts;
    },
    async getWatermark({ target, collection }) { return watermarks.get(`${targetId(target)}|${collection}`) ?? null; },
    async putWatermark({ target, collection, cursor, done }) {
      watermarks.set(`${targetId(target)}|${collection}`, cursor === undefined ? { done } : { cursor, done });
    },
    async deleteTarget({ target }) {
      for (const [id, row] of rows) if (sameTarget(row.target, target)) rows.delete(id);
      const prefix = `${targetId(target)}|`;
      for (const id of watermarks.keys()) if (id.startsWith(prefix)) watermarks.delete(id);
    },
  };
}

function createTargets(initial: readonly SearchTarget[]): SearchTargetPort {
  const sites = new Map<string, SearchSiteTargets>(initial.map(target => [target.siteId, { active: target, building: null }]));
  const current = (siteId: string): SearchSiteTargets => sites.get(siteId) ?? { active: null, building: null };
  return {
    async get({ siteId }) { return { ...current(siteId) }; },
    async setBuilding({ target }) { sites.set(target.siteId, { active: current(target.siteId).active, building: target }); },
    async promote({ siteId, expected }) {
      const { active, building } = current(siteId);
      // Compare-and-swap: only the caller that still sees the stored building may promote it.
      if (!sameTarget(building, expected)) return false;
      sites.set(siteId, { active: building, building: null });
      return { replaced: active };
    },
    async clearBuilding({ siteId }) { sites.set(siteId, { active: current(siteId).active, building: null }); },
  };
}

/**
 * In-memory {@link SearchIndexStatePort} and {@link SearchTargetPort} (two ports, because both
 * name a `get`). `promote` is a real compare-and-swap on the stored `building` pointer.
 * @param optional.active - Targets that start active, one per site.
 * @complexity get/put O(1); listByStatus/counts/deleteTarget O(rows).
 */
export function createInMemorySearchState(_required: Record<string, never> = {}, optional: { readonly active?: readonly SearchTarget[] } = {}): InMemorySearchState {
  return { indexState: createIndexState(), targets: createTargets(optional.active ?? []) };
}

/**
 * An access port that answers `visibleKeys` with a predicate per requested key.
 * @complexity O(keys) predicate calls.
 */
export function createPredicateAccessPort(
  required: { readonly isVisible: (required: { readonly siteId: string; readonly key: SearchDocumentKey; readonly audiences: readonly string[] }) => boolean },
  _optional: Record<string, never> = {},
): SearchAccessPort {
  return {
    async visibleKeys({ siteId, keys, audiences }) {
      return new Set(keys.filter(key => required.isVisible({ siteId, key, audiences })).map(key => encodeSearchKey({ key })));
    },
  };
}

/** An access port under which exactly the listed keys are visible (to every audience). */
export function createStaticAccessPort(required: { readonly visible: readonly SearchDocumentKey[] }, _optional: Record<string, never> = {}): SearchAccessPort {
  const visible = new Set(required.visible.map(key => encodeSearchKey({ key })));
  return createPredicateAccessPort({ isVisible: ({ key }) => visible.has(encodeSearchKey({ key })) });
}
