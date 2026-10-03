import { spawn } from "node:child_process";

/**
 * @file The Postgres side of a database transfer, behind a port, plus its P0 adapter.
 *
 * The adapter shells out to `psql` rather than selecting a driver. Historically P0 had no installed
 * Postgres driver, and adding `pg` was a supply-chain decision for later slices (see
 * `ADS-memory/reports/2026-09-27-assistant-db-transfer-plan.md` §3.3). The port is what the copier
 * depends on, so swapping in `pg` later touches only this file.
 *
 * The connection string never reaches `psql`'s argv (visible to `ps`): it is split into libpq's own
 * `PG*` environment variables, and every inherited `PG*` variable is dropped first so a stray
 * `PGPASSWORD` in the server's environment can never apply to a user's database.
 */

/** What may be shown about a destination: never the password. */
export interface TargetDescription {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly user: string;
}

/** `error` is psql's first ERROR line with every quoted part blanked (Postgres quotes the offending
 *  value there); `copyTable` names the table a failed `COPY` was loading. */
export type TargetResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string; readonly copyTable?: string };

export interface PostgresTargetPort {
  describe(): TargetDescription;
  /** One statement; rows as tab-separated text cells. */
  query(sql: string): Promise<TargetResult<string[][]>>;
  /** A psql script fed through stdin, chunk by chunk, stopping at the first error. */
  runScript(chunks: Iterable<string>): Promise<TargetResult<null>>;
}

export class InvalidConnectionStringError extends Error {}

interface ParsedConnection {
  readonly description: TargetDescription;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Splits a `postgres://` / `postgresql://` URL into libpq environment variables.
 *
 * @throws {InvalidConnectionStringError} With a message that never quotes the string itself.
 */
export function parseConnectionString({ raw }: { raw: string }, { applicationName = "database-transfer" }: { applicationName?: string } = {}): ParsedConnection {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InvalidConnectionStringError("the connection string is not a valid postgres:// URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new InvalidConnectionStringError("the connection string must start with postgres:// or postgresql://");
  }
  const host = url.searchParams.get("host") ?? decodeURIComponent(url.hostname);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(url.username);
  if (host === "" || database === "" || user === "") {
    throw new InvalidConnectionStringError("the connection string must name a host, a user and a database");
  }
  const port = url.port || "5432";
  const env: Record<string, string> = { PGHOST: host, PGPORT: port, PGDATABASE: database, PGUSER: user, PGCONNECT_TIMEOUT: "5", PGAPPNAME: applicationName };
  if (url.password !== "") env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode !== null) env.PGSSLMODE = sslmode;
  return { description: { host, port, database, user }, env };
}

/** The parent environment without any `PG*` variable. */
function environmentWithout(parent: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (!key.startsWith("PG") && value !== undefined) env[key] = value;
  }
  return env;
}

/** psql's own `ERROR:` line (or its first line) with quoted parts blanked; never a CONTEXT or
 *  DETAIL line, which quote row data. */
function failureFrom(stderr: string): { ok: false; error: string; copyTable?: string } {
  const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const line = lines.find((candidate) => /\bERROR:|FATAL:|could not|timeout/i.test(candidate)) ?? lines[0] ?? "psql failed without a message";
  const error = line.replace(/^psql:[^ ]*: /, "").replace(/"[^"]*"/g, '"…"');
  const copyTable = /\bCOPY ([A-Za-z0-9_."]+), line \d+/.exec(stderr)?.[1]?.replace(/"/g, "");
  return copyTable === undefined ? { ok: false, error } : { ok: false, error, copyTable };
}

function runPsql(env: Record<string, string>, args: readonly string[], chunks: Iterable<string> | null): Promise<TargetResult<string>> {
  return new Promise((resolve) => {
    const child = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (data: string) => (stdout += data));
    child.stderr.setEncoding("utf8").on("data", (data: string) => (stderr += data));
    child.on("error", (err) => resolve({ ok: false, error: `psql could not be started (${err.message})` }));
    child.on("close", (code) => resolve(code === 0 ? { ok: true, value: stdout } : failureFrom(stderr)));
    child.stdin.on("error", () => undefined);
    void (async () => {
      for (const chunk of chunks ?? []) {
        if (!child.stdin.write(chunk)) await new Promise((drain) => child.stdin.once("drain", drain));
      }
      child.stdin.end();
    })();
  });
}

/**
 * The P0 adapter: every call is one short-lived `psql` process.
 *
 * @throws {InvalidConnectionStringError} When the string cannot be parsed.
 */
export function createPsqlPostgresTarget({ connectionString }: { connectionString: string }, { parentEnv = process.env, applicationName }: { parentEnv?: NodeJS.ProcessEnv; applicationName?: string } = {}): PostgresTargetPort {
  const parsed = parseConnectionString({ raw: connectionString }, applicationName === undefined ? {} : { applicationName });
  const env = { ...environmentWithout(parentEnv), ...parsed.env };
  return {
    describe: () => parsed.description,
    async query(sql) {
      const result = await runPsql(env, ["-t", "-A", "-F", "\t", "-c", sql], null);
      if (!result.ok) return result;
      const rows = result.value.split("\n").filter((line) => line !== "").map((line) => line.split("\t"));
      return { ok: true, value: rows };
    },
    async runScript(chunks) {
      const result = await runPsql(env, ["-f", "-"], chunks);
      return result.ok ? { ok: true, value: null } : result;
    },
  };
}
