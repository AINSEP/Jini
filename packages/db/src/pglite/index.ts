/** PGlite ownership and socket serving. The consumer supplies its PGlite class. */
export { startPgliteOwner, runningPgliteOwner, acquireOwnerLock, defaultPgliteSocketDir,
  assertSocketPathFits, ensurePrivateDir, PgliteOwnerLockedError, PGLITE_LOW_MEMORY_SETTINGS,
  pgliteLowMemoryStartParams, type PgliteOwner } from "./owner.js";
export { PgliteSocketServer, errorResponseFrame, type PgliteSocketServerOptions } from "./socket-server.js";
export type { PgliteClass } from "./types.js";
