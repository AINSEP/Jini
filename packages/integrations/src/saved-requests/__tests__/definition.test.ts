import { describe, expect, test } from "vitest";
import { parseSavedRequestDefinition, SavedRequestError } from "../index.js";
import { definition } from "./fixtures.js";

function parse(value: unknown) { return parseSavedRequestDefinition({ value }); }

describe("saved-request definition boundary", () => {
  test("accepts a detached fixed GET and bounded query schema", () => {
    const value = definition();
    expect(parse(value)).toEqual(value);
    expect(parse(value)).not.toBe(value);
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"] as const)("accepts %s JSON body fields and pinned constants", method => {
    const value = definition({ method, queryBindings: {}, bodyBindings: { search: "query" }, staticBody: { catalog: "public" } });
    expect(parse(value)).toEqual(value);
  });

  test.each([
    null, [], "request", {}, { ...definition(), version: 2 }, { ...definition(), method: "HEAD" },
    { ...definition(), headers: { Host: "evil.example" } }, { ...definition(), code: "fetch(input.url)" },
    { ...definition(), pathBindings: { id: "query" } }, { ...definition(), credentialIdBinding: "query" },
  ])("refuses malformed or executable/extended definitions %#", value => {
    expect(() => parse(value)).toThrow(SavedRequestError);
  });

  test.each([
    "http://api.example/catalog", "file:///etc/passwd", "https://user:pass@api.example/catalog",
    "https://evil.example/catalog", "https://api.example.evil.test/catalog", "/relative", "", "broken",
    "https://api.example/{query}", "https://{query}/catalog", "https://api.example/%7Bquery%7D",
    "https://api.example/${query}", "https://api.example/`query`", "https://api.example/\\evil",
    "https://api.example/catalog#fragment", "https://api.example/%0d%0aHost:evil", "https://api.example/%XX",
    "https://api.example/catalog?token=embedded", "https://api.example/catalog?api_key=embedded",
    "https://site.example:8443/api", "https://api.example:8443/catalog",
  ])("refuses unsafe fixed target %s", url => {
    expect(() => parse(definition({ url }))).toThrow(SavedRequestError);
  });

  test("refuses a non-default HTTPS target port even with a matching credential origin", () => {
    expect(() => parse(definition({ url: "https://api.example:8443/catalog", credential: { id: "credential-1", revision: "rev-1", origin: "https://api.example:8443" } }))).toThrow(SavedRequestError);
    expect(parse(definition({ url: "https://api.example:443/catalog" })).url).toBe("https://api.example:443/catalog");
  });

  test.each([
    { id: "", revision: "rev-1", origin: "https://api.example" },
    { id: "display label", revision: "rev-1", origin: "https://api.example" },
    { id: "x", revision: "", origin: "https://api.example" },
    { id: "x", revision: "r", origin: "https://api.example/" },
    { id: "x", revision: "r", origin: "https://api.example/path" },
    { id: "x", revision: "r", origin: "https://api.example:8443" },
    { id: "x", revision: "r", origin: "https://api.example", token: "secret" },
  ])("refuses invalid or secret-bearing credential references %#", credential => {
    expect(() => parse({ ...definition(), credential })).toThrow(SavedRequestError);
  });

  test.each([
    { queryBindings: { public: "query" } }, { queryBindings: { q: "undeclared" } },
    { queryBindings: { q: "query.name" } }, { queryBindings: { q: { expression: "query" } } },
    { queryBindings: { "bad\r\nHost": "query" } }, { queryBindings: { Authorization: "query" } },
    { queryBindings: { access_token: "query" } }, { queryBindings: { credentialId: "query" } },
    { queryBindings: { constructor: "query" } }, { queryBindings: { prototype: "query" } },
    { bodyBindings: { field: "query" } }, { staticBody: { catalog: "public" } },
    { method: "POST", staticBody: { key: "fixed" }, bodyBindings: { key: "query" } },
    { method: "POST", bodyBindings: { password: "query" } },
    { method: "POST", staticBody: { cookie: "secret" } },
    { queryBindings: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`key${i}`, "query"])) },
  ])("refuses binding escape, authentication, pinned-filter override or GET body %#", patch => {
    expect(() => parse({ ...definition(), ...patch })).toThrow(SavedRequestError);
  });

  test("rejects object/array query sources but accepts them in JSON bodies", () => {
    const inputSchema = { type: "object", properties: { values: { type: "array", maxItems: 2, minItems: 0, items: { type: "boolean" } } }, additionalProperties: false };
    expect(() => parse(definition({ inputSchema, queryBindings: { q: "values" } }))).toThrow(SavedRequestError);
    expect(parse(definition({ method: "POST", inputSchema, queryBindings: {}, bodyBindings: { values: "values" } })).method).toBe("POST");
  });

  test("definition byte bound counts Unicode and refuses cyclic/non-JSON values", () => {
    expect(() => parse(definition({ staticBody: { text: "💥".repeat(5000) } }))).toThrow(SavedRequestError);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [cycle, undefined, 1n]) expect(() => parse(value)).toThrow(SavedRequestError);
  });
});

describe("bounded supported schema subset", () => {
  const primitiveSchemas = [
    { type: "boolean", enum: [true, false] },
    { type: "string", maxLength: 10, minLength: 0, enum: ["a", "b"] },
    { type: "number", minimum: -1, maximum: 10, enum: [1, 2] },
    { type: "integer", minimum: 0, maximum: 10 },
    { type: "array", minItems: 0, maxItems: 2, items: { type: "string", maxLength: 5 } },
    { type: "object", properties: { child: { type: "boolean" } }, required: [], additionalProperties: false },
  ];
  test.each(primitiveSchemas)("accepts bounded child %#", child => {
    const inputSchema = { type: "object", properties: { query: child }, additionalProperties: false };
    expect(parse(definition({ inputSchema, queryBindings: {} })).inputSchema).toEqual(inputSchema);
  });

  test.each([
    { type: "string" }, { type: "string", maxLength: -1 }, { type: "string", maxLength: 4097 },
    { type: "string", maxLength: 10, minLength: 11 }, { type: "string", maxLength: 3.5 },
    { type: "string", maxLength: 10, pattern: ".*" }, { type: "string", maxLength: 10, format: "uri" },
    { $ref: "https://evil.example/schema" }, { type: "null" }, { type: "toString" },
    { type: ["string", "number"] }, { type: "boolean", anyOf: [] }, { type: "boolean", default: true },
    { type: "boolean", enum: [] }, { type: "boolean", enum: ["true"] }, { type: "boolean", enum: "true" },
    { type: "boolean", enum: Array(33).fill(true) },
    { type: "number", minimum: 0 }, { type: "number", maximum: 1 },
    { type: "number", minimum: "0", maximum: 1 }, { type: "number", minimum: 2, maximum: 1 },
    { type: "array", items: { type: "boolean" } }, { type: "array", maxItems: 51, items: { type: "boolean" } },
    { type: "array", maxItems: 1, minItems: 2, items: { type: "boolean" } },
    { type: "array", maxItems: 1, items: false },
    { type: "object", properties: {}, additionalProperties: true },
    { type: "object", properties: null, additionalProperties: false },
    { type: "object", properties: {}, required: ["absent"], additionalProperties: false },
    { type: "object", properties: { x: { type: "boolean" } }, required: ["x", "x"], additionalProperties: false },
    { type: "object", properties: {}, required: "x", additionalProperties: false },
    { type: "object", properties: { "bad key": { type: "boolean" } }, additionalProperties: false },
    { type: "object", properties: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, { type: "boolean" }])), additionalProperties: false },
  ])("refuses unbounded, malformed or unsupported schema child %#", child => {
    expect(() => parse(definition({ inputSchema: { type: "object", properties: { query: child }, additionalProperties: false }, queryBindings: {} }))).toThrow(SavedRequestError);
  });

  test("root must be an object and nesting is bounded", () => {
    expect(() => parse(definition({ inputSchema: { type: "boolean" }, queryBindings: {} }))).toThrow(SavedRequestError);
    let child: Record<string, unknown> = { type: "boolean" };
    for (let i = 0; i < 5; i++) child = { type: "array", maxItems: 1, items: child };
    expect(() => parse(definition({ inputSchema: { type: "object", properties: { query: child }, additionalProperties: false }, queryBindings: {} }))).toThrow(SavedRequestError);
  });
});

describe("positive typed projection declarations", () => {
  test.each([
    { path: [], type: "boolean" }, { path: ["cost"], type: "number" },
    { path: ["link"], type: "url", maxLength: 500, allowedOrigin: "https://public.example" },
  ])("accepts field %#", field => {
    expect(parse({ ...definition(), output: { path: [], maxItems: 1, fields: { value: field } } }).output.fields.value).toEqual(field);
  });
  test.each([
    { path: "products", maxItems: 1, fields: {} }, { path: Array(9).fill("p"), maxItems: 1, fields: {} },
    { path: ["constructor"], maxItems: 1, fields: {} }, { path: [], maxItems: 0, fields: {} },
    { path: [], maxItems: 51, fields: {} }, { path: [], maxItems: 1, fields: {} },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "object" } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "string" } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "number", maxLength: 2 } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "boolean", allowedOrigin: "https://public.example" } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "url", maxLength: 100, allowedOrigin: "http://public.example" } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "url", maxLength: 100, allowedOrigin: "https://public.example/path" } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "url", maxLength: 100, allowedOrigin: "https://public.example:8443" } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "url", maxLength: 100 } } },
    { path: [], maxItems: 1, fields: { x: { path: [], type: "number", expression: "x" } } },
    { path: [], maxItems: 1, fields: {}, wildcard: true },
  ])("refuses invalid projection %#", output => {
    expect(() => parse({ ...definition(), output })).toThrow(SavedRequestError);
  });
});
