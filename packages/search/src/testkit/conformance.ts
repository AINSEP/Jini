/**
 * @file `runSearchProviderConformance`: the one behavioral bar every search provider (the owner's
 * built-in, every vendor plugin, the in-memory reference) must clear unchanged.
 *
 * The test runner is injected (`test(title, fn)`), so the kit runs under vitest, node:test or jest
 * and imports none of them. Each case is its own test with its own index name, which it drops and
 * re-creates first, so cases are independent and re-runnable against a persistent backend.
 *
 * Async completion seam: for a provider declaring `capabilities.asyncIndexing`, every write that
 * answers `pending` is settled through `awaitTask` (bounded by `maxAwaitPolls`) before anything is
 * read, so the same cases hold for synchronous and task-based backends.
 */
import type { ProviderResult } from '@jini-ai/core/provider-registry';
import {
  encodeSearchKey,
  type SearchDocument, type SearchDocumentKey, type SearchPage, type SearchProvider, type SearchProviderContext,
  type SearchQuery, type SearchRevisionState, type SearchTombstone, type SearchVisibility, type SearchWriteOutcome,
  type SearchWriteResult, type SearchWriteStatus,
} from '../contract.js';
import { validateSearchProvider } from '../registry.js';
import { check, SearchConformanceError } from './assert.js';

/** A test registrar: `vitest`'s or `node:test`'s `test`, or any `(title, fn) => void`. */
export type ConformanceTestRegistrar = (title: string, fn: () => Promise<void>) => unknown;

export type ConformanceContextFactory = (required: { readonly siteId: string; readonly indexName: string }) => SearchProviderContext | Promise<SearchProviderContext>;

export interface SearchProviderConformanceRequired {
  /** Prefixes every test title and index name. */
  readonly name: string;
  /** Synchronous: capabilities decide which cases are registered, before any test runs. */
  readonly makeProvider: () => SearchProvider;
  /** A fresh, working context for the given site and index name. */
  readonly makeContext: ConformanceContextFactory;
  readonly test: ConformanceTestRegistrar;
}

export interface SearchProviderConformanceOptional {
  /** A context under which the backend is unreachable (e.g. built on `createUnavailableHttpClient`). */
  readonly makeUnavailableContext?: ConformanceContextFactory;
  /** `awaitTask` polls per pending write before the kit gives up. */
  readonly maxAwaitPolls?: number;
}

const WORKSPACE = 'ws_conformance';
const SITE_A = 'site_a';
const SITE_B = 'site_b';
/** A word no case uses elsewhere, so `text: TERM` matches exactly the documents a case wrote. */
const TERM = 'zephyrine';

type Status = SearchWriteStatus;

interface Session {
  readonly provider: SearchProvider;
  /** A fresh (dropped, then ensured) index for this case. */
  readonly open: (required: { readonly suffix: string; readonly siteId?: string }) => Promise<SearchProviderContext>;
  readonly upsert: (ctx: SearchProviderContext, documents: readonly SearchDocument[]) => Promise<readonly SearchWriteOutcome[]>;
  readonly remove: (ctx: SearchProviderContext, tombstones: readonly SearchTombstone[]) => Promise<readonly SearchWriteOutcome[]>;
  readonly search: (ctx: SearchProviderContext, query: Omit<SearchQuery, 'text'> & { readonly text?: string }) => Promise<SearchPage>;
  readonly revisions: (ctx: SearchProviderContext, keys: readonly SearchDocumentKey[]) => Promise<readonly SearchRevisionState[]>;
  /** Status sets a write may report; `pending` is added for async providers (settled by the kit). */
  readonly applied: readonly Status[];
  readonly stale: readonly Status[];
}

type Case = readonly [title: string, run: (session: Session) => Promise<void>];

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Every provider call goes through here: a provider that throws fails with a clear message. */
async function attempt<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new SearchConformanceError(`${label} threw instead of returning a result: ${messageOf(error)}`);
  }
}

const describe = (result: ProviderResult<unknown>): string =>
  result.status === 'ok' ? 'ok' : `${result.status} (${result.error.code}: ${result.error.message})`;

function expectOk<T>(result: ProviderResult<T>, label: string): T {
  check(result.status === 'ok', `${label} returned ${describe(result)}, expected ok`);
  return result.value;
}

const keyText = (key: SearchDocumentKey): string => encodeSearchKey({ key });
const keyOf = (documentId: string, optional: { readonly siteId?: string; readonly collection?: string } = {}): SearchDocumentKey =>
  ({ siteId: optional.siteId ?? SITE_A, workspaceId: WORKSPACE, collection: optional.collection ?? 'post', documentId });

interface DocInput {
  readonly key: SearchDocumentKey;
  readonly revision: number;
  readonly title: string;
  readonly locale?: string;
  readonly visibility?: SearchVisibility;
}

function doc(input: DocInput): SearchDocument {
  return {
    key: input.key, revision: input.revision, url: `/${input.key.collection}/${input.key.documentId}`, title: input.title,
    body: `The ${TERM} document ${input.key.documentId} is plain text written by the search conformance kit.`,
    visibility: input.visibility ?? { kind: 'public' }, ...(input.locale === undefined ? {} : { locale: input.locale }),
  };
}

function checkOutcomes(outcomes: readonly SearchWriteOutcome[], inputs: readonly { readonly key: SearchDocumentKey; readonly revision: number }[], label: string): void {
  check(outcomes.length === inputs.length, `${label} reported ${outcomes.length} outcomes for ${inputs.length} inputs`);
  inputs.forEach((input, index) => {
    const outcome = outcomes[index] as SearchWriteOutcome;
    check(keyText(outcome.key) === keyText(input.key) && outcome.revision === input.revision,
      `${label} outcome ${index} is for ${keyText(outcome.key)}@${outcome.revision}, expected ${keyText(input.key)}@${input.revision} (one outcome per input, in input order)`);
  });
}

function checkPage(page: SearchPage, limit: number): void {
  check(page.hits.length <= limit, `query returned ${page.hits.length} hits for limit ${limit}`);
  for (const hit of page.hits) {
    // The kit never writes '<', so any '<' in a snippet is markup the provider injected.
    check(!hit.snippet.includes('<'), `snippet of ${keyText(hit.key)} contains markup: ${hit.snippet}`);
    for (const { start, end } of hit.highlights) {
      const integral = Number.isInteger(start) && Number.isInteger(end);
      check(integral && start >= 0 && start < end && end <= hit.snippet.length,
        `highlight ${start}..${end} of ${keyText(hit.key)} is outside its ${hit.snippet.length}-char snippet`);
    }
  }
}

/** Checks the first outcome of a one-item write (checkOutcomes already guaranteed it exists). */
function checkStatus(outcomes: readonly SearchWriteOutcome[], allowed: readonly Status[], label: string): void {
  const { status } = outcomes[0] as SearchWriteOutcome;
  check(allowed.includes(status), `${label} reported '${status}', expected one of ${allowed.join('|')}`);
}

const hitKeys = (page: SearchPage): readonly string[] => page.hits.map(hit => keyText(hit.key));
const hitFor = (page: SearchPage, key: SearchDocumentKey) => page.hits.find(hit => keyText(hit.key) === keyText(key));

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

function createSession(required: SearchProviderConformanceRequired & { readonly caseId: string; readonly maxAwaitPolls: number }): Session {
  const provider = required.makeProvider();
  const { asyncIndexing, maxBatch } = provider.capabilities;
  const base = `conformance_${required.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${required.caseId}`;

  async function settle(ctx: SearchProviderContext, value: SearchWriteResult, label: string): Promise<void> {
    if (!value.outcomes.some(outcome => outcome.status === 'pending')) return;
    check(asyncIndexing && typeof provider.awaitTask === 'function', `${label} answered pending, but the provider does not declare asyncIndexing with an awaitTask`);
    check(typeof value.taskId === 'string', `${label} answered pending without a taskId`);
    const { taskId } = value;
    const awaitTask = provider.awaitTask;
    for (let poll = 0; poll < required.maxAwaitPolls; poll += 1) {
      const state = expectOk(await attempt('awaitTask', () => awaitTask.call(provider, ctx, { taskId })), 'awaitTask');
      check(state !== 'failed', `task ${taskId} of ${label} failed`);
      if (state === 'succeeded') return;
    }
    check(false, `task ${taskId} of ${label} was still pending after ${required.maxAwaitPolls} polls`);
  }

  async function write<I extends { readonly key: SearchDocumentKey; readonly revision: number }>(
    ctx: SearchProviderContext, items: readonly I[], label: string, send: (chunk: readonly I[]) => Promise<ProviderResult<SearchWriteResult>>,
  ): Promise<readonly SearchWriteOutcome[]> {
    const outcomes: SearchWriteOutcome[] = [];
    for (const chunk of chunks(items, maxBatch)) {
      const value = expectOk(await attempt(label, () => send(chunk)), label);
      checkOutcomes(value.outcomes, chunk, label);
      await settle(ctx, value, label);
      outcomes.push(...value.outcomes);
    }
    return outcomes;
  }

  return {
    provider,
    applied: asyncIndexing ? ['applied', 'pending'] : ['applied'],
    // An async backend may only compare revisions when its task runs; the case then asserts the
    // observable result (nothing changed) after the task settled.
    stale: asyncIndexing ? ['stale', 'pending'] : ['stale'],
    async open({ suffix, siteId = SITE_A }) {
      const ctx = await required.makeContext({ siteId, indexName: `${base}_${suffix}` });
      expectOk(await attempt('dropIndex', () => provider.dropIndex(ctx)), 'dropIndex (fresh index)');
      expectOk(await attempt('ensureIndex', () => provider.ensureIndex(ctx)), 'ensureIndex');
      return ctx;
    },
    upsert: (ctx, documents) => write(ctx, documents, 'upsert', chunk => provider.upsert(ctx, { documents: chunk })),
    remove: (ctx, tombstones) => write(ctx, tombstones, 'remove', chunk => provider.remove(ctx, { tombstones: chunk })),
    async search(ctx, query) {
      const page = expectOk(await attempt('query', () => provider.query(ctx, { query: { text: TERM, ...query } })), 'query');
      checkPage(page, query.limit ?? 10);
      return page;
    },
    async revisions(ctx, keys) {
      const states = expectOk(await attempt('revisionOf', () => provider.revisionOf(ctx, { keys })), 'revisionOf');
      check(states.length === keys.length, `revisionOf returned ${states.length} states for ${keys.length} keys`);
      return states;
    },
  };
}

// --------------------------------------------------------------------------------------------
// Cases
// --------------------------------------------------------------------------------------------

async function shapeCase({ provider }: Session): Promise<void> {
  const reason = validateSearchProvider({ provider });
  check(reason === undefined, `the provider shape is invalid: ${reason}`);
}

async function findCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const document = doc({ key: keyOf('hello'), revision: 1, title: 'Hello conformance' });
  checkStatus(await s.upsert(ctx, [document]), s.applied, 'upsert of a new document');
  const hit = hitFor(await s.search(ctx, {}), document.key);
  check(hit !== undefined, 'an upserted document is not found by a query for a word of its body');
  check(hit.title === document.title && hit.url === document.url && hit.revision === 1, `hit ${JSON.stringify(hit)} does not carry the document's title, url and revision`);
  check(hit.snippet.length > 0, 'the hit of a document with a body has an empty snippet');
}

async function newerReplacesCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const key = keyOf('versioned');
  await s.upsert(ctx, [doc({ key, revision: 1, title: 'First title' })]);
  checkStatus(await s.upsert(ctx, [doc({ key, revision: 2, title: 'Second title' })]), s.applied, 'upsert of a newer revision');
  const page = await s.search(ctx, {});
  check(page.hits.length === 1, `expected exactly one hit after replacing a document, got ${page.hits.length}`);
  check(page.hits[0]?.title === 'Second title' && page.hits[0].revision === 2, 'a newer revision did not replace the older one');
}

async function staleCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const key = keyOf('kept');
  await s.upsert(ctx, [doc({ key, revision: 5, title: 'Kept title' })]);
  checkStatus(await s.upsert(ctx, [doc({ key, revision: 5, title: 'Equal title' })]), s.stale, 'upsert of an equal revision');
  checkStatus(await s.upsert(ctx, [doc({ key, revision: 3, title: 'Older title' })]), s.stale, 'upsert of an older revision');
  const hit = hitFor(await s.search(ctx, {}), key);
  check(hit?.title === 'Kept title' && hit.revision === 5, 'an equal or older revision changed the indexed document');
}

async function removeCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const key = keyOf('removed');
  await s.upsert(ctx, [doc({ key, revision: 1, title: 'Soon removed' })]);
  checkStatus(await s.remove(ctx, [{ key, revision: 2 }]), s.applied, 'remove at a newer revision');
  check(hitFor(await s.search(ctx, {}), key) === undefined, 'a removed document is still returned');
}

async function neverIndexedRemoveCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const key = keyOf('ghost');
  checkStatus(await s.remove(ctx, [{ key, revision: 5 }]), [...s.applied, 'stale'], 'remove of a never-indexed key');
  checkStatus(await s.upsert(ctx, [doc({ key, revision: 3, title: 'Resurrected' })]), s.stale, 'upsert below a tombstone revision');
  check(hitFor(await s.search(ctx, {}), key) === undefined, 'an upsert with a lower revision than its tombstone resurrected the document');
  checkStatus(await s.upsert(ctx, [doc({ key, revision: 6, title: 'Revived' })]), s.applied, 'upsert above a tombstone revision');
  check(hitFor(await s.search(ctx, {}), key)?.revision === 6, 'an upsert with a higher revision than its tombstone did not revive the document');
}

async function draftCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const drafted = keyOf('drafted');
  const live = keyOf('live');
  await s.upsert(ctx, [doc({ key: drafted, revision: 1, title: 'Unpublished later' }), doc({ key: live, revision: 1, title: 'Stays published' })]);
  await s.remove(ctx, [{ key: drafted, revision: 2 }]);
  const keys = hitKeys(await s.search(ctx, {}));
  check(!keys.includes(keyText(drafted)) && keys.includes(keyText(live)), 'moving a published document back to draft did not remove only that document');
}

async function restrictedCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const open = keyOf('open');
  const members = keyOf('members_only');
  await s.upsert(ctx, [
    doc({ key: open, revision: 1, title: 'Open to all' }),
    doc({ key: members, revision: 1, title: 'Members only', visibility: { kind: 'restricted', audiences: ['members'] } }),
  ]);
  for (const audiences of [undefined, ['guests']]) {
    const keys = hitKeys(await s.search(ctx, audiences === undefined ? {} : { audiences }));
    check(keys.includes(keyText(open)) && !keys.includes(keyText(members)), `a restricted document was returned to audiences ${JSON.stringify(audiences ?? [])}`);
  }
  check(hitKeys(await s.search(ctx, { audiences: ['members'] })).includes(keyText(members)), 'a restricted document was not returned to its own audience');
}

/**
 * The indexer never sends restricted documents to a provider without `acceptsRestricted` (it turns
 * them into removals). This case sends one anyway, as defense in depth: a public-only backend may
 * refuse it or ignore it, but must never return it, with or without the matching audience.
 */
async function publicOnlyCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const open = keyOf('open');
  const members = keyOf('members_only');
  await s.upsert(ctx, [doc({ key: open, revision: 1, title: 'Open to all' })]);
  await s.upsert(ctx, [doc({ key: members, revision: 1, title: 'Members only', visibility: { kind: 'restricted', audiences: ['members'] } })]);
  for (const audiences of [[], ['members']]) {
    const keys = hitKeys(await s.search(ctx, { audiences }));
    check(keys.includes(keyText(open)) && !keys.includes(keyText(members)), `a public-only provider returned restricted content to audiences ${JSON.stringify(audiences)}`);
  }
}

async function indexIsolationCase(s: Session): Promise<void> {
  const contexts = [
    { ctx: await s.open({ suffix: 'a' }), key: keyOf('shared'), title: 'Alpha copy' },
    { ctx: await s.open({ suffix: 'b' }), key: keyOf('shared'), title: 'Beta copy' },
    { ctx: await s.open({ suffix: 'c', siteId: SITE_B }), key: keyOf('shared', { siteId: SITE_B }), title: 'Gamma copy' },
  ];
  for (const { ctx, key, title } of contexts) await s.upsert(ctx, [doc({ key, revision: 1, title })]);
  const first = contexts[0] as (typeof contexts)[number];
  await s.remove(first.ctx, [{ key: first.key, revision: 2 }]);
  check((await s.search(first.ctx, {})).hits.length === 0, 'a removal did not apply in its own index');
  for (const { ctx, title } of contexts.slice(1)) {
    const titles = (await s.search(ctx, {})).hits.map(hit => hit.title);
    check(titles.length === 1 && titles[0] === title, `index ${ctx.indexName} returned ${JSON.stringify(titles)}, expected only '${title}' (indexes or sites crossed)`);
  }
}

function localeCase(locales: readonly string[]): (s: Session) => Promise<void> {
  return async s => {
    const ctx = await s.open({ suffix: 'x' });
    await s.upsert(ctx, locales.map(locale => doc({ key: keyOf(`doc_${locale}`), revision: 1, title: `Localized ${locale}`, locale })));
    for (const locale of locales) {
      const keys = hitKeys(await s.search(ctx, { locale }));
      check(keys.length === 1 && keys[0] === keyText(keyOf(`doc_${locale}`)), `locale '${locale}' returned ${JSON.stringify(keys)}`);
    }
  };
}

async function collectionsCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const post = keyOf('item', { collection: 'post' });
  const page = keyOf('item', { collection: 'page' });
  await s.upsert(ctx, [doc({ key: post, revision: 1, title: 'A post' }), doc({ key: page, revision: 1, title: 'A page' })]);
  for (const key of [post, page]) {
    const keys = hitKeys(await s.search(ctx, { collections: [key.collection] }));
    check(keys.length === 1 && keys[0] === keyText(key), `collection '${key.collection}' returned ${JSON.stringify(keys)}`);
  }
}

async function paginationCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const keys = ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => keyOf(id));
  await s.upsert(ctx, keys.map(key => doc({ key, revision: 1, title: `Paged ${key.documentId}` })));
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await s.search(ctx, { limit: 2, ...(cursor === undefined ? {} : { cursor }) });
    seen.push(...hitKeys(page));
    cursor = page.nextCursor;
    pages += 1;
    check(pages <= keys.length, 'pagination never ended (nextCursor on every page)');
  } while (cursor !== undefined);
  check(seen.length === keys.length && new Set(seen).size === keys.length && keys.every(key => seen.includes(keyText(key))),
    `pages returned ${JSON.stringify(seen)}, expected each of the ${keys.length} documents exactly once`);
  const again = hitKeys(await s.search(ctx, { limit: 2 }));
  check(JSON.stringify(again) === JSON.stringify(seen.slice(0, 2)), 'the first page is not stable across identical queries');
}

async function emptyTextCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  for (const text of ['', '   ']) {
    const result = await attempt('query', () => s.provider.query(ctx, { query: { text } }));
    check(result.status === 'rejected' && result.error.code === 'invalid_request', `query text ${JSON.stringify(text)} returned ${describe(result)}, expected rejected (invalid_request)`);
  }
}

async function revisionOfCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const [absent, live, gone] = [keyOf('absent'), keyOf('live'), keyOf('gone')];
  await s.upsert(ctx, [doc({ key: live, revision: 3, title: 'Live' }), doc({ key: gone, revision: 1, title: 'Gone' })]);
  await s.remove(ctx, [{ key: gone, revision: 4 }]);
  const states = await s.revisions(ctx, [absent, live, gone]);
  const expected = [[absent, null, false], [live, 3, false], [gone, 4, true]] as const;
  for (const [key, revision, deleted] of expected) {
    const state = states.find(candidate => keyText(candidate.key) === keyText(key));
    check(state?.revision === revision && state.deleted === deleted, `revisionOf(${keyText(key)}) is ${JSON.stringify(state)}, expected revision ${revision}, deleted ${deleted}`);
  }
}

async function dropIndexCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  await s.upsert(ctx, [doc({ key: keyOf('dropped'), revision: 1, title: 'Dropped with its index' })]);
  expectOk(await attempt('dropIndex', () => s.provider.dropIndex(ctx)), 'dropIndex');
  const result = await attempt('query', () => s.provider.query(ctx, { query: { text: TERM } }));
  const answered = result.status === 'ok' ? `${result.value.hits.length} hits` : describe(result);
  check(result.status === 'ok' ? result.value.hits.length === 0 : result.status === 'rejected' && result.error.code === 'not_found',
    `query of a dropped index returned ${answered}, expected no hits or rejected (not_found)`);
}

async function typoCase(s: Session): Promise<void> {
  const ctx = await s.open({ suffix: 'x' });
  const key = keyOf('typo');
  await s.upsert(ctx, [doc({ key, revision: 1, title: 'Elephant sanctuary' })]);
  check(hitFor(await s.search(ctx, { text: 'elephnt' }), key) !== undefined, 'a one-edit typo did not match although the provider declares typoTolerance');
}

function unavailableCase(makeUnavailableContext: ConformanceContextFactory): (s: Session) => Promise<void> {
  return async ({ provider }) => {
    const ctx = await makeUnavailableContext({ siteId: SITE_A, indexName: 'conformance_unavailable' });
    const key = keyOf('unreachable');
    const calls: [string, () => Promise<ProviderResult<unknown>>][] = [
      ['ensureIndex', () => provider.ensureIndex(ctx)],
      ['dropIndex', () => provider.dropIndex(ctx)],
      ['upsert', () => provider.upsert(ctx, { documents: [doc({ key, revision: 1, title: 'Unreachable' })] })],
      ['remove', () => provider.remove(ctx, { tombstones: [{ key, revision: 2 }] })],
      ['query', () => provider.query(ctx, { query: { text: TERM } })],
      ['revisionOf', () => provider.revisionOf(ctx, { keys: [key] })],
    ];
    const { awaitTask } = provider;
    if (awaitTask !== undefined) calls.push(['awaitTask', () => awaitTask.call(provider, ctx, { taskId: 'task_unreachable' })]);
    for (const [label, call] of calls) {
      const result = await attempt(label, call);
      check(result.status === 'unknown', `${label} returned ${describe(result)} while the backend is unavailable, expected unknown`);
    }
  };
}

function casesFor(provider: SearchProvider, optional: SearchProviderConformanceOptional): Case[] {
  const { acceptsRestricted, typoTolerance, locales } = provider.capabilities;
  const testLocales = locales === 'any' ? ['en', 'fr'] : locales.slice(0, 2);
  const cases: Case[] = [
    ['has a valid provider shape', shapeCase],
    ['upsert then query finds the document', findCase],
    ['a newer revision replaces the document', newerReplacesCase],
    ['an equal or older revision is stale and changes nothing', staleCase],
    ['remove makes the document absent', removeCase],
    ['removing a never-indexed key leaves a tombstone that blocks lower revisions', neverIndexedRemoveCase],
    ['published then draft (tombstone) removes it from queries', draftCase],
    acceptsRestricted
      ? ['restricted documents reach only their audience', restrictedCase]
      : ['a public-only provider never returns restricted documents', publicOnlyCase],
    ['indexes and sites never cross', indexIsolationCase],
    ['collections filter', collectionsCase],
    ['limit and cursor pagination is stable and non-overlapping', paginationCase],
    ['empty or whitespace query text is rejected as invalid_request', emptyTextCase],
    ['revisionOf agrees with the last write', revisionOfCase],
    ['dropIndex removes everything in the index', dropIndexCase],
  ];
  if (testLocales.length > 0) cases.push(['locale filter', localeCase(testLocales)]);
  if (typoTolerance) cases.push(['tolerates a one-edit typo', typoCase]);
  if (optional.makeUnavailableContext !== undefined) cases.push(['an unavailable backend answers unknown and never throws', unavailableCase(optional.makeUnavailableContext)]);
  return cases;
}

/**
 * Register the conformance cases for one provider with the injected test runner.
 * @param required.makeProvider - Called once to read capabilities, then once per case.
 * @param optional.makeUnavailableContext - Enables the unavailable-backend case.
 * @param optional.maxAwaitPolls - Default 20.
 * @returns The registered test titles, in order.
 * @complexity O(cases) registrations; each case does a bounded number of provider calls.
 */
export function runSearchProviderConformance(required: SearchProviderConformanceRequired, optional: SearchProviderConformanceOptional = {}): readonly string[] {
  const { maxAwaitPolls = 20 } = optional;
  const titles: string[] = [];
  casesFor(required.makeProvider(), optional).forEach(([title, run], index) => {
    const full = `${required.name} › ${title}`;
    titles.push(full);
    required.test(full, () => run(createSession({ ...required, caseId: `c${index}`, maxAwaitPolls })));
  });
  return titles;
}
