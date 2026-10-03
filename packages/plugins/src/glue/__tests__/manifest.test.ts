import assert from "node:assert/strict";
import { test } from "vitest";

import {
  resolveCallSiteDispatch,
  validateGlueManifest,
  type GlueCallSite,
  type GlueManifest,
} from "../manifest.js";



function validManifest(overrides: Partial<GlueManifest> = {}): unknown {
  return {
    id: "site-glue-example",
    version: "1.0.0",
    sdkRange: "^1.0.0",
    capabilities: ["content.read", "hooks.attach"],
    attachments: [{ callSite: "content.entry.beforeSave" }],
    ...overrides,
  };
}

function required(manifest: unknown) {
  return { manifest, vocabulary };
}

function codesOf(result: { errors: readonly { code: string }[] }): string[] {
  return result.errors.map((e) => e.code).sort();
}

const ALL_SIX_CALL_SITES: readonly GlueCallSite[] = [
  "content.entry.beforeSave",
  "assistant.tools",
  "events.subscribe",
  "admin.nav",
  "render.contribute",
  "http.routes",
];

test("a fully valid manifest produces zero errors", () => {
  const result = validateGlueManifest(required(validManifest()));
  assert.deepEqual(result.errors, []);
});

for (const callSite of ALL_SIX_CALL_SITES) {
  test(`ADR-057 Decision 2: an attachment declared against call site '${callSite}' passes schema validation (all six are valid at validation time)`, () => {
    const result = validateGlueManifest(required(validManifest({ attachments: [{ callSite }] })));
    assert.deepEqual(result.errors, [], `'${callSite}' must be schema-valid even if unwired for dispatch`);
  });
}

test("an attachment declared against a call site outside the closed six-member vocabulary is CALL_SITE_UNKNOWN", () => {
  const result = validateGlueManifest(
    required(validManifest({ attachments: [{ callSite: "not.a.real.call.site" as never }] }))
  );
  assert.ok(codesOf(result).includes("CALL_SITE_UNKNOWN"));
});

test("a manifest declaring a capability outside the v1 vocabulary is CAPABILITY_UNKNOWN", () => {
  const result = validateGlueManifest(required(validManifest({ capabilities: ["fs.write" as never] })));
  assert.ok(codesOf(result).includes("CAPABILITY_UNKNOWN"));
});

test("every one of the eight glue capability strings is independently accepted", () => {
  const capabilities = [
    "content.read",
    "content.extend",
    "hooks.attach",
    "tools.register",
    "events.subscribe",
    "admin.nav.register",
    "render.contribute",
    "http.route.register",
  ] as const;
  for (const capability of capabilities) {
    const result = validateGlueManifest(required(validManifest({ capabilities: [capability] })));
    assert.deepEqual(result.errors, [], `capability '${capability}' must validate cleanly on its own`);
  }
});

test("a manifest missing a required field is MANIFEST_MALFORMED", () => {
  const { sdkRange: _sdkRange, ...missingSdkRange } = validManifest() as Record<string, unknown>;
  const result = validateGlueManifest(required(missingSdkRange));
  assert.ok(codesOf(result).includes("MANIFEST_MALFORMED"));
});

test("unknown top-level manifest keys fail validation", () => {
  const result = validateGlueManifest(required({ ...(validManifest() as object), unexpectedKey: true }));
  assert.ok(codesOf(result).includes("MANIFEST_MALFORMED"));
});

test("a manifest that is not a JSON object at all is MANIFEST_MALFORMED, never a throw", () => {
  assert.doesNotThrow(() => validateGlueManifest(required(null)));
  assert.doesNotThrow(() => validateGlueManifest(required([1, 2, 3])));
  assert.doesNotThrow(() => validateGlueManifest(required("not an object")));
  assert.ok(codesOf(validateGlueManifest(required(null))).includes("MANIFEST_MALFORMED"));
});

test("an id outside ^[a-z0-9-]+$ or outside 1..50 chars is MANIFEST_MALFORMED", () => {
  const badChars = validateGlueManifest(required(validManifest({ id: "Site_Glue!" })));
  assert.ok(codesOf(badChars).includes("MANIFEST_MALFORMED"));

  const tooLong = validateGlueManifest(required(validManifest({ id: "a".repeat(51) })));
  assert.ok(codesOf(tooLong).includes("MANIFEST_MALFORMED"));
});

test("each 'attachments' entry that is not an object is MANIFEST_MALFORMED", () => {
  const result = validateGlueManifest(required(validManifest({ attachments: ["not-an-object" as never] })));
  assert.ok(codesOf(result).includes("MANIFEST_MALFORMED"));
});

test("collect-all: a manifest violating multiple rules at once reports ALL applicable codes, not just the first", () => {
  const kitchenSink = {
    id: "Bad_Id!",
    version: "1.0.0",
    sdkRange: "^1.0.0",
    capabilities: ["fs.write"],
    attachments: [{ callSite: "not.a.real.call.site" }],
  };

  const result = validateGlueManifest(required(kitchenSink));
  const codes = codesOf(result);

  for (const expected of ["MANIFEST_MALFORMED", "CAPABILITY_UNKNOWN", "CALL_SITE_UNKNOWN"]) {
    assert.ok(
      codes.includes(expected),
      `collect-all validation must report ${expected} alongside every other violated rule (found: ${codes.join(", ")})`
    );
  }
});

test("validateGlueManifest does not mutate its input manifest object", () => {
  const manifest = validManifest();
  const before = JSON.stringify(manifest);
  validateGlueManifest(required(manifest));
  assert.equal(JSON.stringify(manifest), before);
});

// --- resolveCallSiteDispatch: proves dispatch-time rejection is distinct from validation-time
// rejection, for the exact three call sites the ADR names as unwired in v1. ---

const WIRED: readonly GlueCallSite[] = ["content.entry.beforeSave", "assistant.tools", "events.subscribe"];
const UNWIRED: readonly GlueCallSite[] = ["admin.nav", "render.contribute", "http.routes"];

for (const callSite of WIRED) {
  test(`resolveCallSiteDispatch: '${callSite}' is wired in v1`, () => {
    assert.deepEqual(resolveCallSiteDispatch({ callSite, wiredCallSites: WIRED }), { wired: true });
  });
}

for (const callSite of UNWIRED) {
  test(`resolveCallSiteDispatch: '${callSite}' is schema-valid but UNWIRED_CALL_SITE at dispatch`, () => {
    // Schema-valid first (same manifest passes validateGlueManifest cleanly, proven above)...
    const schemaResult = validateGlueManifest(required(validManifest({ attachments: [{ callSite }] })));
    assert.deepEqual(schemaResult.errors, []);

    // and only rejected one step later, at dispatch.
    assert.deepEqual(resolveCallSiteDispatch({ callSite, wiredCallSites: WIRED }), { wired: false, code: "UNWIRED_CALL_SITE" });
  });
}

test("ADR-057 Decision 2: exactly three call sites are wired and exactly three are unwired — the six-member vocabulary is fully partitioned, none double-counted or omitted", () => {
  const statuses = ALL_SIX_CALL_SITES.map((cs) => resolveCallSiteDispatch({ callSite: cs, wiredCallSites: WIRED }).wired);
  assert.equal(statuses.filter((w) => w === true).length, 3);
  assert.equal(statuses.filter((w) => w === false).length, 3);
});


const vocabulary = { capabilities: ["content.read", "content.extend", "hooks.attach", "tools.register", "events.subscribe", "admin.nav.register", "render.contribute", "http.route.register"], callSites: ALL_SIX_CALL_SITES };
