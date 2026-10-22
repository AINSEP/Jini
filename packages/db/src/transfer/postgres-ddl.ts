/** Public named-argument DDL API; the moved ordering/constraint rationale is in internal-ddl.ts. */
import * as ddl from "./internal-ddl.js";
import type { TransferTable } from "./types.js";
const tag = (sqlTag = "transfer") => {
  if (!/^[a-z_][a-z0-9_]*$/.test(sqlTag)) throw new Error("invalid SQL dollar-quote tag");
  return sqlTag;
};
export function quoteIdent({ name }: { name: string }, _optional = {}) { return ddl.quoteIdent(name); }
export function quoteLiteral({ value }: { value: string }, _optional = {}) { return ddl.quoteLiteral(value); }
export function qualified({ schema, table }: { schema: string; table: string }, _optional = {}) { return ddl.qualified(schema, table); }
export function fitIdentifier({ name }: { name: string }, _optional = {}) { return ddl.fitIdentifier(name); }
export function createTableSql({ schema, table }: { schema: string; table: TransferTable }, _optional = {}) { return ddl.createTableSql(schema, table); }
export function indexSql({ schema, table }: { schema: string; table: TransferTable }, _optional = {}) { return ddl.indexSql(schema, table); }
export function reseedIdentitySql({ schema, table }: { schema: string; table: TransferTable }, optional: { sqlTag?: string | undefined } = {}) { return ddl.reseedIdentitySql(schema, table, tag(optional.sqlTag)); }
export function constraintSql({ schema, tables, unvalidatedTable }: { schema: string; tables: readonly TransferTable[]; unvalidatedTable: string }, optional: { sqlTag?: string | undefined } = {}) { return ddl.constraintSql(schema, tables, unvalidatedTable, tag(optional.sqlTag)); }
