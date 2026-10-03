import assert from "node:assert/strict";
import { test } from "vitest";
import { detectSelfDescribingAuthScheme as detect, parseCredentialSchemesFile as parse, type CredentialSchemeRule } from "../auth-schemes.js";
const loadBundledAuthSchemes = async () => [{ id: "custom", prefix: "CustomV1", scheme: "CustomV1" }];
const detectSelfDescribingAuthScheme = (token: string, rules: readonly CredentialSchemeRule[]) => detect({ token, rules });
const parseCredentialSchemesFile = (raw: string) => parse({ raw });
test("detect: a token starting with CustomV1 splits into scheme 'CustomV1' and everything after it as the value", async () => {
  assert.deepEqual(detectSelfDescribingAuthScheme("CustomV1fake_test_token_value", await loadBundledAuthSchemes()), { scheme: "CustomV1", value: "fake_test_token_value" });
});

test("detect: a token that IS exactly 'CustomV1', with nothing following it, does not match — there is no credential value left to send", async () => {
  assert.equal(detectSelfDescribingAuthScheme("CustomV1", await loadBundledAuthSchemes()), null);
});

test("detect: a token that merely CONTAINS 'CustomV1' later in the string, not as a leading prefix, does not match", async () => {
  assert.equal(detectSelfDescribingAuthScheme("opaque_CustomV1_in_the_middle", await loadBundledAuthSchemes()), null);
});

test("detect: an ordinary opaque token does not match — the overwhelming majority of tokens", async () => {
  assert.equal(detectSelfDescribingAuthScheme("opaque-secret-token", await loadBundledAuthSchemes()), null);
});

test("detect: the match is case-sensitive — a lowercase 'customv1' prefix does not match", async () => {
  assert.equal(detectSelfDescribingAuthScheme("customv1fake_test_token_value", await loadBundledAuthSchemes()), null);
});

test("detect: with no rules loaded, nothing matches", () => {
  assert.equal(detectSelfDescribingAuthScheme("CustomV1fake_test_token_value", []), null);
});

test("detect: first matching rule wins, in declared order", () => {
  const rules: CredentialSchemeRule[] = [
    { id: "long", prefix: "AbcDef", scheme: "Long" },
    { id: "short", prefix: "Abc", scheme: "Short" },
  ];
  assert.deepEqual(detectSelfDescribingAuthScheme("AbcDef_rest", rules), { scheme: "Long", value: "_rest" });
  assert.deepEqual(detectSelfDescribingAuthScheme("Abc_rest", rules), { scheme: "Short", value: "_rest" });
});

test("detect: the scheme sent may differ from the prefix matched", () => {
  assert.deepEqual(detectSelfDescribingAuthScheme("pfx_value", [{ id: "x", prefix: "pfx_", scheme: "Custom" }]), { scheme: "Custom", value: "value" });
});

test("parse: accepts a valid file and ignores unknown keys such as note", () => {
  const parsed = parseCredentialSchemesFile(JSON.stringify({ schemaVersion: 1, schemes: [{ id: "a-b", prefix: "Pfx", scheme: "Pfx", note: "evidence" }] }));
  assert.deepEqual(parsed, { ok: true, rules: [{ id: "a-b", prefix: "Pfx", scheme: "Pfx" }] });
});

test("parse: rejects each malformed shape with its exact reason", () => {
  const cases: [string, string][] = [
    ["{", "not valid JSON"],
    [JSON.stringify({ schemaVersion: 2, schemes: [] }), "schemaVersion must be 1"],
    [JSON.stringify({ schemaVersion: 1 }), "schemes must be an array of at most 32 rules"],
    [JSON.stringify({ schemaVersion: 1, schemes: ["x"] }), "schemes[0] must be an object"],
    [JSON.stringify({ schemaVersion: 1, schemes: [{ id: "Bad Id", prefix: "P", scheme: "P" }] }), "schemes[0].id must be a lowercase hyphenated id"],
    [JSON.stringify({ schemaVersion: 1, schemes: [{ id: "a", prefix: "", scheme: "P" }] }), "schemes[0].prefix must be a non-empty run of HTTP token characters"],
    [JSON.stringify({ schemaVersion: 1, schemes: [{ id: "a", prefix: "P x", scheme: "P" }] }), "schemes[0].prefix must be a non-empty run of HTTP token characters"],
    [JSON.stringify({ schemaVersion: 1, schemes: [{ id: "a", prefix: "P", scheme: "Bad Scheme" }] }), "schemes[0].scheme must be an HTTP auth-scheme name"],
    [JSON.stringify({ schemaVersion: 1, schemes: [{ id: "a", prefix: "P", scheme: "P" }, { id: "a", prefix: "Q", scheme: "Q" }] }), "schemes[1].id 'a' is declared twice"],
  ];
  for (const [raw, reason] of cases) assert.deepEqual(parseCredentialSchemesFile(raw), { ok: false, reason }, raw);
});

