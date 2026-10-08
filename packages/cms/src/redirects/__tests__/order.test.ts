/**
 * @file Coverage for `order.ts`, the rule orderings both redirect repo adapters share. Each
 * comparator arm is pinned with plain records, in both argument orders, so a sort that hands the
 * comparator either side gets the same answer.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { compareLongestFirst, compareSamePatternExactFirst, compareTieBreak } from "../order.js";
import type { RedirectRecord } from "../types.js";

function rule(overrides: Partial<RedirectRecord>): RedirectRecord {
  return {
    id: "r-1",
    workspaceId: "ws-1",
    matchType: "exact",
    fromPattern: "/old",
    toTarget: "/new",
    statusCode: 301,
    status: "active",
    override: false,
    priority: 0,
    source: "manual",
    createdByPrincipal: "user-1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("compareTieBreak: higher priority sorts first, by the priority difference", () => {
  const high = rule({ id: "b", priority: 5 });
  const low = rule({ id: "a", priority: 2 });
  assert.equal(compareTieBreak({ a: high, b: low }, {}), -3);
  assert.equal(compareTieBreak({ a: low, b: high }, {}), 3);
});

test("compareTieBreak: at equal priority the more recent updatedAt sorts first", () => {
  const newer = rule({ id: "b", updatedAt: "2026-07-03T00:00:00.000Z" });
  const older = rule({ id: "a", updatedAt: "2026-07-02T00:00:00.000Z" });
  assert.equal(compareTieBreak({ a: newer, b: older }, {}), -1);
  assert.equal(compareTieBreak({ a: older, b: newer }, {}), 1);
});

test("compareTieBreak: an empty updatedAt falls back to createdAt for recency", () => {
  const createdLate = rule({ id: "b", updatedAt: "", createdAt: "2026-07-05T00:00:00.000Z" });
  const updatedEarlier = rule({ id: "a", updatedAt: "2026-07-04T00:00:00.000Z" });
  assert.equal(compareTieBreak({ a: createdLate, b: updatedEarlier }, {}), -1);
  assert.equal(compareTieBreak({ a: updatedEarlier, b: createdLate }, {}), 1);
  const sameCreated = rule({ id: "c", updatedAt: "", createdAt: "2026-07-05T00:00:00.000Z" });
  assert.equal(compareTieBreak({ a: createdLate, b: sameCreated }, {}), -1, "equal fallback recency drops to the id tie-break");
});

test("compareTieBreak: at equal priority and recency the lower id sorts first, and a rule equals itself", () => {
  const a = rule({ id: "a" });
  const b = rule({ id: "b" });
  assert.equal(compareTieBreak({ a: a, b: b }, {}), -1);
  assert.equal(compareTieBreak({ a: b, b: a }, {}), 1);
  assert.equal(compareTieBreak({ a: a, b: rule({ id: "a" }) }, {}), 0);
});

test("compareLongestFirst: the longer pattern wins before any tie-break; equal lengths use the tie-break", () => {
  const long = rule({ id: "z", fromPattern: "/docs/guides", priority: 0 });
  const short = rule({ id: "a", fromPattern: "/docs", priority: 9 });
  assert.equal(compareLongestFirst({ a: long, b: short }, {}), -7);
  assert.equal(compareLongestFirst({ a: short, b: long }, {}), 7);
  const sameLengthHigh = rule({ id: "b", fromPattern: "/blog", priority: 4 });
  const sameLengthLow = rule({ id: "a", fromPattern: "/news", priority: 1 });
  assert.equal(compareLongestFirst({ a: sameLengthHigh, b: sameLengthLow }, {}), -3);
});

test("compareSamePatternExactFirst: an exact rule sorts before a non-exact one, then lower id first", () => {
  const exact = rule({ id: "z", matchType: "exact" });
  const prefix = rule({ id: "a", matchType: "prefix" });
  assert.equal(compareSamePatternExactFirst({ a: exact, b: prefix }, {}), -1);
  assert.equal(compareSamePatternExactFirst({ a: prefix, b: exact }, {}), 1);
  const prefixB = rule({ id: "b", matchType: "prefix" });
  assert.equal(compareSamePatternExactFirst({ a: prefix, b: prefixB }, {}), -1);
  assert.equal(compareSamePatternExactFirst({ a: prefixB, b: prefix }, {}), 1);
  assert.deepEqual([prefixB, exact, prefix].sort((a, b) => compareSamePatternExactFirst({ a, b }, {})).map((r) => r.id), ["z", "a", "b"]);
});
