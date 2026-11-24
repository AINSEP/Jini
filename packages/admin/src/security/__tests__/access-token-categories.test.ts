import { describe, expect, it } from "vitest";
import {
  accessTokenCategoryLabel, accessTokenCategoryMatches, sortAccessTokenGroups,
  type AccessTokenCategoryInfo, type AccessTokenGroupSortInput,
} from "../access-token-categories.js";
import type { AccessTokenRowCategoryId } from "../access-token-rows.js";

const CATEGORIES: readonly AccessTokenCategoryInfo[] = [
  { id: "all", label: "Everything" },
  { id: "source-control", label: "Repos" },
  { id: "hosting", label: "Hosts" },
  { id: "media", label: "Pictures" },
  { id: "ai", label: "Models" },
  { id: "ops", label: "Operations" },
  { id: "general", label: "Misc" },
];

describe("accessTokenCategoryLabel", () => {
  it("reads the label the host injected for the row category, never a built-in English one", () => {
    expect(accessTokenCategoryLabel({ id: "general", categories: CATEGORIES })).toBe("Misc");
    expect(accessTokenCategoryLabel({ id: "ai", categories: CATEGORIES })).toBe("Models");
  });

  it("falls back to the id itself when the host's table omits that category", () => {
    expect(accessTokenCategoryLabel({ id: "ai", categories: CATEGORIES.filter((c) => c.id !== "ai") })).toBe("ai");
  });
});

describe("accessTokenCategoryMatches", () => {
  it("'all' matches every row category", () => {
    expect(accessTokenCategoryMatches({ rowCategory: "hosting", activeCategory: "all" })).toBe(true);
    expect(accessTokenCategoryMatches({ rowCategory: "ai", activeCategory: "all" })).toBe(true);
  });

  it("a specific filter matches only its own bucket", () => {
    expect(accessTokenCategoryMatches({ rowCategory: "hosting", activeCategory: "hosting" })).toBe(true);
    expect(accessTokenCategoryMatches({ rowCategory: "hosting", activeCategory: "media" })).toBe(false);
  });
});

describe("sortAccessTokenGroups", () => {
  type Group = AccessTokenGroupSortInput & { label: string };
  /** `savedCount` stands in for `rows.length` — the sort only ever reads its length. */
  function group(label: string, category: AccessTokenRowCategoryId, savedCount: number): Group {
    return { info: { category, label }, rows: Array.from({ length: savedCount }), label };
  }
  const labelsOf = (groups: readonly Group[], categories = CATEGORIES) => sortAccessTokenGroups({ groups, categories }).map((g) => g.label);

  it("puts every group with a saved row before every group with none, regardless of input order", () => {
    const groups = [group("Netlify", "hosting", 0), group("GitHub", "source-control", 1), group("Vercel", "hosting", 0), group("GitLab", "source-control", 1)];
    const result = sortAccessTokenGroups({ groups, categories: CATEGORIES });
    expect(result.slice(0, 2).every((g) => g.rows.length > 0)).toBe(true);
    expect(result.slice(2).every((g) => g.rows.length === 0)).toBe(true);
  });

  it("orders each tier by the injected category order, skipping 'all'", () => {
    const groups = [group("Cloudinary", "media", 1), group("OpenAI", "ai", 1), group("GitHub", "source-control", 1), group("Ops Co", "ops", 1), group("Custom Co", "general", 1), group("Vercel", "hosting", 1)];
    expect(labelsOf(groups)).toEqual(["GitHub", "Vercel", "Cloudinary", "OpenAI", "Ops Co", "Custom Co"]);
  });

  it("follows a host's different chip order, since the order is injected rather than built in", () => {
    const reordered = [CATEGORIES[0]!, CATEGORIES[3]!, CATEGORIES[1]!, CATEGORIES[2]!, CATEGORIES[4]!, CATEGORIES[5]!, CATEGORIES[6]!];
    const groups = [group("GitHub", "source-control", 1), group("Cloudinary", "media", 1)];
    expect(labelsOf(groups, reordered)).toEqual(["Cloudinary", "GitHub"]);
  });

  it("orders the unsaved tier independently of the saved tier", () => {
    const groups = [group("Vercel", "hosting", 0), group("GitHub", "source-control", 1), group("Bitbucket", "source-control", 0)];
    expect(labelsOf(groups)).toEqual(["GitHub", "Bitbucket", "Vercel"]);
  });

  it("sorts alphabetically within a category, case-insensitively and ignoring surrounding whitespace", () => {
    const groups = [group("  zeta", "hosting", 1), group("Alpha", "hosting", 1), group("beta", "hosting", 1)];
    expect(labelsOf(groups)).toEqual(["Alpha", "beta", "  zeta"]);
  });

  it("returns a new array and leaves the caller's untouched", () => {
    const groups = [group("B", "hosting", 0), group("A", "hosting", 1)];
    const copy = [...groups];
    const sorted = sortAccessTokenGroups({ groups, categories: CATEGORIES });
    expect(sorted).not.toBe(groups);
    expect(groups).toEqual(copy);
  });

  it("sorts a category the host's table omits after every listed one", () => {
    const groups = [group("Zed", "ai", 1), group("Amp", "hosting", 1)];
    expect(labelsOf(groups, CATEGORIES.filter((c) => c.id !== "ai"))).toEqual(["Amp", "Zed"]);
  });
});
