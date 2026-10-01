/**
 * @file `@jini-ai/db/kernel`: the storage kernel port, the kernel core every driver builds on, the
 * dialect helpers and introspection, and the storage-ops contract. Imports kysely and Node builtins
 * only — never a database driver (guard rule R12 checks it; `loads-without-driver.test.ts` proves it).
 */
export {
  type StorageCapabilities,
  type StorageCapability,
  type StorageDialect,
  type StorageKernel,
  type StorageTransport,
  UnsupportedCapabilityError,
} from "./port.js";
export { buildKernel, type KernelDriver } from "./kernel-core.js";
export { TurnLock } from "./turn-lock.js";
export {
  autoIdColumnSql,
  checkpointWal,
  type ColumnAffinity,
  type ColumnInfo,
  columnTypeSql,
  type IndexInfo,
  isUniqueViolation,
  jsonScalarEquals,
  jsonSet,
  jsonSortKey,
  jsonText,
  listColumns,
  listIndexes,
  listTables,
  nowIso,
  tableExists,
  toBool,
  toBytes,
} from "./dialect.js";
export { scopeToSchema } from "./schema-scope.js";
export { databaseFile, readSchemaShape, type SchemaShape, type TableShape } from "./schema-shape.js";
export { renderDatabaseTypes } from "./typegen.js";
export {
  outsideTransactionOf,
  StorageOpError,
  StorageOpNotSupportedError,
  type StorageOps,
  verifyLedgerReadBack,
} from "./ops.js";
export { PG_OID, PG_PARSERS, parseInt8 } from "./pg-types.js";
export { postgresLockKey } from "./postgres-lock.js";
export { PGLITE_SOCKET_FILE } from "./socket.js";
