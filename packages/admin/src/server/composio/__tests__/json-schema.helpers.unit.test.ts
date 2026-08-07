import { describe, expect, it } from 'vitest';

import type { JsonValue } from '@jini-ai/protocol';

import {
  arraysDeepEqual,
  assertAdditionalPropertiesAllowed,
  assertArrayItemsUnique,
  assertArraySizeConstraints,
  assertBranchListSatisfied,
  assertCombinatorBranchesSupported,
  assertDeclaredTypeMatches,
  assertEnumAndConstMatch,
  assertEnumShapeSupported,
  assertNotSchemaSatisfied,
  assertNumberMultipleOfConstraint,
  assertNumberRangeConstraints,
  assertNumericConstraintsSupported,
  assertObjectSizeConstraints,
  assertPropertiesShapeSupported,
  assertRequiredPropertiesPresent,
  assertRequiredShapeSupported,
  assertSizeConstraintsSupported,
  assertSupportedKeywords,
  assertTypeKeywordSupported,
  countMatchingBranches,
  declaredSchemaTypes,
  isSupportedTypeKeywordShape,
  objectsDeepEqual,
  recurseIntoArrayItems,
  recurseIntoDeclaredProperties,
  recurseIntoRemainingChildSchemas,
  validateArrayValue,
  validateNumberValue,
  validateObjectValue,
  validateStringValue,
  type ConnectorJsonSchema,
} from '../json-schema.js';

function freshState(): { nodes: number } {
  return { nodes: 0 };
}

describe('arraysDeepEqual', () => {
  it('is true for equal-length arrays with deep-equal elements, including nested structures', () => {
    expect(arraysDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(arraysDeepEqual([{ a: [1] }], [{ a: [1] }])).toBe(true);
  });

  it('is false for different lengths or a mismatched element', () => {
    expect(arraysDeepEqual([1, 2], [1])).toBe(false);
    expect(arraysDeepEqual([1, 2], [1, 3])).toBe(false);
  });
});

describe('objectsDeepEqual', () => {
  it('is true regardless of key order when keys and values match', () => {
    expect(objectsDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('is false when a key is missing or a value differs', () => {
    expect(objectsDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(objectsDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('declaredSchemaTypes', () => {
  it('normalizes a string type to a single-element list', () => {
    expect(declaredSchemaTypes({ type: 'string' })).toEqual(['string']);
  });

  it('passes an array type through unchanged', () => {
    expect(declaredSchemaTypes({ type: ['string', 'number'] })).toEqual(['string', 'number']);
  });

  it('returns an empty list when `type` is absent', () => {
    expect(declaredSchemaTypes({})).toEqual([]);
  });
});

describe('isSupportedTypeKeywordShape', () => {
  it.each<[string, JsonValue | undefined, boolean]>([
    ['undefined', undefined, true],
    ['a string', 'string', true],
    ['a non-empty string array', ['string', 'number'], true],
    ['an empty array', [], false],
    ['an array with a non-string item', ['string', 1], false],
    ['a number', 123, false],
  ])('%s -> %s', (_label, type, expected) => {
    expect(isSupportedTypeKeywordShape(type)).toBe(expected);
  });
});

describe('assertSupportedKeywords', () => {
  it('does not throw for a schema using only supported keywords', () => {
    expect(() => assertSupportedKeywords({ type: 'string', minLength: 1 }, 'input')).not.toThrow();
  });

  it('throws naming the first unsupported keyword encountered', () => {
    expect(() => assertSupportedKeywords({ pattern: '^x$' }, 'input')).toThrow('unsupported connector input schema keyword "pattern"');
  });
});

describe('assertTypeKeywordSupported', () => {
  it('throws on an invalid type shape', () => {
    expect(() => assertTypeKeywordSupported({ type: 123 }, 'input')).toThrow('invalid type');
  });

  it('throws on a declared type outside VALID_TYPES', () => {
    expect(() => assertTypeKeywordSupported({ type: 'made-up' }, 'input')).toThrow('unsupported type');
  });

  it('does not throw for a supported type', () => {
    expect(() => assertTypeKeywordSupported({ type: ['string', 'null'] }, 'input')).not.toThrow();
  });
});

describe('assertEnumShapeSupported', () => {
  it('does not throw when enum is absent or a non-empty array', () => {
    expect(() => assertEnumShapeSupported({}, 'input')).not.toThrow();
    expect(() => assertEnumShapeSupported({ enum: ['a'] }, 'input')).not.toThrow();
  });

  it('throws when enum is not an array, or is empty', () => {
    expect(() => assertEnumShapeSupported({ enum: 'a' }, 'input')).toThrow('invalid enum');
    expect(() => assertEnumShapeSupported({ enum: [] }, 'input')).toThrow('invalid enum');
  });
});

describe('assertNumericConstraintsSupported', () => {
  it('does not throw for valid numeric keywords', () => {
    expect(() => assertNumericConstraintsSupported({ minimum: 1, maximum: 5, multipleOf: 2 }, 'input')).not.toThrow();
  });

  it('throws on a non-numeric constraint value', () => {
    expect(() => assertNumericConstraintsSupported({ minimum: 'zero' }, 'input')).toThrow('invalid minimum');
  });

  it('throws when multipleOf is not positive', () => {
    expect(() => assertNumericConstraintsSupported({ multipleOf: 0 }, 'input')).toThrow('invalid multipleOf');
    expect(() => assertNumericConstraintsSupported({ multipleOf: -1 }, 'input')).toThrow('invalid multipleOf');
  });
});

describe('assertSizeConstraintsSupported', () => {
  it('does not throw for valid size keywords', () => {
    expect(() => assertSizeConstraintsSupported({ minLength: 0, maxItems: 3, uniqueItems: true }, 'input')).not.toThrow();
  });

  it('throws on a negative or non-integer size constraint', () => {
    expect(() => assertSizeConstraintsSupported({ minLength: -1 }, 'input')).toThrow('invalid minLength');
  });

  it('throws when uniqueItems is not a boolean', () => {
    expect(() => assertSizeConstraintsSupported({ uniqueItems: 'yes' }, 'input')).toThrow('invalid uniqueItems');
  });
});

describe('assertRequiredShapeSupported', () => {
  it('does not throw when required is absent or an array of strings', () => {
    expect(() => assertRequiredShapeSupported({}, 'input')).not.toThrow();
    expect(() => assertRequiredShapeSupported({ required: ['a', 'b'] }, 'input')).not.toThrow();
  });

  it('throws when required is not an array, or contains a non-string', () => {
    expect(() => assertRequiredShapeSupported({ required: 'a' }, 'input')).toThrow('invalid required');
    expect(() => assertRequiredShapeSupported({ required: [1] }, 'input')).toThrow('invalid required');
  });
});

describe('assertPropertiesShapeSupported', () => {
  it('does not throw for a valid properties object and additionalProperties shapes', () => {
    expect(() => assertPropertiesShapeSupported({ properties: { a: { type: 'string' } } }, 'input')).not.toThrow();
    expect(() => assertPropertiesShapeSupported({ additionalProperties: true }, 'input')).not.toThrow();
    expect(() => assertPropertiesShapeSupported({ additionalProperties: false }, 'input')).not.toThrow();
    expect(() => assertPropertiesShapeSupported({ additionalProperties: { type: 'string' } }, 'input')).not.toThrow();
  });

  it('throws when properties is not an object', () => {
    expect(() => assertPropertiesShapeSupported({ properties: [] }, 'input')).toThrow('invalid properties');
  });

  it('throws when additionalProperties is neither boolean nor a schema object', () => {
    expect(() => assertPropertiesShapeSupported({ additionalProperties: 1 }, 'input')).toThrow('invalid additionalProperties');
  });
});

describe('assertCombinatorBranchesSupported', () => {
  it('is a no-op for a schema with no combinator keywords', () => {
    expect(() => assertCombinatorBranchesSupported({}, 'input', 0, freshState())).not.toThrow();
  });

  it('throws when a branch list is empty, not an array, or exceeds the max branch count', () => {
    expect(() => assertCombinatorBranchesSupported({ allOf: [] }, 'input', 0, freshState())).toThrow('invalid allOf');
    expect(() => assertCombinatorBranchesSupported({ anyOf: 'not-an-array' }, 'input', 0, freshState())).toThrow('invalid anyOf');
    expect(() => assertCombinatorBranchesSupported({ oneOf: Array.from({ length: 65 }, () => ({})) }, 'input', 0, freshState())).toThrow('invalid oneOf');
  });

  it('recurses structural validation into each branch, surfacing a nested violation', () => {
    expect(() => assertCombinatorBranchesSupported({ allOf: [{ pattern: '^x$' }] }, 'input', 0, freshState())).toThrow('unsupported connector input schema keyword "pattern"');
  });
});

describe('recurseIntoRemainingChildSchemas', () => {
  it('is a no-op when not/items/properties/additionalProperties are all absent', () => {
    expect(() => recurseIntoRemainingChildSchemas({}, 'input', 0, freshState())).not.toThrow();
  });

  it('recurses into `not` and surfaces its structural violation', () => {
    expect(() => recurseIntoRemainingChildSchemas({ not: { pattern: '^x$' } }, 'input', 0, freshState())).toThrow('unsupported');
  });

  it('recurses into `items` and surfaces its structural violation', () => {
    expect(() => recurseIntoRemainingChildSchemas({ items: { $ref: '#/x' } }, 'input', 0, freshState())).toThrow('unsupported');
  });

  it('recurses into each declared properties child', () => {
    expect(() => recurseIntoRemainingChildSchemas({ properties: { a: { pattern: '^x$' } } }, 'input', 0, freshState())).toThrow('unsupported');
  });

  it('recurses into a schema-valued additionalProperties', () => {
    expect(() => recurseIntoRemainingChildSchemas({ additionalProperties: { pattern: '^x$' } }, 'input', 0, freshState())).toThrow('unsupported');
  });

  it('does not recurse into a boolean additionalProperties', () => {
    expect(() => recurseIntoRemainingChildSchemas({ additionalProperties: false }, 'input', 0, freshState())).not.toThrow();
  });
});

describe('countMatchingBranches', () => {
  it('counts matches and captures the last mismatch error', () => {
    const result = countMatchingBranches(4, [{ const: 4 }, { const: 5 }], 'input', 0, freshState());
    expect(result.matches).toBe(1);
    expect((result.lastError as Error).message).toContain('const');
  });

  it('counts zero matches with no error captured when every branch matches', () => {
    const result = countMatchingBranches(4, [{ type: 'number' }, { minimum: 0 }], 'input', 0, freshState());
    expect(result.matches).toBe(2);
    expect(result.lastError).toBeUndefined();
  });

  it('rethrows a non-mismatch error (e.g. evaluation-budget exhaustion) rather than counting it as a miss', () => {
    const state = { nodes: Number.MAX_SAFE_INTEGER };
    expect(() => countMatchingBranches(4, [{ type: 'number' }], 'input', 0, state)).toThrow('node limit');
  });
});

describe('assertBranchListSatisfied', () => {
  it('throws the captured lastError when an allOf branch did not match', () => {
    const lastError = new Error('boom');
    expect(() => assertBranchListSatisfied('allOf', 1, lastError, 2, 'input')).toThrow('boom');
  });

  it('does not throw when every allOf branch matched', () => {
    expect(() => assertBranchListSatisfied('allOf', 2, undefined, 2, 'input')).not.toThrow();
  });

  it('throws when anyOf has zero matches, and not when it has at least one', () => {
    expect(() => assertBranchListSatisfied('anyOf', 0, undefined, 2, 'input')).toThrow('anyOf');
    expect(() => assertBranchListSatisfied('anyOf', 1, undefined, 2, 'input')).not.toThrow();
  });

  it('throws when oneOf has a match count other than exactly one', () => {
    expect(() => assertBranchListSatisfied('oneOf', 0, undefined, 2, 'input')).toThrow('exactly one');
    expect(() => assertBranchListSatisfied('oneOf', 2, undefined, 2, 'input')).toThrow('exactly one');
    expect(() => assertBranchListSatisfied('oneOf', 1, undefined, 2, 'input')).not.toThrow();
  });
});

describe('assertDeclaredTypeMatches', () => {
  it('does not throw when the value matches a declared type', () => {
    expect(() => assertDeclaredTypeMatches(4, { type: ['string', 'number'] }, 'input')).not.toThrow();
  });

  it('does not throw when no type is declared', () => {
    expect(() => assertDeclaredTypeMatches(4, {}, 'input')).not.toThrow();
  });

  it('throws naming the declared types when the value matches none of them', () => {
    expect(() => assertDeclaredTypeMatches('x', { type: ['number', 'boolean'] }, 'input')).toThrow('must be one of: number, boolean');
  });
});

describe('assertEnumAndConstMatch', () => {
  it('does not throw when the value satisfies enum and const', () => {
    expect(() => assertEnumAndConstMatch('safe', { enum: ['safe'], const: 'safe' }, 'input')).not.toThrow();
  });

  it('throws when the value is not in the enum', () => {
    expect(() => assertEnumAndConstMatch('unsafe', { enum: ['safe'] }, 'input')).toThrow('enum');
  });

  it('throws when the value does not deep-equal const', () => {
    expect(() => assertEnumAndConstMatch({ a: 1 }, { const: { a: 2 } }, 'input')).toThrow('const');
  });
});

describe('assertNotSchemaSatisfied', () => {
  it('is a no-op when `not` is absent', () => {
    expect(() => assertNotSchemaSatisfied(9, {}, 'input', 0, freshState())).not.toThrow();
  });

  it('throws when the value satisfies the not sub-schema', () => {
    expect(() => assertNotSchemaSatisfied(9, { not: { const: 9 } }, 'input', 0, freshState())).toThrow('must not');
  });

  it('does not throw when the value does not satisfy the not sub-schema', () => {
    expect(() => assertNotSchemaSatisfied(8, { not: { const: 9 } }, 'input', 0, freshState())).not.toThrow();
  });
});

describe('assertNumberRangeConstraints', () => {
  it('does not throw for a value within every declared bound', () => {
    expect(() => assertNumberRangeConstraints(4, { minimum: 1, maximum: 5, exclusiveMinimum: 3, exclusiveMaximum: 5 }, 'input')).not.toThrow();
  });

  it.each<[string, ConnectorJsonSchema, number, string]>([
    ['minimum', { minimum: 1 }, 0, '>= 1'],
    ['maximum', { maximum: 5 }, 6, '<= 5'],
    ['exclusiveMinimum', { exclusiveMinimum: 3 }, 3, '> 3'],
    ['exclusiveMaximum', { exclusiveMaximum: 5 }, 5, '< 5'],
  ])('rejects a %s violation', (_keyword, schema, value, message) => {
    expect(() => assertNumberRangeConstraints(value, schema, 'input')).toThrow(message);
  });
});

describe('assertNumberMultipleOfConstraint', () => {
  it('is a no-op when multipleOf is absent', () => {
    expect(() => assertNumberMultipleOfConstraint(7, {}, 'input')).not.toThrow();
  });

  it('does not throw for an exact multiple', () => {
    expect(() => assertNumberMultipleOfConstraint(6, { multipleOf: 2 }, 'input')).not.toThrow();
  });

  it('throws for a non-multiple', () => {
    expect(() => assertNumberMultipleOfConstraint(3, { multipleOf: 2 }, 'input')).toThrow('multiple of 2');
  });
});

describe('validateNumberValue', () => {
  it('throws on a non-finite number before checking any constraint', () => {
    expect(() => validateNumberValue(Number.POSITIVE_INFINITY, { minimum: 0 }, 'input')).toThrow('finite number');
  });

  it('delegates to range and multipleOf constraints', () => {
    expect(() => validateNumberValue(0, { minimum: 1 }, 'input')).toThrow('>= 1');
    expect(() => validateNumberValue(3, { multipleOf: 2 }, 'input')).toThrow('multiple of 2');
    expect(() => validateNumberValue(4, { minimum: 1, multipleOf: 2 }, 'input')).not.toThrow();
  });
});

describe('validateStringValue', () => {
  it('measures length by Unicode codepoint, not UTF-16 code unit', () => {
    expect(() => validateStringValue('😀a', { minLength: 2, maxLength: 2 }, 'input')).not.toThrow();
  });

  it('throws when shorter than minLength or longer than maxLength', () => {
    expect(() => validateStringValue('a', { minLength: 2 }, 'input')).toThrow('at least 2');
    expect(() => validateStringValue('abc', { maxLength: 2 }, 'input')).toThrow('at most 2');
  });
});

describe('assertArraySizeConstraints', () => {
  it('does not throw for a length within bounds', () => {
    expect(() => assertArraySizeConstraints([1, 2], { minItems: 1, maxItems: 3 }, 'input')).not.toThrow();
  });

  it('throws when shorter than minItems or longer than maxItems', () => {
    expect(() => assertArraySizeConstraints([1], { minItems: 2 }, 'input')).toThrow('at least 2');
    expect(() => assertArraySizeConstraints([1, 2, 3], { maxItems: 2 }, 'input')).toThrow('at most 2');
  });
});

describe('assertArrayItemsUnique', () => {
  it('is a no-op when uniqueItems is absent or false, even with duplicates', () => {
    expect(() => assertArrayItemsUnique([1, 1], {}, 'input')).not.toThrow();
    expect(() => assertArrayItemsUnique([1, 1], { uniqueItems: false }, 'input')).not.toThrow();
  });

  it('does not throw for a unique array', () => {
    expect(() => assertArrayItemsUnique([1, 2, 3], { uniqueItems: true }, 'input')).not.toThrow();
  });

  it('throws on a deep-equal duplicate pair', () => {
    expect(() => assertArrayItemsUnique([{ a: 1 }, { a: 1 }], { uniqueItems: true }, 'input')).toThrow('unique');
  });
});

describe('recurseIntoArrayItems', () => {
  it('is a no-op when items is absent', () => {
    expect(() => recurseIntoArrayItems([1, 'two'], {}, 'input', 0, freshState())).not.toThrow();
  });

  it('validates every element against the items sub-schema, indexing the path', () => {
    expect(() => recurseIntoArrayItems([1, 'two'], { items: { type: 'integer' } }, 'input', 0, freshState())).toThrow('input[1]');
  });
});

describe('validateArrayValue', () => {
  it('applies size, uniqueness, and item validation together', () => {
    const schema: ConnectorJsonSchema = { minItems: 2, uniqueItems: true, items: { type: 'integer' } };
    expect(() => validateArrayValue([1, 2], schema, 'input', 0, freshState())).not.toThrow();
    expect(() => validateArrayValue([1], schema, 'input', 0, freshState())).toThrow('at least 2');
    expect(() => validateArrayValue([1, 1], schema, 'input', 0, freshState())).toThrow('unique');
    expect(() => validateArrayValue([1, 'two'], schema, 'input', 0, freshState())).toThrow('one of');
  });
});

describe('assertObjectSizeConstraints', () => {
  it('does not throw for a property count within bounds', () => {
    expect(() => assertObjectSizeConstraints({ a: 1 }, { minProperties: 1, maxProperties: 2 }, 'input')).not.toThrow();
  });

  it('throws when fewer than minProperties or more than maxProperties', () => {
    expect(() => assertObjectSizeConstraints({}, { minProperties: 1 }, 'input')).toThrow('at least 1');
    expect(() => assertObjectSizeConstraints({ a: 1, b: 2 }, { maxProperties: 1 }, 'input')).toThrow('at most 1');
  });
});

describe('assertRequiredPropertiesPresent', () => {
  it('is a no-op when required is absent', () => {
    expect(() => assertRequiredPropertiesPresent({}, {}, 'input')).not.toThrow();
  });

  it('does not throw when every required key is present', () => {
    expect(() => assertRequiredPropertiesPresent({ mode: 'safe' }, { required: ['mode'] }, 'input')).not.toThrow();
  });

  it('throws naming the first missing required key', () => {
    expect(() => assertRequiredPropertiesPresent({}, { required: ['mode'] }, 'input')).toThrow('input.mode is required');
  });
});

describe('recurseIntoDeclaredProperties', () => {
  it('only validates keys actually present on the value', () => {
    expect(() => recurseIntoDeclaredProperties({}, { mode: { type: 'string' } }, 'input', 0, freshState())).not.toThrow();
  });

  it('surfaces a nested violation for a present declared property', () => {
    expect(() => recurseIntoDeclaredProperties({ mode: 1 }, { mode: { type: 'string' } }, 'input', 0, freshState())).toThrow('one of');
  });
});

describe('assertAdditionalPropertiesAllowed', () => {
  it('is a no-op when there are no extra keys', () => {
    expect(() => assertAdditionalPropertiesAllowed({}, { additionalProperties: false }, 'input', [], 0, freshState())).not.toThrow();
  });

  it('throws naming the first disallowed extra key when additionalProperties is false', () => {
    expect(() => assertAdditionalPropertiesAllowed({ extra: 1 }, { additionalProperties: false }, 'input', ['extra'], 0, freshState())).toThrow('input.extra');
  });

  it('does not throw for extra keys when additionalProperties is true', () => {
    expect(() => assertAdditionalPropertiesAllowed({ extra: 1 }, { additionalProperties: true }, 'input', ['extra'], 0, freshState())).not.toThrow();
  });

  it('recurses validation into a schema-valued additionalProperties, surfacing a nested violation', () => {
    expect(() => assertAdditionalPropertiesAllowed(
      { extra: 'not-a-number' },
      { additionalProperties: { type: 'integer' } },
      'input',
      ['extra'],
      0,
      freshState(),
    )).toThrow('one of');
  });
});

describe('validateObjectValue', () => {
  it('applies size, required, declared-property, and additionalProperties validation together', () => {
    const schema: ConnectorJsonSchema = {
      minProperties: 1,
      properties: { mode: { type: 'string' } },
      required: ['mode'],
      additionalProperties: { type: 'integer' },
    };
    expect(() => validateObjectValue({ mode: 'safe', retries: 2 }, schema, 'input', 0, freshState())).not.toThrow();
    expect(() => validateObjectValue({}, schema, 'input', 0, freshState())).toThrow('at least 1');
  });
});
