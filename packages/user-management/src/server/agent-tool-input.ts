/**
 * @file The enforcing boundary parser for identity agent-tool input — the identity domain's
 * analogue of `packages/cms/src/content-types/field-defs.ts`.
 *
 * Deliberate divergence from content-types, disclosed:
 * content-types hand-authors its published `inputSchema` and hand-authors `field-defs.ts`
 * separately, then pins the two together with a fixture corpus
 * (`packages/user-management/src/server/__tests__/agent-tools.schema-agreement.test.ts`) because deriving one from the other would have
 * needed either a JSON Schema library this project does not depend on or a code generator. That
 * reasoning does not carry over here: identity's schemas use a small keyword subset and describe
 * flat objects of strings (plus integer `expectedVersion` basis fields for the lost-update guard),
 * so this file INTERPRETS that published schema directly rather than
 * duplicating it. Sharing the artifact prevents metadata drift; the independent agreement tests
 * still verify interpreter semantics, including Unicode length and unsupported schema shapes.
 *
 * What remains genuinely testable, and is tested in
 * `__tests__/agent-tools.schema-agreement.test.ts`: that this interpreter actually implements
 * every keyword the catalog uses (an unknown keyword fails loudly rather than being ignored, which
 * is one way a schema could still promise something unenforced), and that the wired handlers
 * really route their input through here rather than reading `ctx.input` directly.
 *
 * Architectural role:
 * `identity` library, pure. No I/O, no enforcement of permissions — this is shape validation only.
 * Returns a `Result` rather than throwing so the caller decides how a rejection is surfaced.
 */

/** The keywords this interpreter implements. Anything else in a schema is a hard error, never ignored. */
const OBJECT_KEYWORDS: ReadonlySet<string> = new Set(["type", "properties", "required", "additionalProperties", "description"]);
const STRING_KEYWORDS: ReadonlySet<string> = new Set(["type", "minLength", "description"]);
const INTEGER_KEYWORDS: ReadonlySet<string> = new Set(["type", "minimum", "description"]);

/** Strings stay in `value` (its shape predates integers); integer properties come back in the
 *  additive `integers` map, so existing readers of `value` keep their `string` typing. */
export type IdentityToolInputResult =
  | { ok: true; value: Readonly<Record<string, string>>; integers: Readonly<Record<string, number>> }
  | { ok: false; error: Error };

type Schema = Record<string, unknown>;

/**
 * Asserts a schema uses only keywords {@link parseIdentityToolInput} implements.
 *
 * Separated from the parse loop and run over the WHOLE schema before any value is inspected, so an
 * unimplemented keyword is reported even for an input that happens not to exercise it. Without
 * that ordering a schema could publish, say, a `pattern` the parser silently ignores, and every
 * test using a conforming fixture would still pass.
 *
 * Check order (pinned in `__tests__/agent-tool-input.pins.test.ts`): object shape, top-level
 * keywords, `type`, `additionalProperties`, `properties`, `required`, then each property sub-schema.
 *
 * @param schema - A tool's published `inputSchema`.
 * @throws {Error} If the schema, or any property sub-schema, uses an unimplemented keyword.
 * @complexity O(k) in the total keyword count across the schema and its property sub-schemas.
 * @overallScore 100
 */
function assertSchemaIsInterpretable(schema: Schema): void {
  if (!isSchemaObject(schema)) throw new Error("identity agent-tool schema must be an object");
  assertKeywords(schema, OBJECT_KEYWORDS);
  if (schema.type !== "object") {
    throw new Error(`identity agent-tool schema must be an object schema, got type '${String(schema.type)}'`);
  }
  if (schema.additionalProperties !== false) {
    throw new Error("identity agent-tool schema must declare additionalProperties: false");
  }
  const properties = Object.hasOwn(schema, "properties") ? schema.properties : {};
  if (!isSchemaObject(properties)) throw new Error("identity agent-tool schema properties must be an object");
  assertRequiredIsDeclared(Object.hasOwn(schema, "required") ? schema.required : [], properties);
  for (const [key, sub] of Object.entries(properties)) assertPropertySchema(key, sub);
}

/** `required` must be unique strings, each naming an OWN declared property. */
function assertRequiredIsDeclared(required: unknown, properties: Schema): void {
  if (!isUniqueStringArray(required)) {
    throw new Error("identity agent-tool schema required must be an array of unique strings");
  }
  for (const key of required) {
    if (!Object.hasOwn(properties, key)) throw new Error(`identity agent-tool schema requires undeclared property '${key}'`);
  }
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(key => typeof key === "string") && new Set(value).size === value.length;
}

/** A property sub-schema is a string schema whose optional `minLength` is a nonnegative integer, or
 *  an integer schema whose optional `minimum` is an integer. */
function assertPropertySchema(key: string, sub: unknown): void {
  if (!isSchemaObject(sub)) throw new Error(`identity agent-tool schema property '${key}' must be an object`);
  if (sub.type === "integer") {
    assertKeywords(sub, INTEGER_KEYWORDS);
    if (Object.hasOwn(sub, "minimum") && !(typeof sub.minimum === "number" && Number.isInteger(sub.minimum))) {
      throw new Error(`identity agent-tool schema minimum for '${key}' must be an integer`);
    }
    return;
  }
  assertKeywords(sub, STRING_KEYWORDS);
  if (sub.type !== "string") {
    throw new Error(`identity agent-tool schema declares property '${key}' of unsupported type '${String(sub.type)}' — this parser implements string and integer properties`);
  }
  if (Object.hasOwn(sub, "minLength") && !isNonNegativeInteger(sub.minLength)) {
    throw new Error(`identity agent-tool schema minLength for '${key}' must be a nonnegative integer`);
  }
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * JSON Schema objects and keyword placement are checked before inspecting any input value. The
 * same "non-null, non-array object" test also decides whether an input is an object at all.
 */
function isSchemaObject(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An unsupported or misplaced keyword is a developer error, never a silent no-op. */
function assertKeywords(schema: Schema, supported: ReadonlySet<string>): void {
  for (const keyword of Object.keys(schema)) {
    if (!supported.has(keyword)) {
      throw new Error(`identity agent-tool schema uses unimplemented keyword '${keyword}' — extend agent-tool-input.ts rather than publishing a contract it cannot enforce`);
    }
  }
  if (Object.hasOwn(schema, "description") && typeof schema.description !== "string") {
    throw new Error("identity agent-tool schema description must be a string");
  }
}

/**
 * Validates `input` against a tool's own published `inputSchema` and returns the extracted string
 * values.
 *
 * Every identity tool's input is a closed, flat object whose properties are all strings, so the
 * return type is narrowed to `Record<string, string>` — a caller reads `value.principalId` without
 * re-checking the type, which is what keeps the handlers in `tool-registrations.ts` free of ad hoc
 * `typeof` guards that could disagree with the schema.
 *
 * Rejection messages name the offending KEY and the rule it broke, and never echo the offending
 * VALUE: a tool input carries operator content (a username, an email) and these messages travel
 * back to the model and into the tool-attempt audit trail.
 *
 * @param required.schema - The tool's published `inputSchema`, used as the contract itself.
 * @param required.input - The raw `ctx.input`, of any shape.
 * @returns `{ok:true, value}` with each declared property present in `input` extracted, or
 * `{ok:false, error}` naming the first violation found.
 * @throws {Error} Only if the schema itself is uninterpretable — a developer error, distinct from
 * a bad input, and therefore not folded into the `Result`.
 * @complexity O(p + k + s) in declared properties, own input keys, and string code points.
 * @overallScore 100
 */
export function parseIdentityToolInput(required: {
  schema: Readonly<Record<string, unknown>>;
  input: unknown;
}): IdentityToolInputResult {
  const schema = required.schema as Schema;
  // Also guarantees `type === "object"` and `additionalProperties === false`, read through the
  // same property access used below, so neither needs re-checking here.
  assertSchemaIsInterpretable(schema);

  const { input } = required;
  if (!isSchemaObject(input)) return rejected("input must be an object");

  // Read through ordinary property access, exactly as before validation was split out — see the
  // "inherited schema members (reported, not fixed)" pins for what that means for a prototype.
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const violation = findUnrecognizedKey(input, properties)
    ?? findMissingRequiredKey(input, (schema.required as string[] | undefined) ?? []);
  if (violation !== undefined) return rejected(violation);

  return extractValues(input, properties);
}

function rejected(message: string): IdentityToolInputResult {
  return { ok: false, error: new Error(message) };
}

/** Own input keys only; a key inherited through the input's prototype is neither rejected nor read. */
function findUnrecognizedKey(record: Schema, properties: Schema): string | undefined {
  const key = Object.keys(record).find(candidate => !Object.hasOwn(properties, candidate));
  return key === undefined ? undefined : `'${key}' is not a recognized input key`;
}

/** A required key present with the value `undefined` counts as missing. */
function findMissingRequiredKey(record: Schema, requiredKeys: readonly string[]): string | undefined {
  const key = requiredKeys.find(candidate => !Object.hasOwn(record, candidate) || record[candidate] === undefined);
  return key === undefined ? undefined : `'${key}' is required`;
}

/** Extracts every present declared key, in declaration order, rejecting the first non-conforming value. */
function extractValues(record: Schema, properties: Record<string, Schema>): IdentityToolInputResult {
  const value: Record<string, string> = {};
  const integers: Record<string, number> = {};
  for (const [key, sub] of Object.entries(properties)) {
    if (!Object.hasOwn(record, key)) continue;

    const candidate = record[key];
    if (sub.type === "integer") {
      const integerViolation = findIntegerViolation(key, sub, candidate);
      if (integerViolation !== undefined) return rejected(integerViolation);
      Object.defineProperty(integers, key, { value: candidate, enumerable: true, writable: true, configurable: true });
      continue;
    }
    const stringViolation = findStringViolation(key, sub, candidate);
    if (stringViolation !== undefined) return rejected(stringViolation);
    // defineProperty keeps a `__proto__` key as plain own data rather than invoking the setter.
    Object.defineProperty(value, key, { value: candidate, enumerable: true, writable: true, configurable: true });
  }

  return { ok: true, value, integers };
}

/** Rejection message for a non-integer value or one below `minimum`; undefined when it conforms. */
function findIntegerViolation(key: string, sub: Schema, candidate: unknown): string | undefined {
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) return `'${key}' must be an integer, received ${describeType(candidate)}`;
  if (typeof sub.minimum === "number" && candidate < sub.minimum) return `'${key}' must be at least ${sub.minimum}`;
  return undefined;
}

/** Rejection message for a non-string value or one shorter than `minLength`; undefined when it conforms. */
function findStringViolation(key: string, sub: Schema, candidate: unknown): string | undefined {
  if (typeof candidate !== "string") return `'${key}' must be a string, received ${describeType(candidate)}`;
  if (typeof sub.minLength === "number" && Array.from(candidate).length < sub.minLength) {
    return `'${key}' must contain at least ${sub.minLength} Unicode code point(s)`;
  }
  return undefined;
}

/** Names a value's type for a rejection message WITHOUT echoing the value itself. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
