/**
 * Local DI fakes for the indexer/service/tools tests: plain objects satisfying the ports and the
 * provider contract, each recording its calls and accepting per-call scripted overrides.
 */
import { providerOk, type ProviderResult } from '@jini-ai/core/provider-registry';
import type { HttpClientPort } from '@jini-ai/core/primitives';
import { encodeSearchKey, searchIndexName, type SearchDocument, type SearchDocumentKey, type SearchPage, type SearchProvider, type SearchProviderContext, type SearchRevisionState, type SearchTaskState, type SearchWriteResult } from '../../contract.js';
import type { SearchAccessPort, SearchDocumentSource, SearchIndexStatePort, SearchIndexStateRow, SearchSiteTargets, SearchSourceRecord, SearchStatusCounts, SearchTarget, SearchTargetPort } from '../../ports.js';

export const SITE = 'site1';
export const WS = 'ws1';

export const key = (documentId: string, collection = 'post', siteId = SITE, workspaceId = WS): SearchDocumentKey => ({ siteId, workspaceId, collection, documentId });

export function doc(documentId: string, revision: number, options: { restricted?: boolean; collection?: string } = {}): SearchDocument {
  return {
    key: key(documentId, options.collection), revision, url: `/${documentId}`, title: `Title ${documentId}`, body: `Body ${documentId}`,
    visibility: options.restricted ? { kind: 'restricted', audiences: ['members'] } : { kind: 'public' },
  };
}

export function record(documentId: string, revision: number, options: { restricted?: boolean; absent?: boolean; collection?: string } = {}): SearchSourceRecord {
  return { key: key(documentId, options.collection), revision, document: options.absent ? null : doc(documentId, revision, options) };
}

type Method = 'ensureIndex' | 'dropIndex' | 'upsert' | 'remove' | 'query' | 'revisionOf' | 'awaitTask';
type Override = (args: unknown) => Promise<ProviderResult<unknown>>;

export interface FakeProvider {
  provider: SearchProvider;
  /** What the fake backend holds per encoded key. */
  readonly held: Map<string, { revision: number; deleted: boolean }>;
  readonly calls: { method: Method; ctx: SearchProviderContext; args: unknown }[];
  /** Queue a one-shot answer for the next call of `method`. */
  next(method: Method, answer: Override): void;
  page: SearchPage;
  taskStates: Map<string, SearchTaskState>;
}

export function makeProvider(options: { id?: string; acceptsRestricted?: boolean; maxBatch?: number; asyncIndexing?: boolean; withAwaitTask?: boolean } = {}): FakeProvider {
  const held = new Map<string, { revision: number; deleted: boolean }>();
  const calls: FakeProvider['calls'] = [];
  const queued = new Map<Method, Override[]>();
  const fake: FakeProvider = {
    held, calls, page: { hits: [] }, taskStates: new Map(),
    next(method, answer) { queued.set(method, [...(queued.get(method) ?? []), answer]); },
    provider: undefined as unknown as SearchProvider,
  };
  const run = async <T>(method: Method, ctx: SearchProviderContext, args: unknown, fallback: () => ProviderResult<T>): Promise<ProviderResult<T>> => {
    calls.push({ method, ctx, args });
    const override = queued.get(method)?.shift();
    if (override) return override(args) as Promise<ProviderResult<T>>;
    return fallback();
  };
  const write = (items: readonly { key: SearchDocumentKey; revision: number }[], deleted: boolean): ProviderResult<SearchWriteResult> => {
    const outcomes = items.map(item => {
      const encoded = encodeSearchKey({ key: item.key });
      const current = held.get(encoded);
      if (current && current.revision >= item.revision) return { key: item.key, revision: item.revision, status: 'stale' as const };
      held.set(encoded, { revision: item.revision, deleted });
      return { key: item.key, revision: item.revision, status: 'applied' as const };
    });
    return providerOk({ value: { outcomes } });
  };
  const provider: SearchProvider = {
    id: options.id ?? 'vendor', label: 'Fake',
    capabilities: { acceptsRestricted: options.acceptsRestricted ?? false, typoTolerance: false, locales: 'any', maxBatch: options.maxBatch ?? 100, asyncIndexing: options.asyncIndexing ?? false },
    credentialKeys: [],
    ensureIndex: (ctx, args) => run('ensureIndex', ctx, args, () => providerOk({ value: undefined })),
    dropIndex: (ctx, args) => run('dropIndex', ctx, args, () => providerOk({ value: undefined })),
    upsert: (ctx, args) => run('upsert', ctx, args, () => write(args.documents, false)),
    remove: (ctx, args) => run('remove', ctx, args, () => write(args.tombstones, true)),
    query: (ctx, args) => run('query', ctx, args, () => providerOk({ value: fake.page })),
    revisionOf: (ctx, args) => run('revisionOf', ctx, args, () => providerOk<readonly SearchRevisionState[]>({
      value: args.keys.map(k => {
        const current = held.get(encodeSearchKey({ key: k }));
        return { key: k, revision: current?.revision ?? null, deleted: current?.deleted ?? false };
      }),
    })),
    ...(options.withAwaitTask ? {
      awaitTask: (ctx: SearchProviderContext, args: { readonly taskId: string }) => run('awaitTask', ctx, args, () => providerOk({ value: fake.taskStates.get(args.taskId) ?? 'pending' })),
    } : {}),
  };
  fake.provider = provider;
  return fake;
}

const targetKey = (target: SearchTarget) => `${target.siteId}|${target.providerId}|${target.generation}`;
const ZERO: SearchStatusCounts = { pending: 0, indexed: 0, unknown: 0, failed: 0 };

export interface FakeState extends SearchIndexStatePort {
  readonly rows: Map<string, SearchIndexStateRow>;
  readonly marks: Map<string, { cursor?: string; done: boolean }>;
  readonly puts: SearchIndexStateRow[];
  readonly deleted: SearchTarget[];
  row(target: SearchTarget, k: SearchDocumentKey): SearchIndexStateRow | undefined;
}

export function makeState(): FakeState {
  const rows = new Map<string, SearchIndexStateRow>();
  const marks = new Map<string, { cursor?: string; done: boolean }>();
  const puts: SearchIndexStateRow[] = [];
  const deleted: SearchTarget[] = [];
  const rowKey = (target: SearchTarget, k: SearchDocumentKey) => `${targetKey(target)}#${encodeSearchKey({ key: k })}`;
  const ofTarget = (target: SearchTarget) => [...rows.values()].filter(row => targetKey(row.target) === targetKey(target));
  return {
    rows, marks, puts, deleted,
    row: (target, k) => rows.get(rowKey(target, k)),
    async get({ target, key: k }) { return rows.get(rowKey(target, k)) ?? null; },
    async put({ row }) { puts.push(row); rows.set(rowKey(row.target, row.key), row); },
    async listByStatus({ target, statuses, limit }) { return ofTarget(target).filter(row => statuses.includes(row.status)).slice(0, limit); },
    async counts({ target }) {
      const counts = { ...ZERO };
      for (const row of ofTarget(target)) counts[row.status] += 1;
      return counts;
    },
    async getWatermark({ target, collection }) { return marks.get(`${targetKey(target)}#${collection}`) ?? null; },
    async putWatermark({ target, collection, cursor, done }) { marks.set(`${targetKey(target)}#${collection}`, { done, ...(cursor === undefined ? {} : { cursor }) }); },
    async deleteTarget({ target }) {
      deleted.push(target);
      for (const row of ofTarget(target)) rows.delete(rowKey(row.target, row.key));
    },
  };
}

export interface FakeTargets extends SearchTargetPort {
  current: SearchSiteTargets;
  /** When set, the next promote answers false (someone else moved the pointer). */
  losePromote: boolean;
}

export function makeTargets(initial: Partial<SearchSiteTargets> = {}): FakeTargets {
  const fake: FakeTargets = {
    current: { active: initial.active ?? null, building: initial.building ?? null },
    losePromote: false,
    async get() { return fake.current; },
    async setBuilding({ target }) { fake.current = { ...fake.current, building: target }; },
    async promote({ expected }) {
      const { building, active } = fake.current;
      if (fake.losePromote || building === null || targetKey(building) !== targetKey(expected)) return false;
      fake.current = { active: building, building: null };
      return { replaced: active };
    },
    async clearBuilding() { fake.current = { ...fake.current, building: null }; },
  };
  return fake;
}

export interface FakeSource extends SearchDocumentSource {
  readonly records: Map<string, SearchSourceRecord>;
  readonly loads: { documentId: string; occurredAtMs: number }[];
  readonly scans: (string | undefined)[];
}

/** A source answering `load` from `records` and scanning them in id order, cursor = last id. */
export function makeSource(collection = 'post', initial: SearchSourceRecord[] = []): FakeSource {
  const records = new Map(initial.map(r => [r.key.documentId, r]));
  const loads: FakeSource['loads'] = [];
  const scans: FakeSource['scans'] = [];
  return {
    collection, records, loads, scans,
    events: [`${collection}.published`, `${collection}.unpublished`],
    documentIdOf: ({ event }) => (event.payload as { collection?: string } | undefined)?.collection === collection ? event.aggregateId ?? null : null,
    async load({ documentId, occurredAtMs, siteId, workspaceId }) {
      loads.push({ documentId, occurredAtMs });
      return records.get(documentId) ?? { key: key(documentId, collection, siteId, workspaceId), revision: 1, document: null };
    },
    async scan({ limit }, { cursor } = {}) {
      scans.push(cursor);
      const ids = [...records.keys()].sort();
      const start = cursor === undefined ? 0 : ids.indexOf(cursor) + 1;
      const slice = ids.slice(start, start + limit);
      const more = start + limit < ids.length;
      return { records: slice.map(id => records.get(id) as SearchSourceRecord), ...(more ? { nextCursor: slice[slice.length - 1] as string } : {}) };
    },
  };
}

export const httpClient: HttpClientPort = { send: async () => { throw new Error('no network in tests'); } };

export function contextFor({ target, workspaceId }: { target: SearchTarget; workspaceId: string }): SearchProviderContext {
  return {
    workspaceId, siteId: target.siteId, mode: 'test', credentials: {}, httpClient, timeoutMs: 1000, now: () => 0,
    indexName: searchIndexName({ installId: 'install', siteId: target.siteId, providerId: target.providerId, generation: target.generation }),
  };
}

export function makeAccess(visible: (keys: readonly SearchDocumentKey[]) => readonly SearchDocumentKey[] = keys => keys): SearchAccessPort & { calls: { keys: readonly SearchDocumentKey[]; audiences: readonly string[] }[] } {
  const calls: { keys: readonly SearchDocumentKey[]; audiences: readonly string[] }[] = [];
  return {
    calls,
    async visibleKeys({ keys, audiences }) {
      calls.push({ keys, audiences });
      return new Set(visible(keys).map(k => encodeSearchKey({ key: k })));
    },
  };
}
