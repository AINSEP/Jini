import { Validator, type Schema } from "@cfworker/json-schema";
import { closed, integer, name, record, requireCondition } from "./validation.js";

const KEYS: Readonly<Record<string, readonly string[]>> = {
  object: ["type", "properties", "required", "additionalProperties"],
  array: ["type", "items", "minItems", "maxItems"],
  string: ["type", "minLength", "maxLength", "enum"],
  number: ["type", "minimum", "maximum", "enum"],
  integer: ["type", "minimum", "maximum", "enum"],
  boolean: ["type", "enum"],
};

/** Closed, bounded schemas only; no refs, combinators, formats, regex or executable expressions.
 * @complexity O(s), with depth <= 4 and <= 32 properties per object; serialized schema is capped. */
export function compileInputSchema({ schema }: { schema: Record<string, unknown> }, _options: Record<string, never> = {}): Validator {
  requireCondition({ valid: schema.type === "object" });
  checkNode({ schema, depth: 0 });
  return new Validator(schema as Schema, "2020-12", true);
}

function checkNode({ schema, depth }: { schema: Record<string, unknown>; depth: number }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: depth <= 4 });
  requireCondition({ valid: typeof schema.type === "string" && Object.hasOwn(KEYS, schema.type) });
  const keys = KEYS[schema.type as string]!;
  closed({ value: schema, keys });
  if (schema.type === "object") return checkObject({ schema, depth });
  if (schema.type === "array") return checkArray({ schema, depth });
  checkPrimitive({ schema });
}

function checkObject({ schema, depth }: { schema: Record<string, unknown>; depth: number }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: schema.additionalProperties === false });
  const properties = record({ value: schema.properties });
  integer({ value: Object.keys(properties).length, max: 32 });
  for (const [key, child] of Object.entries(properties)) {
    name({ value: key });
    checkNode({ schema: record({ value: child }), depth: depth + 1 });
  }
  if (schema.required === undefined) return;
  requireCondition({ valid: Array.isArray(schema.required) });
  const required = schema.required as unknown[];
  requireCondition({ valid: required.every(key => typeof key === "string" && Object.hasOwn(properties, key)) });
  requireCondition({ valid: new Set(required).size === required.length });
}

function checkArray({ schema, depth }: { schema: Record<string, unknown>; depth: number }, _options: Record<string, never> = {}): void {
  integer({ value: schema.maxItems, max: 50 });
  if (schema.minItems !== undefined) integer({ value: schema.minItems, max: Number(schema.maxItems) });
  checkNode({ schema: record({ value: schema.items }), depth: depth + 1 });
}

function checkPrimitive({ schema }: { schema: Record<string, unknown> }, _options: Record<string, never> = {}): void {
  if (schema.type === "string") {
    integer({ value: schema.maxLength, max: 4096 });
    if (schema.minLength !== undefined) integer({ value: schema.minLength, max: Number(schema.maxLength) });
  }
  if (schema.type === "number" || schema.type === "integer") checkRange({ schema });
  if (schema.enum !== undefined) checkEnum({ schema });
}

function checkRange({ schema }: { schema: Record<string, unknown> }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: typeof schema.minimum === "number" && Number.isFinite(schema.minimum) });
  requireCondition({ valid: typeof schema.maximum === "number" && Number.isFinite(schema.maximum) });
  requireCondition({ valid: Number(schema.minimum) <= Number(schema.maximum) });
}

function checkEnum({ schema }: { schema: Record<string, unknown> }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: Array.isArray(schema.enum) });
  const values = schema.enum as unknown[];
  integer({ value: values.length, min: 1, max: 32 });
  const type = schema.type === "integer" ? "number" : schema.type;
  requireCondition({ valid: values.every(value => typeof value === type) });
}
