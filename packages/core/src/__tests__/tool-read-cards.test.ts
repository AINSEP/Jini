import { describe, expect, it } from 'vitest';
import { ToolInputError } from '../tool-input-errors.js';
import type { ToolExecutionContext, ToolHandler } from '../tool-registry.js';
import {
  dispatchByIdPresence, renameInputSelector, renameInputSelectors, renameSchemaSelector, rewriteSchemaDescriptions, unionInputSchema, valueAtPath,
} from '../tool-read-cards.js';

const ctxWith = (input: unknown) => ({ input }) as unknown as ToolExecutionContext;
const named = (name: string): ToolHandler => async () => name;

describe('rewriteSchemaDescriptions', () => {
  it('rewrites every string description at any depth and leaves other keys alone', () => {
    const schema = { description: 'a x', properties: { id: { type: 'string', description: 'x id' }, list: [{ description: 'x' }] }, title: 'x' };
    expect(rewriteSchemaDescriptions({ value: schema, rewriteText: ({ text }) => text.replace(/x/g, 'y') })).toEqual({
      description: 'a y', properties: { id: { type: 'string', description: 'y id' }, list: [{ description: 'y' }] }, title: 'x',
    });
  });
  it('returns primitives unchanged', () => {
    expect(rewriteSchemaDescriptions({ value: 3, rewriteText: () => 'z' })).toBe(3);
  });
});

describe('valueAtPath', () => {
  it('walks nested records and stops at a non-record step', () => {
    expect(valueAtPath({ item: { taxonomy: { id: 't1' } }, path: ['taxonomy', 'id'] })).toBe('t1');
    expect(valueAtPath({ item: { taxonomy: 'flat' }, path: ['taxonomy', 'id'] })).toBeUndefined();
    expect(valueAtPath({ item: null, path: ['id'] })).toBeUndefined();
  });
});

describe('dispatchByIdPresence', () => {
  const handler = dispatchByIdPresence({ idProperty: 'menuId', get: named('get'), list: named('list') });
  it('routes to get only when the id property is present (even empty), else list', async () => {
    expect(await handler(ctxWith({ menuId: 'm1' }))).toBe('get');
    expect(await handler(ctxWith({ menuId: '' }))).toBe('get');
    expect(await handler(ctxWith({}))).toBe('list');
    expect(await handler(ctxWith('not a record'))).toBe('list');
  });
  it('lets a batch-enabled get own `items`, and only then', async () => {
    const batch = dispatchByIdPresence({ idProperty: 'menuId', get: named('get'), list: named('list') }, { batchGet: true });
    expect(await batch(ctxWith({ items: [] }))).toBe('get');
    expect(await handler(ctxWith({ items: [] }))).toBe('list');
  });
});

describe('unionInputSchema', () => {
  const getSchema = { properties: { menuId: { type: 'string', description: 'The menu.' }, site: {}, kind: {} }, required: ['menuId', 'kind', 'site'] };
  const listSchema = { properties: { kind: {}, limit: {} }, required: ['kind'] };
  it('makes the id optional with an omit-to-list note and intersects required fields', () => {
    expect(unionInputSchema({ getSchema, listSchema, idProperty: 'menuId' })).toEqual({
      type: 'object', additionalProperties: false, required: ['kind'],
      properties: { kind: {}, limit: {}, site: {}, menuId: { type: 'string', description: 'The menu. Omit to list instead of fetching a single item.' } },
    });
  });
  it('drops a shared-only key that only one branch declares', () => {
    expect(unionInputSchema({ getSchema, listSchema, idProperty: 'menuId' }, { sharedOnlyKeys: ['site'] }).properties).not.toHaveProperty('site');
    expect(unionInputSchema({ getSchema: { properties: { site: {} } }, listSchema: { properties: { site: {} } }, idProperty: 'x' }, { sharedOnlyKeys: ['site'] }).properties).toEqual({ site: {} });
  });
  it('omits an id entry the get side does not declare', () => {
    expect(unionInputSchema({ getSchema: {}, listSchema: {}, idProperty: 'id' })).toEqual({ type: 'object', additionalProperties: false, required: [], properties: {} });
  });
});

describe('renameSchemaSelector', () => {
  it('renames the selector in properties, required and a batch item schema', () => {
    const schema = { type: 'object', properties: { memberId: { type: 'string' }, items: { type: 'array', items: { properties: { memberId: {} }, required: ['memberId'] } } }, required: ['memberId'] };
    expect(renameSchemaSelector({ inputSchema: schema, from: 'memberId', to: 'id' })).toEqual({
      type: 'object', properties: { id: { type: 'string' }, items: { type: 'array', items: { properties: { id: {} }, required: ['id'] } } }, required: ['id'],
    });
  });
  it('keeps a schema-less reader unchanged (same object)', () => {
    const empty = {};
    expect(renameSchemaSelector({ inputSchema: empty, from: 'a', to: 'id' })).toBe(empty);
  });
});

describe('renameInputSelector(s)', () => {
  it('renames without mutating input and notes the spelling, never the value', () => {
    const input = { memberId: 'secret', other: 1 };
    expect(renameInputSelector({ input, from: 'memberId', to: 'id' })).toEqual({ input: { other: 1, id: 'secret' }, notes: ['memberId→id'] });
    expect(input).toEqual({ memberId: 'secret', other: 1 });
    expect(renameInputSelector({ input: { other: 1 }, from: 'memberId', to: 'id' })).toEqual({ input: { other: 1 }, notes: [] });
  });
  it('refuses both spellings as a ToolInputError', () => {
    expect(() => renameInputSelector({ input: { memberId: 'a', id: 'a' }, from: 'memberId', to: 'id' })).toThrow(ToolInputError);
  });
  it('renames inside batch items with indexed notes', () => {
    expect(renameInputSelectors({ input: { items: [{ memberId: 'a' }, { id: 'b' }] }, from: 'memberId', to: 'id' })).toEqual({
      input: { items: [{ id: 'a' }, { id: 'b' }] }, notes: ['items[0].memberId→id'],
    });
    expect(() => renameInputSelectors({ input: { items: [{ memberId: 'a', id: 'a' }] }, from: 'memberId', to: 'id' })).toThrow(/Conflicting inputs/);
  });
});
