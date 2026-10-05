import { expect, it } from 'vitest';
import { defaultDbMessages, getDatabaseAgentToolCatalog, createRestorePoint } from '../../tools/index.js';
import { countSourceRows, runCopy, type TransferSource, type TransferTable } from '../../transfer/index.js';

const table: TransferTable = {
  name: 'records', columns: [{ name: 'id', sqlType: 'text', notNull: true }],
  primaryKey: ['id'], indexes: [], foreignKeys: [], checks: [],
};
const source = (columns: readonly string[] | null): TransferSource => ({
  tableNames: () => ['records'], layout: () => null, columns: () => columns,
  countRows: () => 1, rows: () => [['row']], close: () => {},
});

// REGRESSION: fails if any of the eight database descriptions or costAck description is hardcoded.
it('renders host catalog prose without changing identities, permissions, schemas or risk', () => {
  const baseline = getDatabaseAgentToolCatalog();
  const messages = {
    ...defaultDbMessages, databaseHealth: 'host health', databaseSchemaState: 'host schema',
    databasePendingMigrations: 'host pending', databaseRestorePoints: 'host points',
    databasePlanMigrate: 'host plan', databaseExecuteMigrate: 'host migrate',
    databaseCreateRestorePoint: 'host snapshot', databaseRestoreGuidance: 'host guidance',
    restorePointCostAck: 'host cost acknowledgment',
  };
  const treatment = getDatabaseAgentToolCatalog({}, { messages });
  expect(treatment.map(tool => tool.description)).toEqual([
    'host health', 'host schema', 'host pending', baseline[3]!.description,
    'host points', 'host plan', 'host migrate', 'host snapshot', 'host guidance',
  ]);
  expect(treatment[7]!.inputSchema).toMatchObject({ properties: { costAck: { description: 'host cost acknowledgment' } } });
  // A second invocation must not inherit the first host's model metadata.
  expect(getDatabaseAgentToolCatalog()).toEqual(baseline);
  expect(treatment.map(({ name, sideEffects, authorization, actorClassRule }) => ({ name, sideEffects, authorization, actorClassRule })))
    .toEqual(baseline.map(({ name, sideEffects, authorization, actorClassRule }) => ({ name, sideEffects, authorization, actorClassRule })));
});

// REGRESSION: fails if unavailable restore-point guidance ignores the host or keeps the old default.
it('keeps restore-point refusal fail-closed while replacing prose', async () => {
  let captures = 0;
  const required = { costClass: 'unavailable' as const, kind: 'logical-dump', costAck: true, capture: async () => { captures++; return { artifactRef: 'unused', watermarkAtCapture: 0 }; } };
  await expect(createRestorePoint(required)).rejects.toThrow('no restore-point mechanism is available for the source; migration is refused with no attestation override');
  await expect(createRestorePoint(required, { messages: { ...defaultDbMessages, restorePointUnavailable: 'host refuses capture' } }))
    .rejects.toThrow('host refuses capture');
  expect(captures).toBe(0);
});

// REGRESSION: fails if countSourceRows hardcodes either missing-table or missing-column prose.
it('formats source schema failures while retaining their first-failure boundary', () => {
  const messages = { ...defaultDbMessages,
    missingSourceTable: ({ table }: { table: string }) => `host table ${table}`,
    missingSourceColumn: ({ table, column }: { table: string; column: string }) => `host column ${table}.${column}`,
  };
  expect(() => countSourceRows({ source: source(null), tables: [table] })).toThrow("the source's database has no 'records' table");
  expect(() => countSourceRows({ source: source(null), tables: [table] }, { messages })).toThrow('host table records');
  expect(() => countSourceRows({ source: source([]), tables: [table] })).toThrow("the source's database has no 'records.id' column");
  expect(() => countSourceRows({ source: source([]), tables: [table] }, { messages })).toThrow('host column records.id');
  expect(countSourceRows({ source: source(['id']), tables: [table] }, { messages })).toEqual([{ table, rows: 1 }]);
});

// REGRESSION: fails if runCopy stops forwarding schema-error messages or lets prose affect SQL.
it('forwards copy preflight prose and leaves complete-source scripts byte-identical', async () => {
  const scripts: string[] = [];
  const target = {
    query: async () => ({ ok: true as const, value: [['[]']] }),
    describe: () => ({ host: 'fixture', port: '5432', database: 'fixture', user: 'owner' }),
    runScript: async (chunks: Iterable<string>) => { scripts.push([...chunks].join('')); return { ok: true as const, value: null }; },
  };
  const input = {
    sources: [{ name: 'content', source: source(['id']), tables: [table], leftOut: [] }],
    naming: { defaultSchema: 'copy', schemaPrefix: 'copy_', markerTable: 'copy_marker', unvalidatedTable: 'pg_temp.unchecked', sqlTag: 'copy' },
    target, schema: 'copy', marker: { site: 'source', snapshotAt: 'fixed' }, replaceExisting: false,
  };
  const messages = { ...defaultDbMessages, missingSourceTable: () => 'host missing table' };
  await expect(runCopy({ ...input, sources: [{ ...input.sources[0]!, source: source(null) }] }, { messages }))
    .rejects.toThrow('host missing table');
  expect(scripts).toEqual([]);
  await runCopy(input);
  await runCopy(input, { messages });
  expect(scripts).toHaveLength(2);
  expect(scripts[1]).toBe(scripts[0]);
});
