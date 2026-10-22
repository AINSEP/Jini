import assert from "node:assert/strict";
import { test } from "vitest";
import { upsertEnvLine, readEnvLine } from "../env-text.js";

test("upsertEnvLine: appends a new KEY=value to an empty source", () => {
  assert.equal(upsertEnvLine({ source: "", key: "APP_SITE", value: "my-site" }), "APP_SITE=my-site\n");
});

test("upsertEnvLine: appends without disturbing existing lines (order and content untouched)", () => {
  const source = "APP_ADMIN_PASSWORD=secret123\nAPP_INTEGRATIONS_ROOT_KEY=abc\n";
  const result = upsertEnvLine({ source: source, key: "APP_SITE", value: "my-site" });
  assert.equal(result, "APP_ADMIN_PASSWORD=secret123\nAPP_INTEGRATIONS_ROOT_KEY=abc\nAPP_SITE=my-site\n");
});

test("upsertEnvLine: replaces an existing KEY=value in place, preserving every other line verbatim", () => {
  const source = "APP_ADMIN_PASSWORD=secret123\nAPP_SITE=old-site\nAPP_INTEGRATIONS_ROOT_KEY=abc\n";
  const result = upsertEnvLine({ source: source, key: "APP_SITE", value: "new-site" });
  assert.equal(result, "APP_ADMIN_PASSWORD=secret123\nAPP_SITE=new-site\nAPP_INTEGRATIONS_ROOT_KEY=abc\n");
});

test("upsertEnvLine: a source with no trailing newline still gets exactly one new line appended (no blank line inserted)", () => {
  const result = upsertEnvLine({ source: "APP_ADMIN_PASSWORD=secret123", key: "APP_SITE", value: "my-site" });
  assert.equal(result, "APP_ADMIN_PASSWORD=secret123\nAPP_SITE=my-site\n");
});

test("readEnvLine: returns null when the key is absent", () => {
  assert.equal(readEnvLine({ source: "APP_ADMIN_PASSWORD=secret123\n", key: "APP_SITE" }), null);
});

test("readEnvLine: returns the value for a present key, trimmed", () => {
  assert.equal(readEnvLine({ source: "APP_ADMIN_PASSWORD=secret123\nAPP_SITE= my-site \n", key: "APP_SITE" }), "my-site");
});

test("readEnvLine: reads back exactly what upsertEnvLine wrote (round trip)", () => {
  const written = upsertEnvLine({ source: "APP_ADMIN_PASSWORD=secret123\n", key: "APP_SITE", value: "round-trip-site" });
  assert.equal(readEnvLine({ source: written, key: "APP_SITE" }), "round-trip-site");
});

test("readEnvLine: the FIRST matching line wins — the same one upsertEnvLine would replace", () => {
  const source = "APP_SITE=first\nAPP_SITE=second\n";
  assert.equal(readEnvLine({ source: source, key: "APP_SITE" }), "first");
  assert.equal(upsertEnvLine({ source: source, key: "APP_SITE", value: "third" }), "APP_SITE=third\nAPP_SITE=second\n");
});
