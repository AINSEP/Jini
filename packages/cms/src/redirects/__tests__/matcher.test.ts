import assert from "node:assert/strict";
import { test } from "vitest";

import { match, validatePattern } from "../matcher.js";
import type { RedirectRecord, RedirectRequest } from "../types.js";

/**
 * @file T009 — `matcher.ts`: precedence (behavior.spec.md §1.1), tie-break
 * (§2.1/§6.1), dynamic-set ordering discipline (§2.2), Limits-table boundary
 * for `fromPattern` (§4/§7 — `priority`'s boundary is certified in
 * `redirects.test.ts` instead, since `validatePattern`'s frozen `ports.ts`
 * signature is `{ matchType, fromPattern }` only, no `priority` — a
 * deliberate, documented deviation from a literal file-assignment reading),
 * and EC-04 (prefix matched at exactly its `fromPattern`, no tail).
 */

let seq = 0;
function rule(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  seq += 1;
  return {
    id: `rule-${String(seq).padStart(3, "0")}`,
    workspaceId: "workspace-1",
    matchType: "exact",
    fromPattern: "/a",
    toTarget: "/z",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function req(path: string): RedirectRequest {
  return { workspaceId: "workspace-1", path, phase: "post_content" };
}

// ---------------------------------------------------------------------------
// validatePattern
// ---------------------------------------------------------------------------

test("validatePattern always rejects matchType 'regex' (REQ-22/INV-05)", () => {
  const result = validatePattern({ matchType: "regex", fromPattern: "/a" });
  assert.equal(result.ok, false);
});

test("validatePattern accepts a well-formed exact pattern", () => {
  assert.deepEqual(validatePattern({ matchType: "exact", fromPattern: "/a/b" }), { ok: true });
});

test("validatePattern accepts fromPattern at exactly 2048 characters", () => {
  const fromPattern = "/" + "a".repeat(2047);
  assert.equal(fromPattern.length, 2048);
  assert.deepEqual(validatePattern({ matchType: "exact", fromPattern }), { ok: true });
});

test("validatePattern rejects fromPattern at 2049 characters", () => {
  const fromPattern = "/" + "a".repeat(2048);
  assert.equal(fromPattern.length, 2049);
  const result = validatePattern({ matchType: "exact", fromPattern });
  assert.equal(result.ok, false);
});

test("validatePattern rejects an empty fromPattern", () => {
  const result = validatePattern({ matchType: "exact", fromPattern: "" });
  assert.equal(result.ok, false);
});

test("validatePattern requires a leading slash", () => {
  const result = validatePattern({ matchType: "exact", fromPattern: "no-leading-slash" });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// match — precedence (behavior.spec.md §1.1)
// ---------------------------------------------------------------------------

test("exact beats prefix and wildcard for the same path", () => {
  const rules = [
    rule({ id: "prefix-1", matchType: "prefix", fromPattern: "/a", toTarget: "/prefix-target" }),
    rule({ id: "wildcard-1", matchType: "wildcard", fromPattern: "/a/*", toTarget: "/wc/$1" }),
    rule({ id: "exact-1", matchType: "exact", fromPattern: "/a/b", toTarget: "/exact-target" }),
  ];
  const result = match({ request: req("/a/b"), rules });
  assert.deepEqual(result, {
    matched: true,
    redirectId: "exact-1",
    location: "/exact-target",
    statusCode: 301,
    matchType: "exact",
  });
});

test("prefix beats wildcard when exact misses", () => {
  const rules = [
    rule({ id: "wildcard-1", matchType: "wildcard", fromPattern: "/a/*", toTarget: "/wc/$1" }),
    rule({ id: "prefix-1", matchType: "prefix", fromPattern: "/a", toTarget: "/prefix-target" }),
  ];
  const result = match({ request: req("/a/b"), rules });
  assert.equal(result.matched, true);
  if (result.matched) {
    assert.equal(result.redirectId, "prefix-1");
    assert.equal(result.matchType, "prefix");
  }
});

test("wildcard matches only when exact and prefix both miss", () => {
  const rules = [rule({ id: "wildcard-1", matchType: "wildcard", fromPattern: "/a/*", toTarget: "/wc/$1" })];
  const result = match({ request: req("/a/b"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.matchType, "wildcard");
});

test("among overlapping wildcard rules, the more specific fromPattern wins", () => {
  const rules = [
    rule({ id: "broad", matchType: "wildcard", fromPattern: "/blog/*", toTarget: "/broad/$1", priority: 10 }),
    rule({ id: "specific", matchType: "wildcard", fromPattern: "/blog/hello-*", toTarget: "/specific/$1", priority: 0 }),
  ];
  assert.deepEqual(match({ request: req("/blog/hello-world"), rules }), {
    matched: true,
    redirectId: "specific",
    location: "/specific/world",
    statusCode: 301,
    matchType: "wildcard",
  });
});

test("among two prefix rules, the longer fromPattern wins", () => {
  const rules = [
    rule({ id: "short", matchType: "prefix", fromPattern: "/a", toTarget: "/short-target" }),
    rule({ id: "long", matchType: "prefix", fromPattern: "/a/b", toTarget: "/long-target" }),
  ];
  const result = match({ request: req("/a/b/c"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.redirectId, "long");
});

test("no rule matches falls through to matched:false", () => {
  const rules = [rule({ matchType: "exact", fromPattern: "/other" })];
  const result = match({ request: req("/a/b"), rules });
  assert.deepEqual(result, { matched: false });
});

// ---------------------------------------------------------------------------
// match — tie-break chain (behavior.spec.md §2.1/§6.1)
// ---------------------------------------------------------------------------

test("tie-break: higher priority wins within the same match-type band", () => {
  const rules = [
    rule({ id: "low", matchType: "exact", fromPattern: "/a", priority: 1 }),
    rule({ id: "high", matchType: "exact", fromPattern: "/a", priority: 5 }),
  ];
  const result = match({ request: req("/a"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.redirectId, "high");
});

test("tie-break: equal priority falls back to more recent updatedAt", () => {
  const rules = [
    rule({ id: "older", matchType: "exact", fromPattern: "/a", priority: 1, updatedAt: "2026-01-01T00:00:00.000Z" }),
    rule({ id: "newer", matchType: "exact", fromPattern: "/a", priority: 1, updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = match({ request: req("/a"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.redirectId, "newer");
});

test("tie-break: equal priority and identical updatedAt falls back to lexicographically smaller id (EC-02)", () => {
  const rules = [
    rule({ id: "bbb", matchType: "exact", fromPattern: "/a", priority: 1, updatedAt: "2026-01-01T00:00:00.000Z" }),
    rule({ id: "aaa", matchType: "exact", fromPattern: "/a", priority: 1, updatedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const result = match({ request: req("/a"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.redirectId, "aaa");
});

// ---------------------------------------------------------------------------
// match — wildcard capture interpolation
// ---------------------------------------------------------------------------

test("wildcard interpolates a single capture into the target", () => {
  const rules = [rule({ id: "wc", matchType: "wildcard", fromPattern: "/blog/*", toTarget: "/articles/$1" })];
  const result = match({ request: req("/blog/hello-world"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.location, "/articles/hello-world");
});

test("a single-segment wildcard rejects nested paths and empty captures", () => {
  const rules = [rule({ id: "wc", matchType: "wildcard", fromPattern: "/blog/*", toTarget: "/articles/$1" })];
  for (const path of ["/blog/hello-world/extra", "/blog/", "/blog"]) {
    assert.deepEqual(match({ request: req(path), rules }), { matched: false }, path);
  }
});

test("wildcard interpolates multiple captures in order", () => {
  const rules = [
    rule({ id: "wc", matchType: "wildcard", fromPattern: "/cat/*/item/*", toTarget: "/products/$1/$2" }),
  ];
  const result = match({ request: req("/cat/shoes/item/42"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.location, "/products/shoes/42");
});

// ---------------------------------------------------------------------------
// EC-04 — prefix rule matched at exactly its fromPattern, no tail
// ---------------------------------------------------------------------------

test("EC-04: a prefix rule requested at exactly its fromPattern uses toTarget verbatim, no tail appended", () => {
  const rules = [rule({ id: "prefix", matchType: "prefix", fromPattern: "/old", toTarget: "/new" })];
  const result = match({ request: req("/old"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.location, "/new");
});

test("a prefix rule requested with a trailing segment appends the tail", () => {
  const rules = [rule({ id: "prefix", matchType: "prefix", fromPattern: "/old", toTarget: "/new" })];
  const result = match({ request: req("/old/sub/page"), rules });
  assert.equal(result.matched, true);
  if (result.matched) assert.equal(result.location, "/new/sub/page");
});

test("a prefix rule does not match a sibling path that merely shares a string prefix", () => {
  const rules = [rule({ id: "prefix", matchType: "prefix", fromPattern: "/old", toTarget: "/new" })];
  const result = match({ request: req("/oldish"), rules });
  assert.deepEqual(result, { matched: false });
});

for (const statusCode of [302, 307, 308] as const) {
  test(`match preserves the selected rule's ${statusCode} status code`, () => {
    const selected = rule({ id: `status-${statusCode}`, matchType: "exact", fromPattern: "/temporary", toTarget: "/destination", statusCode });
    assert.deepEqual(match({ request: req("/temporary"), rules: [selected] }), {
      matched: true,
      redirectId: selected.id,
      location: "/destination",
      statusCode,
      matchType: "exact",
    });
  });
}
