import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { test } from "vitest";

import { pgContentSchemaSql } from "../testing/content-schema.js";
import { legacyPgHelpers, pgFixtureFromEnv } from "../testing/pg-fixture.js";
import { postgresDatabaseHelpers, postgresUrlFor } from "../testing/postgres-database.js";

/**
 * @file The internal Postgres test helpers, without a Postgres server: which server and role the
 * env selects, the exact psql commands each helper issues (through the fixture's subprocess port),
 * the URLs they hand out, and that the copied content schema is valid Postgres.
 */

/** A psql stand-in: records each argv and answers with the next scripted status (default 0). */
function fakePsql(statuses: number[] = []) {
  const calls: string[][] = [];
  const spawnSync = (_binary: string, args: string[]) => {
    calls.push(args);
    const status = statuses.shift() ?? 0;
    return { status, stdout: status === 0 ? "out" : "", stderr: status === 0 ? "" : "boom" };
  };
  return { calls, spawnSync };
}

/** The `-h/-U/-p/-d` connection part of a psql argv, and its `-c` command. */
const target = (args: string[]) => ({ connection: args.slice(0, args.indexOf("-v")), command: args.at(-1) });

test("the fixture follows libpq's env vars, defaulting to the /tmp socket and the OS user", () => {
  const defaults = fakePsql();
  pgFixtureFromEnv({ env: {}, username: "alice" }, { spawnSync: defaults.spawnSync }).psql({ database: "db", sql: "SELECT 1" });
  assert.deepEqual(target(defaults.calls[0] ?? []).connection, ["-h", "/tmp", "-U", "alice", "-d", "db"]);

  const configured = fakePsql();
  pgFixtureFromEnv({ env: { PGHOST: "/var/run/postgresql", PGUSER: "bob", PGPORT: "6543" }, username: "alice" }, { spawnSync: configured.spawnSync })
    .psql({ database: "db", sql: "SELECT 1" });
  assert.deepEqual(target(configured.calls[0] ?? []).connection, ["-h", "/var/run/postgresql", "-U", "bob", "-p", "6543", "-d", "db"]);
});

test("the positional helpers run the fixture's commands and surface its results and refusals", () => {
  const psql = fakePsql([0, 0, 0, 0, 1]);
  const helpers = legacyPgHelpers({ fixture: pgFixtureFromEnv({ env: {}, username: "alice" }, { spawnSync: psql.spawnSync }) });

  assert.deepEqual(helpers.psql("app_db", "SELECT 1"), { ok: true, stdout: "out", stderr: "" });
  helpers.recreateDatabase("app_db");
  helpers.dropDatabase("app_db");
  assert.throws(() => helpers.dropDatabase("busy_db"), /^Error: failed to drop fixture database "busy_db": boom$/);

  assert.deepEqual(psql.calls.map(target), [
    { connection: ["-h", "/tmp", "-U", "alice", "-d", "app_db"], command: "SELECT 1" },
    { connection: ["-h", "/tmp", "-U", "alice", "-d", "postgres"], command: "DROP DATABASE IF EXISTS app_db;" },
    { connection: ["-h", "/tmp", "-U", "alice", "-d", "postgres"], command: "CREATE DATABASE app_db;" },
    { connection: ["-h", "/tmp", "-U", "alice", "-d", "postgres"], command: "DROP DATABASE IF EXISTS app_db;" },
    { connection: ["-h", "/tmp", "-U", "alice", "-d", "postgres"], command: "DROP DATABASE IF EXISTS busy_db;" },
  ]);
});

test("database URLs use the socket host and role from the env, encoded, with a port only when one is set", () => {
  assert.equal(postgresUrlFor({ name: "app_db", env: {}, username: "alice" }), "postgresql://alice@/app_db?host=%2Ftmp");
  assert.equal(
    postgresUrlFor({ name: "app_db", env: { PGHOST: "/var/run/pg sock", PGUSER: "ops@team", PGPORT: "6543" }, username: "alice" }),
    "postgresql://ops%40team@/app_db?host=%2Fvar%2Frun%2Fpg%20sock&port=6543"
  );
});

test("a fresh database is recreated before its URL is returned; a content database also gets the content schema", () => {
  const events: string[] = [];
  let schemaStatus = true;
  const helpers = postgresDatabaseHelpers({
    helpers: {
      recreateDatabase: (name) => void events.push(`recreate ${name}`),
      psql: (name, sql) => (events.push(`psql ${name}: ${sql}`), { ok: schemaStatus, stdout: "", stderr: schemaStatus ? "" : "permission denied" }),
    },
    env: { PGPORT: "6543" },
    username: "alice",
  });

  assert.equal(helpers.freshPostgresDatabase("plain_db"), "postgresql://alice@/plain_db?host=%2Ftmp&port=6543");
  assert.equal(helpers.freshPostgresContentDatabase("content_db"), "postgresql://alice@/content_db?host=%2Ftmp&port=6543");
  assert.deepEqual(events, ["recreate plain_db", "recreate content_db", `psql content_db: ${pgContentSchemaSql()}`]);

  schemaStatus = false;
  assert.throws(() => helpers.freshPostgresContentDatabase("locked_db"), /^Error: creating the content schema in "locked_db" failed: permission denied$/);
});

test("the copied content schema is valid Postgres: two tables, entries referencing items", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(pgContentSchemaSql());
    await db.exec("INSERT INTO items VALUES ('i1', 'first'); INSERT INTO entries VALUES ('e1', 'i1'), ('e2', NULL)");
    await assert.rejects(db.exec("INSERT INTO entries VALUES ('e3', 'missing')"), /foreign key/);
    const tables = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
    assert.deepEqual(tables.rows.map((row) => row.table_name), ["entries", "items"]);
  } finally {
    await db.close();
  }
});
