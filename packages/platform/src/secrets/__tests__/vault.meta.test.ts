import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";
import { createVaultMetaParsers, VaultError, type VaultMeta, type VaultMetaParser } from "../credential-sets/index.js";

const invalidMeta = { code: "invalid-meta", message: "Secrets vault: invalid-meta", name: "VaultError" };

describe("createVaultMetaParsers default structural parsing", () => {
  const parsers = createVaultMetaParsers({});

  test("refuses a class instance as metadata", () => {
    class Shape { model = "m"; }
    assert.throws(() => parsers["site-assistant"]({ meta: new Shape() }), invalidMeta);
  });

  test("refuses a non-finite nested number", () => {
    assert.throws(() => parsers["database-destination"]({ meta: { lastRun: { at: Number.NaN } } }), invalidMeta);
  });

  test("refuses an undefined field value as non-JSON", () => {
    assert.throws(() => parsers["site-assistant"]({ meta: { model: undefined } }), invalidMeta);
  });

  test("refuses a prototype-polluting nested key", () => {
    assert.throws(() => parsers["database-destination"]({ meta: { lastRun: JSON.parse('{"__proto__":{}}') } }), invalidMeta);
  });

  test("refuses a prototype key nested in an array", () => {
    assert.throws(() => parsers["database-destination"]({ meta: { description: { list: [{ prototype: 1 }] } } }), invalidMeta);
  });

  test("refuses a top-level key outside the identifier alphabet", () => {
    assert.throws(() => parsers["site-assistant"]({ meta: { "base-url": "https://host" } }), invalidMeta);
  });

  test("refuses a field the kind does not declare", () => {
    assert.throws(() => parsers["publish-peer"]({ meta: { model: "m" } }), invalidMeta);
  });

  test("refuses any field on a kind with no declared fields", () => {
    assert.throws(() => parsers["mcp-env"]({ meta: { baseUrl: null } }), invalidMeta);
  });

  test("refuses an inherited field name that is not declared", () => {
    assert.throws(() => parsers["source-control"]({ meta: { toString: "x" } }), invalidMeta);
  });

  test("accepts null for every declared field", () => {
    const meta = { protocol: null, baseUrl: null, model: null, maxTokens: null };
    assert.deepEqual(parsers["personal-execution"]({ meta }), meta);
  });

  test("accepts each declared field type", () => {
    const meta = { protocol: "p", baseUrl: "https://host", model: "m", maxTokens: 12 };
    assert.deepEqual(parsers["personal-execution"]({ meta }), meta);
  });

  test("accepts object fields holding nested JSON", () => {
    const meta = { description: { text: "d", tags: ["a", 1, true, null] }, lastRun: {} };
    assert.deepEqual(parsers["database-destination"]({ meta }), meta);
  });

  test("refuses a strings field holding a non-array", () => {
    assert.throws(() => parsers.vendor({ meta: { worksFor: [], additionalHosts: "host" } }), invalidMeta);
  });

  test("refuses a number field holding a string", () => {
    assert.throws(() => parsers["personal-execution"]({ meta: { maxTokens: "12" } }), invalidMeta);
  });

  test("returns a copy detached from the caller's object", () => {
    const meta = { description: { text: "d" } };
    const parsed = parsers["database-destination"]({ meta });
    assert.notEqual(parsed.description, meta.description);
  });

  test("vendor without provider defaults compatibility to empty", () => {
    assert.deepEqual(parsers.vendor({ meta: {} }), { credentialType: "vendor", worksFor: [] });
  });

  test("custom kind keeps an explicit custom subtype", () => {
    assert.deepEqual(parsers.custom({ meta: { credentialType: "custom", worksFor: ["A"] }, provider: "x" }),
      { credentialType: "custom", worksFor: ["a"] });
  });

  test("custom subtype never defaults works-for from provider", () => {
    assert.deepEqual(parsers.vendor({ meta: { credentialType: "custom" }, provider: "vercel" }), { credentialType: "custom", worksFor: [] });
  });
});

describe("createVaultMetaParsers injected parsers", () => {
  test("receives a clone of canonical metadata and the provider", () => {
    const parser = vi.fn<VaultMetaParser>(({ meta }) => meta as VaultMeta);
    const parsers = createVaultMetaParsers({}, { parsers: { "site-assistant": parser } });
    const meta = { model: "m" };
    parsers["site-assistant"]({ meta, provider: "p" });
    assert.deepEqual(parser.mock.calls[0]?.[0], { meta, provider: "p" });
    assert.notEqual(parser.mock.calls[0]?.[0].meta, meta);
  });

  test("vendor parser sees canonical subtype and compatibility", () => {
    const parser = vi.fn<VaultMetaParser>(({ meta }) => meta as VaultMeta);
    createVaultMetaParsers({}, { parsers: { vendor: parser } }).vendor({ meta: {}, provider: "GitHub" });
    assert.deepEqual(parser.mock.calls[0]?.[0].meta, { credentialType: "vendor", worksFor: ["github"] });
  });

  test("override owns the shape: undeclared fields pass for non-credential kinds", () => {
    const parsers = createVaultMetaParsers({}, { parsers: { "mcp-env": () => ({ anything: [1, 2] }) } });
    assert.deepEqual(parsers["mcp-env"]({ meta: { input: "x" } }), { anything: [1, 2] });
  });

  test("still refuses invalid input metadata before calling the override", () => {
    const parser = vi.fn<VaultMetaParser>(() => ({}));
    const parsers = createVaultMetaParsers({}, { parsers: { "mcp-env": parser } });
    assert.throws(() => parsers["mcp-env"]({ meta: [] }), invalidMeta);
    assert.equal(parser.mock.calls.length, 0);
  });

  test("refuses a non-identifier input key even when the override would accept it", () => {
    const parser = vi.fn<VaultMetaParser>(({ meta }) => meta as VaultMeta);
    const parsers = createVaultMetaParsers({}, { parsers: { "mcp-env": parser } });
    assert.throws(() => parsers["mcp-env"]({ meta: { "x-api": "v" } }), invalidMeta);
    assert.equal(parser.mock.calls.length, 0);
  });

  test("refuses an override result that is not a plain object", () => {
    const parsers = createVaultMetaParsers({}, { parsers: { "mcp-env": () => [] as unknown as VaultMeta } });
    assert.throws(() => parsers["mcp-env"]({ meta: {} }), invalidMeta);
  });

  test("refuses an override result that is not JSON", () => {
    const parsers = createVaultMetaParsers({}, { parsers: { "mcp-env": () => ({ n: Number.POSITIVE_INFINITY }) } });
    assert.throws(() => parsers["mcp-env"]({ meta: {} }), invalidMeta);
  });

  test("refuses an override result with a non-identifier key", () => {
    const parsers = createVaultMetaParsers({}, { parsers: { "mcp-env": () => ({ "a.b": 1 }) } });
    assert.throws(() => parsers["mcp-env"]({ meta: {} }), invalidMeta);
  });

  test("re-canonicalizes a vendor override result", () => {
    const parsers = createVaultMetaParsers({}, { parsers: { vendor: () => ({ worksFor: ["X", "x"] }) } });
    assert.deepEqual(parsers.vendor({ meta: {} }), { worksFor: ["x"], credentialType: "vendor" });
  });

  test("refuses a vendor override result with an invalid subtype", () => {
    const parsers = createVaultMetaParsers({}, { parsers: { custom: () => ({ credentialType: "vendor", worksFor: [] }) } });
    assert.throws(() => parsers.custom({ meta: {} }), invalidMeta);
  });

  test("returns a copy detached from the override's result", () => {
    const result = { nested: { a: 1 } };
    const parsers = createVaultMetaParsers({}, { parsers: { "mcp-auth": () => result } });
    assert.notEqual(parsers["mcp-auth"]({ meta: {} }).nested, result.nested);
  });

  test("propagates the override's own refusal unchanged", () => {
    const refusal = new VaultError({ code: "context" });
    const parsers = createVaultMetaParsers({}, { parsers: { "site-assistant": () => { throw refusal; } } });
    assert.throws(() => parsers["site-assistant"]({ meta: {} }), (error: unknown) => error === refusal);
  });
});
