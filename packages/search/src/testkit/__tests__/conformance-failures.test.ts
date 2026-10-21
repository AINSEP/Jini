/**
 * The kit is only worth something if it FAILS broken providers. Each test wraps the reference
 * provider with one deliberate defect, collects the kit's registrations with a fake `test`, runs
 * the one case that must catch it, and asserts it rejects with the case's message.
 */
import { describe, expect, test } from 'vitest';
import { providerOk, providerRejected, providerUnknown } from '@jini-ai/core/provider-registry';
import type { SearchDocument, SearchProvider, SearchProviderContext, SearchWriteResult } from '../../contract.js';
import { runSearchProviderConformance, type SearchProviderConformanceOptional } from '../conformance.js';
import { createInMemorySearchProvider, type InMemorySearchProviderOptions } from '../memory-provider.js';
import { memoryContext } from './helpers.js';

type Override = (base: SearchProvider) => Partial<SearchProvider>;

const broken = (override: Override, options: InMemorySearchProviderOptions = {}) => (): SearchProvider => {
  const base = createInMemorySearchProvider({}, options);
  return { ...base, ...override(base) };
};

async function runCase(makeProvider: () => SearchProvider, title: string, optional: SearchProviderConformanceOptional = {}): Promise<void> {
  const registered = new Map<string, () => Promise<void>>();
  runSearchProviderConformance({ name: 'broken', makeProvider, makeContext: input => memoryContext(input), test: (name, fn) => { registered.set(name, fn); } }, optional);
  const run = registered.get(`broken › ${title}`);
  if (run === undefined) throw new Error(`case '${title}' was not registered: ${[...registered.keys()].join(', ')}`);
  await run();
}

const FIND = 'upsert then query finds the document';
const PAGINATION = 'limit and cursor pagination is stable and non-overlapping';
const ok = <T>(value: T) => Promise.resolve(providerOk({ value }));
const pageOf = async (base: SearchProvider, ctx: SearchProviderContext, query: Parameters<SearchProvider['query']>[1]) => {
  const result = await base.query(ctx, query);
  if (result.status !== 'ok') throw new Error('fixture expects ok');
  return result.value;
};
const publicCopy = (documents: readonly SearchDocument[]): SearchDocument[] => documents.map(document => ({ ...document, visibility: { kind: 'public' } }));
/** Applies the write, then rewrites what it reports. */
const rewriteUpsert = (base: SearchProvider, rewrite: (value: SearchWriteResult) => SearchWriteResult): Partial<SearchProvider> => ({
  async upsert(ctx, required) {
    const result = await base.upsert(ctx, required);
    return result.status === 'ok' ? providerOk({ value: rewrite(result.value) }) : result;
  },
});

describe('calls that throw', () => {
  test('a query that throws an Error', async () => {
    await expect(runCase(broken(() => ({ query: async () => { throw new Error('kaput'); } })), FIND)).rejects.toThrow('query threw instead of returning a result: kaput');
  });
  test('an upsert that throws a non-Error', async () => {
    await expect(runCase(broken(() => ({ upsert: async () => { throw 'nope'; } })), FIND)).rejects.toThrow('upsert threw instead of returning a result: nope');
  });
  test('an awaitTask that throws', async () => {
    await expect(runCase(broken(() => ({ awaitTask: async () => { throw new Error('lost'); } }), { asyncIndexing: true }), FIND)).rejects.toThrow('awaitTask threw');
  });
});

describe('shape and index lifecycle', () => {
  test('an invalid provider shape', async () => {
    await expect(runCase(broken(() => ({ label: '' })), 'has a valid provider shape')).rejects.toThrow('the provider shape is invalid: label must be a non-empty string');
  });
  test('ensureIndex that is not ok', async () => {
    await expect(runCase(broken(() => ({ ensureIndex: async () => providerUnknown({ code: 'timeout', message: 'slow' }) })), FIND)).rejects.toThrow('ensureIndex returned unknown (timeout: slow), expected ok');
  });
  test('dropIndex that refuses', async () => {
    await expect(runCase(broken(() => ({ dropIndex: async () => providerRejected({ code: 'forbidden', message: 'no' }) })), FIND)).rejects.toThrow('dropIndex (fresh index) returned rejected');
  });
  test('dropIndex that leaves documents behind', async () => {
    await expect(runCase(broken(() => ({ dropIndex: async () => providerOk({ value: undefined }) })), 'dropIndex removes everything in the index'))
      .rejects.toThrow('query of a dropped index returned 1 hits');
  });
  test('a dropped index may also answer ok with no hits', async () => {
    const tolerant = broken(base => ({
      async query(ctx, required) {
        const result = await base.query(ctx, required);
        return result.status === 'rejected' && result.error.code === 'not_found' ? providerOk({ value: { hits: [] } }) : result;
      },
    }));
    await expect(runCase(tolerant, 'dropIndex removes everything in the index')).resolves.toBeUndefined();
  });
  test('a dropped index answering another refusal', async () => {
    const wrong = broken(base => ({
      async query(ctx, required) {
        const result = await base.query(ctx, required);
        return result.status === 'rejected' ? providerRejected({ code: 'forbidden', message: 'gone' }) : result;
      },
    }));
    await expect(runCase(wrong, 'dropIndex removes everything in the index')).rejects.toThrow('returned rejected (forbidden: gone), expected no hits or rejected (not_found)');
  });
});

describe('write outcomes', () => {
  test('an upsert that is refused', async () => {
    await expect(runCase(broken(() => ({ upsert: async () => providerRejected({ code: 'quota_exceeded', message: 'full' }) })), FIND)).rejects.toThrow('upsert returned rejected (quota_exceeded: full)');
  });
  test('the wrong number of outcomes', async () => {
    await expect(runCase(broken(base => rewriteUpsert(base, () => ({ outcomes: [] }))), FIND)).rejects.toThrow('upsert reported 0 outcomes for 1 inputs');
  });
  test('outcomes out of input order', async () => {
    const reversed = broken(base => rewriteUpsert(base, value => ({ outcomes: [...value.outcomes].reverse() })));
    await expect(runCase(reversed, PAGINATION)).rejects.toThrow('one outcome per input, in input order');
  });
  test('an outcome with the wrong revision', async () => {
    const shifted = broken(base => rewriteUpsert(base, value => ({ outcomes: value.outcomes.map(outcome => ({ ...outcome, revision: outcome.revision + 1 })) })));
    await expect(runCase(shifted, FIND)).rejects.toThrow('outcome 0 is for');
  });
  test('pending from a provider that does not declare asyncIndexing', async () => {
    const pending = broken(base => rewriteUpsert(base, value => ({ outcomes: value.outcomes.map(outcome => ({ ...outcome, status: 'pending' })), taskId: 't' })));
    await expect(runCase(pending, FIND)).rejects.toThrow('answered pending, but the provider does not declare asyncIndexing with an awaitTask');
  });
  test('pending without a task id', async () => {
    const noTask = broken(base => rewriteUpsert(base, value => ({ outcomes: value.outcomes })), { asyncIndexing: true });
    await expect(runCase(noTask, FIND)).rejects.toThrow('upsert answered pending without a taskId');
  });
  test('a task that fails', async () => {
    await expect(runCase(broken(() => ({ awaitTask: () => ok('failed' as const) }), { asyncIndexing: true }), FIND)).rejects.toThrow(/task task_1 of upsert failed/);
  });
  test('a task that never settles', async () => {
    await expect(runCase(broken(() => ({ awaitTask: () => ok('pending' as const) }), { asyncIndexing: true }), FIND, { maxAwaitPolls: 3 }))
      .rejects.toThrow('task task_1 of upsert was still pending after 3 polls');
  });
  test('awaitTask that refuses', async () => {
    await expect(runCase(broken(() => ({ awaitTask: async () => providerRejected({ code: 'not_found', message: 'which?' }) }), { asyncIndexing: true }), FIND))
      .rejects.toThrow('awaitTask returned rejected (not_found: which?)');
  });
});

describe('revisions and tombstones', () => {
  test('a newer revision that is silently dropped', async () => {
    const ignoresNewer = broken(base => ({
      upsert: (ctx, { documents }) => documents.some(document => document.revision > 1)
        ? ok({ outcomes: documents.map(document => ({ key: document.key, revision: document.revision, status: 'applied' as const })) })
        : base.upsert(ctx, { documents }),
    }));
    await expect(runCase(ignoresNewer, 'a newer revision replaces the document')).rejects.toThrow('a newer revision did not replace the older one');
  });
  test('a replace that duplicates the document', async () => {
    let calls = 0;
    const duplicates = broken(base => ({
      upsert: (ctx, { documents }) => {
        calls += 1;
        return base.upsert(ctx, { documents: documents.map(document => ({ ...document, key: { ...document.key, documentId: `${document.key.documentId}_${calls}` } })) })
          .then(result => result.status === 'ok' ? providerOk({ value: { outcomes: result.value.outcomes.map((outcome, index) => ({ ...outcome, key: (documents[index] as SearchDocument).key })) } }) : result);
      },
    }));
    await expect(runCase(duplicates, 'a newer revision replaces the document')).rejects.toThrow('expected exactly one hit after replacing a document, got 2');
  });
  test('a stale write that overwrites', async () => {
    let calls = 0;
    const overwrites = broken(base => ({
      async upsert(ctx, { documents }) {
        calls += 1;
        const bumped = documents.map(document => ({ ...document, revision: document.revision + calls * 100 }));
        const result = await base.upsert(ctx, { documents: bumped });
        return result.status === 'ok' ? providerOk({ value: { outcomes: result.value.outcomes.map((outcome, index) => ({ ...outcome, revision: (documents[index] as SearchDocument).revision })) } }) : result;
      },
    }));
    await expect(runCase(overwrites, 'an equal or older revision is stale and changes nothing')).rejects.toThrow("upsert of an equal revision reported 'applied', expected one of stale");
  });
  test('a stale write reported stale that still changes the hit', async () => {
    const sneaky = broken(base => ({
      async upsert(ctx, { documents }) {
        const result = await base.upsert(ctx, { documents: documents.map(document => ({ ...document, revision: document.revision === 5 ? 5 : 9 })) });
        return result.status === 'ok' ? providerOk({ value: { outcomes: result.value.outcomes.map((outcome, index) => ({ ...outcome, status: 'stale' as const, revision: (documents[index] as SearchDocument).revision })) } }) : result;
      },
    }));
    await expect(runCase(sneaky, 'an equal or older revision is stale and changes nothing')).rejects.toThrow('an equal or older revision changed the indexed document');
  });
  test('a removal that is reported but not applied', async () => {
    const ignoresRemove = broken(() => ({ remove: (_ctx, { tombstones }) => ok({ outcomes: tombstones.map(t => ({ ...t, status: 'applied' as const })) }) }));
    await expect(runCase(ignoresRemove, 'remove makes the document absent')).rejects.toThrow('a removed document is still returned');
    await expect(runCase(ignoresRemove, 'published then draft (tombstone) removes it from queries')).rejects.toThrow('moving a published document back to draft did not remove only that document');
  });
  test('a removal that is refused', async () => {
    const refusesRemove = broken(() => ({ remove: (_ctx, { tombstones }) => ok({ outcomes: tombstones.map(t => ({ ...t, status: 'rejected' as const })) }) }));
    await expect(runCase(refusesRemove, 'remove makes the document absent')).rejects.toThrow("remove at a newer revision reported 'rejected'");
  });
  test('a never-indexed remove that leaves no tombstone resurrects on a lower revision', async () => {
    const forgetful = broken(base => ({
      async remove(ctx, { tombstones }) {
        const states = await base.revisionOf(ctx, { keys: tombstones.map(t => t.key) });
        const known = states.status === 'ok' && states.value.every(state => state.revision !== null);
        return known ? base.remove(ctx, { tombstones }) : ok({ outcomes: tombstones.map(t => ({ ...t, status: 'applied' as const })) });
      },
    }));
    await expect(runCase(forgetful, 'removing a never-indexed key leaves a tombstone that blocks lower revisions'))
      .rejects.toThrow("upsert below a tombstone revision reported 'applied', expected one of stale");
  });
  test('a tombstone that reports stale but lets the document back in', async () => {
    const leaky = broken(base => ({
      async upsert(ctx, { documents }) {
        const result = await base.upsert(ctx, { documents: documents.map(document => ({ ...document, revision: document.revision === 3 ? 7 : document.revision })) });
        return result.status === 'ok' ? providerOk({ value: { outcomes: result.value.outcomes.map((outcome, index) => ({ ...outcome, status: documents[index]?.revision === 3 ? 'stale' as const : outcome.status, revision: (documents[index] as SearchDocument).revision })) } }) : result;
      },
    }));
    await expect(runCase(leaky, 'removing a never-indexed key leaves a tombstone that blocks lower revisions'))
      .rejects.toThrow('an upsert with a lower revision than its tombstone resurrected the document');
  });
  test('a revival that is dropped', async () => {
    const noRevive = broken(base => ({
      upsert: (ctx, { documents }) => documents[0]?.revision === 6
        ? ok({ outcomes: documents.map(document => ({ key: document.key, revision: document.revision, status: 'applied' as const })) })
        : base.upsert(ctx, { documents }),
    }));
    await expect(runCase(noRevive, 'removing a never-indexed key leaves a tombstone that blocks lower revisions'))
      .rejects.toThrow('an upsert with a higher revision than its tombstone did not revive the document');
  });
  test('revisionOf with the wrong number of states', async () => {
    await expect(runCase(broken(() => ({ revisionOf: () => ok([]) })), 'revisionOf agrees with the last write')).rejects.toThrow('revisionOf returned 0 states for 3 keys');
  });
  test('revisionOf that does not report tombstones', async () => {
    const noTombstones = broken(base => ({
      async revisionOf(ctx, required) {
        const result = await base.revisionOf(ctx, required);
        return result.status === 'ok' ? providerOk({ value: result.value.map(state => ({ ...state, deleted: false })) }) : result;
      },
    }));
    await expect(runCase(noTombstones, 'revisionOf agrees with the last write')).rejects.toThrow(/revisionOf\(site_a\/ws_conformance\/post\/gone\) is .*expected revision 4, deleted true/);
  });
});

describe('queries', () => {
  test('a document that is never found', async () => {
    await expect(runCase(broken(() => ({ query: () => ok({ hits: [] }) })), FIND)).rejects.toThrow('an upserted document is not found');
  });
  test('a hit with the wrong title, or an empty snippet', async () => {
    const retitled = broken(base => ({ query: async (ctx, required) => ok({ hits: (await pageOf(base, ctx, required)).hits.map(hit => ({ ...hit, title: 'Other' })) }) }));
    await expect(runCase(retitled, FIND)).rejects.toThrow("does not carry the document's title, url and revision");
    const blank = broken(base => ({ query: async (ctx, required) => ok({ hits: (await pageOf(base, ctx, required)).hits.map(hit => ({ ...hit, snippet: '', highlights: [] })) }) }));
    await expect(runCase(blank, FIND)).rejects.toThrow('has an empty snippet');
  });
  test('an HTML snippet', async () => {
    const html = broken(base => ({ query: async (ctx, required) => ok({ hits: (await pageOf(base, ctx, required)).hits.map(hit => ({ ...hit, snippet: `<em>${hit.snippet}</em>` })) }) }));
    await expect(runCase(html, FIND)).rejects.toThrow('contains markup');
  });
  test('highlights outside the snippet', async () => {
    const wide = broken(base => ({ query: async (ctx, required) => ok({ hits: (await pageOf(base, ctx, required)).hits.map(hit => ({ ...hit, highlights: [{ start: 0, end: 9999 }] })) }) }));
    await expect(runCase(wide, FIND)).rejects.toThrow(/highlight 0\.\.9999 of .* is outside its \d+-char snippet/);
  });
  test('empty query text that is accepted', async () => {
    const lax = broken(base => ({ query: (ctx, required) => required.query.text.trim() === '' ? ok({ hits: [] }) : base.query(ctx, required) }));
    await expect(runCase(lax, 'empty or whitespace query text is rejected as invalid_request')).rejects.toThrow('query text "" returned ok, expected rejected (invalid_request)');
  });
  test('empty query text refused with the wrong code', async () => {
    const wrongCode = broken(() => ({ query: async () => providerRejected({ code: 'unsupported', message: 'empty' }) }));
    await expect(runCase(wrongCode, 'empty or whitespace query text is rejected as invalid_request')).rejects.toThrow('returned rejected (unsupported: empty)');
  });
  test('a query that is not ok', async () => {
    await expect(runCase(broken(() => ({ query: async () => providerUnknown({ code: 'network', message: 'down' }) })), FIND)).rejects.toThrow('query returned unknown (network: down)');
  });
  test('an ignored collections filter', async () => {
    const noCollections = broken(base => ({ query: (ctx, { query }) => base.query(ctx, { query: { ...query, collections: undefined as never } }) }));
    await expect(runCase(noCollections, 'collections filter')).rejects.toThrow("collection 'post' returned");
  });
  test('an ignored locale filter', async () => {
    const noLocale = broken(base => ({ query: (ctx, { query }) => base.query(ctx, { query: { ...query, locale: undefined as never } }) }));
    await expect(runCase(noLocale, 'locale filter')).rejects.toThrow("locale 'en' returned");
  });
  test('a declared typo tolerance that does not tolerate typos', async () => {
    const claims = broken(base => ({ capabilities: { ...base.capabilities, typoTolerance: true } }));
    await expect(runCase(claims, 'tolerates a one-edit typo')).rejects.toThrow('a one-edit typo did not match');
  });
  test('indexes that share one backend index', async () => {
    const shared = (ctx: SearchProviderContext) => ({ ...ctx, indexName: 'one_for_all' });
    const crossing = broken(base => ({
      ensureIndex: ctx => base.ensureIndex(shared(ctx)), dropIndex: ctx => base.dropIndex(shared(ctx)),
      upsert: (ctx, required) => base.upsert(shared(ctx), required), remove: (ctx, required) => base.remove(shared(ctx), required),
      query: (ctx, required) => base.query(shared(ctx), required), revisionOf: (ctx, required) => base.revisionOf(shared(ctx), required),
    }));
    // One shared backend index: the second index's copy of the same key is the first one's, so its removal empties both.
    await expect(runCase(crossing, 'indexes and sites never cross')).rejects.toThrow(/_b returned \[\], expected only 'Beta copy'/);
  });
  test('an index that also returns a sibling index\'s documents', async () => {
    const crossSite = broken(base => ({
      async query(ctx, required) {
        const own = await pageOf(base, ctx, required);
        if (!ctx.indexName.endsWith('_c')) return ok(own);
        // Reads the sibling index as its own tenant (site_a), i.e. leaks it whole.
        const sibling = await pageOf(base, { ...ctx, indexName: ctx.indexName.replace(/_c$/, '_b'), siteId: 'site_a' }, required);
        return ok({ hits: [...own.hits, ...sibling.hits] });
      },
    }));
    await expect(runCase(crossSite, 'indexes and sites never cross')).rejects.toThrow(/returned \["Gamma copy","Beta copy"\], expected only 'Gamma copy'/);
  });
});

describe('pagination', () => {
  test('a limit that is ignored', async () => {
    const unlimited = broken(base => ({ query: (ctx, { query }) => base.query(ctx, { query: { ...query, limit: 100 } }) }));
    await expect(runCase(unlimited, PAGINATION)).rejects.toThrow('query returned 5 hits for limit 2');
  });
  test('a cursor on every page', async () => {
    const endless = broken(base => ({ query: async (ctx, required) => ok({ ...(await pageOf(base, ctx, { query: { ...required.query, cursor: '0' } })), nextCursor: '2' }) }));
    await expect(runCase(endless, PAGINATION)).rejects.toThrow('pagination never ended');
  });
  test('overlapping pages', async () => {
    const overlapping = broken(base => ({
      query: async (ctx, required) => {
        const first = await pageOf(base, ctx, { query: { ...required.query, cursor: '0' } });
        return ok(required.query.cursor === undefined ? first : { hits: first.hits });
      },
    }));
    await expect(runCase(overlapping, PAGINATION)).rejects.toThrow('expected each of the 5 documents exactly once');
  });
  test('an unstable first page', async () => {
    let calls = 0;
    const unstable = broken(base => ({
      query: async (ctx, required) => {
        calls += 1;
        const page = await pageOf(base, ctx, required);
        return ok(calls === 4 ? { ...page, hits: [...page.hits].reverse() } : page);
      },
    }));
    await expect(runCase(unstable, PAGINATION)).rejects.toThrow('the first page is not stable across identical queries');
  });
});

describe('audiences', () => {
  test('a provider that leaks restricted documents to everyone', async () => {
    const leaky = broken(base => ({ upsert: (ctx, { documents }) => base.upsert(ctx, { documents: publicCopy(documents) }) }));
    await expect(runCase(leaky, 'restricted documents reach only their audience')).rejects.toThrow('a restricted document was returned to audiences []');
  });
  test('a provider that hides restricted documents from their audience', async () => {
    const hiding = broken(base => ({ query: (ctx, { query }) => base.query(ctx, { query: { ...query, audiences: [] } }) }));
    await expect(runCase(hiding, 'restricted documents reach only their audience')).rejects.toThrow('a restricted document was not returned to its own audience');
  });
  test('a public-only provider that stores and returns restricted documents', async () => {
    const leaky = broken(base => ({ upsert: (ctx, { documents }) => base.upsert(ctx, { documents: publicCopy(documents) }) }), { acceptsRestricted: false });
    await expect(runCase(leaky, 'a public-only provider never returns restricted documents')).rejects.toThrow('a public-only provider returned restricted content to audiences []');
  });
});

describe('unavailable backend', () => {
  test('a provider that answers ok while unavailable', async () => {
    await expect(runCase(broken(() => ({})), 'an unavailable backend answers unknown and never throws', { makeUnavailableContext: input => memoryContext(input, { down: true }) }))
      .rejects.toThrow('ensureIndex returned ok while the backend is unavailable, expected unknown');
  });
  test('a provider that throws while unavailable', async () => {
    const throwing = broken(() => ({ ensureIndex: async () => { throw new Error('ECONNREFUSED'); } }));
    await expect(runCase(throwing, 'an unavailable backend answers unknown and never throws', { makeUnavailableContext: input => memoryContext(input, { down: true }) }))
      .rejects.toThrow('ensureIndex threw instead of returning a result: ECONNREFUSED');
  });
});

const OVERLAP = 'overlapping writes issued before earlier ones settle still honour revision order';
/** Applies the matching documents above their real revision (a write that ignores revision order), reporting the real one. */
const bumpUpsert = (base: SearchProvider, bumped: (document: SearchDocument) => boolean): Partial<SearchProvider> => ({
  async upsert(ctx, required) {
    const result = await base.upsert(ctx, { documents: required.documents.map(document => (bumped(document) ? { ...document, revision: document.revision + 100 } : document)) });
    if (result.status !== 'ok') return result;
    return providerOk({ value: { ...result.value, outcomes: result.value.outcomes.map((outcome, index) => ({ ...outcome, revision: (required.documents[index] as SearchDocument).revision })) } });
  },
});

describe('overlapping writes', () => {
  test('a lower revision queued behind a tombstone that resurrects the document', async () => {
    await expect(runCase(broken(base => bumpUpsert(base, document => document.title === 'Resurrected overlap')), OVERLAP))
      .rejects.toThrow('an upsert issued below a not-yet-settled tombstone resurrected the document');
  });
  test('an older concurrent upsert that wins over the newer one', async () => {
    await expect(runCase(broken(base => bumpUpsert(base, document => document.title === 'Older overlap')), OVERLAP))
      .rejects.toThrow(/concurrent upserts left .*expected revision 2/);
  });
  test('a revisionOf that loses the tombstone after overlapping writes', async () => {
    const forgetful = broken(base => ({
      async revisionOf(ctx, required) {
        const result = await base.revisionOf(ctx, required);
        return result.status === 'ok' ? providerOk({ value: result.value.map(state => ({ ...state, deleted: false })) }) : result;
      },
    }));
    await expect(runCase(forgetful, OVERLAP)).rejects.toThrow('expected the revision-5 tombstone');
  });
});

describe('tenants, field filters and query text', () => {
  test('a provider that also returns another site\'s documents from a shared index', async () => {
    const leaky = broken(base => ({
      async query(ctx, required) {
        const own = await base.query(ctx, required);
        const other = await base.query({ ...ctx, siteId: ctx.siteId === 'site_a' ? 'site_b' : 'site_a' }, required);
        return own.status === 'ok' && other.status === 'ok' ? providerOk({ value: { hits: [...own.value.hits, ...other.value.hits] } }) : own;
      },
    }));
    await expect(runCase(leaky, 'sites and workspaces sharing one index never cross')).rejects.toThrow(/from a shared index, expected only 'Home tenant'/);
  });
  test('a provider that ignores field filters', async () => {
    const unfiltered = broken(base => ({ query: (ctx, { query: { filters: _ignored, ...rest } }) => base.query(ctx, { query: rest }) }));
    await expect(runCase(unfiltered, 'field filters match exactly and by type')).rejects.toThrow(/filters \{"color":"red"\} returned/);
  });
  test('a provider that compares filter values as strings', async () => {
    const untyped = broken(base => ({
      query: (ctx, { query }) => base.query(ctx, { query: { ...query, ...(query.filters === undefined ? {} : { filters: Object.fromEntries(Object.entries(query.filters).map(([name, value]) => [name, value === '3' ? 3 : value])) }) } }),
    }));
    await expect(runCase(untyped, 'field filters match exactly and by type')).rejects.toThrow(/filters \{"size":"3"\} returned/);
  });
  test('a provider that substitutes a shared term for every query', async () => {
    const substituting = broken(base => ({ query: (ctx, { query }) => base.query(ctx, { query: { ...query, text: 'zephyrine' } }) }));
    await expect(runCase(substituting, 'query text no document contains finds nothing')).rejects.toThrow("query text 'quixotic', which no document contains");
  });
  test('a provider that finds nothing at all', async () => {
    const blind = broken(() => ({ query: () => ok({ hits: [] }) }));
    await expect(runCase(blind, 'query text no document contains finds nothing')).rejects.toThrow('a document is not found by a word of its own body');
  });
});
