import { describe, expect, it } from 'vitest';
import { describeQueryNode, type QueryDescription } from '../instrumentation.js';

// Characterization cases recorded before the complexity refactor. These drive the public
// descriptor with structural Kysely nodes, without a database or telemetry adapter.
const postsTable = { kind: 'TableNode', table: { identifier: { name: 'posts' } } };
type DescriptionCase = { name: string; node: unknown; expected: QueryDescription };

describe('describeQueryNode characterization', () => {
 const tableCases: DescriptionCase[] = [
  { name: 'selects only the first FROM table', node: { kind: 'SelectQueryNode', from: { froms: [postsTable, { kind: 'TableNode', table: { identifier: { name: 'other' } } }] } }, expected: { operation: 'select', table: 'posts' } },
  { name: 'deletes from only the first FROM table', node: { kind: 'DeleteQueryNode', from: { froms: [postsTable, { kind: 'TableNode', table: { identifier: { name: 'other' } } }] } }, expected: { operation: 'delete', table: 'posts' } },
  { name: 'reads an insert destination', node: { kind: 'InsertQueryNode', into: postsTable }, expected: { operation: 'insert', table: 'posts' } },
  { name: 'reads an update table', node: { kind: 'UpdateQueryNode', table: postsTable }, expected: { operation: 'update', table: 'posts' } },
  { name: 'unwraps nested aliases without exporting alias names', node: { kind: 'UpdateQueryNode', table: { kind: 'AliasNode', alias: 'outer', node: { kind: 'AliasNode', alias: 'inner', node: postsTable } } }, expected: { operation: 'update', table: 'posts' } },
  { name: 'omits a missing select FROM', node: { kind: 'SelectQueryNode' }, expected: { operation: 'select' } },
  { name: 'omits missing select FROM entries', node: { kind: 'SelectQueryNode', from: {} }, expected: { operation: 'select' } },
  { name: 'omits an empty select FROM list', node: { kind: 'SelectQueryNode', from: { froms: [] } }, expected: { operation: 'select' } },
  { name: 'omits a missing delete FROM', node: { kind: 'DeleteQueryNode' }, expected: { operation: 'delete' } },
  { name: 'omits missing delete FROM entries', node: { kind: 'DeleteQueryNode', from: {} }, expected: { operation: 'delete' } },
  { name: 'omits an empty delete FROM list', node: { kind: 'DeleteQueryNode', from: { froms: [] } }, expected: { operation: 'delete' } },
  { name: 'omits a missing insert destination', node: { kind: 'InsertQueryNode' }, expected: { operation: 'insert' } },
  { name: 'omits a missing update table', node: { kind: 'UpdateQueryNode' }, expected: { operation: 'update' } },
  { name: 'omits a table with missing identifier', node: { kind: 'InsertQueryNode', into: { kind: 'TableNode', table: {} } }, expected: { operation: 'insert' } },
  { name: 'omits a non-string table name', node: { kind: 'InsertQueryNode', into: { kind: 'TableNode', table: { identifier: { name: 42 } } } }, expected: { operation: 'insert' } },
  { name: 'omits an empty table name', node: { kind: 'InsertQueryNode', into: { kind: 'TableNode', table: { identifier: { name: '' } } } }, expected: { operation: 'insert' } },
  { name: 'does not treat a raw FROM expression as a table', node: { kind: 'SelectQueryNode', from: { froms: [{ kind: 'RawNode', sqlFragments: ['secret'] }] } }, expected: { operation: 'select' } },
 ];
 it.each(tableCases)('$name', ({ node, expected }) => {
  expect(describeQueryNode({ node })).toStrictEqual(expected);
 });

 const rawCases: { name: string; sqlFragments?: readonly unknown[]; operation: string }[] = [
  { name: 'lowercases a leading mixed-case keyword', sqlFragments: [' \nSeLeCt * FROM private_table WHERE token = secret'], operation: 'select' },
  { name: 'accepts a keyword at end of text', sqlFragments: ['COMMIT'], operation: 'commit' },
  { name: 'accepts punctuation after a keyword', sqlFragments: ['PRAGMA(table_info)'], operation: 'pragma' },
  { name: 'rejects a leading single-quoted value', sqlFragments: ["'secret'"], operation: 'raw' },
  { name: 'rejects a leading double-quoted value', sqlFragments: ['"secret"'], operation: 'raw' },
  { name: 'rejects a digit adjoining the keyword', sqlFragments: ['SELECT1 secret'], operation: 'raw' },
  { name: 'rejects an underscore adjoining the keyword', sqlFragments: ['SELECT_secret'], operation: 'raw' },
  { name: 'rejects a single quote adjoining the keyword', sqlFragments: ["SELECT'secret'"], operation: 'raw' },
  { name: 'rejects a double quote adjoining the keyword', sqlFragments: ['SELECT"secret"'], operation: 'raw' },
  { name: 'does not skip a leading SQL comment', sqlFragments: ['/* secret */ SELECT'], operation: 'raw' },
  { name: 'rejects non-alphabetic leading text', sqlFragments: ['123 secret'], operation: 'raw' },
  { name: 'uses only the first fragment', sqlFragments: ['', 'SELECT secret'], operation: 'raw' },
  { name: 'handles an empty fragment', sqlFragments: [''], operation: 'raw' },
  { name: 'handles whitespace alone', sqlFragments: [' \t\n'], operation: 'raw' },
  { name: 'handles missing fragments', operation: 'raw' },
  { name: 'handles an empty fragment list', sqlFragments: [], operation: 'raw' },
  { name: 'handles an undefined first fragment', sqlFragments: [undefined], operation: 'raw' },
  { name: 'handles a null first fragment', sqlFragments: [null], operation: 'raw' },
 ];
 it.each(rawCases)('$name', ({ sqlFragments, operation }) => {
  const node = { kind: 'RawNode', sqlFragments, parameters: ['secret'] };
  expect(describeQueryNode({ node })).toStrictEqual({ operation });
 });

 const fallbackCases: DescriptionCase[] = [
  { name: 'defaults a null node to query', node: null, expected: { operation: 'query' } },
  { name: 'defaults an undefined node to query', node: undefined, expected: { operation: 'query' } },
  { name: 'defaults an absent kind to query', node: {}, expected: { operation: 'query' } },
  { name: 'defaults a non-string kind to query', node: { kind: 42 }, expected: { operation: 'query' } },
  { name: 'removes a QueryNode suffix and separates camel case', node: { kind: 'MergeIntoQueryNode', table: postsTable }, expected: { operation: 'merge_into' } },
  { name: 'removes a Node suffix and separates camel case', node: { kind: 'CreateTableNode' }, expected: { operation: 'create_table' } },
  { name: 'separates a digit from a following capital', node: { kind: 'Create2TableQueryNode' }, expected: { operation: 'create2_table' } },
  { name: 'keeps an acronym together', node: { kind: 'DDLNode' }, expected: { operation: 'ddl' } },
  { name: 'keeps a kind without a recognized suffix', node: { kind: 'customOperation' }, expected: { operation: 'custom_operation' } },
  { name: 'keeps an empty string kind empty', node: { kind: '' }, expected: { operation: '' } },
 ];
 it.each(fallbackCases)('$name', ({ node, expected }) => {
  expect(describeQueryNode({ node })).toStrictEqual(expected);
 });
});
