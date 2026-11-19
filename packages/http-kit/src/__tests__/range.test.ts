import assert from "node:assert/strict";
import { test } from "vitest";

import { parseRangeHeader } from "../range.js";

/**
 * @file Unit tests for `range.ts`'s pure `Range: bytes=...` parser — every branch directly, without
 * an HTTP round trip. `routes/admin/media/original.ts`'s own route-level test file covers the same
 * behavior wired through real requests; this file is the fast, exhaustive edge-case sweep.
 */

const TOTAL = 20; // a stand-in resource length used across most cases below

test("parseRangeHeader: no header at all -> none", () => {
  assert.deepEqual(parseRangeHeader({ header: undefined, totalLength: TOTAL }), { kind: "none" });
  assert.deepEqual(parseRangeHeader({ header: "", totalLength: TOTAL }), { kind: "none" });
});

test("parseRangeHeader: a plain bounded range", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=0-4", totalLength: TOTAL }), { kind: "range", start: 0, end: 4 });
  assert.deepEqual(parseRangeHeader({ header: "bytes=5-9", totalLength: TOTAL }), { kind: "range", start: 5, end: 9 });
});

test("parseRangeHeader: an open-ended range ('bytes=start-') runs to the last byte", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=15-", totalLength: TOTAL }), { kind: "range", start: 15, end: 19 });
});

test("parseRangeHeader: an end past the resource length clamps to the last byte, not an error", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=15-9999", totalLength: TOTAL }), { kind: "range", start: 15, end: 19 });
});

test("parseRangeHeader: a suffix range ('bytes=-N') returns the last N bytes", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=-5", totalLength: TOTAL }), { kind: "range", start: 15, end: 19 });
});

test("parseRangeHeader: a suffix range longer than the whole resource clamps to the entire resource", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=-9999", totalLength: TOTAL }), { kind: "range", start: 0, end: 19 });
});

test("parseRangeHeader: a range covering exactly the whole resource is still a satisfiable range, not 'none'", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=0-19", totalLength: TOTAL }), { kind: "range", start: 0, end: 19 });
});

test("parseRangeHeader: a start at or past the resource length is unsatisfiable", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=20-", totalLength: TOTAL }), { kind: "unsatisfiable" });
  assert.deepEqual(parseRangeHeader({ header: "bytes=1000-2000", totalLength: TOTAL }), { kind: "unsatisfiable" });
});

test("parseRangeHeader: first-byte-pos greater than last-byte-pos is unsatisfiable", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=10-5", totalLength: TOTAL }), { kind: "unsatisfiable" });
});

test("parseRangeHeader: a zero-length suffix ('bytes=-0') is unsatisfiable, not an empty-but-valid range", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=-0", totalLength: TOTAL }), { kind: "unsatisfiable" });
});

test("parseRangeHeader: any range against a zero-length resource is unsatisfiable", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=0-0", totalLength: 0 }), { kind: "unsatisfiable" });
  assert.deepEqual(parseRangeHeader({ header: "bytes=-5", totalLength: 0 }), { kind: "unsatisfiable" });
});

test("parseRangeHeader: malformed header values are ignored (RFC 7233 §3.1 lets a server decline to honor Range), never thrown", () => {
  const malformed = [
    "bytes=",
    "bytes=-",
    "bytes=abc-def",
    "bytes=abc-",
    "bytes=-abc",
    "10-20", // missing "bytes=" unit
    "items=0-10", // wrong unit
    "bytes=0",
    "bytes=0-10-20",
    "not a range header at all",
  ];
  for (const header of malformed) {
    assert.deepEqual(parseRangeHeader({ header, totalLength: TOTAL }), { kind: "none" }, header);
  }
});

test("parseRangeHeader: a multi-range (comma-separated) request is ignored rather than partially honored or crashing", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=0-10,20-30", totalLength: TOTAL }), { kind: "none" });
  assert.deepEqual(parseRangeHeader({ header: "bytes=0-4,-5", totalLength: TOTAL }), { kind: "none" });
});

test("parseRangeHeader: absurdly large numeric bounds do not throw or overflow into a bogus range", () => {
  assert.deepEqual(parseRangeHeader({ header: "bytes=99999999999999999999999-", totalLength: TOTAL }), {
    kind: "unsatisfiable",
  });
  assert.deepEqual(parseRangeHeader({ header: "bytes=-99999999999999999999999", totalLength: TOTAL }), {
    kind: "range",
    start: 0,
    end: 19,
  });
});
