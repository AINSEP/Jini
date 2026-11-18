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
    'GET /health []',
    'GET /api/health []',
    'GET /ready []',
    'GET /api/ready []',
    'GET /version []',
    'GET /api/version []',
  ],
  'tool-execution-routes': [
    'POST /internal/tool-executions [anonymous/3, jsonParser/3, anonymous/2, bodyParserFailure/4]',
    'GET /internal/tool-catalog [anonymous/3, anonymous/2]',
  ],
  'attachment-lookup-routes': [
    'POST /internal/attachment-lookup [jsonParser/3, anonymous/2]',
  ],
  'runs': [
    'POST /api/runs [same-origin]',
    'GET /api/runs []',
    'GET /api/runs/:runId []',
    'POST /api/runs/:runId/cancel [same-origin]',
    'POST /api/runs/:runId/messages [same-origin]',
    'GET /api/runs/:runId/events []',
  ],
  'agents': [
    'GET /api/agents []',
    'POST /api/agents/rescan [same-origin]',
  ],
  'host-tools': [
    'GET /api/editors []',
    'POST /api/resources/:resourceRef/open-in [same-origin]',
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
    'GET /api/daemon/db [same-origin]',
    'POST /api/daemon/db/verify [same-origin]',
    'POST /api/daemon/db/vacuum [same-origin]',
  ],
  'tool-catalog': [
    'GET /api/tools/search [same-origin]',
    'GET /api/tools/:id [same-origin]',
  ],
  'delegated-tools': [
    'POST /api/delegated-tool-calls [same-origin]',
  ],
  'connectors': [
    'POST /api/connectors/auth/signup [same-origin]',
    'POST /api/connectors/auth/signin [same-origin]',
    'POST /api/connectors/auth/signout [same-origin]',
    'POST /api/connectors/auth/session [same-origin]',
    'PUT /api/connectors/storage/:key [same-origin]',
    'GET /api/connectors/storage/:key []',
    'DELETE /api/connectors/storage/:key [same-origin]',
    'GET /api/connectors/storage []',
    'POST /api/connectors/db/:collection [same-origin]',
    'GET /api/connectors/db/:collection/:id []',
    'PATCH /api/connectors/db/:collection/:id [same-origin]',
    'DELETE /api/connectors/db/:collection/:id [same-origin]',
    'GET /api/connectors/db/:collection []',
    'POST /api/connectors/realtime/:channel/publish [same-origin]',
  ],
  'research': [
    'POST /api/research/search [same-origin]',
  ],
  'xai': [
    'POST /api/xai/oauth/start [same-origin]',
    'POST /api/xai/oauth/complete [same-origin]',
    'POST /api/xai/oauth/cancel [same-origin]',
    'GET /api/xai/auth/status [same-origin]',
    'POST /api/xai/oauth/disconnect [same-origin]',
    'POST /api/xai/search [same-origin]',
  ],
  'remote-run-events': [
    'POST /api/runs/:runId/tool-use [remote-bridge-token]',
    'POST /api/runs/:runId/tool-result [remote-bridge-token]',
  ],
  'memory': [
    'GET /api/memory []',
    'GET /api/memory/tree []',
    'PATCH /api/memory/tree/:id [same-origin]',
    'PUT /api/memory/index [same-origin]',
    'PATCH /api/memory/config [same-origin]',
    'GET /api/memory/events [same-origin]',
    'GET /api/memory/extractions []',
    'DELETE /api/memory/extractions [same-origin]',
    'DELETE /api/memory/extractions/:id [same-origin]',
    'GET /api/memory/verifications []',
    'DELETE /api/memory/verifications [same-origin]',
    'DELETE /api/memory/verifications/:id [same-origin]',
    'POST /api/memory [same-origin]',
    'GET /api/memory/:id []',
    'PUT /api/memory/:id [same-origin]',
    'DELETE /api/memory/:id [same-origin]',
  ],
  'routines': [
    'GET /api/routines []',
    'POST /api/routines [same-origin]',
    'GET /api/routines/:id []',
    'PATCH /api/routines/:id [same-origin]',
    'DELETE /api/routines/:id [same-origin]',
    'POST /api/routines/:id/run [same-origin]',
    'GET /api/routines/:id/runs []',
  ],
  'media': [
    'POST /api/media/generate [same-origin]',
    'GET /api/media/tasks/:id []',
    'DELETE /api/media/tasks/:id [same-origin]',
    'GET /api/media/tasks []',
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

  it('is 100 routes and 1 path gate (the scoped frontend-session mount adds its own stream and response route; the two remote-run-event gates now sit in front of their routes as `remote-bridge-token`)', async () => {
    harness = await startRouteHarness();
    const scoped = harness.routes.filter((route) => route.family === 'frontend-sessions (scoped)');
    const rest = harness.routes.filter((route) => route.family !== 'frontend-sessions (scoped)');
    const isGate = (route: { method: string; layers: readonly string[] }) => route.method === 'USE' || route.layers.at(-1)?.endsWith('/3') === true;
    // message-relay's claim handler takes `next` to hand its errors on; it answers, so it is a route, not a gate.
    const gates = [...rest, ...scoped].filter((route) => isGate(route) && route.family !== 'message-relay');
    expect(rest.filter((route) => route.method !== 'USE')).toHaveLength(100);
    expect(gates.map((route) => `${route.method} ${route.path}`)).toEqual([
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
