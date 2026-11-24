import assert from "node:assert/strict";
import { test } from "vitest";

import { isPublishedWebMcpEnabled, PUBLISHED_WEBMCP_KEY, PUBLISHED_WEBMCP_NAMESPACE } from "../settings.js";
import { PUBLISHED_WEBMCP_CONFIRMATION } from "../webmcp-i18n.js";

/**
 * @file The published-site WebMCP switch: absence means the owner's ON default; only a stored
 * `true` keeps it on once a value exists, so a malformed value never grants access.
 */

type Read = Parameters<typeof isPublishedWebMcpEnabled>[0]["getEffective"];

function readerReturning(value: unknown) {
  const calls: unknown[] = [];
  const read = (async (input: unknown) => { calls.push(input); return value; }) as unknown as Read;
  return { calls, read };
}

const settingsRepo = {} as Parameters<typeof isPublishedWebMcpEnabled>[0]["settingsRepo"];

test("an absent setting is the owner's ON default", async () => {
  const { read } = readerReturning(null);
  assert.equal(await isPublishedWebMcpEnabled({ settingsRepo, getEffective: read }, { workspaceId: "ws-1" }), true);
});

test("a stored true stays on; false and malformed values are off", async () => {
  for (const [value, expected] of [[true, true], [false, false], ["true", false], [1, false], [null, false]] as const) {
    const { read } = readerReturning({ value });
    assert.equal(await isPublishedWebMcpEnabled({ settingsRepo, getEffective: read }, { workspaceId: "ws-1" }), expected, `value ${String(value)}`);
  }
});

test("reads the public-site key in its namespace, scoped to the workspace, through the given repo", async () => {
  const { calls, read } = readerReturning(null);
  await isPublishedWebMcpEnabled({ settingsRepo, getEffective: read }, { workspaceId: "ws-9" });
  assert.deepEqual(calls, [{ deps: { repo: settingsRepo }, namespace: "core.privacy", key: "published_site_webmcp_enabled", scopeContext: { workspaceId: "ws-9" } }]);
  assert.equal(PUBLISHED_WEBMCP_NAMESPACE, "core.privacy");
  assert.equal(PUBLISHED_WEBMCP_KEY, "published_site_webmcp_enabled");
});

test("the confirmation copy carries English and every supplied locale, none empty", () => {
  assert.equal(PUBLISHED_WEBMCP_CONFIRMATION.en, "Allow the browser agent to perform this action?");
  assert.equal(Object.keys(PUBLISHED_WEBMCP_CONFIRMATION).length, 22);
  for (const [locale, text] of Object.entries(PUBLISHED_WEBMCP_CONFIRMATION)) assert.ok(text.trim().length > 0, locale);
});
