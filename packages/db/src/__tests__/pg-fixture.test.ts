import assert from "node:assert/strict";
import { test } from "vitest";
import { createPgFixture, type PgFixtureOptions } from "../pg-fixture.js";

type ProcessResult = ReturnType<NonNullable<PgFixtureOptions["spawnSync"]>>;

// Replace execution only: every assertion still exercises the fixture's real command selection.
function harness(required: { results: ProcessResult[]; port?: string }, _optional = {}) {
  const calls: string[][] = [];
  const results = [...required.results];
  const fixture = createPgFixture({ host: "/fixture-socket", user: "fixture-role", port: required.port }, {
    spawnSync(binary, args, options) {
      assert.equal(binary, "psql");
      assert.deepEqual(options, { encoding: "utf8" });
      calls.push(args);
      const result = results.shift();
      assert.ok(result, "unexpected extra subprocess");
      return result;
    },
  });
  return { fixture, calls };
}

test("queries retain server, role, port, database and quiet fail-fast flags", () => {
  const { fixture, calls } = harness({ results: [{ status: 0, stdout: "1\n", stderr: "" }], port: "5544" });
  assert.deepEqual(fixture.psql({ database: "isolated_fixture", sql: "SELECT 1;" }), {
    ok: true, stdout: "1\n", stderr: "",
  });
  assert.deepEqual(calls, [["-h", "/fixture-socket", "-U", "fixture-role", "-p", "5544", "-d", "isolated_fixture", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", "SELECT 1;"]]);
});

test("recreation and cleanup use the fixed admin database and caller-selected target", () => {
  const success = { status: 0, stdout: "", stderr: "" };
  const { fixture, calls } = harness({ results: [success, success, success] });
  fixture.recreateDatabase({ database: "isolated_fixture" });
  fixture.dropDatabase({ database: "isolated_fixture" });
  assert.deepEqual(calls.map(args => args[args.indexOf("-c") + 1]), [
    "DROP DATABASE IF EXISTS isolated_fixture;", "CREATE DATABASE isolated_fixture;", "DROP DATABASE IF EXISTS isolated_fixture;",
  ]);
  for (const args of calls) {
    assert.equal(args[args.indexOf("-d") + 1], "postgres");
    assert.equal(args.includes("-p"), false);
  }
});

test("a refused DROP prevents CREATE and returns the exact diagnostic", () => {
  const { fixture, calls } = harness({ results: [{ status: 1, stdout: "", stderr: "DROP refusal" }] });
  assert.throws(() => fixture.recreateDatabase({ database: "isolated_fixture" }), {
    message: 'failed to drop fixture database "isolated_fixture": DROP refusal',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.at(-1), "DROP DATABASE IF EXISTS isolated_fixture;");
});

test("CREATE and cleanup refusals retain their database-specific diagnostics", () => {
  const { fixture } = harness({ results: [
    { status: 0, stdout: "", stderr: "" },
    { status: 1, stdout: "", stderr: "CREATE refusal" },
    { status: 1, stdout: "", stderr: "DROP refusal" },
  ] });
  assert.throws(() => fixture.recreateDatabase({ database: "isolated_fixture" }), {
    message: 'failed to create fixture database "isolated_fixture": CREATE refusal',
  });
  assert.throws(() => fixture.dropDatabase({ database: "isolated_fixture" }), {
    message: 'failed to drop fixture database "isolated_fixture": DROP refusal',
  });
});

test("missing subprocess output becomes empty strings and launch errors throw", () => {
  const { fixture } = harness({ results: [
    { status: null, stdout: null, stderr: null },
    { status: null, stdout: null, stderr: null, error: new Error("launch refusal") },
  ] });
  assert.deepEqual(fixture.psql({ database: "isolated_fixture", sql: "SELECT 1;" }), {
    ok: false, stdout: "", stderr: "",
  });
  assert.throws(() => fixture.psql({ database: "isolated_fixture", sql: "SELECT 1;" }), {
    message: 'psql could not be run (launch refusal). This test suite requires a local psql binary on PATH and a Postgres server reachable at host "/fixture-socket" as role "fixture-role" — see this file\'s own doc.',
  });
});
