import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { siteSchemaName } from "../copy-engine.js";

/** L2 §4 copy-engine: the schema slug collapses runs, trims edge underscores, stays lossless only
 *  for the safe alphabet, and the 63-byte boundary is exact (63 plain, 64 hashed). */
const naming = { schemaPrefix: "site_", defaultSchema: "public" } as never;
const hash = (site: string) => createHash("sha256").update(site).digest("hex").slice(0, 8);
const name = (site: string) => siteSchemaName({ site, naming });

describe("siteSchemaName", () => {
  it.each([
    ["My Site", "site_my_site"],
    ["a--b__c..d  e", "site_a_b_c_d_e"],
    ["__edge__", "site_edge"],
    ["-lead.trail-", "site_lead_trail"],
    ["ABC123", "site_abc123"],
  ])("lossless %j → %j", (site, expected) => {
    expect(name(site)).toBe(expected);
  });

  it("exactly 63 bytes stays plain; 64 is cut and hashed", () => {
    const fits = "a".repeat(63 - "site_".length);
    expect(name(fits)).toBe(`site_${fits}`);
    expect(name(fits).length).toBe(63);
    const over = `${fits}b`;
    const hashed = name(over);
    expect(hashed).toBe(`site_${over.slice(0, 63 - 5 - 9)}_${hash(over)}`);
    expect(hashed.length).toBe(63);
  });

  it.each(["café", "a/b", "emoji 🙂", "x:y"])("non-lossless %j appends the full-name hash", (site) => {
    const slug = site.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    expect(name(site)).toBe(`site_${slug}_${hash(site)}`);
  });

  it.each(["", "!!!", "___"])("an empty slug %j becomes prefix + hash only", (site) => {
    expect(name(site)).toBe(`site_${hash(site)}`);
  });

  it("distinct lossy names never collide", () => {
    expect(name("a/b")).not.toBe(name("a:b"));
    expect(name("a/b")).not.toBe(name("a_b"));
  });

  it("a cut that ends on underscores trims them before the hash", () => {
    const site = `${"a".repeat(48)} ${"b".repeat(20)}`;
    const result = name(site);
    expect(result).toBe(`site_${"a".repeat(48)}_${hash(site)}`);
  });
});
