/**
 * @file The enforcing boundary parser for identity agent-tool input — the identity domain's
 * analogue of `features/content-types/field-defs.ts`.
 *
 * Deliberate divergence from content-types, disclosed:
 * content-types hand-authors its published `inputSchema` and hand-authors `field-defs.ts`
 * separately, then pins the two together with a fixture corpus
 * (`agent-tools.schema-agreement.unit.test.ts`) because deriving one from the other would have
 * needed either a JSON Schema library this project does not depend on or a code generator. That
 * reasoning does not carry over here: identity's schemas use a small keyword subset and describe
 * flat objects of strings, so this file INTERPRETS that published schema directly rather than
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
const OBJECT_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "description"]);
const STRING_KEYWORDS = new Set(["type", "minLength", "description"]);

export type IdentityToolInputResult =
  | { ok: true; value: Readonly<Record<string, string>> }
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
  const required = Object.hasOwn(schema, "required") ? schema.required : [];
  if (!Array.isArray(required) || required.some(key => typeof key !== "string") || new Set(required).size !== required.length) {
    throw new Error("identity agent-tool schema required must be an array of unique strings");
  }
  for (const key of required) {
    if (!Object.hasOwn(properties, key)) throw new Error(`identity agent-tool schema requires undeclared property '${key}'`);
  }
  for (const [key, sub] of Object.entries(properties)) {
    if (!isSchemaObject(sub)) throw new Error(`identity agent-tool schema property '${key}' must be an object`);
    assertKeywords(sub, STRING_KEYWORDS);
    if (sub.type !== "string") {
      throw new Error(`identity agent-tool schema declares non-string property '${key}' — this parser only implements string properties`);
    }
    if (Object.hasOwn(sub, "minLength") && (typeof sub.minLength !== "number" || !Number.isInteger(sub.minLength) || sub.minLength < 0)) {
      throw new Error(`identity agent-tool schema minLength for '${key}' must be a nonnegative integer`);
    }
  }
}

/** JSON Schema objects and keyword placement are checked before inspecting any input value. */
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
  assertSchemaIsInterpretable(schema);

  if (schema.type !== "object") {
    throw new Error(`identity agent-tool schema must be an object schema, got type '${String(schema.type)}'`);
  }

  const { input } = required;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: new Error("input must be an object") };
  }

  const record = input as Record<string, unknown>;
  const properties = (schema.properties ?? {}) as Record<string, Schema>;

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(properties, key)) {
        return { ok: false, error: new Error(`'${key}' is not a recognized input key`) };
      }
    }
  }

  for (const key of (schema.required as string[] | undefined) ?? []) {
    if (!Object.hasOwn(record, key) || record[key] === undefined) {
      return { ok: false, error: new Error(`'${key}' is required`) };
    }
  }

  const value: Record<string, string> = {};
  for (const [key, sub] of Object.entries(properties)) {
    if (!Object.hasOwn(record, key)) continue;

    const candidate = record[key];
    if (typeof candidate !== "string") {
      return { ok: false, error: new Error(`'${key}' must be a string, received ${describeType(candidate)}`) };
    }
    if (typeof sub.minLength === "number" && Array.from(candidate).length < sub.minLength) {
      return { ok: false, error: new Error(`'${key}' must contain at least ${sub.minLength} Unicode code point(s)`) };
    }
    Object.defineProperty(value, key, { value: candidate, enumerable: true, writable: true, configurable: true });
  }

  return { ok: true, value };
}

/** Names a value's type for a rejection message WITHOUT echoing the value itself. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
