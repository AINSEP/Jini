import assert from "node:assert/strict";
import { test } from "vitest";

import { parseIdentityToolInput } from "../agent-tool-input.js";
import { identityAgentToolCatalog } from "../agent-tools.js";

/**
 * @file The agreement pin between what `identity/agent-tools.ts` PUBLISHES to the model and what
 * `identity/agent-tool-input.ts` ENFORCES.
 *
 * `features/content-types` has the same pin for a different reason: there the schema and the
 * parser are two hand-authored artifacts that can genuinely disagree. Identity's parser interprets
 * the published schema directly, so a value-level disagreement is impossible by construction — and
 * a test that only re-proved that would be vacuous.
 *
 * What is NOT impossible by construction, and is what this file actually checks:
 *
 * 1. **A published keyword the parser does not implement.** This is the one way the schema could
 *    still promise something unenforced — publish `pattern` or `maxLength`, have the parser skip
 *    it, and the model is shown a narrower contract than the one applied. The independent
 *    validator below shares no code with the parser and fails loudly on an unknown keyword, so a
 *    schema that grows one fails here rather than silently widening the contract.
 * 2. **Verdict agreement over a derived corpus.** Fixtures are generated FROM each schema (drop
 *    each required key, wrong-type each declared key, blank each `minLength` key, add an unknown
 *    key), so a newly added tool is covered the moment it enters the catalog rather than when
 *    someone remembers to write fixtures for it.
 * 3. **Catalog-shape invariants** every wired tool depends on — closed schemas, required keys that
 *    actually exist as properties, and string-only properties (the parser's stated limit).
 */

type Schema = Record<string, unknown>;

/** Exactly the keywords the catalog is allowed to use — kept independent of the parser's own copy. */
const SUPPORTED_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "minLength", "description"]);

/**
 * A minimal JSON Schema check written independently of `agent-tool-input.ts`, so agreement between
 * the two is evidence rather than a tautology. Returns true when `value` conforms.
 */
function validate(schema: Schema, value: unknown): boolean {
  assert.equal(schema.type, "object", "every identity tool input schema must be an object schema");

  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  const properties = (schema.properties ?? {}) as Record<string, Schema>;

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in properties)) return false;
    }
  }

  for (const key of (schema.required as string[] | undefined) ?? []) {
    if (!(key in record) || record[key] === undefined) return false;
  }

  for (const [key, sub] of Object.entries(properties)) {
    if (!(key in record) || record[key] === undefined) continue;
    if (typeof record[key] !== "string") return false;
    if (typeof sub.minLength === "number" && (record[key] as string).trim().length < sub.minLength) return false;
  }

  return true;
}

function schemaOf(toolId: string): Schema {
  const entry = identityAgentToolCatalog.find((tool) => tool.name === toolId);
  assert.ok(entry, `catalog has no entry for '${toolId}'`);
  return entry.inputSchema as Schema;
}

function propertiesOf(schema: Schema): Record<string, Schema> {
  return (schema.properties ?? {}) as Record<string, Schema>;
}

function requiredOf(schema: Schema): string[] {
  return (schema.required as string[] | undefined) ?? [];
}

/** A payload satisfying every declared property of `schema` — the base every fixture perturbs. */
function fullyPopulated(schema: Schema): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(propertiesOf(schema))) payload[key] = `value-for-${key}`;
  return payload;
}

/** A payload with only the required properties present. */
function requiredOnly(schema: Schema): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of requiredOf(schema)) payload[key] = `value-for-${key}`;
  return payload;
}

/**
 * Fixtures derived from a schema, each with the verdict BOTH artifacts must reach.
 *
 * Derived rather than hand-listed so a tool added to the catalog is covered automatically — the
 * failure mode a hand-written corpus has is that a new tool silently gets zero fixtures.
 */
function corpusFor(schema: Schema): Array<{ label: string; payload: unknown; accepted: boolean }> {
  const properties = propertiesOf(schema);
  const required = requiredOf(schema);

  const fixtures: Array<{ label: string; payload: unknown; accepted: boolean }> = [
    { label: "every declared property present", payload: fullyPopulated(schema), accepted: true },
    { label: "only the required properties", payload: requiredOnly(schema), accepted: true },

    { label: "not an object — an array", payload: [], accepted: false },
    { label: "not an object — a string", payload: "principal-1", accepted: false },
    { label: "not an object — null", payload: null, accepted: false },
    { label: "not an object — a number", payload: 7, accepted: false },
    { label: "an unrecognized key", payload: { ...fullyPopulated(schema), notARealKey: "x" }, accepted: false },
  ];

  for (const key of required) {
    const withoutKey = fullyPopulated(schema);
    delete withoutKey[key];
    fixtures.push({ label: `missing required '${key}'`, payload: withoutKey, accepted: false });
    fixtures.push({ label: `explicitly-undefined required '${key}'`, payload: { ...fullyPopulated(schema), [key]: undefined }, accepted: false });
  }

  for (const key of Object.keys(properties)) {
    fixtures.push({ label: `numeric '${key}'`, payload: { ...fullyPopulated(schema), [key]: 7 }, accepted: false });
    fixtures.push({ label: `null '${key}'`, payload: { ...fullyPopulated(schema), [key]: null }, accepted: false });
    fixtures.push({ label: `array '${key}'`, payload: { ...fullyPopulated(schema), [key]: ["x"] }, accepted: false });

    const isBlankRejecting = typeof properties[key]!.minLength === "number";
    fixtures.push({ label: `blank '${key}'`, payload: { ...fullyPopulated(schema), [key]: "" }, accepted: !isBlankRejecting });
    fixtures.push({ label: `whitespace-only '${key}'`, payload: { ...fullyPopulated(schema), [key]: "   " }, accepted: !isBlankRejecting });
  }

  return fixtures;
}

// ---------------------------------------------------------------------------
// 1. Agreement
// ---------------------------------------------------------------------------

for (const entry of identityAgentToolCatalog) {
  test(`${entry.name}: the published schema and the enforcing parser reach the same verdict on every derived fixture`, () => {
    const schema = schemaOf(entry.name);

    for (const { label, payload, accepted } of corpusFor(schema)) {
      const schemaSaysValid = validate(schema, payload);
      const parserSaysValid = parseIdentityToolInput({ schema, input: payload }).ok;

      assert.equal(schemaSaysValid, accepted, `the published schema disagrees with the expected verdict for "${label}"`);
      assert.equal(parserSaysValid, accepted, `the parser disagrees with the expected verdict for "${label}"`);
      assert.equal(
        schemaSaysValid,
        parserSaysValid,
        `DRIFT on "${label}": the model would be shown one contract for ${entry.name} and a different one enforced`,
      );
    }
  });
}

test("the derived corpus covers both verdicts, so an all-accepting or all-rejecting parser bug cannot pass this file", () => {
  for (const entry of identityAgentToolCatalog) {
    const corpus = corpusFor(schemaOf(entry.name));
    assert.ok(
      corpus.some((fixture) => fixture.accepted) && corpus.some((fixture) => !fixture.accepted),
      `${entry.name}'s corpus is single-verdict, which would make the agreement assertion vacuous`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. The keyword guard — the one way a schema could still promise the unenforced
// ---------------------------------------------------------------------------

test("every keyword any published schema uses is one both artifacts implement", () => {
  for (const entry of identityAgentToolCatalog) {
    const schema = schemaOf(entry.name);
    for (const keyword of Object.keys(schema)) {
      assert.ok(SUPPORTED_KEYWORDS.has(keyword), `${entry.name} publishes unsupported keyword '${keyword}' at the top level`);
    }
    for (const [property, sub] of Object.entries(propertiesOf(schema))) {
      for (const keyword of Object.keys(sub)) {
        assert.ok(SUPPORTED_KEYWORDS.has(keyword), `${entry.name}.${property} publishes unsupported keyword '${keyword}'`);
      }
    }
  }
});

test("a schema that grows an unimplemented keyword is refused loudly, not silently ignored", () => {
  assert.throws(
    () => parseIdentityToolInput({ schema: { type: "object", additionalProperties: false, required: [], properties: {}, pattern: "^x$" }, input: {} }),
    /unimplemented keyword 'pattern'/,
    "an unenforceable published keyword must fail the call rather than shrink to a no-op",
  );

  assert.throws(
    () =>
      parseIdentityToolInput({
        schema: { type: "object", additionalProperties: false, required: [], properties: { name: { type: "string", maxLength: 3 } } },
        input: { name: "abcd" },
      }),
    /unimplemented keyword 'maxLength'/,
    "the guard must reach into property sub-schemas, not only the top level",
  );
});

test("a non-string property is refused — the parser states that limit rather than quietly passing the value through", () => {
  assert.throws(
    () =>
      parseIdentityToolInput({
        schema: { type: "object", additionalProperties: false, required: [], properties: { count: { type: "integer" } } },
        input: { count: 3 },
      }),
    /only implements string properties/,
  );
});

// ---------------------------------------------------------------------------
// 3. Catalog-shape invariants the wiring layer depends on
// ---------------------------------------------------------------------------

test("every catalog entry publishes a CLOSED schema, so a misspelled key is reported rather than ignored", () => {
  for (const entry of identityAgentToolCatalog) {
    assert.equal(schemaOf(entry.name).additionalProperties, false, `${entry.name}'s schema must be closed`);
  }
});

test("every required key is actually a declared property — a required key with no property would be unvalidatable", () => {
  for (const entry of identityAgentToolCatalog) {
    const schema = schemaOf(entry.name);
    const properties = propertiesOf(schema);
    for (const key of requiredOf(schema)) {
      assert.ok(key in properties, `${entry.name} requires '${key}' but declares no property for it`);
    }
  }
});

test("every declared property is a string — the shape the parser and every handler assume", () => {
  for (const entry of identityAgentToolCatalog) {
    for (const [property, sub] of Object.entries(propertiesOf(schemaOf(entry.name)))) {
      assert.equal(sub.type, "string", `${entry.name}.${property} must be a string property`);
    }
  }
});

test("every required property carries minLength — a required key that accepted '' would reach the service layer blank", () => {
  for (const entry of identityAgentToolCatalog) {
    const schema = schemaOf(entry.name);
    const properties = propertiesOf(schema);
    for (const key of requiredOf(schema)) {
      assert.equal(properties[key]!.minLength, 1, `${entry.name}.${key} is required, so it must publish minLength:1`);
    }
  }
});

test("the two read tools take no input at all, so a model cannot be confused about what to pass them", () => {
  for (const toolId of ["identity_user_list", "identity_role_list"]) {
    const schema = schemaOf(toolId);
    assert.deepEqual(requiredOf(schema), []);
    assert.deepEqual(Object.keys(propertiesOf(schema)), []);
    assert.equal(parseIdentityToolInput({ schema, input: {} }).ok, true);
    assert.equal(parseIdentityToolInput({ schema, input: { anything: "x" } }).ok, false, "a closed empty schema must still reject stray keys");
  }
});

test("identity_user_create requires username and password but not email — email is the one genuinely optional identity input", () => {
  const schema = schemaOf("identity_user_create");
  assert.deepEqual(requiredOf(schema).sort(), ["password", "username"]);
  assert.ok("email" in propertiesOf(schema));
  assert.equal(parseIdentityToolInput({ schema, input: { username: "ed", password: "pw-valid-1234" } }).ok, true);
});

test("identity_user_update_email accepts a blank email — that is how the tool clears the stored value", () => {
  const schema = schemaOf("identity_user_update_email");
  const parsed = parseIdentityToolInput({ schema, input: { principalId: "p-1", email: "" } });

  assert.equal(parsed.ok, true, "a blank email must survive the boundary so updateUser can clear the field");
  assert.equal(parsed.ok && parsed.value.email, "");
});

// ---------------------------------------------------------------------------
// 4. Rejection messages
// ---------------------------------------------------------------------------

test("a rejection names the offending key and the broken rule, and never echoes the value — tool input carries operator content", () => {
  const schema = schemaOf("identity_user_create");
  const secret = "s3cret-operator-content";

  const parsed = parseIdentityToolInput({ schema, input: { username: secret, password: 7 } });
  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok && /'password' must be a string, received a number/.test(parsed.error.message));
  assert.equal(!parsed.ok && parsed.error.message.includes(secret), false, "the message leaked an input value");
});

test("the FIRST violation is reported, so a model gets one actionable failure rather than a list to disentangle", () => {
  const schema = schemaOf("identity_role_assign");
  const parsed = parseIdentityToolInput({ schema, input: { stray: "x", alsoStray: "y" } });

  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok && /is not a recognized input key/.test(parsed.error.message));
});
