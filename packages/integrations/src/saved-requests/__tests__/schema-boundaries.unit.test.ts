import { expect, it } from 'vitest';
import { compileInputSchema } from '../schema.js';
import { SavedRequestError } from '../index.js';

const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false });

it('supports optional closed properties and bounded arrays without requiring a minimum', () => {
  const validator = compileInputSchema({ schema: object({
    items: { type: 'array', maxItems: 2, items: { type: 'string', minLength: 1, maxLength: 3 } },
  }) });
  expect(validator.validate({}).valid).toBe(true);
  expect(validator.validate({ items: [] }).valid).toBe(true);
  expect(validator.validate({ items: ['abc', 'x'] }).valid).toBe(true);
  expect(validator.validate({ items: [''] }).valid).toBe(false);
  expect(validator.validate({ items: ['abcd'] }).valid).toBe(false);
  expect(validator.validate({ items: ['a', 'b', 'c'] }).valid).toBe(false);
  expect(validator.validate({ extra: true }).valid).toBe(false);
});

it('preserves boolean and integer enum restrictions in the installed validator', () => {
  const validator = compileInputSchema({ schema: object({
    approved: { type: 'boolean', enum: [false] },
    count: { type: 'integer', minimum: 0, maximum: 4, enum: [0, 2, 4] },
  }) });
  expect(validator.validate({ approved: false, count: 2 }).valid).toBe(true);
  expect(validator.validate({ approved: true, count: 2 }).valid).toBe(false);
  expect(validator.validate({ approved: false, count: 3 }).valid).toBe(false);
  expect(validator.validate({ approved: false, count: 2.5 }).valid).toBe(false);
});

it.each([
  { type: 'boolean', enum: [false, 'false'] },
  { type: 'integer', minimum: 0, maximum: 4, enum: ['2'] },
  { type: 'string', maxLength: 5, enum: 'value' },
])('rejects malformed enum declarations before interpreting a request: %j', field => {
  expect(() => compileInputSchema({ schema: object({ field }) })).toThrow(SavedRequestError);
});
