/**
 * @module json-schema
 *
 * Fail-closed validation for the bounded JSON Schema subset accepted by the
 * Composio execution boundary.
 */
import type { JsonValue } from '@jini-ai/protocol';

export type ConnectorJsonSchema = { [key: string]: JsonValue };

const JSON_SCHEMA_MAX_DEPTH = 32;
const JSON_SCHEMA_MAX_NODES = 20_000;
const JSON_SCHEMA_MAX_BRANCHES = 64;

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'type',
  'enum',
  'const',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'minProperties',
  'maxProperties',
  'required',
  'properties',
  'additionalProperties',
]);

const VALID_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);

interface ValidationState {
  nodes: number;
}

class ConnectorSchemaMismatchError extends Error {
  constructor(path: string, message: string) {
    super(`${path} ${message}`);
    this.name = 'ConnectorSchemaMismatchError';
  }
}

class ConnectorSchemaUnsupportedError extends Error {
  constructor(path: string, message: string) {
    super(`${path} ${message}`);
    this.name = 'ConnectorSchemaUnsupportedError';
  }
}

class ConnectorSchemaEvaluationError extends Error {
  constructor(path: string, message: string) {
    super(`${path} ${message}`);
    this.name = 'ConnectorSchemaEvaluationError';
  }
}

function schemaError(path: string, message: string): never {
  throw new ConnectorSchemaMismatchError(path, message);
}

function unsupportedSchemaError(path: string, message: string): never {
  throw new ConnectorSchemaUnsupportedError(path, message);
}

function schemaEvaluationError(path: string, message: string): never {
  throw new ConnectorSchemaEvaluationError(path, message);
}

function isJsonObject(value: unknown): value is ConnectorJsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Element-wise deep equality for two same-length JSON arrays. */
export function arraysDeepEqual(left: JsonValue[], right: JsonValue[]): boolean {
  return left.length === right.length && left.every((item, index) => deepJsonEqual(item, right[index]!));
}

/** Key-set and value-wise deep equality for two JSON objects (order-independent). */
export function objectsDeepEqual(left: ConnectorJsonSchema, right: ConnectorJsonSchema): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && deepJsonEqual(left[key]!, right[key]!));
}

function deepJsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && arraysDeepEqual(left, right);
  }
  if (isJsonObject(left) || isJsonObject(right)) {
    return isJsonObject(left) && isJsonObject(right) && objectsDeepEqual(left, right);
  }
  return false;
}

function actualJsonType(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesDeclaredType(value: JsonValue, declaredType: string): boolean {
  if (declaredType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (declaredType === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return actualJsonType(value) === declaredType;
}

function requireNonNegativeInteger(value: JsonValue | undefined, keyword: string, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    unsupportedSchemaError(path, `has an invalid ${keyword} schema constraint`);
  }
  return value;
}

function requireFiniteNumber(value: JsonValue | undefined, keyword: string, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    unsupportedSchemaError(path, `has an invalid ${keyword} schema constraint`);
  }
  return value;
}

/** The `type` keyword's declared type(s), normalized to a list (empty when `type` is absent). Shared by structural validation and evaluation. */
export function declaredSchemaTypes(schema: ConnectorJsonSchema): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) return schema.type as string[];
  return [];
}

/** True when the `type` keyword is absent, a string, or a non-empty array of strings. */
export function isSupportedTypeKeywordShape(type: JsonValue | undefined): boolean {
  if (type === undefined || typeof type === 'string') return true;
  return Array.isArray(type) && type.length > 0 && type.every((item) => typeof item === 'string');
}

/** Rejects any schema keyword outside the bounded, supported subset. */
export function assertSupportedKeywords(schema: ConnectorJsonSchema, path: string): void {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      unsupportedSchemaError(path, `uses unsupported connector input schema keyword "${keyword}"`);
    }
  }
}

/** Rejects an unsupported `type` keyword shape or a declared type outside `VALID_TYPES`. */
export function assertTypeKeywordSupported(schema: ConnectorJsonSchema, path: string): void {
  if (!isSupportedTypeKeywordShape(schema.type)) {
    unsupportedSchemaError(path, 'has an invalid type schema constraint');
  }
  if (declaredSchemaTypes(schema).some((type) => !VALID_TYPES.has(type))) {
    unsupportedSchemaError(path, 'has an unsupported type schema constraint');
  }
}

/** Rejects a malformed `enum` keyword (must be a non-empty array when present). */
export function assertEnumShapeSupported(schema: ConnectorJsonSchema, path: string): void {
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    unsupportedSchemaError(path, 'has an invalid enum schema constraint');
  }
}

/** Rejects malformed numeric-range keywords (`minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf`). */
export function assertNumericConstraintsSupported(schema: ConnectorJsonSchema, path: string): void {
  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const) {
    requireFiniteNumber(schema[keyword], keyword, path);
  }
  if (typeof schema.multipleOf === 'number' && schema.multipleOf <= 0) {
    unsupportedSchemaError(path, 'has an invalid multipleOf schema constraint');
  }
}

/** Rejects malformed size keywords (`min/maxLength`, `min/maxItems`, `min/maxProperties`) and a malformed `uniqueItems`. */
export function assertSizeConstraintsSupported(schema: ConnectorJsonSchema, path: string): void {
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'] as const) {
    requireNonNegativeInteger(schema[keyword], keyword, path);
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') {
    unsupportedSchemaError(path, 'has an invalid uniqueItems schema constraint');
  }
}

/** Rejects a malformed `required` keyword (must be an array of strings when present). */
export function assertRequiredShapeSupported(schema: ConnectorJsonSchema, path: string): void {
  if (
    schema.required !== undefined
    && (!Array.isArray(schema.required) || !schema.required.every((item) => typeof item === 'string'))
  ) {
    unsupportedSchemaError(path, 'has an invalid required schema constraint');
  }
}

/** Rejects a malformed `properties` or `additionalProperties` keyword shape (recursion into their children happens separately). */
export function assertPropertiesShapeSupported(schema: ConnectorJsonSchema, path: string): void {
  if (schema.properties !== undefined && !isJsonObject(schema.properties)) {
    unsupportedSchemaError(path, 'has an invalid properties schema constraint');
  }
  if (
    schema.additionalProperties !== undefined
    && typeof schema.additionalProperties !== 'boolean'
    && !isJsonObject(schema.additionalProperties)
  ) {
    unsupportedSchemaError(path, 'has an invalid additionalProperties schema constraint');
  }
}

/** Rejects a malformed `allOf`/`anyOf`/`oneOf` branch list and recurses structural validation into each branch. */
export function assertCombinatorBranchesSupported(
  schema: ConnectorJsonSchema,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = schema[keyword];
    if (branches === undefined) continue;
    if (!Array.isArray(branches) || branches.length === 0 || branches.length > JSON_SCHEMA_MAX_BRANCHES) {
      unsupportedSchemaError(path, `has an invalid ${keyword} schema constraint`);
    }
    branches.forEach((branch, index) => {
      assertSchemaStructureSupported(branch, `${path}.${keyword}[${index}]`, depth + 1, state);
    });
  }
}

/** Recurses structural validation into `not`, `items`, each declared `properties` child, and a schema-valued `additionalProperties`. */
export function recurseIntoRemainingChildSchemas(
  schema: ConnectorJsonSchema,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  if (schema.not !== undefined) assertSchemaStructureSupported(schema.not, `${path}.not`, depth + 1, state);
  if (schema.items !== undefined) assertSchemaStructureSupported(schema.items, `${path}.items`, depth + 1, state);
  if (isJsonObject(schema.properties)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      assertSchemaStructureSupported(childSchema, `${path}.properties.${key}`, depth + 1, state);
    }
  }
  if (isJsonObject(schema.additionalProperties)) {
    assertSchemaStructureSupported(schema.additionalProperties, `${path}.additionalProperties`, depth + 1, state);
  }
}

function assertSchemaStructureSupported(
  schema: JsonValue,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  state.nodes += 1;
  if (state.nodes > JSON_SCHEMA_MAX_NODES) unsupportedSchemaError(path, 'schema exceeds the node limit');
  if (depth > JSON_SCHEMA_MAX_DEPTH) unsupportedSchemaError(path, 'schema exceeds the depth limit');
  if (typeof schema === 'boolean') return;
  if (!isJsonObject(schema)) unsupportedSchemaError(path, 'has an invalid connector input schema');

  assertSupportedKeywords(schema, path);
  assertTypeKeywordSupported(schema, path);
  assertEnumShapeSupported(schema, path);
  assertNumericConstraintsSupported(schema, path);
  assertSizeConstraintsSupported(schema, path);
  assertRequiredShapeSupported(schema, path);
  assertPropertiesShapeSupported(schema, path);
  assertCombinatorBranchesSupported(schema, path, depth, state);
  recurseIntoRemainingChildSchemas(schema, path, depth, state);
}

/** Runs `value` against every branch of an `allOf`/`anyOf`/`oneOf` list, returning the match count and the last mismatch seen (for `allOf`'s error). */
export function countMatchingBranches(
  value: JsonValue,
  branches: JsonValue[],
  path: string,
  depth: number,
  state: ValidationState,
): { matches: number; lastError: unknown } {
  let matches = 0;
  let lastError: unknown;
  for (const branch of branches) {
    try {
      validateSchema(value, branch, path, depth + 1, state);
      matches += 1;
    } catch (error) {
      if (!(error instanceof ConnectorSchemaMismatchError)) throw error;
      lastError = error;
    }
  }
  return { matches, lastError };
}

/** Enforces the combinator's match-count rule (`allOf`: all branches, `anyOf`: at least one, `oneOf`: exactly one) given a branch-match tally. */
export function assertBranchListSatisfied(
  keyword: 'allOf' | 'anyOf' | 'oneOf',
  matches: number,
  lastError: unknown,
  totalBranches: number,
  path: string,
): void {
  if (keyword === 'allOf' && matches !== totalBranches) {
    // A mismatch means at least one non-empty, structurally validated branch
    // failed through `schemaError`, which always produces an Error.
    throw lastError as Error;
  }
  if (keyword === 'anyOf' && matches === 0) schemaError(path, 'must satisfy at least one anyOf branch');
  if (keyword === 'oneOf' && matches !== 1) schemaError(path, 'must satisfy exactly one oneOf branch');
}

function validateSchemaBranchList(
  keyword: 'allOf' | 'anyOf' | 'oneOf',
  branches: JsonValue | undefined,
  value: JsonValue,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  if (branches === undefined) return;
  // Structure is validated in a complete pass before evaluation begins.
  const validatedBranches = branches as JsonValue[];
  const { matches, lastError } = countMatchingBranches(value, validatedBranches, path, depth, state);
  assertBranchListSatisfied(keyword, matches, lastError, validatedBranches.length, path);
}

/** Rejects a value whose type doesn't match the schema's declared `type` keyword. */
export function assertDeclaredTypeMatches(value: JsonValue, schema: ConnectorJsonSchema, path: string): void {
  const declaredTypes = declaredSchemaTypes(schema);
  if (declaredTypes.length > 0 && !declaredTypes.some((type) => matchesDeclaredType(value, type))) {
    schemaError(path, `must be one of: ${declaredTypes.join(', ')}`);
  }
}

/** Rejects a value that fails the schema's `enum` or `const` keyword. */
export function assertEnumAndConstMatch(value: JsonValue, schema: ConnectorJsonSchema, path: string): void {
  if (schema.enum !== undefined) {
    if (!(schema.enum as JsonValue[]).some((candidate) => deepJsonEqual(value, candidate))) schemaError(path, 'must match an allowed enum value');
  }
  if (schema.const !== undefined && !deepJsonEqual(value, schema.const)) {
    schemaError(path, 'must match the const schema value');
  }
}

/** Rejects a value that satisfies the schema's `not` sub-schema (a mismatch there is what `not` requires). */
export function assertNotSchemaSatisfied(
  value: JsonValue,
  schema: ConnectorJsonSchema,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  if (schema.not === undefined) return;
  let rejected = false;
  try {
    validateSchema(value, schema.not, path, depth + 1, state);
  } catch (error) {
    if (!(error instanceof ConnectorSchemaMismatchError)) throw error;
    rejected = true;
  }
  if (!rejected) schemaError(path, 'must not satisfy the not schema');
}

/** Rejects a number outside `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`. */
export function assertNumberRangeConstraints(value: number, schema: ConnectorJsonSchema, path: string): void {
  const minimum = requireFiniteNumber(schema.minimum, 'minimum', path);
  const maximum = requireFiniteNumber(schema.maximum, 'maximum', path);
  const exclusiveMinimum = requireFiniteNumber(schema.exclusiveMinimum, 'exclusiveMinimum', path);
  const exclusiveMaximum = requireFiniteNumber(schema.exclusiveMaximum, 'exclusiveMaximum', path);
  if (minimum !== undefined && value < minimum) schemaError(path, `must be >= ${minimum}`);
  if (maximum !== undefined && value > maximum) schemaError(path, `must be <= ${maximum}`);
  if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) schemaError(path, `must be > ${exclusiveMinimum}`);
  if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) schemaError(path, `must be < ${exclusiveMaximum}`);
}

/** Rejects a number that isn't a multiple of the schema's `multipleOf`. */
export function assertNumberMultipleOfConstraint(value: number, schema: ConnectorJsonSchema, path: string): void {
  const multipleOf = requireFiniteNumber(schema.multipleOf, 'multipleOf', path);
  if (multipleOf === undefined) return;
  const quotient = value / multipleOf;
  if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient))) {
    schemaError(path, `must be a multiple of ${multipleOf}`);
  }
}

/** Validates a number value against the schema's finiteness, range, and `multipleOf` keywords. */
export function validateNumberValue(value: number, schema: ConnectorJsonSchema, path: string): void {
  if (!Number.isFinite(value)) schemaError(path, 'must be a finite number');
  assertNumberRangeConstraints(value, schema, path);
  assertNumberMultipleOfConstraint(value, schema, path);
}

/** Validates a string value's Unicode-codepoint length against `minLength`/`maxLength`. */
export function validateStringValue(value: string, schema: ConnectorJsonSchema, path: string): void {
  const minLength = requireNonNegativeInteger(schema.minLength, 'minLength', path);
  const maxLength = requireNonNegativeInteger(schema.maxLength, 'maxLength', path);
  const length = [...value].length;
  if (minLength !== undefined && length < minLength) schemaError(path, `must contain at least ${minLength} characters`);
  if (maxLength !== undefined && length > maxLength) schemaError(path, `must contain at most ${maxLength} characters`);
}

/** Rejects an array whose length falls outside `minItems`/`maxItems`. */
export function assertArraySizeConstraints(value: JsonValue[], schema: ConnectorJsonSchema, path: string): void {
  const minItems = requireNonNegativeInteger(schema.minItems, 'minItems', path);
  const maxItems = requireNonNegativeInteger(schema.maxItems, 'maxItems', path);
  if (minItems !== undefined && value.length < minItems) schemaError(path, `must contain at least ${minItems} items`);
  if (maxItems !== undefined && value.length > maxItems) schemaError(path, `must contain at most ${maxItems} items`);
}

/** When `uniqueItems` is `true`, rejects an array containing two deep-equal elements. */
export function assertArrayItemsUnique(value: JsonValue[], schema: ConnectorJsonSchema, path: string): void {
  if (schema.uniqueItems !== true) return;
  for (let left = 0; left < value.length; left += 1) {
    for (let right = left + 1; right < value.length; right += 1) {
      if (deepJsonEqual(value[left]!, value[right]!)) schemaError(path, 'must contain unique items');
    }
  }
}

/** Recurses evaluation into every array element against the schema's `items` sub-schema. */
export function recurseIntoArrayItems(
  value: JsonValue[],
  schema: ConnectorJsonSchema,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  if (schema.items === undefined) return;
  for (let index = 0; index < value.length; index += 1) {
    validateSchema(value[index]!, schema.items, `${path}[${index}]`, depth + 1, state);
  }
}

/** Validates an array value's size, uniqueness, and (recursively) its items. */
export function validateArrayValue(
  value: JsonValue[],
  schema: ConnectorJsonSchema,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  assertArraySizeConstraints(value, schema, path);
  assertArrayItemsUnique(value, schema, path);
  recurseIntoArrayItems(value, schema, path, depth, state);
}

/** Rejects an object whose property count falls outside `minProperties`/`maxProperties`. */
export function assertObjectSizeConstraints(value: ConnectorJsonSchema, schema: ConnectorJsonSchema, path: string): void {
  const keys = Object.keys(value);
  const minProperties = requireNonNegativeInteger(schema.minProperties, 'minProperties', path);
  const maxProperties = requireNonNegativeInteger(schema.maxProperties, 'maxProperties', path);
  if (minProperties !== undefined && keys.length < minProperties) schemaError(path, `must contain at least ${minProperties} properties`);
  if (maxProperties !== undefined && keys.length > maxProperties) schemaError(path, `must contain at most ${maxProperties} properties`);
}

/** Rejects an object missing any of the schema's `required` property names. */
export function assertRequiredPropertiesPresent(value: ConnectorJsonSchema, schema: ConnectorJsonSchema, path: string): void {
  const required = schema.required as string[] | undefined;
  if (required === undefined) return;
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) schemaError(`${path}.${key}`, 'is required by connector input schema');
  }
}

function propertySchemasOf(schema: ConnectorJsonSchema): ConnectorJsonSchema {
  return schema.properties === undefined ? {} : schema.properties as ConnectorJsonSchema;
}

/** Recurses evaluation into every value present in `value` whose key is declared in `properties`. */
export function recurseIntoDeclaredProperties(
  value: ConnectorJsonSchema,
  propertySchemas: ConnectorJsonSchema,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  for (const [key, childSchema] of Object.entries(propertySchemas)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      validateSchema(value[key]!, childSchema, `${path}.${key}`, depth + 1, state);
    }
  }
}

function extraObjectKeys(value: ConnectorJsonSchema, propertySchemas: ConnectorJsonSchema): string[] {
  return Object.keys(value).filter((key) => !Object.prototype.hasOwnProperty.call(propertySchemas, key));
}

/** Rejects a disallowed extra property (`additionalProperties: false`) or recurses evaluation into a schema-valued `additionalProperties`. */
export function assertAdditionalPropertiesAllowed(
  value: ConnectorJsonSchema,
  schema: ConnectorJsonSchema,
  path: string,
  extraKeys: string[],
  depth: number,
  state: ValidationState,
): void {
  if (schema.additionalProperties === false && extraKeys.length > 0) {
    schemaError(`${path}.${extraKeys[0]}`, 'is not allowed by connector input schema');
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== true && schema.additionalProperties !== false) {
    for (const key of extraKeys) {
      validateSchema(value[key]!, schema.additionalProperties, `${path}.${key}`, depth + 1, state);
    }
  }
}

/** Validates an object value's size, `required` properties, declared `properties`, and `additionalProperties`. */
export function validateObjectValue(
  value: ConnectorJsonSchema,
  schema: ConnectorJsonSchema,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  assertObjectSizeConstraints(value, schema, path);
  assertRequiredPropertiesPresent(value, schema, path);
  const propertySchemas = propertySchemasOf(schema);
  recurseIntoDeclaredProperties(value, propertySchemas, path, depth, state);
  const extraKeys = extraObjectKeys(value, propertySchemas);
  assertAdditionalPropertiesAllowed(value, schema, path, extraKeys, depth, state);
}

function validateSchema(
  value: JsonValue,
  schema: JsonValue,
  path: string,
  depth: number,
  state: ValidationState,
): void {
  state.nodes += 1;
  if (state.nodes > JSON_SCHEMA_MAX_NODES) schemaEvaluationError(path, 'schema evaluation exceeded the node limit');
  if (typeof schema === 'boolean') {
    if (!schema) schemaError(path, 'is rejected by the connector input schema');
    return;
  }
  // The structural pass has already proven this is a supported schema object.
  const validatedSchema = schema as ConnectorJsonSchema;

  assertDeclaredTypeMatches(value, validatedSchema, path);
  assertEnumAndConstMatch(value, validatedSchema, path);

  validateSchemaBranchList('allOf', validatedSchema.allOf, value, path, depth, state);
  validateSchemaBranchList('anyOf', validatedSchema.anyOf, value, path, depth, state);
  validateSchemaBranchList('oneOf', validatedSchema.oneOf, value, path, depth, state);
  assertNotSchemaSatisfied(value, validatedSchema, path, depth, state);

  if (typeof value === 'number') validateNumberValue(value, validatedSchema, path);
  if (typeof value === 'string') validateStringValue(value, validatedSchema, path);
  if (Array.isArray(value)) validateArrayValue(value, validatedSchema, path, depth, state);
  if (isJsonObject(value)) validateObjectValue(value, validatedSchema, path, depth, state);
}

/**
 * Validates input or throws before any provider effect can run.
 *
 * Structure and evaluation use independent shared node budgets. Exhaustion is
 * an indeterminate hard denial and cannot be consumed as an ordinary
 * combinator mismatch.
 *
 * @complexity Time: O(n). Space: O(d), for bounded schema/input traversal.
 * @overallScore 100/100
 */
export function assertConnectorInputMatchesSchema(
  value: JsonValue,
  schema: ConnectorJsonSchema | undefined,
  path = 'input',
): void {
  if (schema === undefined) schemaError(path, 'is missing a connector input schema');
  assertSchemaStructureSupported(schema, path, 0, { nodes: 0 });
  validateSchema(value, schema, path, 0, { nodes: 0 });
}

/** Returns the fail-closed reason used to keep unsupported live tools uncallable. */
export function getConnectorSchemaSupportError(schema: JsonValue): string | undefined {
  try {
    assertSchemaStructureSupported(schema, 'schema-probe', 0, { nodes: 0 });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}
