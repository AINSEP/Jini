import assert from "node:assert/strict";
import { test } from "vitest";

import { validateManifest, type PluginManifest } from "../support/manifest.js";

/**
 * @file C-006 `validateManifest()` — SPEC-005 REQ-01, BR-02/BR-03, AC-07/AC-08/AC-12, EC-01/EC-04/
 * EC-05, DUP-01 (`SHADOWS_BUILT_IN` half — the `ID_DUPLICATE` site-vs-site half needs the whole
 * discovered set and is covered by `discovery.integration.test.ts` instead).
 *
 * RT-009 note (carried into every fixture in this file): the 1.1.1 `plugin.tier` fix makes `tier`
 * a required field with no safe default. Every "baseline valid" manifest fixture below explicitly
 * declares `tier: "tier-3"` — the only value a v1 in-process ESM loader may declare (ADR-024 §1) —
 * so a fixture never spuriously fails validation for an unrelated reason.
 *
 * TDD-certified against the stub in `../../manifest.ts`; currently RED — `validateManifest` throws
 * "not implemented". These assertions describe the contract the Programmer stage must satisfy.
 */

function validManifest(overrides: Partial<PluginManifest> = {}): Record<string, unknown> {
  return {
    id: "word-count",
    name: "Word Count",
    version: "1.0.0",
    sdkRange: "^1.0.0",
    engine: 1,
    tier: "tier-3",
    capabilities: ["content.read", "content.extend", "hooks.attach"],
    hooks: ["content.entry.beforeSave"],
    fields: [{ path: "ext.word-count.count", type: "integer", queryable: false }],
    integrity: { "server/index.mjs": `sha256-${"ab".repeat(32)}` },
    ...overrides,
  };
}

function required(manifest: unknown, folderName = "word-count", builtInIds: readonly string[] = []) {
  return { manifest, folderName, builtInIds };
}

function codesOf(result: { errors: readonly { code: string }[] }): string[] {
  return result.errors.map((e) => e.code).sort();
}

test("REQ-01/BR-03: a fully valid manifest (tier included, RT-009) produces zero errors", () => {
  const result = validateManifest(required(validManifest()));
  assert.deepEqual(result.errors, []);
});

test("REQ-01/AC-12: a manifest missing a required field is MANIFEST_MALFORMED", () => {
  const { name: _name, ...missingName } = validManifest() as Record<string, unknown>;
  const result = validateManifest(required(missingName));
  assert.ok(codesOf(result).includes("MANIFEST_MALFORMED"));
});

test("REQ-01 (1.1.1 fix)/BR-02: a manifest missing `tier` is MANIFEST_MALFORMED, same as any other required field", () => {
  const { tier: _tier, ...missingTier } = validManifest() as Record<string, unknown>;
  const result = validateManifest(required(missingTier));
  assert.ok(
    codesOf(result).includes("MANIFEST_MALFORMED"),
    "a missing `tier` must fail exactly like a missing `engine`/`sdkRange` — no silent default (behavior.spec.md §10)"
  );
});

test("REQ-01 (1.1.1 fix): a manifest with an out-of-vocabulary `tier` value is MANIFEST_MALFORMED", () => {
  const result = validateManifest(required(validManifest({ tier: "tier-9" as never })));
  assert.ok(codesOf(result).includes("MANIFEST_MALFORMED"));
});

test("REQ-01: unknown top-level manifest keys fail validation", () => {
  const result = validateManifest(required({ ...validManifest(), unexpectedKey: true } as never));
  assert.ok(codesOf(result).includes("MANIFEST_MALFORMED"));
});

test("REQ-01: engine newer than the runtime supports is ENGINE_UNSUPPORTED", () => {
  const result = validateManifest(required(validManifest({ engine: 999 })));
  assert.ok(codesOf(result).includes("ENGINE_UNSUPPORTED"));
});

test("EC-01: tovu.plugin.json id differing from the install folder name is ID_FOLDER_MISMATCH", () => {
  const result = validateManifest(required(validManifest({ id: "word-count" }), "different-folder-name"));
  assert.ok(codesOf(result).includes("ID_FOLDER_MISMATCH"));
});

test("REQ-01: an id outside ^[a-z0-9-]+$ or outside 1..50 chars is MANIFEST_MALFORMED", () => {
  const badChars = validateManifest(required(validManifest({ id: "Word_Count!" }), "Word_Count!"));
  assert.ok(codesOf(badChars).includes("MANIFEST_MALFORMED"));

  const tooLong = validateManifest(required(validManifest({ id: "a".repeat(51) }), "a".repeat(51)));
  assert.ok(codesOf(tooLong).includes("MANIFEST_MALFORMED"));
});

test("REQ-04: a manifest declaring a capability outside the v1 vocabulary is CAPABILITY_UNKNOWN", () => {
  const result = validateManifest(required(validManifest({ capabilities: ["content.read", "fs.write" as never] })));
  assert.ok(codesOf(result).includes("CAPABILITY_UNKNOWN"));
});

test("EC-05/REQ-05: a manifest declaring a hook point outside the v1 vocabulary is HOOK_UNKNOWN", () => {
  const result = validateManifest(required(validManifest({ hooks: ["content.entry.afterEverything"] })));
  assert.ok(codesOf(result).includes("HOOK_UNKNOWN"));
});

test("REQ-06/AC-07: a field path not namespaced to the plugin's own id is FIELD_PATH_INVALID", () => {
  const result = validateManifest(
    required(validManifest({ fields: [{ path: "ext.other-plugin.x", type: "string", queryable: false }] }))
  );
  assert.ok(codesOf(result).includes("FIELD_PATH_INVALID"));
});

test("EC-04/AC-08: a field declared queryable:true is QUERYABLE_UNSUPPORTED_V1", () => {
  const result = validateManifest(
    required(validManifest({ fields: [{ path: "ext.word-count.count", type: "integer", queryable: true }] }))
  );
  assert.ok(codesOf(result).includes("QUERYABLE_UNSUPPORTED_V1"));
});

test("DUP-01: a site plugin id equal to a built-in id is SHADOWS_BUILT_IN, and the built-in is unaffected (this function only reports the site record's error)", () => {
  const result = validateManifest(required(validManifest({ id: "word-count" }), "word-count", ["word-count"]));
  assert.ok(codesOf(result).includes("SHADOWS_BUILT_IN"));
});

test("the id 'core' is reserved: it is the claim system's own owner id for Tovu core, so a plugin with it would never conflict with core", () => {
  assert.deepEqual(validateManifest(required(validManifest({ id: "core", fields: [{ path: "ext.core.count", type: "integer", queryable: false }] }), "core")).errors, [{
    code: "ID_RESERVED", file: null, message: "id 'core' is reserved for Tovu core",
  }]);
});

test("REQ-01/BR-02 (collect-all, adversarial aggregate case): a manifest violating every rule at once reports ALL applicable codes, not just the first", () => {
  const kitchenSink = {
    id: "Bad_Id!",
    name: "Bad Plugin",
    version: "1.0.0",
    sdkRange: "^1.0.0",
    engine: 999,
    tier: "not-a-tier",
    capabilities: ["fs.write"],
    hooks: ["content.entry.afterEverything"],
    fields: [
      { path: "ext.someone-else.x", type: "string", queryable: true },
    ],
    integrity: { "server/index.mjs": `sha256-${"ab".repeat(32)}` },
  };

  const result = validateManifest(required(kitchenSink, "totally-different-folder"));
  const codes = codesOf(result);

  for (const expected of [
    "MANIFEST_MALFORMED", // tier out of vocabulary (or id format) — at least one MANIFEST_MALFORMED entry
    "ENGINE_UNSUPPORTED",
    "ID_FOLDER_MISMATCH",
    "CAPABILITY_UNKNOWN",
    "HOOK_UNKNOWN",
    "FIELD_PATH_INVALID",
    "QUERYABLE_UNSUPPORTED_V1",
  ]) {
    assert.ok(
      codes.includes(expected),
      `collect-all validation must report ${expected} alongside every other violated rule — ` +
        `first-failure short-circuiting would silently hide it (BR-02, all codes found: ${codes.join(", ")})`
    );
  }
});

test("REQ-01/BR-02 (property-style): every one of the 6 well-formed-except-one-field mutations of a valid manifest independently produces exactly the error that field's own rule predicts, and no others introduced by the mutation itself", () => {
  const mutations: Array<{ label: string; overrides: Partial<PluginManifest>; expectedCode: string }> = [
    { label: "bad tier", overrides: { tier: "tier-4" as never }, expectedCode: "MANIFEST_MALFORMED" },
    { label: "bad engine", overrides: { engine: 42 }, expectedCode: "ENGINE_UNSUPPORTED" },
    { label: "bad capability", overrides: { capabilities: ["network.raw" as never] }, expectedCode: "CAPABILITY_UNKNOWN" },
    { label: "bad hook", overrides: { hooks: ["content.entry.afterSave"] }, expectedCode: "HOOK_UNKNOWN" },
    {
      label: "bad field namespace",
      overrides: { fields: [{ path: "ext.not-me.x", type: "string", queryable: false }] },
      expectedCode: "FIELD_PATH_INVALID",
    },
    {
      label: "queryable field",
      overrides: { fields: [{ path: "ext.word-count.count", type: "integer", queryable: true }] },
      expectedCode: "QUERYABLE_UNSUPPORTED_V1",
    },
  ];

  for (const { label, overrides, expectedCode } of mutations) {
    const result = validateManifest(required(validManifest(overrides)));
    assert.deepEqual(codesOf(result), [expectedCode], `mutation "${label}" must report only its own error`);
    const error = result.errors[0];
    assert.ok(error);
    assert.equal(error.file, null);
    assert.ok(error.message.length > 0);
  }
});

test("REQ-01: validateManifest does not mutate its input manifest object", () => {
  const manifest = validManifest();
  const before = JSON.stringify(manifest);
  validateManifest(required(manifest));
  assert.equal(JSON.stringify(manifest), before);
});

/**
 * 2026-08-26 addition (`PluginManifestFieldDecl.description`, additive/optional — see this field's
 * own doc for why): folded into `search_tools`' indexed description by
 * `features/plugin-runtime/capability-tool-registrations.ts` when a plugin is enabled. Covered here
 * because `validateField` is where it is (optionally) checked; the capability-tool consumer's own
 * suite (`capability-tool-registrations.unit.test.ts`) covers what happens when it is present vs.
 * absent at the tool-description level.
 */
test("a field description, when present, is accepted and produces zero errors", () => {
  const result = validateManifest(
    required(
      validManifest({
        fields: [{ path: "ext.word-count.count", type: "integer", queryable: false, description: "Word count and reading time for this post." }],
      }),
    ),
  );
  assert.deepEqual(result.errors, []);
});

test("a field description that is present but an empty/blank string is FIELD_DESCRIPTION_INVALID, not silently accepted", () => {
  const result = validateManifest(
    required(validManifest({ fields: [{ path: "ext.word-count.count", type: "integer", queryable: false, description: "   " }] })),
  );
  assert.ok(codesOf(result).includes("FIELD_DESCRIPTION_INVALID"));
});

test("omitting a field description entirely (every pre-existing manifest) still produces zero errors — this is additive, not a new requirement", () => {
  const result = validateManifest(required(validManifest())); // validManifest()'s own fixture field has no `description`
  assert.deepEqual(result.errors, []);
});

/**
 * BUG (found auditing `validateField` for the complexity refactor, `manifest.ts`): the old
 * `queryable` check was `decl.queryable === true`, which only ever rejects the literal boolean
 * `true`. A non-boolean, JS-truthy value (a string, a number, ...) silently passed with ZERO
 * errors despite `queryable` being a REQUIRED `boolean` field — the exact "missing-vs-present-but-
 * wrong-type conflated" class of gap this audit was told to look for.
 */
test("BUG REGRESSION: a non-boolean queryable value (e.g. a string) is MANIFEST_MALFORMED, not silently accepted", () => {
  const result = validateManifest(
    required(validManifest({ fields: [{ path: "ext.word-count.count", type: "integer", queryable: "false" as never }] })),
  );
  assert.ok(
    codesOf(result).includes("MANIFEST_MALFORMED"),
    `a non-boolean 'queryable' must be rejected as malformed, not pass through as if 'queryable: false' had been declared (found: ${codesOf(result).join(", ")})`,
  );
});

test("BUG REGRESSION: an omitted queryable field is MANIFEST_MALFORMED — it is a required field, not defaulted", () => {
  const result = validateManifest(
    required(validManifest({ fields: [{ path: "ext.word-count.count", type: "integer" } as never] })),
  );
  assert.ok(
    codesOf(result).includes("MANIFEST_MALFORMED"),
    `an omitted 'queryable' must be rejected as malformed (found: ${codesOf(result).join(", ")})`,
  );
});

// F4.4: each malformed value breaks only the named shape guard.
test("malformed top-level JSON values return a structured error without throwing", () => {
  for (const manifest of [null, [], "plugin", 42, true]) {
    assert.deepEqual(validateManifest(required(manifest)).errors, [{
      code: "MANIFEST_MALFORMED", file: null, message: "tovu.plugin.json must be a JSON object",
    }]);
  }
});

test("non-array capabilities, hooks and fields each report their own shape diagnostic", () => {
  for (const key of ["capabilities", "hooks", "fields"] as const) {
    assert.deepEqual(validateManifest(required(validManifest({ [key]: {} } as never))).errors, [{
      code: "MANIFEST_MALFORMED", file: null, message: `'${key}' must be an array`,
    }]);
  }
});

test("unsupported field types and non-object declarations return structured diagnostics", () => {
  assert.deepEqual(validateManifest(required(validManifest({ fields: [null] as never }))).errors, [{
    code: "MANIFEST_MALFORMED", file: null, message: "each 'fields' entry must be an object",
  }]);
  assert.deepEqual(validateManifest(required(validManifest({ fields: [
    { path: "ext.word-count.count", type: "date" as never, queryable: false },
  ] }))).errors, [{
    code: "MANIFEST_MALFORMED", file: null,
    message: "field 'ext.word-count.count' has an unrecognized type 'date'",
  }]);
});

// F3193: REQ-01 requires `name`, a semver `version`, and SHA-256 `integrity` hashes. Before this,
// any present value passed (the old fixture's own 'sha256-deadbeef' was accepted).
test("REQ-01: an empty or non-string name is MANIFEST_MALFORMED", () => {
  for (const name of ["", "   ", 7, null]) {
    assert.deepEqual(validateManifest(required(validManifest({ name } as never))).errors, [{
      code: "MANIFEST_MALFORMED", file: null, message: "'name' must be a non-empty string",
    }], JSON.stringify(name));
  }
});

test("REQ-01: a version that is not exact semver is MANIFEST_MALFORMED", () => {
  for (const version of ["1.0", "v1.0.0", "latest", "1.0.0 ", "", 1, "1.0.0+", "=1.0.0+build"]) {
    assert.deepEqual(validateManifest(required(validManifest({ version } as never))).errors, [{
      code: "MANIFEST_MALFORMED", file: null, message: `version '${String(version)}' must be a semver version (e.g. 1.0.0)`,
    }], JSON.stringify(version));
  }
  for (const version of ["0.1.0", "2.10.3", "1.0.0-beta.1", "1.0.0+build.42", "1.0.0-beta.1+sha.abc"]) {
    assert.deepEqual(validateManifest(required(validManifest({ version } as never))).errors, [], version);
  }
});

test("REQ-01: integrity must map files to 'sha256-' + 64 lowercase hex; anything else is MANIFEST_MALFORMED", () => {
  for (const hash of ["sha256-deadbeef", `sha256-${"AB".repeat(32)}`, `sha512-${"ab".repeat(32)}`, `${"ab".repeat(32)}`, 42]) {
    assert.deepEqual(validateManifest(required(validManifest({ integrity: { "server/index.mjs": hash } } as never))).errors, [{
      code: "MANIFEST_MALFORMED", file: null,
      message: "integrity entry 'server/index.mjs' must be 'sha256-' followed by 64 lowercase hex characters",
    }], String(hash));
  }
  for (const integrity of [[], "sha256-x", null]) {
    assert.deepEqual(validateManifest(required(validManifest({ integrity } as never))).errors, [{
      code: "MANIFEST_MALFORMED", file: null, message: "'integrity' must be an object mapping packaged file paths to sha256 hashes",
    }], JSON.stringify(integrity));
  }
  assert.deepEqual(validateManifest(required(validManifest({ integrity: {} }))).errors, [], "a built-in has no packaged files to hash");
});

// --- `contributes` (2026-10-04, conflict detection — see `plugin-claims.ts`) ---

test("contributes: a well-formed block is valid, and omitting it stays valid", () => {
  const result = validateManifest(required(validManifest({
    contributes: {
      routes: ["GET /word-count/stats", "/word-count", "* /word-count/any"], tools: ["word_count_stats"], tables: ["p_word_count__totals"],
      settings: ["word-count.mode"], widgets: ["word-count-badge"], permissions: ["word-count.manage"],
    },
  })));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(validateManifest(required(validManifest())).errors, []);
});

test("contributes: every malformed entry is CONTRIBUTES_INVALID, collected, not first-failure", () => {
  const result = validateManifest(required(validManifest({
    contributes: {
      routes: ["word-count"], tools: ["plugin_capability_other", "agent_plugin_x"], tables: ["p_other__items", "p_word_count__"],
      settings: ["word-count.*"], widgets: [""], permissions: "word-count.manage",
    } as unknown as NonNullable<PluginManifest["contributes"]>,
  })));
  assert.deepEqual(codesOf(result), Array(8).fill("CONTRIBUTES_INVALID"));
  assert.ok(result.errors.some((error) => error.message.includes("'p_other__items' must be namespaced to this plugin ('p_word_count__*')")));
  assert.ok(result.errors.some((error) => error.message.includes("'word-count.*' must name one thing")));
});

test("contributes: an unknown list name and a non-object block are refused", () => {
  assert.deepEqual(codesOf(validateManifest(required(validManifest({ contributes: { hooks: ["x"] } as unknown as NonNullable<PluginManifest["contributes"]> })))), ["CONTRIBUTES_INVALID"]);
  assert.deepEqual(codesOf(validateManifest(required(validManifest({ contributes: ["routes"] as unknown as NonNullable<PluginManifest["contributes"]> })))), ["CONTRIBUTES_INVALID"]);
});

test("AW-7 Tier 1: validateManifest reports a bad contentTypes declaration, so discovery lists it invalid", () => {
  const result = validateManifest(required(validManifest({ contentTypes: [{ key: "post", label: "P", fields: [{ name: "a", kind: "text" }] }] })));
  assert.deepEqual(result.errors, [{ code: "CONTENT_TYPE_DECL_INVALID", file: null, message: "content type key 'post' is reserved by core" }]);
});

test("AW-7 Tier 1: a tier-1 manifest may declare content types but no code surface", () => {
  const declarative = { tier: "tier-1" as const, capabilities: [], hooks: [], fields: [], integrity: {} };
  const faq = [{ key: "faq", label: "FAQ", fields: [{ name: "answer", kind: "text" }] }];
  assert.deepEqual(validateManifest(required(validManifest({ ...declarative, contentTypes: faq }))).errors, []);
  const withHooks = validateManifest(required(validManifest({ ...declarative, hooks: ["content.entry.beforeSave"] })));
  assert.deepEqual(codesOf(withHooks), ["TIER1_DECLARES_CODE_SURFACE"]);
});

test("AW-7 Tier 1: a tier-1 manifest whose code-surface lists are malformed reports them once, as malformed", () => {
  const result = validateManifest(required(validManifest({ tier: "tier-1", capabilities: "all" as never, hooks: [], fields: [], integrity: {} })));
  assert.deepEqual(codesOf(result), ["MANIFEST_MALFORMED"]);
});
