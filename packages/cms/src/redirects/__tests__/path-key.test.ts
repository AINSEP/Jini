import assert from "node:assert/strict";
import { test } from "vitest";

import { match } from "../matcher.js";
import { redirectPathKey } from "../path-key.js";
import type { RedirectRecord } from "../types.js";

/**
 * @file Bug A (2026-10-22) — multi-segment exact sources (WordPress date permalinks such as
 * `/2022/06/13/craving/`) must match whether the rule or the request carries the trailing slash,
 * and whether either side percent-encodes an unreserved/UTF-8 character.
 */

function exact(fromPattern: string): RedirectRecord {
  return {
    id: "r-1", workspaceId: "w", matchType: "exact", fromPattern, toTarget: "/new", statusCode: 301,
    status: "active", override: false, priority: 0, source: "import", createdByPrincipal: "u",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1,
  };
}

const SEGMENTS = ["2022", "06", "13", "craving", "part"];

for (let depth = 1; depth <= 5; depth += 1) {
  const bare = `/${SEGMENTS.slice(0, depth).join("/")}`;
  for (const [rulePath, requestPath] of [[bare, bare], [bare, `${bare}/`], [`${bare}/`, bare], [`${bare}/`, `${bare}/`]] as const) {
    test(`exact rule ${rulePath} matches request ${requestPath} (depth ${depth})`, () => {
      const result = match({ request: { workspaceId: "w", path: requestPath, phase: "post_content" }, rules: [exact(rulePath)] }, {});
      assert.deepEqual(result, { matched: true, redirectId: "r-1", location: "/new", statusCode: 301, matchType: "exact" });
    });
  }
  test(`exact rule ${bare} does not match a deeper or shallower path (depth ${depth})`, () => {
    for (const other of [`${bare}/extra`, `${bare}x`, `/${SEGMENTS.slice(0, depth - 1).join("/")}`]) {
      const result = match({ request: { workspaceId: "w", path: other, phase: "post_content" }, rules: [exact(bare)] }, {});
      assert.deepEqual(result, { matched: false }, other);
    }
  });
}

test("percent-encoding is normalised on both sides", () => {
  const request = { workspaceId: "w", path: "/2022/06/caf%C3%A9/", phase: "post_content" } as const;
  assert.equal(match({ request, rules: [exact("/2022/06/café")] }, {}).matched, true);
  assert.equal(match({ request: { ...request, path: "/2022/06/café" }, rules: [exact("/2022/06/caf%c3%a9/")] }, {}).matched, true);
  assert.equal(match({ request: { ...request, path: "/a%2Db" }, rules: [exact("/a-b")] }, {}).matched, true);
});

test("redirectPathKey keeps an encoded slash distinct from a separator and tolerates malformed escapes", () => {
  assert.notEqual(redirectPathKey({ path: "/a%2Fb" }, {}), redirectPathKey({ path: "/a/b" }, {}));
  assert.equal(redirectPathKey({ path: "/a%2fb" }, {}), redirectPathKey({ path: "/a%2Fb" }, {}));
  assert.equal(redirectPathKey({ path: "/bad%zz/" }, {}), "/bad%zz");
  assert.equal(redirectPathKey({ path: "/" }, {}), "/");
  assert.equal(redirectPathKey({ path: "/a//" }, {}), "/a");
  assert.equal(redirectPathKey({ path: "/A/B" }, {}), "/A/B");
});
