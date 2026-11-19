import { describe, expect, it } from "vitest";

import {
  decideLocalSiteKeyEnsure,
  matchesFingerprint,
  planSiteKeyEnsure,
  verdictOf,
  verdictOfCheck,
  type LocalSiteKeyDecision,
  type SiteKeyMaterialCheck,
  type SiteKeyVerdict,
} from "../decide.js";

const rows = [
  { perSite: "valid", other: "valid", withoutData: "noop", withData: "noop" },
  { perSite: "valid", other: "invalid", withoutData: "noop", withData: "noop" },
  { perSite: "valid", other: "absent", withoutData: "noop", withData: "noop" },
  { perSite: "invalid", other: "valid", withoutData: "invalid", withData: "invalid" },
  { perSite: "invalid", other: "invalid", withoutData: "invalid", withData: "invalid" },
  { perSite: "invalid", other: "absent", withoutData: "invalid", withData: "invalid" },
  { perSite: "absent", other: "valid", withoutData: "adopt", withData: "adopt" },
  { perSite: "absent", other: "invalid", withoutData: "invalid", withData: "invalid" },
  { perSite: "absent", other: "absent", withoutData: "mint", withData: "refuse" },
] as const;

const tableCases = rows.flatMap((row) => [
  { perSite: row.perSite, other: row.other, siteDbsWithKeyData: false, action: row.withoutData },
  { perSite: row.perSite, other: row.other, siteDbsWithKeyData: true, action: row.withData },
]);

describe("planSiteKeyEnsure", () => {
  it.each(tableCases)(
    "local $perSite / $other, key data $siteDbsWithKeyData -> $action",
    ({ perSite, other, siteDbsWithKeyData, action }) => {
      expect(planSiteKeyEnsure({ mode: "local", perSite: { kind: perSite }, other: { kind: other }, siteDbsWithKeyData }))
        .toStrictEqual({ action });
    },
  );

  it.each(tableCases)(
    "production ignores $perSite / $other and key data $siteDbsWithKeyData",
    ({ perSite, other, siteDbsWithKeyData }) => {
      expect(planSiteKeyEnsure({ mode: "production", perSite: { kind: perSite }, other: { kind: other }, siteDbsWithKeyData }))
        .toStrictEqual({ action: "production-noop" });
    },
  );
});

const perSiteValue = { hex: "per-site-payload" };
const otherValue = { hex: "other-payload" };
const perSiteRejection = { reason: "per-site-rejection" };
const otherRejection = { reason: "other-rejection" };
type PayloadVerdict = SiteKeyVerdict<typeof perSiteValue, typeof perSiteRejection>;
type PayloadDecision = LocalSiteKeyDecision<typeof perSiteValue, typeof perSiteRejection>;

const payloadCases: readonly {
  name: string;
  perSite: PayloadVerdict;
  other: PayloadVerdict;
  siteDbsWithKeyData: boolean;
  expected: PayloadDecision;
}[] = [
  {
    name: "valid per-site material wins over another valid source",
    perSite: { kind: "valid", value: perSiteValue }, other: { kind: "valid", value: otherValue },
    siteDbsWithKeyData: true, expected: { action: "noop", value: perSiteValue },
  },
  {
    name: "invalid per-site material wins over another rejection",
    perSite: { kind: "invalid", value: perSiteRejection }, other: { kind: "invalid", value: otherRejection },
    siteDbsWithKeyData: true, expected: { action: "invalid", value: perSiteRejection },
  },
  {
    name: "absent per-site material adopts the other value even with key data",
    perSite: { kind: "absent" }, other: { kind: "valid", value: otherValue },
    siteDbsWithKeyData: true, expected: { action: "adopt", value: otherValue },
  },
  {
    name: "absent per-site material preserves the other rejection",
    perSite: { kind: "absent" }, other: { kind: "invalid", value: otherRejection },
    siteDbsWithKeyData: false, expected: { action: "invalid", value: otherRejection },
  },
  {
    name: "missing material with key data refuses without a value",
    perSite: { kind: "absent" }, other: { kind: "absent" },
    siteDbsWithKeyData: true, expected: { action: "refuse" },
  },
  {
    name: "missing material without key data mints without a value",
    perSite: { kind: "absent" }, other: { kind: "absent" },
    siteDbsWithKeyData: false, expected: { action: "mint" },
  },
];

it.each(payloadCases)("decideLocalSiteKeyEnsure: $name", ({ perSite, other, siteDbsWithKeyData, expected }) => {
  expect(decideLocalSiteKeyEnsure({ perSite, other, siteDbsWithKeyData })).toStrictEqual(expected);
});

describe("verdictOfCheck", () => {
  it.each([
    { kind: "absent", expected: { kind: "absent" } },
    { kind: "valid", expected: { kind: "valid", value: undefined } },
    { kind: "invalid", expected: { kind: "invalid", value: undefined } },
  ] as const)("preserves the $kind check without adding material", ({ kind, expected }) => {
    const check: SiteKeyMaterialCheck = { kind };
    expect(verdictOfCheck({ check })).toStrictEqual(expected);
  });
});

describe("verdictOf", () => {
  it("classifies an absent parse result as absent", () => {
    expect(verdictOf({ parsed: undefined })).toStrictEqual({ kind: "absent" });
  });

  it("preserves the original valid hex without normalization", () => {
    const hex = "aA".repeat(32);
    expect(verdictOf({ parsed: { ok: true, hex } })).toStrictEqual({ kind: "valid", value: hex });
  });

  it.each(["empty", "not-hex", "odd-length", "too-short"] as const)("preserves the %s rejection", (reason) => {
    expect(verdictOf({ parsed: { ok: false, reason, hexDigits: 0 } })).toStrictEqual({ kind: "invalid", value: reason });
  });
});

const hex = "aa".repeat(32);
// Pinned decoded-byte fingerprint, independent of the predicate under test.
const fingerprint = "e0e77a507412";

describe("matchesFingerprint", () => {
  it.each([
    { name: "missing material", parsed: undefined, fingerprint, expected: false },
    { name: "invalid material", parsed: { ok: false, reason: "not-hex", hexDigits: 3 }, fingerprint, expected: false },
    { name: "missing stamp", parsed: { ok: true, hex }, fingerprint: undefined, expected: false },
    { name: "different stamp", parsed: { ok: true, hex }, fingerprint: "000000000000", expected: false },
    { name: "matching stamp", parsed: { ok: true, hex }, fingerprint, expected: true },
    { name: "equivalent uppercase bytes", parsed: { ok: true, hex: hex.toUpperCase() }, fingerprint, expected: true },
  ] as const)("returns $expected for $name", ({ parsed, fingerprint: stamp, expected }) => {
    expect(matchesFingerprint({ parsed, fingerprint: stamp })).toBe(expected);
  });
});
