import type { ExpressionBuilder } from "kysely";

/** Any table, any column: the shape a registry-driven query sees. A type alias, not an interface:
 *  Kysely's `withTables` needs the implicit index signature only an alias has. */
export type LooseTables = Record<string, Record<string, unknown>>;

/** The expression builder a registry-driven `WHERE` is written against. */
export type LooseExpressionBuilder = ExpressionBuilder<LooseTables, string>;

