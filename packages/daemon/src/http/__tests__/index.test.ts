import { describe, expect, it } from 'vitest';
import * as HttpBarrel from '../index.js';

/** Barrel-only smoke coverage ensures hosts can import the daemon route surface directly. */
// PARITY: the moved barrel retains the published route methods, paths and factories.
describe('@jini-ai/daemon/http barrel', () => {
  it('re-exports run lifecycle HTTP routes and registrars', () => {
    expect(HttpBarrel.runStartRoute.path).toBe('/api/runs');
    expect(HttpBarrel.runStatusRoute.path).toBe('/api/runs/:runId');
    expect(HttpBarrel.runCancelRoute.path).toBe('/api/runs/:runId/cancel');
    expect(typeof HttpBarrel.registerRunEventStream).toBe('function');
    expect(typeof HttpBarrel.registerRunRoutes).toBe('function');
  });

  it('re-exports the attachment upload capability: routes, store, and helpers', () => {
    expect(HttpBarrel.ATTACHMENTS_ROUTE_PATH).toBe('/api/attachments');
    expect(typeof HttpBarrel.registerAttachmentRoutes).toBe('function');
    expect(typeof HttpBarrel.createDiskAttachmentStore).toBe('function');
    expect(typeof HttpBarrel.handleAttachmentUpload).toBe('function');
    expect(typeof HttpBarrel.handleAttachmentCleanup).toBe('function');
    expect(typeof HttpBarrel.sanitizeAttachmentName).toBe('function');
    expect(typeof HttpBarrel.detectAttachmentKind).toBe('function');
    expect(typeof HttpBarrel.writeBoundedAttachmentBody).toBe('function');
    expect(typeof HttpBarrel.isUnchangedAttachment).toBe('function');
    expect(new HttpBarrel.AttachmentRejectedError({ reason: 'invalid-batch', message: 'nope' }).reason).toBe('invalid-batch');
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
