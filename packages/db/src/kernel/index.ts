/**
 * @file `@jini-ai/db/kernel`: the storage kernel port, the kernel core every driver builds on, the
 * dialect helpers and introspection, and the storage-ops contract. Imports kysely and Node builtins
 * only — never a database driver (`import-isolation.test.ts` and `loads-without-driver.test.ts` prove it).
 */
export type { DbTransport, KyselyKernel } from "./port.js";
export { buildKernel, type KernelDriver } from "./kernel-core.js";
export { TurnLock } from "./turn-lock.js";
export {
  autoIdColumnSql,
  checkpointWal,
  type ColumnAffinity,
  columnTypeSql,
  type IndexInfo,
  jsonScalarEquals,
  jsonSet,
  jsonSortKey,
  jsonText,
  listColumns,
  listIndexes,
  listTables,
  nowIso,
  tableExists,
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
export { postgresLockKey } from "./postgres-lock.js";

export { withKernelSessionLock, kernelSessionPoolMax } from "./session-lock.js";
