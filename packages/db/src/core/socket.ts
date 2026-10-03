/**
 * @file Where a PGlite owner's Unix socket lives inside its socket directory. Shared by the owner
 * (`@jini-ai/db/pglite`) and the socket client (`@jini-ai/db/postgres`), which must agree on it and
 * must not import each other.
 */

/** The Postgres client convention: a client given `host=<dir>, port=5432` connects to this file. */
export const PGLITE_SOCKET_FILE = ".s.PGSQL.5432";
