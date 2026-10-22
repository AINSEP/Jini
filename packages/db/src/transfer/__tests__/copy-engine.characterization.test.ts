import { describe, expect, it, vi } from 'vitest';
import { runCopy, SourceSchemaMismatchError, type RunCopyInput, type TableCount } from '../copy-engine.js';
import type { PostgresTargetPort, TargetResult } from '../postgres-target.js';
import type { TransferSource } from '../sqlite-source.js';
import type { TransferNaming, TransferTable } from '../types.js';

const naming: TransferNaming = { defaultSchema: 'copy', schemaPrefix: 'copy_', markerTable: 'copy_marker', unvalidatedTable: 'pg_temp.unchecked' };
const table: TransferTable = { name: 'items', columns: [{ name: 'id', sqlType: 'bigint', notNull: true }], primaryKey: ['id'], indexes: [], checks: [], foreignKeys: [] };
function fixture({ result = { ok: true, value: null }, read = { ok: true, value: [['[]']] }, scriptError }: {
  result?: TargetResult<null>; read?: TargetResult<string[][]>; scriptError?: Error;
}, _options = {}) {
  const source: TransferSource = {
    tableNames: () => ['items'], layout: () => null, columns: () => ['id'],
    countRows: vi.fn(() => 2), rows: () => [[1], [2]], close: () => {},
  };
  let script = '';
  const target: PostgresTargetPort = {
    describe: () => ({ host: 'localhost', port: '5432', user: 'owner', database: 'disposable' }),
    query: vi.fn(async () => read),
    runScript: vi.fn(async chunks => {
      if (scriptError) throw scriptError;
      for (const chunk of chunks) script += chunk;
      return result;
    }),
  };
  const input: RunCopyInput = {
    sources: [{ name: 'content', source, tables: [table], leftOut: [] }], target, naming, schema: 'copy',
    marker: { site: 'example', snapshotAt: '2026-10-20' }, replaceExisting: false,
  };
  return { input, target, source, script: () => script };
}

describe('copy preflight pins', () => {
  it.each([
    { counts: [], label: 'missing counts' },
    { counts: [{ table, rows: -1 }], label: 'negative count' },
    { counts: [{ table, rows: 1.5 }], label: 'fractional count' },
    { counts: [{ table, rows: Number.MAX_SAFE_INTEGER + 1 }], label: 'unsafe count' },
    { counts: [{ table: { ...table, name: 'other' }, rows: 2 }], label: 'wrong order or name' },
  ] satisfies { counts: TableCount[]; label: string }[])('rejects $label before any target effects', async ({ counts }) => {
    const { input, target, source } = fixture({});
    await expect(runCopy({ ...input, sources: [{ ...input.sources[0]!, counts }] })).rejects.toThrow('transfer counts do not cover the planned tables: content');
    expect(source.countRows).not.toHaveBeenCalled();
    expect(target.runScript).not.toHaveBeenCalled();
    expect(target.query).not.toHaveBeenCalled();
  });
  it('uses frozen counts but takes the target layout from the actual plan', async () => {
    const f = fixture({});
    const cached = { ...table, columns: [{ name: 'wrong', sqlType: 'text', notNull: false }] };
    expect(await runCopy({ ...f.input, sources: [{ ...f.input.sources[0]!, counts: [{ table: cached, rows: 0 }] }] })).toEqual({ ok: true, tables: [{ name: 'items', rows: 0 }], unvalidatedConstraints: [] });
    expect(f.source.countRows).not.toHaveBeenCalled();
    expect(f.script()).toContain('COPY "copy"."items" ("id") FROM STDIN;');
    expect(f.script()).toContain('IF n <> 0 THEN');
  });
  it('counts the source when frozen counts are absent and preserves transaction guards', async () => {
    const f = fixture({});
    expect(await runCopy(f.input)).toEqual({ ok: true, tables: [{ name: 'items', rows: 2 }], unvalidatedConstraints: [] });
    expect(f.source.countRows).toHaveBeenCalledWith('items', undefined);
    const script = f.script();
    expect(script).toMatch(/^BEGIN;\n/);
    expect(script).toContain("IF mine = 0 OR mine <> total THEN RAISE EXCEPTION 'TRANSFER_TARGET_NOT_OURS'");
    expect(script).toContain("EXCEPTION WHEN undefined_column THEN RAISE EXCEPTION 'TRANSFER_TARGET_NOT_OURS'");
    expect(script).toContain('DO $transfer$');
    expect(script).not.toContain('DROP SCHEMA');
    expect(script).toMatch(/COMMIT;\n$/);
  });
  it.each(['public', 'bad-name', 'A', '', 'a'.repeat(64)])('refuses schema %j before any target effects', async schema => {
    const { input, target } = fixture({});
    await expect(runCopy({ ...input, schema })).rejects.toThrow(`runCopy: '${schema}' is not a schema this copier may write`);
    expect(target.runScript).not.toHaveBeenCalled();
    expect(target.query).not.toHaveBeenCalled();
  });
  it('accepts a 63-byte schema and emits DROP only for a replacement', async () => {
    const f = fixture({});
    const schema = 'a'.repeat(63);
    await runCopy({ ...f.input, schema, replaceExisting: true });
    expect(f.script()).toContain(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
  });
  it('rejects duplicate targets, marker collisions and invalid tags in preflight order', async () => {
    const { input, target } = fixture({});
    await expect(runCopy({ ...input, sources: [...input.sources, { ...input.sources[0]!, name: 'other' }] })).rejects.toThrow('multiple transfer sources declare the same target table');
    await expect(runCopy({ ...input, naming: { ...naming, markerTable: 'items' } })).rejects.toThrow('transfer table conflicts with its copy marker');
    await expect(runCopy({ ...input, sources: [], naming: { ...naming, sqlTag: 'bad$tag' } })).rejects.toThrow('invalid SQL dollar-quote tag');
    expect(target.runScript).not.toHaveBeenCalled();
    expect(target.query).not.toHaveBeenCalled();
  });
  it('keeps source completeness and missing-column validation ahead of target effects', async () => {
    const { input, source, target } = fixture({});
    await expect(runCopy({ ...input, sources: [{ ...input.sources[0]!, tables: [] }] })).rejects.toThrow('incomplete transfer plan: content: items');
    source.columns = () => [];
    await expect(runCopy(input, { messages: { missingSourceTable: () => 'missing table', missingSourceColumn: () => 'missing column' } })).rejects.toThrow('missing column');
    source.columns = () => null;
    await expect(runCopy(input, { messages: { missingSourceTable: () => 'missing table', missingSourceColumn: () => 'missing column' } })).rejects.toThrow('missing table');
    expect(target.runScript).not.toHaveBeenCalled();
  });
});

describe('copy result pins', () => {
  it.each([
    { error: 'TRANSFER_TARGET_NOT_OURS', code: 'TARGET_NOT_OURS', message: "the destination already has a 'copy' area that holds other data. Nothing was written, and it was left untouched." },
    { error: 'TRANSFER_COUNT_MISMATCH items', code: 'COUNT_MISMATCH', message: "the copy of 'items' did not match, so the whole copy was thrown away. Any earlier copy is untouched." },
    { error: 'refused', code: 'COPY_FAILED', message: 'the destination refused the copy, so the whole copy was thrown away. Any earlier copy is untouched.' },
  ])('retains $code mapping', async ({ error, code, message }) => {
    const f = fixture({ result: { ok: false, error } });
    const expected = code === 'TARGET_NOT_OURS' ? { ok: false, code, message } : { ok: false, code, message, logDetail: error };
    expect(await runCopy(f.input)).toEqual(expected);
    expect(f.target.query).not.toHaveBeenCalled();
  });
  it('strips the target schema from a failed COPY table in the public message', async () => {
    const f = fixture({ result: { ok: false, error: 'refused', copyTable: 'copy.items' } });
    expect(await runCopy(f.input)).toEqual({ ok: false, code: 'COPY_FAILED', message: "the destination refused the copy while copying 'items', so the whole copy was thrown away. Any earlier copy is untouched.", logDetail: 'refused' });
  });
  it('converts only source schema exceptions to a failed result', async () => {
    const mismatch = fixture({ scriptError: new SourceSchemaMismatchError('binary data') });
    expect(await runCopy(mismatch.input)).toEqual({ ok: false, code: 'COPY_FAILED', message: 'binary data. Nothing was changed.' });
    const unexpected = new Error('transport broke');
    await expect(runCopy(fixture({ scriptError: unexpected }).input)).rejects.toBe(unexpected);
  });
  it.each([{ ok: false, error: 'unreadable' }, { ok: true, value: [] }] satisfies TargetResult<string[][]>[])(
    'reports a warning when committed constraints cannot be read: %j', async read => {
      expect(await runCopy(fixture({ read }).input)).toEqual({ ok: true, tables: [{ name: 'items', rows: 2 }], unvalidatedConstraints: [], warning: 'the copy finished, but its list of unchecked constraints could not be read back' });
    },
  );
  it.each(['invalid JSON', 'null', '{}', '[1]'])('reports a committed-copy warning for malformed marker %s', async cell => {
    const f = fixture({ read: { ok: true, value: [[cell]] } });
    await expect(runCopy(f.input)).resolves.toEqual({ ok: true, tables: [{ name: 'items', rows: 2 }], unvalidatedConstraints: [], warning: 'the copy finished, but its list of unchecked constraints could not be read back' });
    expect(f.script()).toMatch(/COMMIT;\n$/);
  });
});

it('preserves a committed copy when marker readback throws', async () => {
  const f = fixture({});
  f.target.query = async () => { throw new Error('private upstream details'); };
  expect(await runCopy(f.input)).toEqual({ ok: true, tables: [{ name: 'items', rows: 2 }], unvalidatedConstraints: [],
    warning: 'the copy finished, but its list of unchecked constraints could not be read back' });
  expect(f.script()).toMatch(/COMMIT;\n$/);
});
