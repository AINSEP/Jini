/**
 * @module @jini/node-host
 *
 * The Node.js host preset (extraction-plan.md §2.4): `createLocalNodeDaemon`, the piece that
 * assembles `@jini/core`/`@jini/daemon`/`@jini/sqlite`/`@jini/http` into an actually-runnable
 * daemon process, plus the generic host-lifecycle primitives it's built on. See `source-map.md`
 * for full provenance and scope-decision notes.
 */
export type {
  CreateLocalNodeDaemonConfig,
  KernelBoundIds,
  LocalNodeDaemon,
  LocalNodeHttpExtension,
  LocalNodeHttpExtensionContext,
} from './create-local-node-daemon.js';
export { buildDaemonDbOperations, createLocalNodeDaemon, resolveBoundPort, resolveReportHost } from './create-local-node-daemon.js';

export { createFrontendControl } from './frontend-control.js';
export type {
  CreateFrontendControlOptions,
  FrontendBindErrorContext,
  FrontendControl,
} from './frontend-control.js';

export type { CloseHttpServerOptions } from './host-bootstrap.js';
export { DEFAULT_DAEMON_BIND_HOST, closeHttpServer, normalizeDaemonBindHost } from './host-bootstrap.js';
