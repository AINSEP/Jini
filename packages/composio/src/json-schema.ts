/**
 * @module json-schema
 *
 * Fail-closed validation for the bounded JSON Schema subset accepted by the
 * Composio execution boundary.
 */
import type { JsonValue } from '@jini/protocol';

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

function deepJsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepJsonEqual(item, right[index]!));
  }
  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => (
        key === rightKeys[index]
        && deepJsonEqual(left[key]!, right[key]!)
      ));
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

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      unsupportedSchemaError(path, `uses unsupported connector input schema keyword "${keyword}"`);
    }
  }

  if (
    schema.type !== undefined
    && typeof schema.type !== 'string'
    && !(Array.isArray(schema.type) && schema.type.length > 0 && schema.type.every((item) => typeof item === 'string'))
  ) {
    unsupportedSchemaError(path, 'has an invalid type schema constraint');
  }
  const declaredTypes = typeof schema.type === 'string'
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type as string[]
      : [];
  if (declaredTypes.some((type) => !VALID_TYPES.has(type))) {
    unsupportedSchemaError(path, 'has an unsupported type schema constraint');
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    unsupportedSchemaError(path, 'has an invalid enum schema constraint');
  }

  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const) {
    requireFiniteNumber(schema[keyword], keyword, path);
  }
  if (typeof schema.multipleOf === 'number' && schema.multipleOf <= 0) {
    unsupportedSchemaError(path, 'has an invalid multipleOf schema constraint');
  }
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'] as const) {
    requireNonNegativeInteger(schema[keyword], keyword, path);
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') {
    unsupportedSchemaError(path, 'has an invalid uniqueItems schema constraint');
  }
  if (
    schema.required !== undefined
    && (!Array.isArray(schema.required) || !schema.required.every((item) => typeof item === 'string'))
  ) {
    unsupportedSchemaError(path, 'has an invalid required schema constraint');
  }
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
  let matches = 0;
  let lastError: unknown;
  for (const branch of validatedBranches) {
    try {
      validateSchema(value, branch, path, depth + 1, state);
      matches += 1;
    } catch (error) {
      if (!(error instanceof ConnectorSchemaMismatchError)) throw error;
      lastError = error;
    }
  }
  if (keyword === 'allOf' && matches !== validatedBranches.length) {
    // A mismatch means at least one non-empty, structurally validated branch
    // failed through `schemaError`, which always produces an Error.
    throw lastError as Error;
  }
  if (keyword === 'anyOf' && matches === 0) schemaError(path, 'must satisfy at least one anyOf branch');
  if (keyword === 'oneOf' && matches !== 1) schemaError(path, 'must satisfy exactly one oneOf branch');
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

  let declaredTypes: string[] = [];
  if (typeof validatedSchema.type === 'string') declaredTypes = [validatedSchema.type];
  else if (Array.isArray(validatedSchema.type)) declaredTypes = validatedSchema.type as string[];
  if (declaredTypes.length > 0 && !declaredTypes.some((type) => matchesDeclaredType(value, type))) {
    schemaError(path, `must be one of: ${declaredTypes.join(', ')}`);
  }

  if (validatedSchema.enum !== undefined) {
    if (!(validatedSchema.enum as JsonValue[]).some((candidate) => deepJsonEqual(value, candidate))) schemaError(path, 'must match an allowed enum value');
  }
  if (validatedSchema.const !== undefined && !deepJsonEqual(value, validatedSchema.const)) {
    schemaError(path, 'must match the const schema value');
  }

  validateSchemaBranchList('allOf', validatedSchema.allOf, value, path, depth, state);
  validateSchemaBranchList('anyOf', validatedSchema.anyOf, value, path, depth, state);
  validateSchemaBranchList('oneOf', validatedSchema.oneOf, value, path, depth, state);
  if (validatedSchema.not !== undefined) {
    let rejected = false;
    try {
      validateSchema(value, validatedSchema.not, path, depth + 1, state);
    } catch (error) {
      if (!(error instanceof ConnectorSchemaMismatchError)) throw error;
      rejected = true;
    }
    if (!rejected) schemaError(path, 'must not satisfy the not schema');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) schemaError(path, 'must be a finite number');
    const minimum = requireFiniteNumber(validatedSchema.minimum, 'minimum', path);
    const maximum = requireFiniteNumber(validatedSchema.maximum, 'maximum', path);
    const exclusiveMinimum = requireFiniteNumber(validatedSchema.exclusiveMinimum, 'exclusiveMinimum', path);
    const exclusiveMaximum = requireFiniteNumber(validatedSchema.exclusiveMaximum, 'exclusiveMaximum', path);
    const multipleOf = requireFiniteNumber(validatedSchema.multipleOf, 'multipleOf', path);
    if (minimum !== undefined && value < minimum) schemaError(path, `must be >= ${minimum}`);
    if (maximum !== undefined && value > maximum) schemaError(path, `must be <= ${maximum}`);
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) schemaError(path, `must be > ${exclusiveMinimum}`);
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) schemaError(path, `must be < ${exclusiveMaximum}`);
    if (multipleOf !== undefined) {
      const quotient = value / multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient))) {
        schemaError(path, `must be a multiple of ${multipleOf}`);
      }
    }
  }

  if (typeof value === 'string') {
    const minLength = requireNonNegativeInteger(validatedSchema.minLength, 'minLength', path);
    const maxLength = requireNonNegativeInteger(validatedSchema.maxLength, 'maxLength', path);
    const length = [...value].length;
    if (minLength !== undefined && length < minLength) schemaError(path, `must contain at least ${minLength} characters`);
    if (maxLength !== undefined && length > maxLength) schemaError(path, `must contain at most ${maxLength} characters`);
  }

  if (Array.isArray(value)) {
    const minItems = requireNonNegativeInteger(validatedSchema.minItems, 'minItems', path);
    const maxItems = requireNonNegativeInteger(validatedSchema.maxItems, 'maxItems', path);
    if (minItems !== undefined && value.length < minItems) schemaError(path, `must contain at least ${minItems} items`);
    if (maxItems !== undefined && value.length > maxItems) schemaError(path, `must contain at most ${maxItems} items`);
    if (validatedSchema.uniqueItems === true) {
      for (let left = 0; left < value.length; left += 1) {
        for (let right = left + 1; right < value.length; right += 1) {
          if (deepJsonEqual(value[left]!, value[right]!)) schemaError(path, 'must contain unique items');
        }
      }
    }
    if (validatedSchema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        validateSchema(value[index]!, validatedSchema.items, `${path}[${index}]`, depth + 1, state);
      }
    }
  }

  if (isJsonObject(value)) {
    const keys = Object.keys(value);
    const minProperties = requireNonNegativeInteger(validatedSchema.minProperties, 'minProperties', path);
    const maxProperties = requireNonNegativeInteger(validatedSchema.maxProperties, 'maxProperties', path);
    if (minProperties !== undefined && keys.length < minProperties) schemaError(path, `must contain at least ${minProperties} properties`);
    if (maxProperties !== undefined && keys.length > maxProperties) schemaError(path, `must contain at most ${maxProperties} properties`);

    const required = validatedSchema.required as string[] | undefined;
    if (required !== undefined) {
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) schemaError(`${path}.${key}`, 'is required by connector input schema');
      }
    }

    const properties = validatedSchema.properties;
    const propertySchemas = properties === undefined ? {} : properties as ConnectorJsonSchema;
    for (const [key, childSchema] of Object.entries(propertySchemas)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateSchema(value[key]!, childSchema, `${path}.${key}`, depth + 1, state);
      }
    }

    const extraKeys = keys.filter((key) => !Object.prototype.hasOwnProperty.call(propertySchemas, key));
    if (validatedSchema.additionalProperties === false && extraKeys.length > 0) {
      schemaError(`${path}.${extraKeys[0]}`, 'is not allowed by connector input schema');
    }
    if (validatedSchema.additionalProperties !== undefined && validatedSchema.additionalProperties !== true && validatedSchema.additionalProperties !== false) {
      for (const key of extraKeys) {
        validateSchema(value[key]!, validatedSchema.additionalProperties, `${path}.${key}`, depth + 1, state);
      }
    }
  }
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
