import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTERNAL_FAILURE_MARKER, startRouteHarness, type RouteHarness } from './harness.js';
import { CROSS_ORIGIN_MESSAGE, FOREIGN_ORIGIN, probe, type ProbeAnswer } from './probes.js';

/**
 * T3: what every route that answers JSON says to two fixed questions, recorded from today's code
 * with every dependency replaced by one that throws. Columns: the route; its answer to a
 * same-origin caller sending `{}` (path parameters filled with `x1`); its answer to the same
 * request from a foreign origin.
 *
 * What a row pins: whether the route has a same-origin gate (`403 FORBIDDEN` in the last column)
 * and that the gate runs before input is read; whether empty input is refused (`400`) or reaches
 * the handler (`500 INTERNAL_ERROR`, or a `200` for the few routes that need no dependency);
 * which bearer gate sits in front (`401`); and, for every `500`, the internal-error contract
 * below. `leaks-dependency-message` marks a row whose answer carries a dependency's own error
 * text. Three memory routes did until DM-MEM (owner decision 2026-11-17): they now answer with a fixed
 * sentence and a request ID, and the text goes to the host's error sink; no row carries it.
 *
 * The rows run in mount order against one host, as a client would meet them.
 */
const RESPONSE_MATRIX: readonly (readonly [route: string, sameOrigin: string, foreignOrigin: string])[] = [
  // health
  ['GET /health', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['GET /api/health', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['GET /ready', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['GET /api/ready', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['GET /version', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['GET /api/version', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  // tool-execution-routes
  ['POST /internal/tool-executions', '401 UNAUTHORIZED', '401 UNAUTHORIZED'],
  ['GET /internal/tool-catalog', '401 UNAUTHORIZED', '401 UNAUTHORIZED'],
  // attachment-lookup-routes
  ['POST /internal/attachment-lookup', '400 BAD_REQUEST', '400 BAD_REQUEST'],
  // runs
  ['POST /api/runs', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/runs', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['GET /api/runs/:runId', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['POST /api/runs/:runId/cancel', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['POST /api/runs/:runId/messages', '400 BAD_REQUEST', '403 FORBIDDEN'],
  // agents
  ['GET /api/agents', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['POST /api/agents/rescan', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  // host-tools
  ['GET /api/editors', '200 json{editors,platform}', '200 json{editors,platform}'],
  ['POST /api/resources/:resourceRef/open-in', '400 BAD_REQUEST', '403 FORBIDDEN'],
  // active-context
  ['POST /api/active', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/active', '200 json{active}', '403 FORBIDDEN'],
  // terminals
  ['GET /api/terminals', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['POST /api/terminals', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['POST /api/terminals/:id/stdin', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['POST /api/terminals/:id/resize', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['POST /api/terminals/:id/kill', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['DELETE /api/terminals/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  // db-ops
  ['GET /api/daemon/db', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['POST /api/daemon/db/verify', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['POST /api/daemon/db/vacuum', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  // tool-catalog
  ['GET /api/tools/search', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/tools/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  // delegated-tools
  ['POST /api/delegated-tool-calls', '400 BAD_REQUEST', '403 FORBIDDEN'],
  // connectors
  ['POST /api/connectors/auth/signup', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['POST /api/connectors/auth/signin', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['POST /api/connectors/auth/signout', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['POST /api/connectors/auth/session', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['PUT /api/connectors/storage/:key', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/connectors/storage/:key', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['DELETE /api/connectors/storage/:key', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['GET /api/connectors/storage', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['POST /api/connectors/db/:collection', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/connectors/db/:collection/:id', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['PATCH /api/connectors/db/:collection/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['DELETE /api/connectors/db/:collection/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['GET /api/connectors/db/:collection', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['POST /api/connectors/realtime/:channel/publish', '400 BAD_REQUEST', '403 FORBIDDEN'],
  // research
  ['POST /api/research/search', '400 BAD_REQUEST', '403 FORBIDDEN'],
  // xai
  ['POST /api/xai/oauth/start', '409 OAUTH_FLOW_IN_PROGRESS', '403 FORBIDDEN'],
  ['POST /api/xai/oauth/complete', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['POST /api/xai/oauth/cancel', '200 json{ok}', '403 FORBIDDEN'],
  ['GET /api/xai/auth/status', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['POST /api/xai/oauth/disconnect', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['POST /api/xai/search', '400 BAD_REQUEST', '403 FORBIDDEN'],
  // remote-run-events
  ['POST /api/runs/:runId/tool-use', '401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', '401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED'],
  ['POST /api/runs/:runId/tool-result', '401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', '401 REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED'],
  // memory
  ['GET /api/memory', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['GET /api/memory/tree', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['PATCH /api/memory/tree/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['PUT /api/memory/index', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['PATCH /api/memory/config', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['GET /api/memory/extractions', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['DELETE /api/memory/extractions', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['DELETE /api/memory/extractions/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['GET /api/memory/verifications', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['DELETE /api/memory/verifications', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['DELETE /api/memory/verifications/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['POST /api/memory', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/memory/:id', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['PUT /api/memory/:id', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['DELETE /api/memory/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  // routines
  ['GET /api/routines', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['POST /api/routines', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/routines/:id', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['PATCH /api/routines/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['DELETE /api/routines/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['POST /api/routines/:id/run', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['GET /api/routines/:id/runs', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  // media
  ['POST /api/media/generate', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/media/tasks/:id', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['DELETE /api/media/tasks/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  ['GET /api/media/tasks', '400 BAD_REQUEST', '400 BAD_REQUEST'],
  // frontend-sessions
  ['POST /api/frontend-sessions/:sessionId/responses', '400 BAD_REQUEST', '403 FORBIDDEN'],
  // frontend-sessions (scoped)
  ['POST /api/scoped-frontend-sessions/:sessionId/responses', '403 text:Forbidden', '403 text:Forbidden'],
  ['POST /api/scoped-frontend-sessions/:sessionId/begin', '403 text:Forbidden', '403 text:Forbidden'],
  // daemon-status
  ['GET /api/daemon/status', '500 INTERNAL_ERROR', '500 INTERNAL_ERROR'],
  ['POST /api/daemon/shutdown', '200 json{ok,scheduled}', '403 FORBIDDEN'],
  // component-catalog
  ['GET /api/components/search', '400 BAD_REQUEST', '403 FORBIDDEN'],
  ['GET /api/components/:id', '500 INTERNAL_ERROR', '403 FORBIDDEN'],
  // frontend-request-route
  ['POST /api/frontend-requests', '400 error-string', '400 error-string'],
];

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface InternalErrorReport { readonly method?: string; readonly path?: string; readonly error?: unknown; readonly correlationId?: string; readonly logSource?: string }

let harness: RouteHarness;
beforeAll(async () => { harness = await startRouteHarness(); });
afterAll(async () => { await harness.close(); });

/** An internal failure answers with a request ID and fixed words; the cause goes to the host's sink only. */
function expectRedactedInternalError({ answer, reports }: { answer: ProbeAnswer; reports: readonly InternalErrorReport[] }): InternalErrorReport {
  const error = (answer.json as { error: { code: string; message: string; requestId: string } }).error;
  expect(error.requestId).toMatch(REQUEST_ID);
  expect(answer.text).not.toContain(INTERNAL_FAILURE_MARKER);
  expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const report = reports.find((candidate) => candidate.correlationId === error.requestId);
  expect(report, 'the sink received the incident under the request ID the caller was shown').toBeDefined();
  expect(report?.error).toBeInstanceOf(Error);
  expect((report?.error as Error).message).toBe(INTERNAL_FAILURE_MARKER);
  return report as InternalErrorReport;
}

describe('JSON response matrix', () => {
  it.each(RESPONSE_MATRIX)('%s', async (route, sameOrigin, foreignOrigin) => {
    const before = harness.internalErrors.length;
    const plain = await probe({ harness, route });
    expect(plain.summary).toBe(sameOrigin);
    if (sameOrigin === '500 INTERNAL_ERROR') expectRedactedInternalError({ answer: plain, reports: harness.internalErrors.slice(before) as InternalErrorReport[] });
    const mark = harness.internalErrors.length;
    const foreign = await probe({ harness, route }, { origin: FOREIGN_ORIGIN });
    expect(foreign.summary).toBe(foreignOrigin);
    if (foreignOrigin !== '403 FORBIDDEN') return;
    expect(foreign.json).toEqual({ error: { code: 'FORBIDDEN', message: CROSS_ORIGIN_MESSAGE } });
    expect(foreign.headers.get('content-type')).toBe('application/json; charset=utf-8');
    // Refused before the handler: nothing was attempted, so nothing failed.
    expect(harness.internalErrors).toHaveLength(mark);
  });

  it('covers every JSON-answering registration of the route table', () => {
    const answered = new Set(RESPONSE_MATRIX.map(([route]) => route));
    const streamsAndUploads = new Set(['GET /api/runs/:runId/events', 'GET /api/terminals/:id/stream', 'GET /api/memory/events', 'GET /api/frontend-sessions/stream', 'GET /api/scoped-frontend-sessions/stream', 'POST /api/attachments', 'DELETE /api/attachments', 'POST /api/runs/:runId/messages/claim']);
    const expected = harness.routes
      .filter((route) => route.method !== 'USE' && route.family !== 'model-proxy')
      .map((route) => `${route.method} ${route.path}`)
      .filter((route) => !streamsAndUploads.has(route));
    expect([...answered].sort()).toEqual([...new Set(expected)].sort());
    expect(RESPONSE_MATRIX).toHaveLength(89);
  });

  it('has a same-origin gate on exactly the routes the matrix says, and no route that leaks a dependency message', () => {
    const gated = RESPONSE_MATRIX.filter(([, , foreignOrigin]) => foreignOrigin === '403 FORBIDDEN');
    expect(gated).toHaveLength(55);
    expect(RESPONSE_MATRIX.filter(([, sameOrigin]) => sameOrigin.endsWith('leaks-dependency-message')).map(([route]) => route)).toEqual([]);
  });
});

/**
 * T2: which registration answers when two could. Express takes the first registered match, so
 * `/api/memory/:id` answers a verb the literal path beside it does not register. The report the
 * sink receives names the route that ran.
 */
describe('precedence', () => {
  it.each([
    ['GET /api/memory/tree', '/api/memory/tree'],
    ['GET /api/memory/extractions', '/api/memory/extractions'],
    ['GET /api/memory/verifications', '/api/memory/verifications'],
    ['GET /api/memory/x1', '/api/memory/:id'],
    ['GET /api/memory/index', '/api/memory/:id'],
    ['GET /api/memory/config', '/api/memory/:id'],
    ['GET /api/runs', '/api/runs'],
    ['GET /api/runs/x1', '/api/runs/:runId'],
    ['GET /api/routines/x1/runs', '/api/routines/:id/runs'],
    // The connectors group reports through its own sink shape: the operation name says which route ran.
    ['GET /api/connectors/storage', 'connectors/storage.list'],
    ['GET /api/connectors/storage/x1', 'connectors/storage.get'],
  ])('%s is answered by the route registered as %s', async (route, answeredBy) => {
    const before = harness.internalErrors.length;
    const answer = await probe({ harness, route });
    expect(answer.summary).toBe('500 INTERNAL_ERROR');
    const report = expectRedactedInternalError({ answer, reports: harness.internalErrors.slice(before) as InternalErrorReport[] });
    const ranAs = report.path === undefined ? report.logSource : `${String(report.method).toUpperCase()} ${report.path}`;
    expect(ranAs).toBe(answeredBy.startsWith('/') ? `GET ${answeredBy}` : answeredBy);
  });

  it.each(['POST /api/memory/index', 'DELETE /api/runs/x1'])('%s matches no registration and gets the framework\'s own 404', async (route) => {
    const answer = await probe({ harness, route });
    expect(answer.status).toBe(404);
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});
