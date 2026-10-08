/** Driver-neutral ports, artifact naming, and shared wire constants. No optional peers. */
// Connections may depend on core; core must never import a driver or ORM, so hosts using
// another backend can load these contracts without resolving a native dependency.
// There is deliberately no package-root barrel combining core and connection entries:
// Node executes every reachable static import rather than tree-shaking unused exports.
export { restorePointFilename, sanitizeForFilename } from "./artifact-naming.js";
export type { DbOpsPort, RestorePoint, RestoreCapability, RestoreCostClass, RestoreKind, WatermarkReader } from "./ports.js";
export { PGLITE_SOCKET_FILE } from "./socket.js";
export { PG_OID, PG_PARSERS, parseInt8 } from "./pg-types.js";

export { parseJsonOrUndef, row, rows } from "./row-values.js";
export type { DbRow, JsonObject } from "./row-values.js";
export type { TransferNaming } from './transfer-naming.js';
