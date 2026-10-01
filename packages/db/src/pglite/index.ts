/**
 * @file `@jini-ai/db/pglite`: the in-process PGlite driver, the PGlite owner (one process serving a
 * data dir on a private Unix socket) and its vendored socket server, and the PGlite storage ops.
 * Never imports `@electric-sql/pglite` at runtime — pass your own `PGlite` class.
 */
export { openPgliteKernel, type PgKernel } from "./driver.js";
export { PgliteDialect } from "./dialect.js";
export {
  acquireOwnerLock,
  assertSocketPathFits,
  defaultPgliteSocketDir,
  ensurePrivateDir,
  PGLITE_LOW_MEMORY_SETTINGS,
  PGLITE_SOCKET_FILE,
  pgliteLowMemoryStartParams,
  type PgliteOwner,
  PgliteOwnerLockedError,
  runningPgliteOwner,
  startPgliteOwner,
} from "./owner.js";
export { errorResponseFrame, PgliteSocketServer, type PgliteSocketServerOptions } from "./socket-server.js";
export { copyServedPgliteTo, type PgliteExclusive, pgliteOps, type PgliteRestore } from "./ops.js";
export type { PgliteClass } from "./types.js";
