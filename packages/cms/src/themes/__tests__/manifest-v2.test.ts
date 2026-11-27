import assert from "node:assert/strict";
import { test } from "vitest";

import { validateManifestV2 } from "../manifest-v2.js";

/**
 * @file Direct-call tests for `validateManifestV2`'s own contract, independent of its one current
 * caller (`validate-theme-package.ts`, which always resolves `schemaVersion` from
 * `raw.apiVersion === 2` before ever calling this function — see that file's `loadRawManifest`/
 * `validateThemePackage`). That gate makes `checkApiVersion`'s `v2-api-version` finding unreachable
 * through the one wired product path (verified 2026-08-20: a repo-wide grep for `validateManifestV2(`
 * turns up exactly that one call site, inside a branch already conditioned on the same equality).
 *
 * That is a caller-side fact about `validate-theme-package.ts`, not a fact about `validateManifestV2`
 * itself — this function is independently exported with no type-level tie to the gate (`raw` is a
 * plain `Record<string, unknown>`; nothing stops a future caller, or a test, from invoking it with an
 * `apiVersion` other than `2`). Per this repo's coverage-gap policy: a branch only unreachable through
 * one caller's current usage, not through the function's own public contract, gets a test, not a
 * deletion — this file is that test.
 */

test("validateManifestV2: a raw manifest whose apiVersion is not exactly 2 is rejected directly (v2-api-version)", () => {
  const wrongVersion = validateManifestV2({ validateScripts: () => ({ problems: [] }), isSourceDirGeneratedConflict: () => false, raw: { apiVersion: 1, id: "t", name: "T", version: "1.0.0" } });
  const found = wrongVersion.find((issue) => issue.ruleId === "v2-api-version");
  assert.ok(found, JSON.stringify(wrongVersion));
  assert.equal(found!.message, "theme.json: apiVersion must be exactly 2, got 1");
});

test("validateManifestV2: a raw manifest with no apiVersion field at all is also rejected (v2-api-version)", () => {
  const missingVersion = validateManifestV2({ validateScripts: () => ({ problems: [] }), isSourceDirGeneratedConflict: () => false, raw: { id: "t", name: "T", version: "1.0.0" } });
  const found = missingVersion.find((issue) => issue.ruleId === "v2-api-version");
  assert.ok(found, JSON.stringify(missingVersion));
  assert.equal(found!.message, "theme.json: apiVersion must be exactly 2, got undefined");
});

test('validateManifestV2: fontStylesheets accepts HTTPS and local paths, including explicit opt-out', () => {
  for (const fontStylesheets of [[], ['https://fonts.example.test/site.css?a=1&b=2', '/fonts/site.css']]) {
    assert.deepEqual(validateManifestV2({ validateScripts: () => ({ problems: [] }), isSourceDirGeneratedConflict: () => false, raw: { apiVersion: 2, id: 't', name: 'T', version: '1.0.0', fontStylesheets } }), []);
  }
});

test('validateManifestV2: fontStylesheets rejects non-arrays and any malformed entry', () => {
  for (const fontStylesheets of [null, 'https://fonts.example.test/site.css', {}, [42], ['http://fonts.example.test/site.css'],
    ['//fonts.example.test/site.css'], ['fonts/site.css'], ['https://'], ['https://fonts.example.test/site.css', '/\\remote.test/site.css'],
    ['/fonts/site.css', 'javascript:alert(1)'], ['/fonts/site.css', '/ /remote.test/site.css']]) {
    const issues = validateManifestV2({ validateScripts: () => ({ problems: [] }), isSourceDirGeneratedConflict: () => false, raw: { apiVersion: 2, id: 't', name: 'T', version: '1.0.0', fontStylesheets } });
    assert.deepEqual(issues.map(issue => issue.ruleId), ['v2-font-stylesheets'], JSON.stringify(fontStylesheets));
  }
});

// Rule ids from manifest-v2-fields.ts; named once so each expectation reads as the rule it checks.
const TOKENS_UNIMPLEMENTED = "v2-tokens-unimplemented";
const PARTIALS_UNIMPLEMENTED = "v2-partials-unimplemented";
const manifest = { id: "guide", name: "Guide", version: "1.2.3-alpha.1+build", apiVersion: 2 };
const validate = (fields: Record<string, unknown>, isSourceDirGeneratedConflict: (required: { sourceDir: string }) => boolean = () => false) =>
  validateManifestV2({ raw: { ...manifest, ...fields }, validateScripts: () => ({ problems: [] }), isSourceDirGeneratedConflict });
const ruleIds = (fields: Record<string, unknown>) => validate(fields).map(issue => issue.ruleId);

test.each([
  { field: "id", value: "", rule: "v2-id" }, { field: "id", value: 3, rule: "v2-id" },
  { field: "name", value: "", rule: "v2-name" }, { field: "name", value: false, rule: "v2-name" },
  { field: "version", value: "v1.2.3", rule: "v2-version-semver" }, { field: "version", value: 2, rule: "v2-version-semver" },
  { field: "tier", value: "freeform", rule: "v2-tier" }, { field: "tier", value: [], rule: "v2-tier" },
  { field: "license", value: "MIT", rule: "v2-license-shape" },
  { field: "authors", value: { name: "Someone" }, rule: "v2-authors-shape" },
  { field: "attributions", value: null, rule: "v2-attributions-shape" },
  { field: "regions", value: { main: true }, rule: "v2-regions-shape" },
])("rejects $field=$value with $rule", ({ field, value, rule }) => {
  assert.deepEqual(ruleIds({ [field]: value }), [rule]);
});

test("rejects unknown top-level keys while disclosing recognized fields the loader ignores", () => {
  assert.deepEqual(validate({ madeUp: true, assets: {}, ai: {} }), [
    { ruleId: "v2-unknown-field", message: "theme.json: unrecognized top-level field 'madeUp' (schema v2 is additionalProperties: false)" },
    { ruleId: "v2-assets-unimplemented", message: "theme.json: assets is not yet read by the runtime loader (theme.ts) — this declaration will be silently ignored" },
    { ruleId: "v2-ai-unimplemented", message: "theme.json: ai is not yet read by the runtime loader (theme.ts) — this declaration will be silently ignored" },
  ]);
});

test("schema and runtime template ownership agree on an invalid templateFor shape", () => {
  const issues = validate({ templateFor: ["post"], templates: ["article"] });
  assert.deepEqual(issues.map(issue => issue.ruleId), ["v2-template-for"]);
  assert.match(issues[0]!.message, /templateFor/);
});

test("legacy scalar engine is rejected and even a valid engine object tells authors it will be discarded", () => {
  assert.deepEqual(ruleIds({ engine: 1 }), ["v2-engine-shape"]);
  assert.deepEqual(ruleIds({ engine: { name: "liquid" } }), ["v2-engine-object-unimplemented"]);
  assert.deepEqual(ruleIds({ engine: { name: "handlebars", version: "4" } }), ["v2-engine-object-unimplemented"]);
  assert.deepEqual(ruleIds({ engine: { name: "twig", version: 4 } }), ["v2-engine-name", "v2-engine-version", "v2-engine-object-unimplemented"]);
  assert.deepEqual(ruleIds({ engine: { name: null } }), ["v2-engine-name", "v2-engine-object-unimplemented"]);
});

test("nested tokens, partials and renderer each warn once with their own shape issues", () => {
  assert.deepEqual(ruleIds({ tokens: false, partials: [], renderer: {} }),
    ["v2-tokens-shape", TOKENS_UNIMPLEMENTED, "v2-partials-shape", PARTIALS_UNIMPLEMENTED, "v2-renderer-unimplemented"]);
  assert.deepEqual(ruleIds({ tokens: { modes: [] } }), ["v2-tokens-modes", TOKENS_UNIMPLEMENTED]);
  assert.deepEqual(ruleIds({ tokens: { defaultMode: "constructor", modes: { light: "light.json" } } }), ["v2-tokens-default-mode", TOKENS_UNIMPLEMENTED]);
  assert.deepEqual(ruleIds({ tokens: { defaultMode: "dark", modes: { dark: "dark.json" } }, partials: { hero: {} } }),
    [TOKENS_UNIMPLEMENTED, PARTIALS_UNIMPLEMENTED]);
  assert.deepEqual(ruleIds({ tokens: { modes: {} } }), [TOKENS_UNIMPLEMENTED]);
});

test("build metadata rejects malformed and unknown declarations while allowing known optional fields", () => {
  assert.deepEqual(ruleIds({ build: ["react"] }), ["v2-build-shape"]);
  assert.deepEqual(ruleIds({ build: { source: "network", framework: "jquery" } }), ["v2-build-source", "v2-build-framework"]);
  assert.deepEqual(ruleIds({ build: { source: 1, framework: true } }), ["v2-build-source", "v2-build-framework"]);
  assert.deepEqual(ruleIds({ build: { source: "authored", framework: "solid" } }), []);
  assert.deepEqual(ruleIds({ build: {} }), []);
});

test("compiled builds require a real source directory and hashes, and report host-reserved directories", () => {
  assert.deepEqual(ruleIds({ build: { source: "compiled" } }), ["v2-build-sourcedir-required", "v2-build-artifacthashes-required"]);
  assert.deepEqual(ruleIds({ build: { source: "compiled", sourceDir: "", artifactHashes: {} } }), ["v2-build-sourcedir-required", "v2-build-artifacthashes-required"]);
  const seen: string[] = [];
  const containsReserved = ({ sourceDir }: { sourceDir: string }) => { seen.push(sourceDir); return sourceDir === "src/generated"; };
  assert.deepEqual(validate({ build: { source: "compiled", sourceDir: "src/generated", artifactHashes: { "main.js": "hash" } } }, containsReserved), [
    { ruleId: "v2-build-sourcedir-conflict", message: "theme.json: build.sourceDir 'src/generated' must not name or contain a reserved generated directory" },
  ]);
  assert.deepEqual(validate({ build: { source: "compiled", sourceDir: "src/editor", artifactHashes: { "main.js": "hash" } } }, containsReserved), []);
  assert.deepEqual(seen, ["src/generated", "src/editor"]);
});
