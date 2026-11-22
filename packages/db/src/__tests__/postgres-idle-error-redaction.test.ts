import { createConsoleLogger } from "@jini-ai/core/primitives";
import type { PgCursor, PgQueryResult } from "../core/pg-types.js";
import { sql } from "kysely";
import { expect, it, vi } from 'vitest';
import { openPostgresKernel } from '../kernel/postgres/driver.js';

it('logs an idle-pool failure as its class only, without connecting to a database', async () => {
  let emit!: (error: Error) => void;
  class Pool {
    options = {};
    on(_event: 'error', listener: (error: Error) => void) { emit = listener; }
    async connect(): Promise<never> { throw new Error('this test must never connect'); }
    async end() {}
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const kernel = openPostgresKernel({ pg: { Pool, types: { getTypeParser: () => value => value } }, connectionString: 'postgres://unused' });
  try {
    emit(new Error('boom api_key=SECRETSECRETSECRETSECRET'));
    expect(warn).toHaveBeenCalledWith('[postgres] Idle pool connection dropped.', 'Error');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/boom|SECRETSECRET|postgres-idle-error-redaction/);
  } finally { warn.mockRestore(); await kernel.close(); }
});

it('reports idle and active loss through the injected safe logger and attaches one active listener', async () => {
  const listeners = new Map<string, (error: Error) => void>();
  let attached = 0;
  let connectionLost = false;
  class Client {
    on(event: string, listener: (error: Error) => void) { attached++; listeners.set(event, listener); }
    release() {}
    query<Row>(statement: string, parameters: ReadonlyArray<unknown>): Promise<PgQueryResult<Row>>;
    query<Row>(cursor: PgCursor<Row>): PgCursor<Row>;
    query<Row>(statement: string | PgCursor<Row>): Promise<PgQueryResult<Row>> | PgCursor<Row> {
      if (typeof statement !== "string") return statement;
      return connectionLost ? Promise.reject(new Error("private driver password")) : Promise.resolve({ command: "SELECT", rowCount: 0, rows: [] });
    }
  }
  const client = new Client();
  let idle: ((error: Error) => void) | undefined;
  let pool: Pool | undefined;
  class Pool {
    options = {};
    constructor() { pool = this; }
    on(_event: 'error', listener: (error: Error) => void) { idle = listener; }
    async connect() { return client; }
    async end() {}
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const kernel = openPostgresKernel({ pg: { Pool, types: { getTypeParser: () => value => value } }, connectionString: 'postgres://unused' },
    { report: createConsoleLogger({ prefix: '[connection]' }) });
  try {
    const error = Object.assign(new Error('private driver password'), { stack: 'private driver password' });
    idle!(error);
    await pool!.connect();
    await pool!.connect();
    connectionLost = true;
    listeners.get('error')!(error);
    await expect(kernel.query(sql`SELECT 1`)).rejects.toThrow('private driver password');
    expect(attached).toBe(1);
    expect(warn.mock.calls).toEqual([
      ['[connection] Idle pool connection dropped.', 'Error'],
      ['[connection] Active pool connection dropped; its operation will stop.', 'Error'],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private driver password');
  } finally { warn.mockRestore(); await kernel.close(); }
});
