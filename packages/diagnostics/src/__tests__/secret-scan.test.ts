import { describe, expect, it } from "vitest";
import { scanTextForSecrets } from "../redaction/secrets-only.js";

/**
 * The text scanner moved here from a host's contracts (K5-contracts-core-3). These cases pin the
 * hit shape the host's commit guard prints (pattern name, offset, exact value) and the minimum-length
 * edges, so a scanner drift shows up in this package and not only in a host's guard test.
 */
describe("scanTextForSecrets", () => {
  it("reports each vendor format at its minimum length with its offset and exact value", () => {
    for (const [prefix, length, patternName] of [
      ["gho_", 36, "GitHub OAuth token (gho_)"],
      ["github_pat_", 80, "GitHub fine-grained PAT"],
      ["fm2_", 20, "Fastmail app password (fm2_)"],
    ] as const) {
      const value = prefix + "x".repeat(length);
      expect(scanTextForSecrets({ text: `token="${value}"` })).toEqual([{ patternName, index: 7, value }]);
    }
  });

  it("rejects a run one character shorter than the vendor's minimum", () => {
    expect(scanTextForSecrets({ text: `gho_${"x".repeat(35)}` })).toEqual([]);
    expect(scanTextForSecrets({ text: `fm2_${"x".repeat(19)}` })).toEqual([]);
  });

  it("returns every match, not only the first", () => {
    const a = `gho_${"a".repeat(36)}`;
    const b = `gho_${"b".repeat(36)}`;
    const hits = scanTextForSecrets({ text: `${a} and ${b}` });
    expect(hits.filter((hit) => hit.patternName === "GitHub OAuth token (gho_)").map((hit) => hit.value)).toEqual([a, b]);
  });

  it("finds nothing in plain text", () => {
    expect(scanTextForSecrets({ text: "no credentials here" })).toEqual([]);
  });
});
