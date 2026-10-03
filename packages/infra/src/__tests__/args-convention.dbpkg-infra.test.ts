import { expect, test } from 'vitest';
import { restorePointFilename, sanitizeForFilename } from '../db/core/index.js';
import { DEFAULT_PRAGMAS, openSqliteConnection } from '../db/sqlite/index.js';

// Pending acceptance contracts for the authoritative database package's next conversion.
// The shim is a direct re-export: changing these helpers locally would create a second source
// of truth. Narrow casts let these runtime contracts be written before the upstream signatures
// change; they intentionally do not claim declaration compatibility with the current API.
test('filename sanitation takes a required argument object and preserves replacement semantics', () => {
  const sanitize = sanitizeForFilename as unknown as (required: { value: string }, optional?: Record<string, never>) => string;
  expect(sanitize({ value: '../workspace:blue' }, {})).toBe('___workspace_blue');
});

test('artifact extension belongs to the optional object without changing the filename wire format', () => {
  const filename = restorePointFilename as unknown as (
    required: { scopeId: string; watermarkAtCapture: number; timestamp: number }, optional?: { extension?: string },
  ) => string;
  const required = { scopeId: 'a/b', watermarkAtCapture: 3, timestamp: 4 };
  expect(filename(required, {})).toBe('restore-point-a_b-wm3-4.db');
  expect(filename(required, { extension: 'snapshot' })).toBe('restore-point-a_b-wm3-4.snapshot');
});

test('connection recovery and custom pragmas belong to the optional object, in the original order', () => {
  const order: string[] = [];
  const connection = { pragma: (value: string) => { order.push(value); } };
  const open = openSqliteConnection as unknown as (
    required: { filePath: string; open: (required: { filePath: string }, optional: object) => typeof connection },
    optional?: { recover?: (required: { filePath: string }) => void; pragmas?: readonly string[] },
  ) => typeof connection;
  const required = { filePath: '/host/content.db', open: ({ filePath }: { filePath: string }, options: object) => {
    expect(filePath).toBe('/host/content.db');
    expect(options).toEqual({});
    order.push('open');
    return connection;
  } };
  expect(open(required, { recover: ({ filePath }) => {
    expect(filePath).toBe('/host/content.db');
    order.push('recover');
  }, pragmas: ['foreign_keys = ON'] })).toBe(connection);
  expect(order).toEqual(['recover', 'open', 'foreign_keys = ON']);
  order.length = 0;
  open(required, {});
  expect(order).toEqual(['open', ...DEFAULT_PRAGMAS]);
});
