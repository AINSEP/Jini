import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HARNESS_BEARER_TOKEN, SCOPED_FRONTEND_PREFIX, startRouteHarness, type RouteHarness } from './harness.js';
import { CROSS_ORIGIN_MESSAGE, FOREIGN_ORIGIN, probe } from './probes.js';

/**
 * The gates and body limits of the routes that are mounted by hand (streams, uploads, bearer-gated
 * routes), recorded from today's code with every dependency replaced by one that throws. The JSON
 * routes' same-origin gates are in the response matrix beside this file; the clause-by-clause
 * bearer decisions (token unset, loopback peer, constant-time compare) are in
 * `auth-gates.characterization.test.ts`.
 */
let harness: RouteHarness;
beforeAll(async () => { harness = await startRouteHarness(); });
afterAll(async () => { await harness.close(); });

const bearer = { authorization: `Bearer ${HARNESS_BEARER_TOKEN}` };
// Same length as the real token, so only the comparison can tell them apart.
const wrongBearer = { authorization: `Bearer ${'x'.repeat(HARNESS_BEARER_TOKEN.length)}` };

describe('same-origin gate on hand-mounted routes', () => {
  it.each([
    'GET /api/memory/events',
    'GET /api/terminals/:id/stream',
    'GET /api/frontend-sessions/stream',
    'POST /api/proxy/anthropic/stream',
    'POST /api/proxy/openai/stream',
    'POST /api/proxy/azure/stream',
    'POST /api/proxy/google/stream',
    'POST /api/proxy/ollama/stream',
    'POST /api/proxy/:provider/stream',
    'POST /api/attachments',
    'DELETE /api/attachments',
  ])('%s refuses a foreign origin with 403 before doing anything', async (route) => {
    const before = harness.internalErrors.length;
    const answer = await probe({ harness, route }, { origin: FOREIGN_ORIGIN });
    expect(answer.summary).toBe('403 FORBIDDEN');
    expect(answer.json).toEqual({ error: { code: 'FORBIDDEN', message: CROSS_ORIGIN_MESSAGE } });
    // Nothing was subscribed, opened or stored: no dependency was called, so none failed.
    expect(harness.internalErrors).toHaveLength(before);
  });

  it.each([
    // The run event stream has no origin gate today; a foreign origin reaches the run lookup.
    ['GET /api/runs/:runId/events', '500 INTERNAL_ERROR'],
    // A scoped host answers origin together with ownership in its own resolver, which here throws.
    [`GET ${SCOPED_FRONTEND_PREFIX}/stream`, '500 INTERNAL_ERROR'],
    // Bearer-gated routes are not browser routes: the token decides, the origin is not looked at.
    ['POST /internal/tool-executions', '401 UNAUTHORIZED'],
    ['POST /api/runs/:runId/tool-use', '401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED'],
    ['POST /internal/attachment-lookup', '400 BAD_REQUEST'],
    ['POST /api/frontend-requests', '400 error-string'],
  ])('%s has no same-origin gate: a foreign origin gets %s, the same as a local caller', async (route, expected) => {
    expect((await probe({ harness, route }, { origin: FOREIGN_ORIGIN })).summary).toBe(expected);
    expect((await probe({ harness, route })).summary).toBe(expected);
  });
});

describe('bearer gates', () => {
  it.each([
    ['POST /internal/tool-executions', '401 UNAUTHORIZED', '400 BAD_REQUEST'],
    ['GET /internal/tool-catalog', '401 UNAUTHORIZED', '400 BAD_REQUEST'],
    ['POST /api/runs/:runId/tool-use', '401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', '400 BAD_REQUEST'],
    ['POST /api/runs/:runId/tool-result', '401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', '400 BAD_REQUEST'],
  ])('%s: no token and a wrong token of the right length get %s; the right token reaches input validation (%s)', async (route, refused, admitted) => {
    expect((await probe({ harness, route })).summary).toBe(refused);
    expect((await probe({ harness, route }, { headers: wrongBearer })).summary).toBe(refused);
    expect((await probe({ harness, route }, { headers: bearer })).summary).toBe(admitted);
  });

  it('the tool-execution gate answers before the body is read: malformed JSON without a token is 401, with the token 400', async () => {
    const route = 'POST /internal/tool-executions';
    expect((await probe({ harness, route }, { body: '{"broken"' })).summary).toBe('401 UNAUTHORIZED');
    expect((await probe({ harness, route }, { body: '{"broken"', headers: bearer })).summary).toBe('400 BAD_REQUEST');
  });

  it('the scoped frontend-session response route is refused with a plain 403 when its owner cannot be resolved', async () => {
    const answer = await probe({ harness, route: `POST ${SCOPED_FRONTEND_PREFIX}/:sessionId/responses` });
    expect(answer.status).toBe(403);
    expect(answer.text).toBe('Forbidden');
    expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('the frontend-request route refuses a wrong envelope with its plain-string body, byte for byte', async () => {
    const answer = await probe({ harness, route: 'POST /api/frontend-requests' });
    expect(answer.status).toBe(400);
    expect(answer.text).toBe('{"error":"Expected an allowed capabilityId, object input and frontend bindToken."}');
  });
});

/** `{"pad":[1e20,1e20,...]}` padded with JSON whitespace to exactly `bytes`: the body that grows the most when parsed and printed again. */
function expansionBody(bytes: number): string {
  const count = Math.floor((bytes - 9) / 5);
  const text = `{"pad":[${Array.from({ length: count }, () => '1e20').join(',')}]}`;
  return text + ' '.repeat(bytes - text.length);
}

describe('body limits', () => {
  // The blanket parser of the preset: express.json() with its default limit.
  const PRESET_LIMIT = 102_400;
  // The attachment-lookup route's own parser.
  const LOOKUP_LIMIT = 64 * 1024;

  it.each([
    ['one byte under', PRESET_LIMIT - 1, '400 BAD_REQUEST'],
    ['exactly at', PRESET_LIMIT, '400 BAD_REQUEST'],
  ])('a JSON route behind the blanket parser reads a most-expanding body %s the parser limit (%i bytes)', async (_label, bytes, expected) => {
    const body = expansionBody(bytes);
    expect(Buffer.byteLength(body)).toBe(bytes);
    const answer = await probe({ harness, route: 'POST /api/runs' }, { body });
    // The body passed the parser and reached the route's own input check, which names its first missing field.
    expect(answer.summary).toBe(expected);
    expect(answer.json).toMatchObject({ error: { code: 'BAD_REQUEST', message: 'contextRef must be a non-empty string' } });
  });

  it('one byte over the blanket parser limit is refused by the parser with 413, and the route is not reached', async () => {
    const before = harness.internalErrors.length;
    const answer = await probe({ harness, route: 'POST /api/runs' }, { body: expansionBody(PRESET_LIMIT + 1) });
    expect(answer.status).toBe(413);
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(answer.text).toContain('PayloadTooLargeError');
    expect(harness.internalErrors).toHaveLength(before);
  });

  it('a gzip JSON body under the limit is inflated by the blanket parser and read by the route', async () => {
    const { gzipSync } = await import('node:zlib');
    const answer = await probe({ harness, route: 'POST /api/runs' }, { body: gzipSync('{"pad":[1e20]}'), headers: { 'content-encoding': 'gzip' } });
    expect(answer.summary).toBe('400 BAD_REQUEST');
    expect(answer.json).toMatchObject({ error: { code: 'BAD_REQUEST', message: 'contextRef must be a non-empty string' } });
  });

  it.each([
    ['one byte under', LOOKUP_LIMIT - 1, 400],
    ['exactly at', LOOKUP_LIMIT, 400],
    ['one byte over', LOOKUP_LIMIT + 1, 413],
  ])('attachment lookup has its own 64 KB parser: %s the limit answers %i', async (_label, bytes, status) => {
    const answer = await probe({ harness, route: 'POST /internal/attachment-lookup' }, { body: expansionBody(bytes) });
    expect(answer.status).toBe(status);
    if (status === 400) expect(answer.summary).toBe('400 BAD_REQUEST');
  });

  it('malformed JSON is refused by the blanket parser with its own 400 page, not by the route', async () => {
    const answer = await probe({ harness, route: 'POST /api/runs' }, { body: '{"broken"' });
    expect(answer.status).toBe(400);
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});
