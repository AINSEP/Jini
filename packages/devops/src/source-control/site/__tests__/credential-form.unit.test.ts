import assert from "node:assert/strict";
import { test } from "vitest";

import { parseSourceControlCredentialForm } from "../credential-form.js";

/**
 * @file `credential-form.ts` — the saved-credential form a git-host plugin declares for the admin
 * Source Control page. Every malformed block is refused with its exact reason.
 */

const TOKEN = { name: "token", label: "Token", required: true, secret: true };

test("absent is none; a full block parses and tokenField defaults to 'token'", () => {
  assert.equal(parseSourceControlCredentialForm({ value: undefined, at: "c" }), undefined);
  assert.deepEqual(parseSourceControlCredentialForm({ value: { help: "h", tokenPageUrl: "https://x.test/new", fields: [TOKEN, { name: "username", label: "Username", required: true }] }, at: "c" }), {
    help: "h",
    tokenPageUrl: "https://x.test/new",
    tokenField: "token",
    fields: [TOKEN, { name: "username", label: "Username", required: true }],
  });
});

test("malformed blocks are refused with the exact reason", () => {
  const cases: ReadonlyArray<[unknown, string]> = [
    ["x", "c must be an object"],
    [{ fields: [] }, "c.fields must be a list of 1 to 10 fields"],
    [{ fields: [TOKEN], tokenPageUrl: "http://x.test" }, "c.tokenPageUrl must be an https URL"],
    [{ fields: [TOKEN], help: 3 }, "c.help must be a string of at most 500 characters"],
    [{ fields: [{ ...TOKEN, name: "Bad Name" }] }, "c.fields[0].name must be a camelCase identifier"],
    [{ fields: [{ ...TOKEN, name: "providerId" }] }, "c.fields[0].name 'providerId' is reserved"],
    [{ fields: [{ ...TOKEN, label: "" }] }, "c.fields[0].label must be a non-empty string"],
    [{ fields: [TOKEN, TOKEN] }, "c.fields[1].name 'token' is declared twice"],
    [{ fields: [{ ...TOKEN, secret: false }] }, "c.tokenField must name a declared secret field"],
    [{ fields: [TOKEN], tokenField: "missing" }, "c.tokenField must name a declared secret field"],
  ];
  for (const [value, reason] of cases) assert.equal(parseSourceControlCredentialForm({ value, at: "c" }), reason);
});

test("non-object credential fields are refused with their field location", () => {
  for (const field of [null, "token", []]) {
    assert.equal(parseSourceControlCredentialForm({ value: { fields: [field] }, at: "c" }), "c.fields[0] must be an object");
  }
});

test("non-boolean required flags are refused instead of silently becoming optional", () => {
  assert.equal(parseSourceControlCredentialForm({ value: { fields: [{ ...TOKEN, required: "true" }] }, at: "c" }),
    "c.fields[0].required must be a boolean");
});

test("non-boolean secret flags on non-token fields are refused", () => {
  assert.equal(parseSourceControlCredentialForm({ value: { fields: [TOKEN, { name: "username", label: "Username", secret: "true" }] }, at: "c" }),
    "c.fields[1].secret must be a boolean");
});

test("token page URLs must be strings of at most 500 characters", () => {
  const url = "https://x.test/".padEnd(500, "a");
  assert.deepEqual(parseSourceControlCredentialForm({ value: { fields: [TOKEN], tokenPageUrl: url }, at: "c" }), {
    tokenPageUrl: url, tokenField: "token", fields: [TOKEN],
  });
  for (const tokenPageUrl of [url + "a", new URL("https://x.test/new")]) {
    assert.equal(parseSourceControlCredentialForm({ value: { fields: [TOKEN], tokenPageUrl }, at: "c" }),
      "c.tokenPageUrl must be an https URL");
  }
});


test("a custom tokenField selects the declared alternate secret with all field flags preserved", () => {
  assert.deepEqual(parseSourceControlCredentialForm({ value: {
    help: "Use an access token", tokenPageUrl: "https://git.test/tokens", tokenField: "accessToken",
    fields: [{ name: "accessToken", label: "Access token", required: true, secret: true }, { name: "username", label: "Username", required: false, secret: false }],
  }, at: "c" }), {
    help: "Use an access token", tokenPageUrl: "https://git.test/tokens", tokenField: "accessToken",
    fields: [{ name: "accessToken", label: "Access token", required: true, secret: true }, { name: "username", label: "Username", required: false }],
  });
});

test("L146 validation preserves bounds, optional flags and first-error ordering", () => {
  const cases: ReadonlyArray<[unknown, string]> = [
    [null, "c must be an object"],
    [[], "c must be an object"],
    [{ help: "h".repeat(501), fields: [] }, "c.help must be a string of at most 500 characters"],
    [{ tokenPageUrl: "invalid", fields: [] }, "c.tokenPageUrl must be an https URL"],
    [{ fields: undefined }, "c.fields must be a list of 1 to 10 fields"],
    [{ fields: Array.from({ length: 11 }, () => TOKEN) }, "c.fields must be a list of 1 to 10 fields"],
    [{ fields: [{ ...TOKEN, name: 2 }] }, "c.fields[0].name must be a camelCase identifier"],
    [{ fields: [{ ...TOKEN, label: 2 }] }, "c.fields[0].label must be a non-empty string"],
    [{ fields: [{ ...TOKEN, label: "  " }] }, "c.fields[0].label must be a non-empty string"],
    [{ fields: [{ ...TOKEN, label: "a".repeat(101) }] }, "c.fields[0].label must be a non-empty string"],
    [{ fields: [{ ...TOKEN, required: null, secret: null }] }, "c.fields[0].required must be a boolean"],
    [{ fields: [{ ...TOKEN, secret: null }] }, "c.fields[0].secret must be a boolean"],
    [{ fields: [TOKEN], tokenField: null }, "c.tokenField must name a declared secret field"],
  ];
  for (const [value, reason] of cases) assert.equal(parseSourceControlCredentialForm({ value, at: "c" }), reason);
  assert.deepEqual(parseSourceControlCredentialForm({ value: { help: "h".repeat(500), fields: [TOKEN,
    { name: "username", label: " User ".padEnd(100, " ") },
  ] }, at: "c" }), { help: "h".repeat(500), tokenField: "token", fields: [TOKEN,
    { name: "username", label: " User ".padEnd(100, " "), required: false },
  ] });
});
