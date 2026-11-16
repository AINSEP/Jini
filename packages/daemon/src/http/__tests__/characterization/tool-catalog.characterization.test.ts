import { get as httpGet } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ToolCatalogEntry, ToolCatalogQuery, ToolCatalogSearchHit } from '../../tool-catalog.js';
import { INTERNAL_FAILURE_MARKER, startRouteHarness, type RouteHarness } from './harness.js';
import { CROSS_ORIGIN_MESSAGE, FOREIGN_ORIGIN, probe } from './probes.js';

/**
 * Every answer of the two tool-catalog routes, recorded from today's code with a catalog that
 * works: the bytes of each success and each refusal, what the catalog was asked, the headers a
 * client can see, and which spellings of the two paths reach which route. The response matrix
 * beside this file asks every route two questions with broken dependencies; this file asks one
 * route family everything, because it is the first one whose routes are to be returned as data
 * and each row here must read the same afterwards.
 */

const HIT: ToolCatalogSearchHit = { id: 'alpha.tool', description: 'Finds alpha', source: 'first-party', score: 0.5, readOnly: true };
const ENTRY: ToolCatalogEntry = { id: 'alpha.tool', description: 'Finds alpha', source: 'first-party', inputSchema: { type: 'object' } };

interface RecordingCatalog extends ToolCatalogQuery {
  readonly searches: unknown[][];
  readonly describes: unknown[][];
  failNext: boolean;
}

function recordingCatalog(): RecordingCatalog {
  const catalog: RecordingCatalog = {
    searches: [],
    describes: [],
    failNext: false,
    search: (...args) => {
      catalog.searches.push(args);
      if (catalog.failNext) throw new Error(INTERNAL_FAILURE_MARKER);
      return [HIT];
    },
    describe: (...args) => {
      catalog.describes.push(args);
      return args[0].id === ENTRY.id || args[0].id === 'a/b' ? { ...ENTRY, id: args[0].id } : null;
    },
  };
  return catalog;
}

const SEARCH_BODY = '{"hits":[{"id":"alpha.tool","description":"Finds alpha","source":"first-party","score":0.5,"readOnly":true}]}';
const ENTRY_BODY = '{"id":"alpha.tool","description":"Finds alpha","source":"first-party","inputSchema":{"type":"object"}}';
const badRequest = (message: string): string => JSON.stringify({ error: { code: 'BAD_REQUEST', message } });

describe('tool catalog routes, every answer', () => {
  let harness: RouteHarness;
  const catalog = recordingCatalog();
  beforeAll(async () => { harness = await startRouteHarness({}, { familyDeps: { 'tool-catalog': { catalog } } }); });
  afterAll(async () => { await harness.close(); });
  beforeEach(() => { catalog.searches.length = 0; catalog.describes.length = 0; catalog.failNext = false; });

  describe('GET /api/tools/search', () => {
    it('answers the hits as JSON and asks the catalog with the default limit of 10', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/search?q=alpha' });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(answer.text).toBe(SEARCH_BODY);
      expect(catalog.searches).toEqual([[{ query: 'alpha' }, { limit: 10 }]]);
    });

    it.each([
      ['a limit is passed on', '?q=alpha&limit=3', 3],
      ['a limit above 25 is lowered to 25', '?q=alpha&limit=99', 25],
      ['the query is passed on untrimmed', '?q=%20alpha%20', 10],
    ])('%s', async (_label, query, limit) => {
      expect((await probe({ harness, route: `GET /api/tools/search${query}` })).status).toBe(200);
      expect(catalog.searches).toEqual([[{ query: new URLSearchParams(query).get('q') }, { limit }]]);
    });

    it.each([
      ['no query', '', 'q (search query) is required and must be a non-empty string'],
      ['a blank query', '?q=%20%20', 'q (search query) is required and must be a non-empty string'],
      ['a repeated query', '?q=a&q=b', 'q (search query) is required and must be a non-empty string'],
      ['a limit that is not a whole number', '?q=a&limit=abc', 'limit must be a single positive-integer query-string value when provided'],
      ['a repeated limit', '?q=a&limit=1&limit=2', 'limit must be a single positive-integer query-string value when provided'],
      ['a limit of zero', '?q=a&limit=0', 'limit must be at least 1'],
    ])('refuses %s with 400 and never asks the catalog', async (_label, query, message) => {
      const answer = await probe({ harness, route: `GET /api/tools/search${query}` });
      expect(answer.status).toBe(400);
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(answer.text).toBe(badRequest(message));
      expect(catalog.searches).toEqual([]);
    });

    it('refuses a foreign origin with 403 before the query is read or the catalog asked', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/search' }, { origin: FOREIGN_ORIGIN });
      expect(answer.status).toBe(403);
      expect(answer.text).toBe(JSON.stringify({ error: { code: 'FORBIDDEN', message: CROSS_ORIGIN_MESSAGE } }));
      expect(catalog.searches).toEqual([]);
    });

    it('a catalog that throws answers 500 with a request ID, never the thrown text, and the host sink gets the error', async () => {
      catalog.failNext = true;
      const before = harness.internalErrors.length;
      const answer = await probe({ harness, route: 'GET /api/tools/search?q=alpha' });
      expect(answer.status).toBe(500);
      const { error } = answer.json as { error: { code: string; message: string; requestId: string } };
      expect(Object.keys(error).sort()).toEqual(['code', 'message', 'requestId']);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.message).toBe('The server could not finish this request. Check whether your change was saved, then copy the request ID and report this problem.');
      expect(answer.text).not.toContain(INTERNAL_FAILURE_MARKER);
      const reported = harness.internalErrors.slice(before) as { error: Error; correlationId: string }[];
      expect(reported).toHaveLength(1);
      expect(reported[0]!.error.message).toBe(INTERNAL_FAILURE_MARKER);
      expect(reported[0]!.correlationId).toBe(error.requestId);
    });
  });

  describe('GET /api/tools/:id', () => {
    it('answers the entry as JSON and asks the catalog for that id only', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/alpha.tool' });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(answer.text).toBe(ENTRY_BODY);
      expect(catalog.describes).toEqual([[{ id: 'alpha.tool' }]]);
    });

    it('decodes a percent-encoded id before asking the catalog', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/a%2Fb' });
      expect(answer.status).toBe(200);
      expect(catalog.describes).toEqual([[{ id: 'a/b' }]]);
    });

    it('an id the catalog does not have is 404 NOT_FOUND naming the id', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/missing.tool' });
      expect(answer.status).toBe(404);
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(answer.text).toBe(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no catalog entry for tool id "missing.tool"' } }));
    });

    it('refuses a foreign origin with 403 before the catalog is asked', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/alpha.tool' }, { origin: FOREIGN_ORIGIN });
      expect(answer.status).toBe(403);
      expect(answer.text).toBe(JSON.stringify({ error: { code: 'FORBIDDEN', message: CROSS_ORIGIN_MESSAGE } }));
      expect(catalog.describes).toEqual([]);
    });
  });

  describe('which spellings of the two paths reach which route', () => {
    it.each([
      ['a trailing slash', 'GET /api/tools/search/?q=alpha'],
      ['another letter case', 'GET /API/Tools/Search?q=alpha'],
      ['the word search in capitals (it is still the search route, not an id)', 'GET /api/tools/SEARCH?q=alpha'],
    ])('%s reaches the search route', async (_label, route) => {
      const answer = await probe({ harness, route });
      expect(answer.status).toBe(200);
      expect(answer.text).toBe(SEARCH_BODY);
      expect(catalog.describes).toEqual([]);
    });

    it.each([
      ['a trailing slash after the id', 'GET /api/tools/alpha.tool/'],
      ['another letter case in the fixed part', 'GET /API/TOOLS/alpha.tool'],
    ])('%s reaches the entry route with the id as sent', async (_label, route) => {
      const answer = await probe({ harness, route });
      expect(answer.status).toBe(200);
      expect(answer.text).toBe(ENTRY_BODY);
      expect(catalog.describes).toEqual([[{ id: 'alpha.tool' }]]);
    });

    it('an id that is not valid percent-encoding is refused by the framework with its own 400 page; the catalog is not asked', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/%E0%A4%A' });
      expect(answer.status).toBe(400);
      expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(catalog.describes).toEqual([]);
    });

    it('HEAD answers the status and headers of GET with no body, and still asks the catalog', async () => {
      const answer = await probe({ harness, route: 'HEAD /api/tools/search?q=alpha' });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(answer.headers.get('content-length')).toBe(String(SEARCH_BODY.length));
      expect(answer.text).toBe('');
      expect(catalog.searches).toHaveLength(1);
    });

    it.each([
      ['OPTIONS /api/tools/search'],
      ['OPTIONS /api/tools/alpha.tool'],
    ])('%s is answered by the framework: 200 with Allow: GET,HEAD', async (route) => {
      const answer = await probe({ harness, route });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('allow')).toBe('GET,HEAD');
      expect(answer.text).toBe('GET,HEAD');
    });

    it('a method neither route has matches nothing and gets the framework 404 page', async () => {
      const answer = await probe({ harness, route: 'POST /api/tools/search' });
      expect(answer.status).toBe(404);
      expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
    });
  });

  describe('the headers of a success, and the conditional request they make possible', () => {
    it('a success carries a length and a weak validator', async () => {
      const answer = await probe({ harness, route: 'GET /api/tools/search?q=alpha' });
      expect(answer.headers.get('content-length')).toBe(String(SEARCH_BODY.length));
      expect(answer.headers.get('etag')).toMatch(/^W\/"[0-9a-f]+-[A-Za-z0-9+/]+"$/);
    });

    // Sent with `node:http`, as a browser cache revalidates: `fetch` adds `Cache-Control: no-cache` to a
    // request that names a validator itself, and the framework then answers 200 in full.
    it('a request that names that validator, as a browser cache sends it, is answered 304 with no body (the catalog is still asked)', async () => {
      const etag = (await probe({ harness, route: 'GET /api/tools/search?q=alpha' })).headers.get('etag')!;
      catalog.searches.length = 0;
      const answer = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        httpGet(`${harness.origin}/api/tools/search?q=alpha`, { headers: { 'if-none-match': etag } }, (response) => {
          let body = '';
          response.setEncoding('utf8').on('data', (chunk: string) => { body += chunk; }).on('end', () => resolve({ status: response.statusCode, body }));
        }).on('error', reject);
      });
      expect(answer).toEqual({ status: 304, body: '' });
      expect(catalog.searches).toHaveLength(1);
    });
  });
});
