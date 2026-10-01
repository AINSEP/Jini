/**
 * @file `@jini-ai/db/postgres`: node-postgres kernels — a pooled one for any Postgres server, and a
 * one-connection one for a PGlite owner's Unix socket — plus their storage ops. Never imports `pg`
 * at runtime — pass your own module (`import pg from "pg"`).
 */
export { openPostgresKernel } from "./driver.js";
export { openPgliteSocketKernel } from "./pglite-socket.js";
export { postgresOps } from "./ops.js";
export { type PgModule, type PgPool, type PgPoolOptions, pgTypesFor } from "./types.js";
