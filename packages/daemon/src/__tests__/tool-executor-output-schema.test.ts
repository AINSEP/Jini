import { describe, expect, it } from 'vitest';

import { findOutputSchemaProblem } from '../tool-executor-output-schema.js';

describe('findOutputSchemaProblem', () => {
  it('accepts a value that fits every supported keyword', () => {
    const schema = {
      type: 'object', required: ['pages'], additionalProperties: false,
      properties: { pages: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, state: { enum: ['draft', 'live'] } } } }, note: { type: ['string', 'null'] } },
    };
    expect(findOutputSchemaProblem({ value: { pages: [{ id: 1, state: 'live' }], note: null }, schema })).toBeUndefined();
  });

  it.each([
    ['a missing required field', { type: 'object', required: ['id'] }, {}, 'the required field id is missing'],
    ['an undeclared field on a closed object', { type: 'object', additionalProperties: false, properties: {} }, { extra: 1 }, 'the result has an unexpected field extra'],
    ['a wrong-typed array item', { type: 'array', items: { type: 'string' } }, ['a', 2], 'result[1] should be a string, but it was a number'],
    ['a value outside its enum', { properties: { state: { enum: ['draft', 'live'] } } }, { state: 'gone' }, 'state should be one of "draft", "live"'],
    ['a fraction where an integer is declared', { type: 'integer' }, 1.5, 'the result should be an integer, but it was a number'],
    ['a type union with no match', { type: ['string', 'null'] }, 3, 'the result should be a string or null, but it was a number'],
    ['nothing returned for a declared object', { type: 'object' }, undefined, 'the result should be an object, but it was nothing'],
    ['a nested field', { properties: { page: { properties: { title: { type: 'string' } } } } }, { page: { title: false } }, 'page.title should be a string, but it was a boolean'],
  ])('reports %s', (_name, schema, value, problem) => {
    expect(findOutputSchemaProblem({ value, schema })).toBe(problem);
  });

  it('ignores keywords and type names outside its subset rather than failing the tool', () => {
    expect(findOutputSchemaProblem({ value: 'x', schema: { type: 'custom', minLength: 5, pattern: '^y' } })).toBeUndefined();
    expect(findOutputSchemaProblem({ value: 'x', schema: true })).toBeUndefined();
  });

  it('stops past 64 levels instead of exhausting the stack on a cyclic schema', () => {
    const schema: Record<string, unknown> = { type: 'object' };
    schema.properties = { next: schema };
    let value: Record<string, unknown> = {};
    for (let i = 0; i < 70; i += 1) value = { next: value };
    expect(findOutputSchemaProblem({ value, schema })).toMatch(/is nested more than 64 levels deep$/);
  });
});
