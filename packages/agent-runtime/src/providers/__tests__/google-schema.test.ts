import assert from "node:assert/strict";
import { test } from "vitest";
import { sanitizeGoogleSchema, coerceNumericEnumStringsToNumbers } from "../google-schema.js";
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
test("sanitizeGoogleSchema strips additionalProperties/$schema/$ref/$defs at the top level", () => {
    const input = {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" } },
        required: ["name"],
    };
    assert.deepEqual(sanitizeGoogleSchema({ schema: input }), {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
    });
});
test("sanitizeGoogleSchema strips the same keys when nested in properties/items/anyOf, and preserves everything else", () => {
    const input = {
        type: "object",
        additionalProperties: false,
        properties: {
            tags: {
                type: "array",
                items: { type: "object", additionalProperties: false, properties: { id: { type: "string" } } },
            },
            target: {
                anyOf: [
                    { type: "object", $ref: "#/$defs/widget", additionalProperties: false },
                    { type: "null" },
                ],
            },
            note: { type: "string", description: "kept", enum: ["a", "b"], format: "date-time", default: "a" },
        },
        $defs: { widget: { type: "object" } },
        required: ["tags"],
    };
    assert.deepEqual(sanitizeGoogleSchema({ schema: input }), {
        type: "object",
        properties: {
            tags: {
                type: "array",
                items: { type: "object", properties: { id: { type: "string" } } },
            },
            target: {
                anyOf: [{ type: "object" }, { type: "null" }],
            },
            note: { type: "string", description: "kept", enum: ["a", "b"], format: "date-time", default: "a" },
        },
        required: ["tags"],
    });
});
test("sanitizeGoogleSchema leaves non-schema values (primitives, empty object) untouched", () => {
    assert.equal(sanitizeGoogleSchema({ schema: "x" }), "x");
    assert.equal(sanitizeGoogleSchema({ schema: 5 }), 5);
    assert.equal(sanitizeGoogleSchema({ schema: null }), null);
    assert.deepEqual(sanitizeGoogleSchema({ schema: {} }), {});
});
test("sanitizeGoogleSchema converts const to enum, top-level and nested", () => {
    const input = {
        type: "object",
        properties: {
            kind: { const: "entryRef" },
            target: { type: "object", properties: { discriminator: { const: "x" } } },
        },
    };
    assert.deepEqual(sanitizeGoogleSchema({ schema: input }), {
        type: "object",
        properties: {
            kind: { type: "string", enum: ["entryRef"] },
            target: { type: "object", properties: { discriminator: { type: "string", enum: ["x"] } } },
        },
    });
});
test("sanitizeGoogleSchema converts a const nested exactly 2 properties-levels deep, matching the owner's real error path (declaration[102].parameters.properties[4].value.properties[0].value)", () => {
    const input = {
        type: "object",
        properties: {
            a: { type: "string" },
            b: { type: "string" },
            c: { type: "string" },
            d: { type: "string" },
            target: { type: "object", properties: { kind: { const: "entryRef" }, entryId: { type: "string" } } },
        },
    };
    const sanitized = sanitizeGoogleSchema({ schema: input }) as {
        properties: {
            target: {
                properties: {
                    kind: unknown;
                };
            };
        };
    };
    assert.deepEqual(sanitized.properties.target.properties.kind, { type: "string", enum: ["entryRef"] });
});
test("sanitizeGoogleSchema collapses a type array (JSON-Schema nullable idiom) to a single type plus nullable, top-level and nested", () => {
    assert.deepEqual(sanitizeGoogleSchema({ schema: { type: ["string", "null"] } }), { type: "string", nullable: true });
    assert.deepEqual(sanitizeGoogleSchema({ schema: { type: ["null", "integer"] } }), { type: "integer", nullable: true });
    assert.deepEqual(sanitizeGoogleSchema({ schema: { type: ["string"] } }), { type: "string" });
    const nested = {
        type: "object",
        properties: {
            ledgerEventId: { type: ["string", "null"], description: "nullable id" },
        },
    };
    assert.deepEqual(sanitizeGoogleSchema({ schema: nested }), {
        type: "object",
        properties: { ledgerEventId: { type: "string", nullable: true, description: "nullable id" } },
    });
});
test("sanitizeGoogleSchema stringifies a numeric enum and forces type to string, top-level and nested", () => {
    const input = { type: "integer", enum: [301, 302, 307, 308], description: "status" };
    assert.deepEqual(sanitizeGoogleSchema({ schema: input }), { type: "string", enum: ["301", "302", "307", "308"], description: "status" });
    const nested = { type: "object", properties: { statusCode: { type: "integer", enum: [301, 302] } } };
    assert.deepEqual(sanitizeGoogleSchema({ schema: nested }), { type: "object", properties: { statusCode: { type: "string", enum: ["301", "302"] } } });
    const stringEnum = { type: "string", enum: ["active", "disabled"] };
    assert.deepEqual(sanitizeGoogleSchema({ schema: stringEnum }), stringEnum);
});
test("sanitizeGoogleSchema converts oneOf to anyOf, merging with a sibling anyOf if present, and preserving arbitrary property names inside each branch", () => {
    const oneOfOnly = { oneOf: [{ type: "string" }, { type: "number" }] };
    assert.deepEqual(sanitizeGoogleSchema({ schema: oneOfOnly }), { anyOf: [{ type: "string" }, { type: "number" }] });
    const oneOfWithSiblingAnyOf = { anyOf: [{ type: "boolean" }], oneOf: [{ type: "string" }] };
    assert.deepEqual(sanitizeGoogleSchema({ schema: oneOfWithSiblingAnyOf }), { anyOf: [{ type: "boolean" }, { type: "string" }] });
    const taggedUnion = {
        oneOf: [
            { type: "object", additionalProperties: false, required: ["kind", "entryId"], properties: { kind: { const: "entryRef" }, entryId: { type: "string" } } },
            { type: "object", additionalProperties: false, required: ["kind", "href"], properties: { kind: { const: "url" }, href: { type: "string" } } },
        ],
    };
    assert.deepEqual(sanitizeGoogleSchema({ schema: taggedUnion }), {
        anyOf: [
            { type: "object", required: ["kind", "entryId"], properties: { kind: { type: "string", enum: ["entryRef"] }, entryId: { type: "string" } } },
            { type: "object", required: ["kind", "href"], properties: { kind: { type: "string", enum: ["url"] }, href: { type: "string" } } },
        ],
    });
});
test("sanitizeGoogleSchema inlines a non-recursive $ref/$defs pointer by value", () => {
    const input = {
        type: "object",
        properties: { name: { $ref: "#/$defs/nonEmptyString" } },
        $defs: { nonEmptyString: { type: "string", minLength: 1 } },
    };
    assert.deepEqual(sanitizeGoogleSchema({ schema: input }), {
        type: "object",
        properties: { name: { type: "string", minLength: 1 } },
    });
});
test("sanitizeGoogleSchema inlines a genuinely recursive $ref/$defs schema up to MAX_GOOGLE_REF_DEPTH, then substitutes a valid non-recursive stub instead of looping forever", () => {
    const input = {
        type: "object",
        $defs: {
            node: {
                type: "object",
                properties: { id: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/node" } } },
            },
        },
        properties: { root: { $ref: "#/$defs/node" } },
    };
    const output = sanitizeGoogleSchema({ schema: input }) as Record<string, unknown>;
    const serialized = JSON.stringify(output);
    assert.ok(serialized.length < 20000, `expected a bounded output size, got ${serialized.length} chars`);
    assert.ok(!serialized.includes("$ref"));
    assert.ok(!serialized.includes("$defs"));
    const root = (output.properties as Record<string, unknown>).root as Record<string, unknown>;
    assert.equal(root.type, "object");
    assert.ok(isPlainObject((root.properties as Record<string, unknown>).children));
});
test("coerceNumericEnumStringsToNumbers converts a numeric-looking string at a found path back to a number, and leaves everything else alone", () => {
    const paths = ["statusCode"];
    assert.deepEqual(coerceNumericEnumStringsToNumbers({ input: { statusCode: "301", fromPattern: "/old" }, paths: paths }), { statusCode: 301, fromPattern: "/old" });
    assert.deepEqual(coerceNumericEnumStringsToNumbers({ input: { statusCode: 301 }, paths: paths }), { statusCode: 301 });
    assert.deepEqual(coerceNumericEnumStringsToNumbers({ input: { statusCode: "not-a-number" }, paths: paths }), { statusCode: "not-a-number" });
    const input = { anything: "x" };
    assert.equal(coerceNumericEnumStringsToNumbers({ input: input, paths: [] }), input);
    assert.deepEqual(coerceNumericEnumStringsToNumbers({ input: { target: { statusCode: "302" } }, paths: ["target.statusCode"] }), { target: { statusCode: 302 } });
});

test('the wire schema repairs truncated recursive arrays and honors the per-call reference bound', async () => {
  const { googleParametersOf } = await import('../google-schema.js');
  const descriptor = { id: 'tree', inputSchema: { type: 'object', $defs: { children: { type: 'array', items: { $ref: '#/$defs/children' } } }, properties: { children: { $ref: '#/$defs/children' } } } };
  const original = structuredClone(descriptor);
  const output = googleParametersOf({ descriptor }, { maxRefDepth: 0 });
  const children = (output.properties as Record<string, Record<string, unknown>>).children!;
  assert.equal(children.type, 'array');
  assert.deepEqual(children.items, { type: 'string', description: 'Contents simplified for Gemini compatibility.' });
  assert.deepEqual(descriptor, original);
});
