import assert from "node:assert/strict";
import { test } from "vitest";

import { isAllowedHref, toAllowedHref } from "../href.js";

/**
 * @file The single href standard: `isAllowedHref` decides, `toAllowedHref` coerces. The table is the
 * union of the inputs a host's two former `safeHref` copies were characterized over, with the answer
 * the one standard gives. Each row is [input, output of `toAllowedHref`]: the trimmed input when allowed,
 * `"#"` when refused.
 */
const TABLE: readonly (readonly [string, string])[] = [
  ["", "#"], [" ", "#"], ["#", "#"], ["#x", "#x"], [" #x ", "#x"], [" #x", "#x"], ["#\u0000", "#\u0000"],
  ["/", "/"], ["/a", "/a"], ["/a?b#c", "/a?b#c"], [" /a ", "/a"], ["/%2f/evil", "/%2f/evil"], ["/a b", "/a b"], ["/\u0000a", "/\u0000a"],
  ["http://a", "http://a"], ["HTTPS://a", "HTTPS://a"], [" https://a ", "https://a"],
  ["mailto:a@b", "mailto:a@b"], ["MAILTO:a", "MAILTO:a"], ["mailto:", "mailto:"],
  ["//evil.example", "#"], ["/\\evil.example", "#"], ["/\t/evil.example", "#"], ["/\n/evil.example", "#"], ["/\r/evil.example", "#"],
  ["///evil", "#"], ["/\\/evil", "#"], ["/\\\\evil", "#"], ["\\\\evil", "#"],
  ["javascript:alert(1)", "#"], ["java\tscript:alert(1)", "#"], [" javascript:x", "#"], ["data:text/html,x", "#"],
  ["file:///etc/passwd", "#"], ["blob:x", "#"], ["about:blank", "#"], ["tel:1", "#"], ["ftp://x", "#"],
  ["http:evil", "#"], ["https:", "#"], ["x", "#"], ["a/b", "#"], ["./a", "#"], ["../a", "#"], ["?q", "#"], ["\u0000/a", "#"],
  // A protocol-relative href is off-origin whatever its host, including the validator's own placeholder
  // hosts and the two spellings of a default port.
  ["//safehref.invalid/x", "#"], ["/\\safehref.invalid/x", "#"], ["//safehref.invalid:80/x", "#"],
  ["//safehref.invalid:8080/x", "#"], ["//tovu-safehref.invalid/x", "#"], ["/\\tovu-safehref.invalid/x", "#"],
  ["//tovu-safehref.invalid:443/x", "#"], ["//tovu-safehref.invalid:80/x", "#"], ["//other-host.example:80/x", "#"],
];

const NON_STRINGS: readonly unknown[] = [undefined, null, 5, true, {}, [], () => "/a"];

function isExpectedAllowed({ input, output }: { input: string; output: string }): boolean {
  return output !== "#" || input.trim().startsWith("#");
}

test("the href table has no duplicate inputs and keeps the 52 characterized ones", () => {
  const distinct = new Set(TABLE.map(([input]) => input)).size;
  assert.equal(distinct, TABLE.length);
  assert.ok(distinct >= 52, `expected at least 52 inputs, got ${distinct}`);
});

test("isAllowedHref: exact decision for every table input", () => {
  for (const [input, output] of TABLE) {
    assert.equal(isAllowedHref({ rawHref: input }), isExpectedAllowed({ input, output }), JSON.stringify(input));
  }
});

test("isAllowedHref refuses a protocol-relative href to its own former placeholder host and to any host", () => {
  for (const rawHref of ["//safehref.invalid/x", "/\\safehref.invalid/x", "//safehref.invalid:80/x", "//other-host.example/x"]) {
    assert.equal(isAllowedHref({ rawHref }), false, rawHref);
  }
});

test("isAllowedHref still admits an ordinary origin-relative path", () => {
  assert.equal(isAllowedHref({ rawHref: "/path" }), true);
});

test("isAllowedHref returns false, never throws, for a non-string", () => {
  for (const rawHref of NON_STRINGS) assert.equal(isAllowedHref({ rawHref }), false, String(rawHref));
});

test("toAllowedHref: trimmed href when allowed, '#' when refused, for every table input", () => {
  for (const [input, output] of TABLE) assert.equal(toAllowedHref({ rawHref: input }), output, JSON.stringify(input));
});

test("toAllowedHref returns '#' for a non-string", () => {
  for (const rawHref of NON_STRINGS) assert.equal(toAllowedHref({ rawHref }), "#", String(rawHref));
});
