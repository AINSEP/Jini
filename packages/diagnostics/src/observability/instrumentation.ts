import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { DbQueryTracker, ObservabilityPort } from './ports.js';
import { isNoopObservabilityPort } from './noop.js';

/**
 * @file Decorators that put a host's existing chokepoints on the observability port: the storage
 * kernel (every repo query, on every dialect) and the guarded HTTP client (every vetted egress call).
 * Both return their input untouched for the no-op port, so a disabled install keeps the exact
 * objects and call paths it had — no wrapper frame, no per-query plugin, no allocation.
 */

export interface QueryDescription { operation: string; table?: string; }
type NodeLike = { kind?: unknown; from?: { froms?: readonly unknown[] }; into?: unknown; table?: unknown; node?: unknown; sqlFragments?: readonly string[] } | null | undefined;

function tableName(node: unknown): string | undefined {
 const n = node as { kind?: unknown; node?: unknown; table?: { identifier?: { name?: unknown } } } | null | undefined;
 if (n?.kind === 'AliasNode') return tableName(n.node);
 const name = n?.kind === 'TableNode' ? n.table?.identifier?.name : undefined;
 return typeof name === 'string' ? name : undefined;
}
function withTable(operation: string, node: unknown): QueryDescription {
 const table = tableName(node);
 return table ? { operation, table } : { operation };
}

/** Operation and table of one Kysely operation node. Reads node kinds and identifiers only — never
 * parameter values or statement text, so the description is safe to export whatever the query binds.
 * A raw statement contributes its leading keyword alone (`pragma`, `select`), or `raw`. */
export function describeQueryNode({ node }: { node: unknown }): QueryDescription {
 const n = node as NodeLike;
 switch (n?.kind) {
  case 'SelectQueryNode': return withTable('select', n.from?.froms?.[0]);
  case 'InsertQueryNode': return withTable('insert', n.into);
  case 'UpdateQueryNode': return withTable('update', n.table);
  case 'DeleteQueryNode': return withTable('delete', n.from?.froms?.[0]);
  case 'RawNode': {
   // The keyword must end at a boundary: a fragment that opens with a quoted literal is not one.
   const keyword = /^\s*([A-Za-z]+)(?![A-Za-z0-9_'"])/.exec(n.sqlFragments?.[0] ?? '')?.[1];
   return { operation: keyword ? keyword.toLowerCase() : 'raw' };
  }
  default:
   if (typeof n?.kind !== 'string') return { operation: 'query' };
   return { operation: n.kind.replace(/(Query)?Node$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() };
 }
}

/** The kernel surface the decorator replaces; `StorageKernel<DB>` from `@jini-ai/db/kernel` fits it. */
// `any` for the builder and statement: each host's kernel is generic over its own schema, and no
// structural type both accepts every instantiation and stays callable here. The decorator only
// passes them through (plus `withPlugin`, feature-detected at run time).
export interface InstrumentableKernel {
 readonly dialect: string;
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 run(fn: (db: any) => unknown): Promise<unknown>;
 transaction(fn: () => Promise<unknown>): Promise<unknown>;
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 query(statement: any): Promise<unknown>;
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 execute(statement: any): Promise<unknown>;
}
type LooseKernel = {
 dialect: string;
 run(fn: (db: unknown) => unknown): Promise<unknown>;
 transaction(fn: () => Promise<unknown>): Promise<unknown>;
 query(statement: unknown): Promise<unknown>;
 execute(statement: unknown): Promise<unknown>;
};
type CapturePlugin = { transformQuery(args: { node: unknown }): unknown; transformResult(args: { result: unknown }): Promise<unknown> };

const INSTRUMENTED = new WeakSet<object>();

async function settle<T>({ tracker, describe }: { tracker: DbQueryTracker; describe: () => QueryDescription }, work: () => Promise<T>): Promise<T> {
 let result: T;
 try { result = await tracker.run(work); } catch (error) { tracker.end({ ...describe(), error }); throw error; }
 tracker.end(describe());
 return result;
}
function rawDescription(statement: unknown): QueryDescription {
 const toNode = (statement as { toOperationNode?: unknown } | null)?.toOperationNode;
 return describeQueryNode({ node: typeof toNode === 'function' ? toNode.call(statement) : null });
}

/**
 * Tracks every kernel `run`/`transaction`/`query`/`execute` as one DB span, decorating the kernel
 * IN PLACE. A replacement object would break identity-keyed lookups hosts already rely on (the
 * SQLite driver's connection reverse cache, kernels cached per connection), and in-place keeps every
 * holder of the same kernel covered. `run` bodies get the builder with a capture plugin, so the span
 * is named from the first query the body builds (operation + table), never its SQL text.
 * @param required The kernel and the port. A no-op port, or a kernel already decorated, is left alone.
 * @returns The same kernel object.
 * @complexity O(1) per call beyond one plugin pass per built query.
 */
export function instrumentStorageKernel<K extends InstrumentableKernel>({ kernel, observability }: { kernel: K; observability: ObservabilityPort }): K {
 if (isNoopObservabilityPort(observability) || INSTRUMENTED.has(kernel)) return kernel;
 INSTRUMENTED.add(kernel);
 const target = kernel as unknown as LooseKernel;
 const system = target.dialect === 'postgres' ? 'postgresql' : target.dialect;
 const run = target.run.bind(target), transaction = target.transaction.bind(target);
 const query = target.query.bind(target), execute = target.execute.bind(target);
 target.run = (fn) => {
  let seen: QueryDescription | undefined;
  const capture: CapturePlugin = {
   transformQuery: ({ node }) => { seen ??= describeQueryNode({ node }); return node; },
   transformResult: async ({ result }) => result,
  };
  const withCapture = (db: unknown) => {
   const builder = db as { withPlugin?: (plugin: CapturePlugin) => unknown } | null;
   return typeof builder?.withPlugin === 'function' ? builder.withPlugin(capture) : db;
  };
  return settle({ tracker: observability.trackDbQuery({ system }), describe: () => seen ?? { operation: 'run' } }, () => run((db) => fn(withCapture(db))));
 };
 // Inner run() spans start inside the transaction's scope, so they nest under it.
 target.transaction = (fn) => settle({ tracker: observability.trackDbQuery({ system }), describe: () => ({ operation: 'transaction' }) }, () => transaction(fn));
 target.query = (statement) => settle({ tracker: observability.trackDbQuery({ system }), describe: () => rawDescription(statement) }, () => query(statement));
 target.execute = (statement) => settle({ tracker: observability.trackDbQuery({ system }), describe: () => rawDescription(statement) }, () => execute(statement));
 return kernel;
}

/** Any `fetch`-shaped function: the global, a timeout wrapper, a SigV4 client's `fetch`. Structural,
 * so this universal entry needs no DOM or undici types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FetchLike = (input: any, init?: any) => Promise<{ status: number }>;

/** URL and method of one fetch call: `init.method` wins over a Request's own, as in `fetch` itself.
 * Anything that is not a string, URL or Request-shaped object becomes '' (the adapter's `invalid-url`). */
function fetchTarget(input: unknown, init: unknown): { method: string; url: string } {
 const shaped = (typeof input === 'object' && input !== null ? input : {}) as { href?: unknown; url?: unknown; method?: unknown };
 const raw = typeof input === 'string' ? input : shaped.href ?? shaped.url;
 const method = (init as { method?: unknown } | undefined)?.method ?? shaped.method;
 return { url: typeof raw === 'string' ? raw : '', method: typeof method === 'string' ? method.toUpperCase() : 'GET' };
}

/** One outbound span per call of a raw `fetch` — the egress paths that do not go through a guarded
 * client (deploy hosts, git hosts, object stores, loopback). Input, init and the response pass through
 * untouched; the span gets scheme/host/port and status only, like {@link trackHttpClient}.
 * @returns `fetch` itself for the no-op port.
 * @complexity O(1) per call. */
export function trackFetch<F extends FetchLike>({ fetch, observability }: { fetch: F; observability: ObservabilityPort }): F {
 if (isNoopObservabilityPort(observability)) return fetch;
 const tracked: FetchLike = async (input, init) => {
  const tracker = observability.trackOutboundCall(fetchTarget(input, init));
  let response: { status: number };
  try { response = await tracker.run(() => fetch(input, init)); } catch (error) { tracker.end({ error }); throw error; }
  tracker.end({ statusCode: response.status });
  return response;
 };
 return tracked as F;
}

/** One outbound span per `send`, with the response status or the transport failure; the call itself
 * is unchanged. Returns `client` itself for the no-op port. */
export function trackHttpClient({ client, observability }: { client: HttpClientPort; observability: ObservabilityPort }): HttpClientPort {
 if (isNoopObservabilityPort(observability)) return client;
 return {
  async send(required, optional) {
   const tracker = observability.trackOutboundCall({ method: required.request.method, url: required.request.url });
   let response: Awaited<ReturnType<HttpClientPort['send']>>;
   try { response = await tracker.run(() => client.send(required, optional)); } catch (error) { tracker.end({ error }); throw error; }
   tracker.end({ statusCode: response.status });
   return response;
  },
 };
}
