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
