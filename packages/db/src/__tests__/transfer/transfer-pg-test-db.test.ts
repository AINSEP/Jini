/** The live-Postgres test helpers, bound to a fake target: connection strings, statements and errors. */
import { expect, it } from "vitest";
import { createTransferPgTestDb } from "../../testing/transfer-pg-test-db.js";
import type { PostgresTargetPort, TargetResult } from "../../transfer/index.js";

function recording(answer: TargetResult<string[][]> = { ok: true, value: [] }) {
  const calls: { connectionString: string; statement: string }[] = [];
  const target = (connectionString: string): PostgresTargetPort => ({
    describe: () => ({ host: "localhost", port: "5432", database: "db", user: "u" }),
    query: async statement => { calls.push({ connectionString, statement }); return answer; },
    runScript: async () => ({ ok: true, value: null }),
  });
  return { calls, target };
}

it("builds local connection strings from the defaults or the PG environment overrides", () => {
  expect(createTransferPgTestDb({ env: {} }).connectionFor("scratch")).toBe("postgresql://la@localhost:5432/scratch");
  const ci = createTransferPgTestDb({ env: { PGUSER: "ci", PGPORT: "6543", PGHOST: "/var/run/postgresql" } });
  expect(ci.connectionFor("scratch")).toBe("postgresql://ci@localhost:6543/scratch?host=%2Fvar%2Frun%2Fpostgresql");
  expect(ci.connectionFor("scratch", "pw")).toBe("postgresql://ci:pw@localhost:6543/scratch?host=%2Fvar%2Frun%2Fpostgresql");
});

it("runs a statement against the named database and joins rows by newlines and cells by tabs", async () => {
  const fake = recording({ ok: true, value: [["1", "a"], ["2", "b"]] });
  const db = createTransferPgTestDb({ env: {} }, { target: fake.target });
  expect(await db.sql("scratch", "SELECT id, name FROM t")).toBe("1\ta\n2\tb");
  expect(fake.calls).toEqual([{ connectionString: "postgresql://la@localhost:5432/scratch", statement: "SELECT id, name FROM t" }]);
});

it("throws a failed statement's error prefixed with its database", async () => {
  const db = createTransferPgTestDb({ env: {} }, { target: recording({ ok: false, error: "psql request failed" }).target });
  await expect(db.sql("scratch", "SELECT 1")).rejects.toThrow("scratch: psql request failed");
});

it("recreates and drops a database only through the postgres admin database", async () => {
  const fake = recording();
  const db = createTransferPgTestDb({ env: {} }, { target: fake.target });
  await db.recreateDatabase("transfer_case");
  await db.dropDatabase("transfer_case");
  expect(fake.calls).toEqual([
    { connectionString: "postgresql://la@localhost:5432/postgres", statement: "DROP DATABASE IF EXISTS transfer_case" },
    { connectionString: "postgresql://la@localhost:5432/postgres", statement: "CREATE DATABASE transfer_case" },
    { connectionString: "postgresql://la@localhost:5432/postgres", statement: "DROP DATABASE IF EXISTS transfer_case" },
  ]);
});

it("defaults to the psql adapter, whose failure to reach a server surfaces as a database-prefixed error", async () => {
  // No server is contacted: the socket directory does not exist, so psql (or its absence) fails at once.
  const db = createTransferPgTestDb({ env: { PGHOST: "/nonexistent/jini-transfer-socket" } });
  await expect(db.sql("scratch", "SELECT 1")).rejects.toThrow(/^scratch: psql (request failed|could not be started)$/);
});
