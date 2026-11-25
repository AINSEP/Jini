import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

/**
 * @file Source pin for `session.ts`'s MAC comparison, relocated from the host's trust-key pin suite
 * together with the codec it reads.
 */

/**
 * T-D4c. Constant time cannot be proven by a result test: a plain string compare returns the same
 * answers. So this guard reads the source. It fails unless the MAC comparison is `timingSafeEqual`
 * over two buffers whose lengths were compared first, and it fails if any line of the file compares
 * a MAC with `===` or `!==`.
 */
test("T-D4c: the session MAC is compared with timingSafeEqual on equal-length buffers, never with ===", () => {
  const source = readFileSync(fileURLToPath(new URL("../session.ts", import.meta.url)), "utf8");
  const start = source.indexOf("function macMatches(");
  assert.notEqual(start, -1, "session.ts must define macMatches");
  const body = source.slice(start, source.indexOf("\n}\n", start));

  assert.match(body, /return presented\.length === expected\.length && timingSafeEqual\(presented, expected\);/);
  assert.match(body, /const presented = Buffer\.from\(presentedMac, "base64url"\);/);
  assert.match(body, /const expected = Buffer\.from\(expectedMac, "base64url"\);/);

  const macIdentifier = String.raw`\b\w*[mM]ac\w*\b`;
  const plainCompare = new RegExp(`${macIdentifier}\\s*[!=]==?|[!=]==?\\s*${macIdentifier}`);
  const offending = source.split("\n").filter((line) => !line.trimStart().startsWith("*") && plainCompare.test(line));
  assert.deepEqual(offending, []);
  assert.equal(source.split("macMatches(").length - 1, 2, "macMatches has one definition and one call site");
});
