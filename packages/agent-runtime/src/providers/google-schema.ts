import type { ProviderToolDescriptor } from './tool-turn-types.js';
function inputSchemaOf(descriptor: ProviderToolDescriptor): Record<string, unknown> {
  return descriptor.inputSchema && typeof descriptor.inputSchema === "object"
    ? (descriptor.inputSchema as Record<string, unknown>)
    : { type: "object", additionalProperties: false, required: [], properties: {} };
}

const GOOGLE_SUPPORTED_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "default",
  "items",
  "minItems",
  "maxItems",
  "enum",
  "properties",
  "propertyOrdering",
  "required",
  "minProperties",
  "maxProperties",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "example",
  "anyOf",
]);
const MAX_GOOGLE_REF_DEPTH = 4;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function inferGoogleTypeFromLiteral(value: unknown): string {
  if (typeof value === "boolean")
    return "boolean";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  return "string";
}
function collapseGoogleTypeArray(members: readonly unknown[]): {
  readonly type: string;
  readonly nullable: boolean;
} {
  const names = members.filter((member): member is string => typeof member === "string");
  const nullable = names.includes("null");
  const nonNull = names.filter((name) => name !== "null");
  return { type: nonNull[0] ?? "string", nullable };
}
function resolveGoogleRef(ref: string, defs: Readonly<Record<string, unknown>>): unknown {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix))
    return { type: "object" };
  return defs[ref.slice(prefix.length)] ?? { type: "object" };
}
function terminalGoogleRefStub(resolved: unknown): Record<string, unknown> {
  const type = isRecord(resolved) && typeof resolved.type === "string" ? resolved.type : "object";
  const originalDescription = isRecord(resolved) && typeof resolved.description === "string" ? `${resolved.description} ` : "";
  return { type, description: `${originalDescription}(further nesting simplified for Gemini compatibility)` };
}
function enforceGoogleSchemaShape(node: Record<string, unknown>): Record<string, unknown> {
  const usesAnyOf = Array.isArray(node.anyOf) && node.anyOf.length > 0;
  if (!usesAnyOf && typeof node.type !== "string")
    node.type = "object";
  if (node.type === "array" && !isRecord(node.items)) {
    node.items = { type: "string", description: "Contents simplified for Gemini compatibility." };
  }
  return node;
}
function isGoogleIgnoredSchemaKey(key: string): boolean {
  return key === "$defs" || key === "$ref" || key === "oneOf";
}
function isGoogleTypeArrayKey(key: string, value: unknown): boolean {
  return key === "type" && Array.isArray(value);
}
function isGoogleNullableEnumKey(key: string, value: unknown): boolean {
  return key === "enum" && Array.isArray(value) && value.includes(null);
}
function applyGoogleSchemaEnum(result: Record<string, unknown>, value: readonly unknown[]): void {
  result.enum = value.filter((member) => member !== null);
}
function isGooglePropertiesKey(key: string, value: unknown): boolean {
  return key === "properties" && isRecord(value);
}
function isGoogleSchemaPositionKey(key: string): boolean {
  return key === "items" || key === "anyOf";
}
function applyGoogleSchemaTypeArray(result: Record<string, unknown>, value: readonly unknown[]): GoogleSchemaEntryEffect {
  const collapsed = collapseGoogleTypeArray(value);
  result.type = collapsed.type;
  return collapsed.nullable ? { inferredNullable: true } : {};
}
function sanitizeGoogleSchemaValuePositionValue(value: unknown, defs: Readonly<Record<string, unknown>>, remainingRefDepth: number): unknown {
  return Array.isArray(value)
    ? value.map((member) => sanitizeGoogleSubschema(member, defs, remainingRefDepth))
    : sanitizeGoogleSubschema(value, defs, remainingRefDepth);
}
interface GoogleSchemaEntryEffect {
  readonly constValue?: unknown;
  readonly hasConst?: boolean;
  readonly inferredNullable?: boolean;
}
function applyGoogleSchemaEntry(result: Record<string, unknown>, key: string, value: unknown, localDefs: Readonly<Record<string, unknown>>, remainingRefDepth: number): GoogleSchemaEntryEffect {
  if (isGoogleIgnoredSchemaKey(key))
    return {};
  if (key === "const") {
    result.enum = [value];
    return { hasConst: true, constValue: value };
  }
  if (isGoogleTypeArrayKey(key, value))
    return applyGoogleSchemaTypeArray(result, value as readonly unknown[]);
  if (isGoogleNullableEnumKey(key, value)) {
    applyGoogleSchemaEnum(result, value as readonly unknown[]);
    return {};
  }
  if (!GOOGLE_SUPPORTED_SCHEMA_KEYS.has(key))
    return {};
  if (isGooglePropertiesKey(key, value)) {
    result.properties = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, propSchema]) => [name, sanitizeGoogleSubschema(propSchema, localDefs, remainingRefDepth)]));
    return {};
  }
  if (isGoogleSchemaPositionKey(key)) {
    result[key] = sanitizeGoogleSchemaValuePositionValue(value, localDefs, remainingRefDepth);
    return {};
  }
  result[key] = sanitizeGoogleSchemaValue(value, localDefs, remainingRefDepth);
  return {};
}
function mergeGoogleOneOf(schema: Record<string, unknown>, result: Record<string, unknown>, defs: Readonly<Record<string, unknown>>, remainingRefDepth: number): unknown[] | undefined {
  if (!Array.isArray(schema.oneOf))
    return undefined;
  const merged = [...(Array.isArray(result.anyOf) ? result.anyOf : []), ...schema.oneOf];
  return merged.map((member) => sanitizeGoogleSubschema(member, defs, remainingRefDepth));
}
interface GoogleSchemaBuildResult {
  readonly result: Record<string, unknown>;
  readonly hasConst: boolean;
  readonly constValue: unknown;
  readonly inferredNullable: boolean;
}
function buildGoogleSchemaResult(schema: Record<string, unknown>, localDefs: Readonly<Record<string, unknown>>, remainingRefDepth: number): GoogleSchemaBuildResult {
  const result: Record<string, unknown> = {};
  let constValue: unknown;
  let hasConst = false;
  let inferredNullable = false;
  for (const [key, value] of Object.entries(schema)) {
    const effect = applyGoogleSchemaEntry(result, key, value, localDefs, remainingRefDepth);
    if (effect.hasConst) {
      hasConst = true;
      constValue = effect.constValue;
    }
    if (effect.inferredNullable)
      inferredNullable = true;
  }
  const mergedOneOf = mergeGoogleOneOf(schema, result, localDefs, remainingRefDepth);
  if (mergedOneOf)
    result.anyOf = mergedOneOf;
  return { result, hasConst, constValue, inferredNullable };
}
function sanitizeGoogleSchemaValueRef(ref: string, localDefs: Readonly<Record<string, unknown>>, remainingRefDepth: number): unknown {
  const resolved = resolveGoogleRef(ref, localDefs);
  if (remainingRefDepth <= 0)
    return enforceGoogleSchemaShape(terminalGoogleRefStub(resolved));
  return sanitizeGoogleSchemaValue(resolved, localDefs, remainingRefDepth - 1);
}
function hasGoogleNumericEnumValues(schema: Record<string, unknown>): boolean {
  return Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((member) => typeof member === "number");
}
function applyGoogleNumericEnumStringification(schema: Record<string, unknown>, result: Record<string, unknown>): void {
  if (!hasGoogleNumericEnumValues(schema))
    return;
  result.enum = (schema.enum as unknown[]).map((member) => String(member));
  result.type = "string";
}
function applyGoogleConstTypeInference(result: Record<string, unknown>, hasConst: boolean, constValue: unknown): void {
  if (!hasConst || result.type !== undefined)
    return;
  result.type = inferGoogleTypeFromLiteral(constValue);
}
function sanitizeGoogleSchemaValue(schema: unknown, defs: Readonly<Record<string, unknown>> = {}, remainingRefDepth: number = MAX_GOOGLE_REF_DEPTH): unknown {
  if (Array.isArray(schema))
    return schema.map((entry) => sanitizeGoogleSchemaValue(entry, defs, remainingRefDepth));
  if (!isRecord(schema))
    return schema;
  const localDefs = isRecord(schema.$defs) ? { ...defs, ...schema.$defs } : defs;
  if (typeof schema.$ref === "string")
    return sanitizeGoogleSchemaValueRef(schema.$ref, localDefs, remainingRefDepth);
  const { result, hasConst, constValue, inferredNullable } = buildGoogleSchemaResult(schema, localDefs, remainingRefDepth);
  if (inferredNullable)
    result.nullable = true;
  applyGoogleConstTypeInference(result, hasConst, constValue);
  applyGoogleNumericEnumStringification(schema, result);
  return result;
}
function sanitizeGoogleSubschema(value: unknown, defs: Readonly<Record<string, unknown>>, depth: number): unknown {
  const sanitized = sanitizeGoogleSchemaValue(value, defs, depth);
  return isRecord(sanitized) ? enforceGoogleSchemaShape(sanitized) : sanitized;
}
function googleParametersOfValue(descriptor: ProviderToolDescriptor, maxRefDepth: number = MAX_GOOGLE_REF_DEPTH): Record<string, unknown> {
  return enforceGoogleSchemaShape(sanitizeGoogleSchemaValue(inputSchemaOf(descriptor), {}, maxRefDepth) as Record<string, unknown>);
}
function isGoogleNumericEnumSchema(schema: Record<string, unknown>): boolean {
  return (schema.type === "integer" || schema.type === "number") && hasGoogleNumericEnumValues(schema);
}
function findNumericEnumPathsValue(schema: unknown, prefix: readonly string[] = []): string[] {
  if (!isRecord(schema))
    return [];
  const paths: string[] = [];
  if (isGoogleNumericEnumSchema(schema))
    paths.push(prefix.join("."));
  if (isRecord(schema.properties)) {
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      paths.push(...findNumericEnumPathsValue(propSchema, [...prefix, name]));
    }
  }
  return paths;
}
function readAtGooglePath(input: Record<string, unknown>, segments: readonly string[]): unknown {
  let current: unknown = input;
  for (const segment of segments) {
    if (!isRecord(current))
      return undefined;
    current = current[segment];
  }
  return current;
}
function writeAtGooglePath(input: Record<string, unknown>, segments: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = segments;
  if (head === undefined)
    return input;
  if (rest.length === 0)
    return { ...input, [head]: value };
  const child = input[head];
  if (!isRecord(child))
    return input;
  return { ...input, [head]: writeAtGooglePath(child, rest, value) };
}
function coerceNumericEnumStringsToNumbersValue(input: unknown, paths: readonly string[]): unknown {
  if (paths.length === 0 || !isRecord(input))
    return input;
  let result: Record<string, unknown> = input;
  for (const path of paths) {
    const segments = path.split(".");
    const current = readAtGooglePath(result, segments);
    if (typeof current === "string" && current.trim().length > 0 && Number.isFinite(Number(current))) {
      result = writeAtGooglePath(result, segments, Number(current));
    }
  }
  return result;
}

/** Converts JSON Schema into Gemini's restricted schema dialect. Unsupported constraints are guidance only; hosts must still validate tool input. Reference expansion defaults to four hops. Time and space are proportional to the expanded schema tree; this bound limits reference hops, not ordinary object nesting. */
export function sanitizeGoogleSchema({ schema }: { schema: unknown }, { defs = {}, maxRefDepth = MAX_GOOGLE_REF_DEPTH }: { defs?: Readonly<Record<string, unknown>>; maxRefDepth?: number } = {}): unknown {
  return sanitizeGoogleSchemaValue(schema, defs, maxRefDepth);
}
/** Produces the schema actually placed on a Gemini function declaration, including required node types and array items. */
export function googleParametersOf({ descriptor }: { descriptor: ProviderToolDescriptor }, { maxRefDepth = MAX_GOOGLE_REF_DEPTH }: { maxRefDepth?: number } = {}): Record<string, unknown> {
  return googleParametersOfValue(descriptor, maxRefDepth);
}
/** Finds numeric enum fields through object properties. Array, union and reference traversal are outside this conversion's current scope. */
export function findNumericEnumPaths({ schema }: { schema: unknown }, { prefix = [] }: { prefix?: readonly string[] } = {}): string[] {
  return findNumericEnumPathsValue(schema, prefix);
}
/** Reverses Gemini's numeric enum stringification without mutating the incoming tool argument. Paths use dot-separated property names. */
export function coerceNumericEnumStringsToNumbers({ input, paths }: { input: unknown; paths: readonly string[] }): unknown {
  return coerceNumericEnumStringsToNumbersValue(input, paths);
}
