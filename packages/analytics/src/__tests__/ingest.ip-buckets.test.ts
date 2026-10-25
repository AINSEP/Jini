/**
 * @file The exact coarse IP bucket `normalizeIngestContext` hashes, read through an injected hash port
 * (the bucket is the privacy guarantee: a /24 for IPv4, the first 3 expanded groups for IPv6). One row
 * per shape: `::` at the start/middle/end, full 8 groups, bracketed, IPv4-mapped (any case), junk
 * around a mapped form, and non-addresses. Closes L10 survivors at ingest.ts:235-248, 291.
 */
import { describe, expect, test } from "vitest";
import { normalizeIngestContext } from "../ingest.js";

function bucketOf(ip: string): string {
  let signal = "";
  normalizeIngestContext({ input: { ip, userAgent: "", siteHost: "site.example" }, dailySalt: Buffer.alloc(32) }, {
    hash: { sha256: ({ parts }) => { signal = String(parts[2]); return "h"; }, deriveDailySalt: () => Buffer.alloc(32) },
  });
  return signal.split("|")[0]!;
}

describe("coarse IP bucket", () => {
  test.each([
    ["203.0.113.77", "203.0.113.0"], ["[203.0.113.77]", "203.0.113.0"], ["1.2.3", "unknown"], ["", "unknown"],
    ["::ffff:192.168.1.9", "192.168.1.0"], ["::FFFF:10.0.0.1", "10.0.0.0"], ["[::ffff:10.0.0.1]", "10.0.0.0"],
    ["::ffff:1.2.3.4x", "0:0:0::"], ["x::ffff:1.2.3.4", "x:0:0::"], ["::ffff:1234.2.3.4", "0:0:0::"],
    ["::1", "0:0:0::"], ["::", "0:0:0::"], ["[::1]", "0:0:0::"], ["a::b", "a:0:0::"], ["2001:db8::", "2001:db8:0::"], ["2001:db8::1", "2001:db8:0::"],
    ["2001:db8:0:0:0:0:0:1", "2001:db8:0::"], ["1:2:3:4:5:6:7:8", "1:2:3::"], ["1:2:3:4:5:6:7::", "1:2:3::"], ["1:2::3:4:5:6:7:8", "1:2:3::"],
    ["[::1", "[:0:0::"], [":1:2:3:4:5:6:7", "1:2:3::"], ["1:2:3:4:5:6:7:", "1:2:3::"], ["1:::2", "1:0:0::"], ["::1:", "0:0:0::"],
  ])("%j -> %j", (ip, bucket) => {
    expect(bucketOf(ip)).toBe(bucket);
  });

  test("a shorthand address and its expanded form share a bucket; a different /48 does not", () => {
    expect(bucketOf("2001:db8::1")).toBe(bucketOf("2001:db8:0:ffff::"));
    expect(bucketOf("2001:db8:1::")).not.toBe(bucketOf("2001:db8::1"));
  });
});
