/**
 * @file The in-memory REFERENCE search provider. It exists so the conformance kit has something
 * real to run against in tests, and as a readable executable statement of the contract's write and
 * query semantics.
 *
 * It is NOT the built-in provider: the owner builds the real built-in (`id: 'builtin'`) on the host's
 * storage kernel with its own tables and migration, and it must pass the same conformance kit. Never
 * register this one in a running host — all state lives in one process's memory.
 */
import {
  providerOk, providerRejected, providerUnknown, type ProviderResult,
} from '@jini-ai/core/provider-registry';
import {
  encodeSearchKey,
  type SearchCapabilities, type SearchDocument, type SearchDocumentKey, type SearchHighlight, type SearchHit,
  type SearchPage, type SearchProvider, type SearchProviderContext, type SearchQuery, type SearchRevisionState,
  type SearchTaskState, type SearchTombstone, type SearchWriteOutcome, type SearchWriteResult,
} from '../contract.js';

interface Entry {
  readonly key: SearchDocumentKey;
  readonly revision: number;
  /** Absent = tombstone. */
  readonly document?: SearchDocument;
}

type Index = Map<string, Entry>;

/** One queued write: what it would store, applied in order when its task is awaited. */
interface QueuedTask {
  readonly indexName: string;
  readonly entries: readonly Entry[];
}

export interface InMemorySearchProviderOptions {
  readonly id?: string;
  readonly label?: string;
  readonly acceptsRestricted?: boolean;
  readonly asyncIndexing?: boolean;
  readonly typoTolerance?: boolean;
  readonly locales?: readonly string[] | 'any';
  readonly maxBatch?: number;
  /** `false` turns every call for that context into `unknown`/`provider_unavailable`. */
  readonly available?: (required: { readonly ctx: SearchProviderContext }) => boolean;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const SNIPPET_LEAD = 40;
const SNIPPET_LENGTH = 160;
/** Typo tolerance (when enabled) allows one edit on words of at least this length. */
const TYPO_MIN_LENGTH = 5;
const WORD = /[\p{L}\p{N}]+/gu;

const words = (text: string): string[] => (text.toLowerCase().match(WORD) ?? []);

/** True when `a` and `b` are at most one insertion, deletion or substitution apart. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  // Skip one char of the longer word (or one of each when equal length) and compare the rests.
  const restA = a.length >= b.length ? a.slice(i + 1) : a.slice(i);
  const restB = b.length >= a.length ? b.slice(i + 1) : b.slice(i);
  return restA === restB;
}

function makeMatcher(required: { readonly terms: readonly string[]; readonly typoTolerance: boolean }): (word: string) => boolean {
  const { terms, typoTolerance } = required;
  return word => terms.some(term => term === word || (typoTolerance && term.length >= TYPO_MIN_LENGTH && withinOneEdit(term, word)));
}

/** Plain-text excerpt around the first matching word, with every matching word in it highlighted. */
function snippetOf(required: { readonly body: string; readonly matches: (word: string) => boolean }): { readonly snippet: string; readonly highlights: readonly SearchHighlight[] } {
  const { body, matches } = required;
  const located = [...body.matchAll(WORD)].map(found => ({ start: found.index, end: found.index + found[0].length, hit: matches(found[0].toLowerCase()) }));
  const first = located.find(word => word.hit);
  const start = first === undefined ? 0 : Math.max(0, first.start - SNIPPET_LEAD);
  const end = Math.min(body.length, start + SNIPPET_LENGTH);
  const highlights = located
    .filter(word => word.hit && word.start >= start && word.end <= end)
    .map(word => ({ start: word.start - start, end: word.end - start }));
  return { snippet: body.slice(start, end), highlights };
}

function audienceAllows(document: SearchDocument, audiences: readonly string[]): boolean {
  const { visibility } = document;
  return visibility.kind === 'public' || visibility.audiences.some(audience => audiences.includes(audience));
}

function fieldsMatch(document: SearchDocument, filters: Readonly<Record<string, string | number | boolean>>): boolean {
  return Object.entries(filters).every(([name, expected]) => {
    const actual = document.fields?.[name];
    return Array.isArray(actual) ? actual.includes(expected as string) : actual === expected;
  });
}

function scopeMatches(document: SearchDocument, query: SearchQuery): boolean {
  const collectionOk = query.collections === undefined || query.collections.includes(document.key.collection);
  return collectionOk && (query.locale === undefined || document.locale === query.locale);
}

function passesFilters(document: SearchDocument, query: SearchQuery): boolean {
  return scopeMatches(document, query) && fieldsMatch(document, query.filters ?? {}) && audienceAllows(document, query.audiences ?? []);
}

function pageBounds(query: SearchQuery): { readonly offset: number; readonly limit: number } | string {
  const limit = query.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return `limit must be an integer from 1 to ${MAX_LIMIT}`;
  const cursor = query.cursor ?? '0';
  if (!/^\d+$/.test(cursor)) return 'cursor is not a cursor of this provider';
  return { offset: Number(cursor), limit };
}

/** 0 unless every query term matches some word (AND semantics); title words weigh double. */
function scoreOf(document: SearchDocument, required: { readonly termMatchers: readonly ((word: string) => boolean)[]; readonly matches: (word: string) => boolean }): number {
  const titleWords = words(document.title);
  const bodyWords = words(document.body);
  const all = [...titleWords, ...bodyWords];
  if (!required.termMatchers.every(matcher => all.some(matcher))) return 0;
  return titleWords.filter(required.matches).length * 2 + bodyWords.filter(required.matches).length;
}

function hitOf(document: SearchDocument, score: number, matches: (word: string) => boolean): SearchHit {
  const { snippet, highlights } = snippetOf({ body: document.body, matches });
  return { key: document.key, revision: document.revision, url: document.url, title: document.title, snippet, highlights, score };
}

function runQuery(index: Index, query: SearchQuery, typoTolerance: boolean): ProviderResult<SearchPage> {
  const terms = words(query.text);
  if (terms.length === 0) return providerRejected({ code: 'invalid_request', message: 'query text must not be empty' });
  const bounds = pageBounds(query);
  if (typeof bounds === 'string') return providerRejected({ code: 'invalid_request', message: bounds });
  const matches = makeMatcher({ terms, typoTolerance });
  const termMatchers = terms.map(term => makeMatcher({ terms: [term], typoTolerance }));
  const ranked = [...index.entries()]
    .flatMap(([encoded, entry]) => entry.document !== undefined && passesFilters(entry.document, query) ? [{ encoded, document: entry.document, score: scoreOf(entry.document, { termMatchers, matches }) }] : [])
    .filter(candidate => candidate.score > 0)
    // Score first, then the encoded key: a total order, so cursors over offsets are stable.
    .sort((a, b) => b.score - a.score || (a.encoded < b.encoded ? -1 : 1));
  const end = bounds.offset + bounds.limit;
  const hits = ranked.slice(bounds.offset, end).map(candidate => hitOf(candidate.document, candidate.score, matches));
  return providerOk({ value: end < ranked.length ? { hits, nextCursor: String(end) } : { hits } });
}

const isRevision = (revision: unknown): boolean => typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;

function resolveOptions(optional: InMemorySearchProviderOptions) {
  const {
    id = 'memory', label = 'In-memory reference provider', acceptsRestricted = true, asyncIndexing = false,
    typoTolerance = false, locales = 'any', maxBatch = 100, available = () => true,
  } = optional;
  return { id, label, acceptsRestricted, asyncIndexing, typoTolerance, locales, maxBatch, available };
}

/**
 * The reference provider. Case-insensitive word matching over title + body (every query word must
 * match), plain-text snippet windows with highlight ranges, versioned tombstones, cursor = offset.
 * With `asyncIndexing`, a non-stale write answers `pending` with a task id and becomes visible only
 * when that task (and every earlier one) is settled by the next `awaitTask` call.
 * @complexity Writes O(batch); queries O(documents in the index × words).
 */
export function createInMemorySearchProvider(_required: Record<string, never> = {}, optional: InMemorySearchProviderOptions = {}): SearchProvider {
  const { id, label, acceptsRestricted, asyncIndexing, typoTolerance, locales, maxBatch, available } = resolveOptions(optional);
  const indexes = new Map<string, Index>();
  const queued = new Map<string, QueuedTask>();
  const settled = new Set<string>();
  let taskCounter = 0;
  const capabilities: SearchCapabilities = { acceptsRestricted, typoTolerance, locales, maxBatch, asyncIndexing };

  const unavailable = () => providerUnknown<never>({ code: 'provider_unavailable', message: 'the in-memory provider is unavailable for this context' });
  const missing = (indexName: string) => providerRejected<never>({ code: 'not_found', message: `index '${indexName}' does not exist` });

  const store = (index: Index, entry: Entry): boolean => {
    const encoded = encodeSearchKey({ key: entry.key });
    const current = index.get(encoded);
    if (current !== undefined && current.revision >= entry.revision) return false;
    index.set(encoded, entry);
    return true;
  };

  const restrictedRefusal = (entry: Entry): string | undefined =>
    !acceptsRestricted && entry.document?.visibility.kind === 'restricted' ? 'this provider accepts public documents only' : undefined;

  function outcomeOf(index: Index, entry: Entry, pending: Entry[]): SearchWriteOutcome {
    const base = { key: entry.key, revision: entry.revision };
    const refusal = isRevision(entry.revision) ? restrictedRefusal(entry) : 'revision must be a non-negative safe integer';
    if (refusal !== undefined) return { ...base, status: 'rejected', message: refusal };
    const current = index.get(encodeSearchKey({ key: entry.key }));
    if (current !== undefined && current.revision >= entry.revision) return { ...base, status: 'stale' };
    if (!asyncIndexing) {
      store(index, entry);
      return { ...base, status: 'applied' };
    }
    pending.push(entry);
    return { ...base, status: 'pending' };
  }

  function write(ctx: SearchProviderContext, entries: readonly Entry[]): ProviderResult<SearchWriteResult> {
    if (!available({ ctx })) return unavailable();
    if (entries.length > maxBatch) return providerRejected({ code: 'invalid_request', message: `at most ${maxBatch} items per write` });
    const index = indexes.get(ctx.indexName);
    if (index === undefined) return missing(ctx.indexName);
    const pending: Entry[] = [];
    const outcomes = entries.map(entry => outcomeOf(index, entry, pending));
    if (pending.length === 0) return providerOk({ value: { outcomes } });
    taskCounter += 1;
    const taskId = `task_${taskCounter}`;
    queued.set(taskId, { indexName: ctx.indexName, entries: pending });
    return providerOk({ value: { outcomes, taskId } });
  }

  /** Settle every queued task up to and including `taskId`, in write order. */
  function settleThrough(taskId: string): void {
    const ids = [...queued.keys()];
    // awaitTask calls this only when `taskId` is queued, so indexOf is never -1.
    for (const queuedId of ids.slice(0, ids.indexOf(taskId) + 1)) {
      const task = queued.get(queuedId) as QueuedTask;
      const index = indexes.get(task.indexName);
      // A task whose index was dropped meanwhile has nothing left to write into.
      if (index !== undefined) for (const entry of task.entries) store(index, entry);
      queued.delete(queuedId);
      settled.add(queuedId);
    }
  }

  async function guarded<T>(ctx: SearchProviderContext, run: (index: Index) => ProviderResult<T>): Promise<ProviderResult<T>> {
    if (!available({ ctx })) return unavailable();
    const index = indexes.get(ctx.indexName);
    return index === undefined ? missing(ctx.indexName) : run(index);
  }

  const provider: SearchProvider = {
    id, label, capabilities, credentialKeys: [],
    async ensureIndex(ctx) {
      if (!available({ ctx })) return unavailable();
      if (!indexes.has(ctx.indexName)) indexes.set(ctx.indexName, new Map());
      return providerOk({ value: undefined });
    },
    async dropIndex(ctx) {
      if (!available({ ctx })) return unavailable();
      indexes.delete(ctx.indexName);
      return providerOk({ value: undefined });
    },
    async upsert(ctx, { documents }) {
      return write(ctx, documents.map(document => ({ key: document.key, revision: document.revision, document })));
    },
    async remove(ctx, { tombstones }) {
      return write(ctx, tombstones.map((tombstone: SearchTombstone) => ({ key: tombstone.key, revision: tombstone.revision })));
    },
    async query(ctx, { query }) {
      return guarded(ctx, index => runQuery(index, query, typoTolerance));
    },
    async revisionOf(ctx, { keys }) {
      return guarded(ctx, index => providerOk({
        value: keys.map((key): SearchRevisionState => {
          const entry = index.get(encodeSearchKey({ key }));
          return entry === undefined ? { key, revision: null, deleted: false } : { key, revision: entry.revision, deleted: entry.document === undefined };
        }),
      }));
    },
  };
  if (!asyncIndexing) return provider;
  return {
    ...provider,
    async awaitTask(ctx, { taskId }): Promise<ProviderResult<SearchTaskState>> {
      if (!available({ ctx })) return unavailable();
      if (queued.has(taskId)) settleThrough(taskId);
      if (settled.has(taskId)) return providerOk({ value: 'succeeded' });
      return providerRejected({ code: 'not_found', message: `task '${taskId}' is not known` });
    },
  };
}
