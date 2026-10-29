import { expect, it } from 'vitest';
import { scopeNestedSchemaRefs } from '../schema-ref-scope.js';

it('keeps external and unresolved references unchanged without an enclosing definitions scope', () => {
  const schema = { anyOf: [{ $ref: '#/$defs/missing' }, { $ref: 'https://example.com/schema#/$defs/name' }, false] };
  expect(scopeNestedSchemaRefs({ schema })).toEqual(schema);
  expect(scopeNestedSchemaRefs({ schema: null })).toBeNull();
});

it('scopes escaped names inside schema maps while leaving literal instance data alone', () => {
  const schema = { properties: { 'a/b~c': {
    $defs: { 'part/name~': { type: 'string' } },
    properties: { const: { $ref: '#/$defs/part~1name~0' } },
    const: { $ref: '#/$defs/part~1name~0' },
    enum: [{ $ref: '#/$defs/part~1name~0' }],
    default: { $ref: '#/$defs/part~1name~0' },
    examples: [{ $ref: '#/$defs/part~1name~0' }],
  } } };
  const snapshot = structuredClone(schema);
  expect(scopeNestedSchemaRefs({ schema })).toEqual({ properties: { 'a/b~c': {
    ...schema.properties['a/b~c'], properties: { const: { $ref: '#/properties/a~1b~0c/$defs/part~1name~0' } },
  } } });
  expect(schema).toEqual(snapshot);
});

it('keeps root definitions authoritative when nested definitions use the same name', () => {
  const schema = { $defs: { shared: { type: 'number' } }, properties: { child: {
    $defs: { shared: { type: 'string' }, local: { type: 'boolean' } },
    allOf: [{ $ref: '#/$defs/shared' }, { $ref: '#/$defs/local' }, true],
  } } };
  expect(scopeNestedSchemaRefs({ schema })).toEqual({ ...schema, properties: { child: {
    ...schema.properties.child, allOf: [{ $ref: '#/$defs/shared' }, { $ref: '#/properties/child/$defs/local' }, true],
  } } });
});
