/**
 * The psql adapter's process contract, driven through an injected `spawnProcess` fake built on real
 * Node streams: argv and environment, row parsing, streamed scripts with backpressure, and how a
 * failed run is reduced to copier-owned codes without leaking server text.
 */
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, it } from "vitest";
import { createPsqlPostgresTarget, type PsqlProcess, type PsqlSpawn } from "../../transfer/index.js";

interface Launch { args: readonly string[]; env: Record<string, string> }
interface FakeRun { stdout?: string; stderr?: string; code?: number | null; startError?: boolean; stdinError?: boolean }

/** A psql stand-in: records what it was given, consumes stdin slowly, then answers as scripted. */
function fakePsql(run: FakeRun = {}) {
  const launches: Launch[] = [];
  const received: string[] = [];
  let writesRefused = 0;
  const spawnProcess: PsqlSpawn = (args, { env }) => {
    launches.push({ args, env });
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    // A 4-byte buffer and an asynchronous sink: any longer chunk is refused until `drain`.
    const stdin = new Writable({ highWaterMark: 4, write(chunk, _encoding, done) { received.push(String(chunk)); setImmediate(done); } });
    const write = stdin.write.bind(stdin);
    stdin.write = ((chunk: string) => { const accepted = write(chunk); if (!accepted) writesRefused++; return accepted; }) as typeof stdin.write;
    const answer = () => {
      if (run.stdout) stdout.write(run.stdout);
      if (run.stderr) stderr.write(run.stderr);
      setImmediate(() => child.emit("close", "code" in run ? run.code : 0));
    };
    if (run.startError) setImmediate(() => child.emit("error", new Error("spawn psql ENOENT")));
    else if (run.stdinError) setImmediate(() => { stdin.emit("error", new Error("EPIPE")); answer(); });
    else stdin.on("finish", answer);
    return Object.assign(child, { stdin, stdout, stderr }) as PsqlProcess;
  };
  return { spawnProcess, launches, received, refused: () => writesRefused };
}

const connectionString = "postgresql://owner:pw@db.example:6543/app?sslmode=require";

it("runs one query as psql argv with a PG-only environment built from the connection string", async () => {
  const psql = fakePsql({ stdout: "1\tone\n\n2\ttwo\n" });
  const target = createPsqlPostgresTarget({ connectionString }, { parentEnv: { PATH: "/bin", PGPASSWORD: "stray", PGHOST: "elsewhere", EMPTY: undefined }, spawnProcess: psql.spawnProcess });
  expect(await target.query("SELECT id, name FROM t")).toEqual({ ok: true, value: [["1", "one"], ["2", "two"]] });
  expect(psql.launches).toEqual([{
    args: ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "\t", "-c", "SELECT id, name FROM t"],
    env: { PATH: "/bin", PGHOST: "db.example", PGPORT: "6543", PGDATABASE: "app", PGUSER: "owner", PGCONNECT_TIMEOUT: "5", PGAPPNAME: "database-transfer", PGPASSWORD: "pw", PGSSLMODE: "require" },
  }]);
  // The connection string never reaches argv, where `ps` would show it.
  expect(psql.launches[0]!.args.join(" ")).not.toContain("pw");
  expect(psql.received).toEqual([]);
  expect(target.describe()).toEqual({ host: "db.example", port: "6543", database: "app", user: "owner" });
});

it("names the application psql reports when the host supplies one", async () => {
  const psql = fakePsql();
  const target = createPsqlPostgresTarget({ connectionString }, { parentEnv: {}, applicationName: "host-copy", spawnProcess: psql.spawnProcess });
  expect(await target.query("SELECT 1")).toEqual({ ok: true, value: [] });
  expect(psql.launches[0]!.env.PGAPPNAME).toBe("host-copy");
});

it("streams a script through stdin in order, waiting for drain when psql falls behind", async () => {
  const psql = fakePsql();
  const target = createPsqlPostgresTarget({ connectionString }, { parentEnv: {}, spawnProcess: psql.spawnProcess });
  const chunks = ["BEGIN;\n", "COPY t FROM STDIN;\n1\n\\.\n", "COMMIT;\n"];
  expect(await target.runScript(chunks)).toEqual({ ok: true, value: null });
  expect(psql.launches[0]!.args).toEqual(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"]);
  expect(psql.received.join("")).toBe(chunks.join(""));
  expect(psql.refused()).toBe(3);
});

it("reports a psql that cannot start without any detail", async () => {
  const psql = fakePsql({ startError: true });
  const target = createPsqlPostgresTarget({ connectionString }, { parentEnv: {}, spawnProcess: psql.spawnProcess });
  expect(await target.query("SELECT 1")).toEqual({ ok: false, error: "psql could not be started" });
});

it("survives psql closing its stdin early and still reports the exit", async () => {
  const psql = fakePsql({ stdinError: true, code: 2, stderr: "psql: error: connection to server failed: timeout expired\n" });
  const target = createPsqlPostgresTarget({ connectionString }, { parentEnv: {}, spawnProcess: psql.spawnProcess });
  expect(await target.runScript(["SELECT 1;\n"])).toEqual({ ok: false, error: "psql request failed" });
});

it.each([
  { label: "the foreign-schema signal", stderr: "psql:<stdin>:4: ERROR:  TRANSFER_TARGET_NOT_OURS\nCONTEXT:  PL/pgSQL function inline_code_block\n", expected: { ok: false, error: "TRANSFER_TARGET_NOT_OURS" } },
  { label: "a count mismatch naming its table", stderr: "psql:<stdin>:9: ERROR:  TRANSFER_COUNT_MISMATCH notes\n", expected: { ok: false, error: "TRANSFER_COUNT_MISMATCH notes" } },
  { label: "a count mismatch whose table is not a plain identifier", stderr: "ERROR:  TRANSFER_COUNT_MISMATCH bad name; drop\n", expected: { ok: false, error: "TRANSFER_COUNT_MISMATCH [redacted]" } },
  { label: "a failed COPY, by table", stderr: "psql:<stdin>:7: ERROR:  invalid input syntax for type bigint: \"x\"\nCONTEXT:  COPY \"app\".\"notes\", line 3, column id: \"x\"\n", expected: { ok: false, error: "psql request failed", copyTable: "app.notes" } },
  { label: "an unrecognised first line", stderr: "\n  some warning text\nmore text\n", expected: { ok: false, error: "psql request failed" } },
  { label: "an empty stderr", stderr: "", expected: { ok: false, error: "psql request failed" } },
])("reduces $label to a copier-owned error", async ({ stderr, expected }) => {
  const psql = fakePsql({ stderr, code: 3 });
  const target = createPsqlPostgresTarget({ connectionString }, { parentEnv: {}, spawnProcess: psql.spawnProcess });
  expect(await target.runScript(["SELECT 1;\n"])).toEqual(expected);
  expect(await createPsqlPostgresTarget({ connectionString }, { parentEnv: {}, spawnProcess: fakePsql({ stderr, code: null }).spawnProcess }).query("SELECT 1")).toEqual(expected);
});
