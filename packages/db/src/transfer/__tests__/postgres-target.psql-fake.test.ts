import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPsqlPostgresTarget, type PsqlProcess, type PsqlSpawn } from "../postgres-target.js";
import { COUNT_MISMATCH_SIGNAL, FOREIGN_SCHEMA_SIGNAL } from "../signals.js";

/** L2 §4 postgres-target via an injected psql fake (no real Postgres): PG* parent env is dropped
 *  while other env passes, argv is pinned, and stderr classification picks the right line. */
function fakePsql({ code = 0, stdout = "", stderr = "", startError = false }: { code?: number; stdout?: string; stderr?: string; startError?: boolean }) {
  const calls: Array<{ args: readonly string[]; env: Record<string, string>; stdin: string }> = [];
  const spawn: PsqlSpawn = (args, { env }) => {
    const child = new EventEmitter() as EventEmitter & PsqlProcess;
    const stdin = new PassThrough(); const out = new PassThrough(); const err = new PassThrough();
    Object.assign(child, { stdin, stdout: out, stderr: err });
    const call = { args, env, stdin: "" };
    calls.push(call);
    stdin.on("data", (chunk: Buffer) => { call.stdin += chunk.toString(); });
    stdin.on("finish", () => {
      if (startError) { child.emit("error", new Error("ENOENT")); return; }
      out.end(stdout); err.end(stderr);
      setImmediate(() => child.emit("close", code));
    });
    return child;
  };
  return { spawn, calls };
}
const URL_ = "postgres://u:p@db.test:5433/app";

describe("psql adapter", () => {
  it("drops every PG* parent variable, keeps the rest, and pins argv for a query", async () => {
    const psql = fakePsql({ stdout: "a\tb\n\nc\td\n" });
    const target = createPsqlPostgresTarget({ connectionString: URL_ }, { spawnProcess: psql.spawn, parentEnv: { PATH: "/bin", PGPASSWORD: "leak", PGHOST: "evil", PG: "x", pgx: "lower-kept", UNSET: undefined } });
    await expect(target.query("select 1")).resolves.toEqual({ ok: true, value: [["a", "b"], ["c", "d"]] });
    const { args, env } = psql.calls[0]!;
    expect(args).toEqual(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "\t", "-c", "select 1"]);
    expect(env).toEqual({ PATH: "/bin", pgx: "lower-kept", PGHOST: "db.test", PGPORT: "5433", PGDATABASE: "app", PGUSER: "u", PGPASSWORD: "p", PGCONNECT_TIMEOUT: "5", PGAPPNAME: "database-transfer" });
    expect(target.describe()).toEqual({ host: "db.test", port: "5433", database: "app", user: "u" });
  });

  it("runScript streams every chunk to stdin and returns null on success", async () => {
    const psql = fakePsql({});
    const target = createPsqlPostgresTarget({ connectionString: URL_ }, { spawnProcess: psql.spawn, parentEnv: {} });
    await expect(target.runScript(["BEGIN;", "COMMIT;"])).resolves.toEqual({ ok: true, value: null });
    expect(psql.calls[0]!.args).toEqual(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"]);
    expect(psql.calls[0]!.stdin).toBe("BEGIN;COMMIT;");
  });

  it("a psql that cannot start reports a fixed message", async () => {
    const target = createPsqlPostgresTarget({ connectionString: URL_ }, { spawnProcess: fakePsql({ startError: true }).spawn, parentEnv: {} });
    await expect(target.query("x")).resolves.toEqual({ ok: false, error: "psql could not be started" });
  });

  it.each([
    ["foreign schema signal after a notice line", `NOTICE: hi\npsql:<stdin>:3: ERROR:  ${FOREIGN_SCHEMA_SIGNAL}\n`, { ok: false, error: FOREIGN_SCHEMA_SIGNAL }],
    ["count mismatch with a valid table", `\n  \npsql:<stdin>:9: ERROR:  ${COUNT_MISMATCH_SIGNAL} posts\n`, { ok: false, error: `${COUNT_MISMATCH_SIGNAL} posts` }],
    ["count mismatch with an unsafe table name", `ERROR: ${COUNT_MISMATCH_SIGNAL} bad-name;drop\n`, { ok: false, error: `${COUNT_MISMATCH_SIGNAL} [redacted]` }],
    ["count mismatch with trailing junk", `ERROR: ${COUNT_MISMATCH_SIGNAL} posts extra\n`, { ok: false, error: `${COUNT_MISMATCH_SIGNAL} [redacted]` }],
    ["FATAL picked over an earlier plain line", "warning: noise\nFATAL: password authentication failed\n", { ok: false, error: "psql request failed" }],
    ["COPY context names the table (quotes stripped)", 'ERROR: bad\nCONTEXT:  COPY "site_a"."posts", line 3\n', { ok: false, error: "psql request failed", copyTable: "site_a.posts" }],
    ["empty stderr", "", { ok: false, error: "psql request failed" }],
  ])("classifies %s", async (_label, stderr, expected) => {
    const target = createPsqlPostgresTarget({ connectionString: URL_ }, { spawnProcess: fakePsql({ code: 3, stderr }).spawn, parentEnv: {} });
    await expect(target.runScript(["x"])).resolves.toEqual(expected);
  });
});
