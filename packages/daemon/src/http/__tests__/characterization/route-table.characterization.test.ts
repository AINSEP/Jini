import { afterEach, describe, expect, it } from 'vitest';
import { describeRouteTable, startRouteHarness, type RouteHarness } from './harness.js';

/**
 * T1: every route the daemon's HTTP folder registers, as an inline literal (never a regenerated
 * snapshot): verb, path and the layers in front of the answer, in mount order, by route file.
 * A lost route, a changed path, a lost gate or a reordered gate changes a line here.
 *
 * Reading a line: `METHOD path [layers]`. A layer is `name/arity`: arity 3 is a gate (it can pass
 * the request on), `jsonParser/3` is a body parser the route brings itself, arity 4 is an error
 * handler, and the last arity-2 layer answers. `USE` lines are path gates with no answer of their
 * own. Same-origin gates live inside the answering layer and are pinned per route by the response
 * matrix beside this file.
 */
const ROUTE_TABLE: Readonly<Record<string, readonly string[]>> = {
  'health': [
    'GET /health [anonymous/2]',
    'GET /api/health [anonymous/2]',
    'GET /ready [anonymous/2]',
    'GET /api/ready [anonymous/2]',
    'GET /version [anonymous/2]',
    'GET /api/version [anonymous/2]',
  ],
  'tool-execution-routes': [
    'POST /internal/tool-executions [anonymous/3, jsonParser/3, anonymous/2, bodyParserFailure/4]',
    'GET /internal/tool-catalog [anonymous/3, anonymous/2]',
  ],
  'attachment-lookup-routes': [
    'POST /internal/attachment-lookup [jsonParser/3, anonymous/2]',
  ],
  'runs': [
    'POST /api/runs [anonymous/2]',
    'GET /api/runs [anonymous/2]',
    'GET /api/runs/:runId [anonymous/2]',
    'POST /api/runs/:runId/cancel [anonymous/2]',
    'POST /api/runs/:runId/messages [anonymous/2]',
    'GET /api/runs/:runId/events [anonymous/2]',
  ],
  'agents': [
    'GET /api/agents []',
    'POST /api/agents/rescan [same-origin]',
  ],
  'host-tools': [
    'GET /api/editors [anonymous/2]',
    'POST /api/resources/:resourceRef/open-in [anonymous/2]',
  ],
  'model-proxy': [
    'POST /api/proxy/anthropic/stream [anonymous/2]',
    'POST /api/proxy/openai/stream [anonymous/2]',
    'POST /api/proxy/azure/stream [anonymous/2]',
    'POST /api/proxy/google/stream [anonymous/2]',
    'POST /api/proxy/ollama/stream [anonymous/2]',
    'POST /api/proxy/:provider/stream [anonymous/2]',
  ],
  'active-context': [
    'POST /api/active [same-origin]',
    'GET /api/active [same-origin]',
  ],
  'terminals': [
    'GET /api/terminals [anonymous/2]',
    'POST /api/terminals [anonymous/2]',
    'POST /api/terminals/:id/stdin [anonymous/2]',
    'POST /api/terminals/:id/resize [anonymous/2]',
    'POST /api/terminals/:id/kill [anonymous/2]',
    'DELETE /api/terminals/:id [anonymous/2]',
    'GET /api/terminals/:id/stream [anonymous/2]',
  ],
  'db-ops': [
    'GET /api/daemon/db [anonymous/2]',
    'POST /api/daemon/db/verify [anonymous/2]',
    'POST /api/daemon/db/vacuum [anonymous/2]',
  ],
  'tool-catalog': [
    'GET /api/tools/search [same-origin]',
    'GET /api/tools/:id [same-origin]',
  ],
  'delegated-tools': [
    'POST /api/delegated-tool-calls [same-origin]',
  ],
  'connectors': [
    'POST /api/connectors/auth/signup [anonymous/2]',
    'POST /api/connectors/auth/signin [anonymous/2]',
    'POST /api/connectors/auth/signout [anonymous/2]',
    'POST /api/connectors/auth/session [anonymous/2]',
    'PUT /api/connectors/storage/:key [anonymous/2]',
    'GET /api/connectors/storage/:key [anonymous/2]',
    'DELETE /api/connectors/storage/:key [anonymous/2]',
    'GET /api/connectors/storage [anonymous/2]',
    'POST /api/connectors/db/:collection [anonymous/2]',
    'GET /api/connectors/db/:collection/:id [anonymous/2]',
    'PATCH /api/connectors/db/:collection/:id [anonymous/2]',
    'DELETE /api/connectors/db/:collection/:id [anonymous/2]',
    'GET /api/connectors/db/:collection [anonymous/2]',
    'POST /api/connectors/realtime/:channel/publish [anonymous/2]',
  ],
  'research': [
    'POST /api/research/search [same-origin]',
  ],
  'xai': [
    'POST /api/xai/oauth/start [anonymous/2]',
    'POST /api/xai/oauth/complete [anonymous/2]',
    'POST /api/xai/oauth/cancel [anonymous/2]',
    'GET /api/xai/auth/status [anonymous/2]',
    'POST /api/xai/oauth/disconnect [anonymous/2]',
    'POST /api/xai/search [anonymous/2]',
  ],
  'remote-run-events': [
    'USE /api/runs/:runId/tool-use [anonymous/3]',
    'USE /api/runs/:runId/tool-result [anonymous/3]',
    'POST /api/runs/:runId/tool-use [anonymous/2]',
    'POST /api/runs/:runId/tool-result [anonymous/2]',
  ],
  'memory': [
    'GET /api/memory [anonymous/2]',
    'GET /api/memory/tree [anonymous/2]',
    'PATCH /api/memory/tree/:id [anonymous/2]',
    'PUT /api/memory/index [anonymous/2]',
    'PATCH /api/memory/config [anonymous/2]',
    'GET /api/memory/events [anonymous/2]',
    'GET /api/memory/extractions [anonymous/2]',
    'DELETE /api/memory/extractions [anonymous/2]',
    'DELETE /api/memory/extractions/:id [anonymous/2]',
    'GET /api/memory/verifications [anonymous/2]',
    'DELETE /api/memory/verifications [anonymous/2]',
    'DELETE /api/memory/verifications/:id [anonymous/2]',
    'POST /api/memory [anonymous/2]',
    'GET /api/memory/:id [anonymous/2]',
    'PUT /api/memory/:id [anonymous/2]',
    'DELETE /api/memory/:id [anonymous/2]',
  ],
  'routines': [
    'GET /api/routines [anonymous/2]',
    'POST /api/routines [anonymous/2]',
    'GET /api/routines/:id [anonymous/2]',
    'PATCH /api/routines/:id [anonymous/2]',
    'DELETE /api/routines/:id [anonymous/2]',
    'POST /api/routines/:id/run [anonymous/2]',
    'GET /api/routines/:id/runs [anonymous/2]',
  ],
  'media': [
    'POST /api/media/generate [anonymous/2]',
    'GET /api/media/tasks/:id [anonymous/2]',
    'DELETE /api/media/tasks/:id [anonymous/2]',
    'GET /api/media/tasks [anonymous/2]',
  ],
  'frontend-sessions': [
    'GET /api/frontend-sessions/stream [anonymous/2]',
    'POST /api/frontend-sessions/:sessionId/responses [anonymous/2]',
  ],
  'frontend-sessions (scoped)': [
    'GET /api/scoped-frontend-sessions/stream [anonymous/2]',
    'POST /api/scoped-frontend-sessions/:sessionId/responses [anonymous/3]',
    'POST /api/scoped-frontend-sessions/:sessionId/responses [anonymous/2]',
  ],
  'daemon-status': [
    'GET /api/daemon/status []',
    'POST /api/daemon/shutdown [same-origin]',
  ],
  'component-catalog': [
    'GET /api/components/search [same-origin]',
    'GET /api/components/:id [same-origin]',
  ],
  'attachments': [
    'POST /api/attachments [anonymous/2]',
    'DELETE /api/attachments [anonymous/2]',
  ],
  'message-relay': [
    'POST /api/runs/:runId/messages/claim [anonymous/3]',
  ],
  'frontend-request-route': [
    'POST /api/frontend-requests [anonymous/2]',
  ],
};

let harness: RouteHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('daemon route table', () => {
  it('registers exactly these routes and gates, in this order', async () => {
    harness = await startRouteHarness();
    expect(describeRouteTable({ routes: harness.routes })).toEqual(ROUTE_TABLE);
  });

  it('is 100 routes and 3 path gates (the scoped frontend-session mount adds its own stream and response route)', async () => {
    harness = await startRouteHarness();
    const scoped = harness.routes.filter((route) => route.family === 'frontend-sessions (scoped)');
    const rest = harness.routes.filter((route) => route.family !== 'frontend-sessions (scoped)');
    const isGate = (route: { method: string; layers: readonly string[] }) => route.method === 'USE' || route.layers.at(-1)?.endsWith('/3') === true;
    // message-relay's claim handler takes `next` to hand its errors on; it answers, so it is a route, not a gate.
    const gates = [...rest, ...scoped].filter((route) => isGate(route) && route.family !== 'message-relay');
    expect(rest.filter((route) => route.method !== 'USE')).toHaveLength(100);
    expect(gates.map((route) => `${route.method} ${route.path}`)).toEqual([
      'USE /api/runs/:runId/tool-use',
      'USE /api/runs/:runId/tool-result',
      'POST /api/scoped-frontend-sessions/:sessionId/responses',
    ]);
    expect(scoped.filter((route) => !isGate(route))).toHaveLength(2);
  });

  it('answers one registration per method and path: no route is mounted twice', async () => {
    harness = await startRouteHarness();
    const answering = harness.routes.filter((route) => route.method !== 'USE' && route.layers.at(-1)?.endsWith('/3') !== true || route.family === 'message-relay');
    const keys = answering.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
