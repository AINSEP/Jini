import { describe, expect, it, vi } from 'vitest';
import { describeQueryNode, instrumentStorageKernel, trackFetch, trackHttpClient, type InstrumentableKernel, type QueryDescription } from '../instrumentation.js';
import { createNoopObservabilityPort, type DbQueryTrackingOutcome, type OutboundCallTrackingOutcome } from '@jini-ai/core/contracts/observability';
import type { HttpClientPort } from '@jini-ai/core/primitives';

// Characterization cases recorded before the complexity refactor. These drive the public
// descriptor with structural Kysely nodes, without a database or telemetry adapter.
const postsTable = { kind: 'TableNode', table: { identifier: { name: 'posts' } } };

it('instruments a storage kernel in place once and labels a run by its first query only', async () => {
 const stored = { title: 'saved draft' };
 type Plugin = { transformQuery(input: { node: unknown }): unknown; transformResult(input: { result: unknown }): Promise<unknown> };
 const db = {
  withPlugin(plugin: Plugin) {
   return {
    async load() {
     const first = { kind: 'SelectQueryNode', from: { froms: [postsTable] } };
     expect(plugin.transformQuery({ node: first })).toBe(first);
     plugin.transformQuery({ node: { kind: 'DeleteQueryNode' } });
     return plugin.transformResult({ result: stored });
    },
   };
  },
 };
 const kernel: InstrumentableKernel = {
  dialect: 'postgres',
  async run(fn) { return fn(db); },
  async transaction(fn) { return fn(); },
  async query() { return stored; },
  async execute() { throw new Error('unexpected execute'); },
 };
 const noop = createNoopObservabilityPort({});
 const originalRun = kernel.run;
 expect(instrumentStorageKernel({ kernel, observability: noop })).toBe(kernel);
 expect(kernel.run).toBe(originalRun);
 const end = vi.fn<(outcome: DbQueryTrackingOutcome) => void>();
 const trackDbQuery = vi.fn(() => ({ run: <T>(fn: () => T) => fn(), end }));
 const observability = { ...noop, trackDbQuery };
 expect(instrumentStorageKernel({ kernel, observability })).toBe(kernel);
 instrumentStorageKernel({ kernel, observability });
 const result = await kernel.run(builder => (builder as { load(): Promise<unknown> }).load());
 expect(result).toBe(stored);
 expect(trackDbQuery.mock.calls).toEqual([[{ system: 'postgresql' }]]);
 expect(end.mock.calls).toEqual([[{ operation: 'select', table: 'posts' }]]);
});

it('reports nested transaction, raw query and execute failure without replacing their outcomes', async () => {
 const db = { dialect: 'sqlite', marker: 'borrowed' };
 const failure = new Error('database closed');
 const statement = {
  keyword: 'PRAGMA busy_timeout',
  toOperationNode() { return { kind: 'RawNode', sqlFragments: [this.keyword] }; },
 };
 const query = vi.fn(async () => [37]);
 const execute = vi.fn(async () => { throw failure; });
 const kernel: InstrumentableKernel = {
  dialect: 'sqlite', async run(fn) { return fn(db); }, async transaction(fn) { return fn(); }, query, execute,
 };
 const scope: number[] = [];
 const events: { signal: number; parent?: number; outcome: DbQueryTrackingOutcome }[] = [];
 let next = 0;
 const trackDbQuery = vi.fn(() => {
  const signal = ++next;
  const parent = scope.at(-1);
  return {
   run<T>(fn: () => T): T {
    scope.push(signal);
    try { return fn(); } finally { scope.pop(); }
   },
   end: (outcome: DbQueryTrackingOutcome) => { events.push({ signal, ...(parent === undefined ? {} : { parent }), outcome }); },
  };
 });
 instrumentStorageKernel({ kernel, observability: { ...createNoopObservabilityPort({}), trackDbQuery } });
 expect(await kernel.transaction(async () => kernel.run(builder => builder))).toBe(db);
 expect(await kernel.query(statement)).toEqual([37]);
 expect(query.mock.calls).toEqual([[statement]]);
 await expect(kernel.execute(null)).rejects.toBe(failure);
 expect(execute.mock.calls).toEqual([[null]]);
 expect(trackDbQuery.mock.calls).toEqual(Array.from({ length: 4 }, () => [{ system: 'sqlite' }]));
 expect(events).toEqual([
  { signal: 2, parent: 1, outcome: { operation: 'run' } },
  { signal: 1, outcome: { operation: 'transaction' } },
  { signal: 3, outcome: { operation: 'pragma' } },
  { signal: 4, outcome: { operation: 'query', error: failure } },
 ]);
});

it('tracks raw fetch targets without changing their arguments, results or rejection', async () => {
 const response = { status: 418, body: 'still returned' };
 const failure = new Error('offline');
 const url = new URL('https://test.example/status');
 const request = { url: 'https://test.example/items', method: 'delete' };
 const init = { method: 'patch' };
 const end = vi.fn<(outcome: OutboundCallTrackingOutcome) => void>();
 let inScope = false;
 const trackOutboundCall = vi.fn(() => ({
  run<T>(fn: () => T): T {
   inScope = true;
   try { return fn(); } finally { inScope = false; }
  },
  end,
 }));
 const fetch = vi.fn(async (input: unknown, _init?: { method?: string }) => {
  expect(inScope).toBe(true);
  if (input === 'https://test.example/offline') throw failure;
  return response;
 });
 const noop = createNoopObservabilityPort({});
 expect(trackFetch({ fetch, observability: noop })).toBe(fetch);
 const tracked = trackFetch({ fetch, observability: { ...noop, trackOutboundCall } });
 expect(await tracked(url)).toBe(response);
 expect(await tracked(request)).toBe(response);
 expect(await tracked(request, init)).toBe(response);
 expect(await tracked(null)).toBe(response);
 await expect(tracked('https://test.example/offline')).rejects.toBe(failure);
 expect(fetch.mock.calls).toEqual([[url, undefined], [request, undefined], [request, init], [null, undefined], ['https://test.example/offline', undefined]]);
 expect(trackOutboundCall.mock.calls).toEqual([
  [{ method: 'GET', url: 'https://test.example/status' }], [{ method: 'DELETE', url: 'https://test.example/items' }],
  [{ method: 'PATCH', url: 'https://test.example/items' }], [{ method: 'GET', url: '' }],
  [{ method: 'GET', url: 'https://test.example/offline' }],
 ]);
 expect(end.mock.calls).toEqual([[{ statusCode: 418 }], [{ statusCode: 418 }], [{ statusCode: 418 }], [{ statusCode: 418 }], [{ error: failure }]]);
});

it('tracks guarded HTTP calls while preserving redirect policy and the transport error', async () => {
 const response = { status: 307, headers: { location: '/next' }, bodyText: '' };
 const failure = new Error('transport disconnected');
 const send = vi.fn<HttpClientPort['send']>().mockResolvedValueOnce(response).mockRejectedValueOnce(failure);
 const client = { send };
 const options = { redirect: 'manual' } as const;
 const required = { request: { method: 'HEAD', url: 'https://test.example/start', headers: {}, timeoutMs: 500 } } as const;
 const noop = createNoopObservabilityPort({});
 expect(trackHttpClient({ client, observability: noop })).toBe(client);
 const end = vi.fn<(outcome: OutboundCallTrackingOutcome) => void>();
 let scopedCalls = 0;
 const trackOutboundCall = vi.fn(() => ({
  run<T>(fn: () => T): T { scopedCalls++; return fn(); },
  end,
 }));
 const tracked = trackHttpClient({ client, observability: { ...noop, trackOutboundCall } });
 expect(await tracked.send(required, options)).toBe(response);
 await expect(tracked.send(required)).rejects.toBe(failure);
 expect(send.mock.calls).toEqual([[required, options], [required, undefined]]);
 expect(trackOutboundCall.mock.calls).toEqual([
  [{ method: 'HEAD', url: 'https://test.example/start' }], [{ method: 'HEAD', url: 'https://test.example/start' }],
 ]);
 expect(scopedCalls).toBe(2);
 expect(end.mock.calls).toEqual([[{ statusCode: 307 }], [{ error: failure }]]);
});
type DescriptionCase = { name: string; node: unknown; expected: QueryDescription };

describe('describeQueryNode characterization', () => {
 const tableCases: DescriptionCase[] = [
  { name: 'selects only the first FROM table', node: { kind: 'SelectQueryNode', from: { froms: [postsTable, { kind: 'TableNode', table: { identifier: { name: 'other' } } }] } }, expected: { operation: 'select', table: 'posts' } },
  { name: 'deletes from only the first FROM table', node: { kind: 'DeleteQueryNode', from: { froms: [postsTable, { kind: 'TableNode', table: { identifier: { name: 'other' } } }] } }, expected: { operation: 'delete', table: 'posts' } },
  { name: 'reads an insert destination', node: { kind: 'InsertQueryNode', into: postsTable }, expected: { operation: 'insert', table: 'posts' } },
  { name: 'reads an update table', node: { kind: 'UpdateQueryNode', table: postsTable }, expected: { operation: 'update', table: 'posts' } },
  { name: 'unwraps nested aliases without exporting alias names', node: { kind: 'UpdateQueryNode', table: { kind: 'AliasNode', alias: 'outer', node: { kind: 'AliasNode', alias: 'inner', node: postsTable } } }, expected: { operation: 'update', table: 'posts' } },
  { name: 'omits a missing select FROM', node: { kind: 'SelectQueryNode' }, expected: { operation: 'select' } },
  { name: 'omits missing select FROM entries', node: { kind: 'SelectQueryNode', from: {} }, expected: { operation: 'select' } },
  { name: 'omits an empty select FROM list', node: { kind: 'SelectQueryNode', from: { froms: [] } }, expected: { operation: 'select' } },
  { name: 'omits a missing delete FROM', node: { kind: 'DeleteQueryNode' }, expected: { operation: 'delete' } },
  { name: 'omits missing delete FROM entries', node: { kind: 'DeleteQueryNode', from: {} }, expected: { operation: 'delete' } },
  { name: 'omits an empty delete FROM list', node: { kind: 'DeleteQueryNode', from: { froms: [] } }, expected: { operation: 'delete' } },
  { name: 'omits a missing insert destination', node: { kind: 'InsertQueryNode' }, expected: { operation: 'insert' } },
  { name: 'omits a missing update table', node: { kind: 'UpdateQueryNode' }, expected: { operation: 'update' } },
  { name: 'omits a table with missing identifier', node: { kind: 'InsertQueryNode', into: { kind: 'TableNode', table: {} } }, expected: { operation: 'insert' } },
  { name: 'omits a non-string table name', node: { kind: 'InsertQueryNode', into: { kind: 'TableNode', table: { identifier: { name: 42 } } } }, expected: { operation: 'insert' } },
  { name: 'omits an empty table name', node: { kind: 'InsertQueryNode', into: { kind: 'TableNode', table: { identifier: { name: '' } } } }, expected: { operation: 'insert' } },
  { name: 'does not treat a raw FROM expression as a table', node: { kind: 'SelectQueryNode', from: { froms: [{ kind: 'RawNode', sqlFragments: ['secret'] }] } }, expected: { operation: 'select' } },
 ];
 it.each(tableCases)('$name', ({ node, expected }) => {
  expect(describeQueryNode({ node })).toStrictEqual(expected);
 });

 const rawCases: { name: string; sqlFragments?: readonly unknown[]; operation: string }[] = [
  { name: 'lowercases a leading mixed-case keyword', sqlFragments: [' \nSeLeCt * FROM private_table WHERE token = secret'], operation: 'select' },
  { name: 'accepts a keyword at end of text', sqlFragments: ['COMMIT'], operation: 'commit' },
  { name: 'accepts punctuation after a keyword', sqlFragments: ['PRAGMA(table_info)'], operation: 'pragma' },
  { name: 'rejects a leading single-quoted value', sqlFragments: ["'secret'"], operation: 'raw' },
  { name: 'rejects a leading double-quoted value', sqlFragments: ['"secret"'], operation: 'raw' },
  { name: 'rejects a digit adjoining the keyword', sqlFragments: ['SELECT1 secret'], operation: 'raw' },
  { name: 'rejects an underscore adjoining the keyword', sqlFragments: ['SELECT_secret'], operation: 'raw' },
  { name: 'rejects a single quote adjoining the keyword', sqlFragments: ["SELECT'secret'"], operation: 'raw' },
  { name: 'rejects a double quote adjoining the keyword', sqlFragments: ['SELECT"secret"'], operation: 'raw' },
  { name: 'does not skip a leading SQL comment', sqlFragments: ['/* secret */ SELECT'], operation: 'raw' },
  { name: 'rejects non-alphabetic leading text', sqlFragments: ['123 secret'], operation: 'raw' },
  { name: 'uses only the first fragment', sqlFragments: ['', 'SELECT secret'], operation: 'raw' },
  { name: 'handles an empty fragment', sqlFragments: [''], operation: 'raw' },
  { name: 'handles whitespace alone', sqlFragments: [' \t\n'], operation: 'raw' },
  { name: 'handles missing fragments', operation: 'raw' },
  { name: 'handles an empty fragment list', sqlFragments: [], operation: 'raw' },
  { name: 'handles an undefined first fragment', sqlFragments: [undefined], operation: 'raw' },
  { name: 'handles a null first fragment', sqlFragments: [null], operation: 'raw' },
 ];
 it.each(rawCases)('$name', ({ sqlFragments, operation }) => {
  const node = { kind: 'RawNode', sqlFragments, parameters: ['secret'] };
  expect(describeQueryNode({ node })).toStrictEqual({ operation });
 });

 const fallbackCases: DescriptionCase[] = [
  { name: 'defaults a null node to query', node: null, expected: { operation: 'query' } },
  { name: 'defaults an undefined node to query', node: undefined, expected: { operation: 'query' } },
  { name: 'defaults an absent kind to query', node: {}, expected: { operation: 'query' } },
  { name: 'defaults a non-string kind to query', node: { kind: 42 }, expected: { operation: 'query' } },
  { name: 'removes a QueryNode suffix and separates camel case', node: { kind: 'MergeIntoQueryNode', table: postsTable }, expected: { operation: 'merge_into' } },
  { name: 'removes a Node suffix and separates camel case', node: { kind: 'CreateTableNode' }, expected: { operation: 'create_table' } },
  { name: 'separates a digit from a following capital', node: { kind: 'Create2TableQueryNode' }, expected: { operation: 'create2_table' } },
  { name: 'keeps an acronym together', node: { kind: 'DDLNode' }, expected: { operation: 'ddl' } },
  { name: 'keeps a kind without a recognized suffix', node: { kind: 'customOperation' }, expected: { operation: 'custom_operation' } },
  { name: 'keeps an empty string kind empty', node: { kind: '' }, expected: { operation: '' } },
 ];
 it.each(fallbackCases)('$name', ({ node, expected }) => {
  expect(describeQueryNode({ node })).toStrictEqual(expected);
 });
});
