/**
 * @file Tests for `js-backslide-guard.ts`'s pure predicate. The git-listing half
 * (`scripts/check-js-backslide.ts`) is not exercised here — it spawns `git` — so these tests hand
 * it path lists directly.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { jsBackslideOffenders } from "../js-backslide-guard.js";

const ALLOWED = ["apps/desktop/src/speech/preload-speech.cjs"];

test("an empty path list has zero offenders", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: [] }), []);
});

test("a plain .ts file is not an offender", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/src/quality-gates.ts"] }), []);
});

test("a .js file is an offender", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/src/foo.js"] }), ["apps/desktop/src/foo.js"]);
});

test("a .mjs file is an offender", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/scripts/foo.mjs"] }), ["apps/desktop/scripts/foo.mjs"]);
});

test("a .cjs file not on the allowlist is an offender", () => {
  assert.deepEqual(
    jsBackslideOffenders({ paths: ["apps/desktop/src/speech/other.cjs"] }, { allowlist: ALLOWED }),
    ["apps/desktop/src/speech/other.cjs"]
  );
});

test("a .test.js file is an offender — extension, not basename, decides", () => {
  assert.deepEqual(
    jsBackslideOffenders({ paths: ["apps/desktop/src/foo.test.js"] }),
    ["apps/desktop/src/foo.test.js"]
  );
});

test("a .js file under renderer/ is still an offender — no directory is exempt", () => {
  assert.deepEqual(
    jsBackslideOffenders({ paths: ["apps/desktop/src/renderer/foo.js"] }),
    ["apps/desktop/src/renderer/foo.js"]
  );
});

test("a .mjs file under bin/ is an offender", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/bin/launch.mjs"] }), ["apps/desktop/bin/launch.mjs"]);
});

test("a .cjs file under scripts/ is an offender", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/scripts/check-foo.cjs"] }), ["apps/desktop/scripts/check-foo.cjs"]);
});

test("a root config file like foo.config.mjs is an offender", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/vite.config.mjs"] }), ["apps/desktop/vite.config.mjs"]);
});

test("the exact allowlisted preload path is not an offender", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/src/speech/preload-speech.cjs"] }, { allowlist: ALLOWED }), []);
});

test("a .ts file whose name merely contains 'js' is not an offender — extension match, not substring", () => {
  assert.deepEqual(jsBackslideOffenders({ paths: ["apps/desktop/src/js-backslide-guard.ts"] }), []);
});

test("the allowlist is not consulted when it is omitted — no implicit exemption", () => {
  assert.deepEqual(
    jsBackslideOffenders({ paths: ["apps/desktop/src/speech/preload-speech.cjs"] }),
    ["apps/desktop/src/speech/preload-speech.cjs"]
  );
});

test("multiple offenders are all reported, in the order given", () => {
  assert.deepEqual(
    jsBackslideOffenders({ paths: ["apps/desktop/src/a.js", "apps/desktop/src/b.ts", "apps/desktop/src/c.cjs"] }),
    ["apps/desktop/src/a.js", "apps/desktop/src/c.cjs"]
  );
});
