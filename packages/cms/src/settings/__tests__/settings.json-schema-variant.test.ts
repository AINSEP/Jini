import assert from "node:assert/strict";
import { test } from "vitest";

import { validateValueAgainstSchema } from "../settings.js";

/**
 * @file Certification of the `{type:"json"}` `SettingValueSchema` variant (ADR-PIPE-008 Decision
 * §3, C-024; Named Risk #3). Scoped narrowly: the ledger only asserts "this is a JSON value" —
 * internal shape/length validation is the registering feature's own write-path responsibility,
 * never this ledger's job.
 */

test("validateValueAgainstSchema({type:'json'}): accepts a plain object", () => {
  assert.equal(validateValueAgainstSchema({ type: "json" }, { userAgent: "*", disallow: ["/admin"] }), true);
});

test("validateValueAgainstSchema({type:'json'}): accepts an array", () => {
  assert.equal(
    validateValueAgainstSchema({ type: "json" }, [{ userAgent: "*" }, { userAgent: "Googlebot" }]),
    true
  );
});

test("validateValueAgainstSchema({type:'json'}): accepts a bare scalar (string/number/boolean)", () => {
  assert.equal(validateValueAgainstSchema({ type: "json" }, "a scalar string"), true);
  assert.equal(validateValueAgainstSchema({ type: "json" }, 42), true);
  assert.equal(validateValueAgainstSchema({ type: "json" }, true), true);
});

test("validateValueAgainstSchema({type:'json', nullable:true}): accepts null", () => {
  assert.equal(validateValueAgainstSchema({ type: "json", nullable: true }, null), true);
});

test("validateValueAgainstSchema({type:'json'}) (not nullable): rejects null", () => {
  assert.equal(validateValueAgainstSchema({ type: "json" }, null), false);
});
