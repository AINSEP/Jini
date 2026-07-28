import { describe, expect, it } from 'vitest';
import * as HttpBarrel from '../index.js';

/**
 * A barrel-only smoke test: every other test in this package imports its target
 * module directly, so the root barrel itself was never actually exercised.
 * Proves the public surface a host actually imports (`from '@jini-ai/http'`) really
 * re-exports what `source-map.md` documents.
 */
describe('@jini-ai/http barrel', () => {
  it('re-exports the Result helpers', () => {
    expect(typeof HttpBarrel.ok).toBe('function');
    expect(typeof HttpBarrel.err).toBe('function');
  });

  it('re-exports the origin-validation predicates, including the same-origin guard', () => {
    expect(typeof HttpBarrel.isLocalSameOrigin).toBe('function');
    expect(typeof HttpBarrel.isAllowedBrowserOrigin).toBe('function');
    expect(typeof HttpBarrel.allowedBrowserPorts).toBe('function');
    expect(typeof HttpBarrel.configuredAllowedOrigins).toBe('function');
  });

  it('re-exports the pack-http registrar', () => {
    expect(typeof HttpBarrel.mountPackHttp).toBe('function');
  });

  it('re-exports run lifecycle HTTP routes and registrars', () => {
    expect(HttpBarrel.runStartRoute.path).toBe('/api/runs');
    expect(HttpBarrel.runStatusRoute.path).toBe('/api/runs/:runId');
    expect(HttpBarrel.runCancelRoute.path).toBe('/api/runs/:runId/cancel');
    expect(typeof HttpBarrel.registerRunEventStream).toBe('function');
    expect(typeof HttpBarrel.registerRunRoutes).toBe('function');
  });

  it('re-exports the compat error helpers', () => {
    expect(typeof HttpBarrel.createCompatApiError).toBe('function');
    expect(typeof HttpBarrel.createCompatApiErrorResponse).toBe('function');
    expect(typeof HttpBarrel.sendCompatApiError).toBe('function');
  });

  it('re-exports the Express-mounting Adapter and security middleware flat at the root', () => {
    expect(typeof HttpBarrel.mountJsonRoute).toBe('function');
    expect(typeof HttpBarrel.registerApiBearerAuthMiddleware).toBe('function');
  });

  it('re-exports cancelRunsOwnedBy', () => {
    expect(typeof HttpBarrel.cancelRunsOwnedBy).toBe('function');
  });

  it('re-exports the host-tools editors route and registrar', () => {
    expect(typeof HttpBarrel.registerHostToolsRoutes).toBe('function');
    expect(HttpBarrel.hostEditorsRoute.path).toBe('/api/editors');
  });

  it('re-exports the active-context routes and registrar', () => {
    expect(typeof HttpBarrel.registerActiveContextRoutes).toBe('function');
    expect(HttpBarrel.setActiveRoute.path).toBe('/api/active');
    expect(HttpBarrel.getActiveRoute.path).toBe('/api/active');
    expect(HttpBarrel.ACTIVE_CONTEXT_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('re-exports the generic SSE primitive', () => {
    expect(typeof HttpBarrel.createSseChannel).toBe('function');
    expect(typeof HttpBarrel.requestedAfterCursor).toBe('function');
    expect(typeof HttpBarrel.sendRawApiError).toBe('function');
    expect(HttpBarrel.DEFAULT_MAX_QUEUED_SSE_EVENTS).toBe(1000);
  });

  it('re-exports the raw SSE primitive used by run-stream mounting (a distinct mechanism from createSseChannel)', () => {
    expect(typeof HttpBarrel.createSseResponse).toBe('function');
  });

  it('re-exports the AG-UI run-stream route core and its Express mounting registrar', () => {
    expect(typeof HttpBarrel.handleRunStreamRequest).toBe('function');
    expect(typeof HttpBarrel.registerRunStreamRoute).toBe('function');
    expect(HttpBarrel.RUN_STREAM_ROUTE_PATH).toBe('/api/runs/:runId/agui-stream');
  });

  it('re-exports the workspace-root port', () => {
    expect(typeof HttpBarrel.resolveWorkspaceRoot).toBe('function');
    expect(typeof HttpBarrel.denyAllWorkspaceRoots).toBe('function');
    expect(HttpBarrel.WorkspaceRootDeniedError).toBeDefined();
  });

  it('re-exports the daemon DB-ops routes and tool registrar', () => {
    expect(typeof HttpBarrel.createDaemonDbToolRegistrations).toBe('function');
    expect(typeof HttpBarrel.registerDaemonDbRoutes).toBe('function');
    expect(HttpBarrel.daemonDbInspectRoute.path).toBe('/api/daemon/db');
    expect(HttpBarrel.daemonDbVerifyRoute.path).toBe('/api/daemon/db/verify');
    expect(HttpBarrel.daemonDbVacuumRoute.path).toBe('/api/daemon/db/vacuum');
    expect(HttpBarrel.DB_INSPECT_TOOL_ID).toBe('daemon.db.inspect');
  });

  it('re-exports the delegated-tools route (the MCP-callback bridge)', () => {
    expect(typeof HttpBarrel.registerDelegatedToolRoutes).toBe('function');
    expect(HttpBarrel.delegatedToolExecuteRoute.path).toBe('/api/delegated-tool-calls');
    expect(typeof HttpBarrel.registerFrontendSessionRoutes).toBe('function');
    expect(typeof HttpBarrel.handleFrontendSessionStream).toBe('function');
    expect(typeof HttpBarrel.parseCapabilityQuery).toBe('function');
    expect(HttpBarrel.FRONTEND_SESSION_STREAM_ROUTE_PATH).toBe('/api/frontend-sessions/stream');
    expect(HttpBarrel.frontendSessionResponseRoute.path).toBe('/api/frontend-sessions/:sessionId/responses');
  });
});
