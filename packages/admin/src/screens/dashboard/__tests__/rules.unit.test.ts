import { describe, expect, it } from "vitest";

import { activeThemeName, activityRowHref, commentsStatMeta, mergeRecent, pagesStatMeta, postsStatMeta, shouldShowDefaultPasswordBanner, shouldShowSiteKeyBanner, siteKeyBannerCopy } from "../rules.js";
import type { DashboardActivityRow } from "../dashboard-view.types.js";

/**
 * @file Direct coverage for the stat-card meta formatters extracted out of `Dashboard`'s own body
 * (complexity-ceiling pass) — `mergeRecent`/`activityRowHref` already have their own header
 * comments and stay covered transitively through `Dashboard.unit.test.tsx`'s rendering tests, so
 * this file only adds the three new pure functions.
 *
 * Identity translator, same convention `pages/__tests__/rules.unit.test.ts` uses — asserts against
 * the English key template (with `{count}` substituted) rather than a real locale's copy. A
 * browser sweep (2026-09-22) found these three functions returning hardcoded English regardless of
 * locale; they now take a `Translate` the same way `pages/rules.ts`'s column-sort labels do.
 * Now: this package also pins `mergeRecent`/`activityRowHref` directly, since the host's end-to-end
 * screen test covers them only transitively; the `pages` rules named above are the host's.
 */
const identityT = (key: string): string => key;

describe("postsStatMeta", () => {
  it("is blank while published is still pending (null)", () => {
    expect(postsStatMeta({ published: null, t: identityT })).toBe("");
  });

  it("reports the published count once known, including zero", () => {
    expect(postsStatMeta({ published: 0, t: identityT })).toBe("0 published");
    expect(postsStatMeta({ published: 5, t: identityT })).toBe("5 published");
  });
});

describe("pagesStatMeta", () => {
  it("is blank while drafts is still pending (null)", () => {
    expect(pagesStatMeta({ drafts: null, t: identityT })).toBe("");
  });

  it("singularizes 'draft' for exactly one", () => {
    expect(pagesStatMeta({ drafts: 1, t: identityT })).toBe("1 draft");
  });

  it("pluralizes for zero and for more than one", () => {
    expect(pagesStatMeta({ drafts: 0, t: identityT })).toBe("0 drafts");
    expect(pagesStatMeta({ drafts: 3, t: identityT })).toBe("3 drafts");
  });
});

describe("commentsStatMeta", () => {
  it("reads 'nothing to review' only when the pending count is exactly 0", () => {
    expect(commentsStatMeta({ pendingCount: 0, t: identityT })).toBe("nothing to review");
  });

  it("reads 'awaiting moderation' for a positive pending count", () => {
    expect(commentsStatMeta({ pendingCount: 4, t: identityT })).toBe("awaiting moderation");
  });

  it("reads 'awaiting moderation' while still pending (null) — preserved, not fixed, by this extraction", () => {
    expect(commentsStatMeta({ pendingCount: null, t: identityT })).toBe("awaiting moderation");
  });
});

describe("stat meta translators", () => {
  it("translates every template and substitutes counts after translation", () => {
    const markerT = (key: string) => `[${key}]`;
    expect(postsStatMeta({ published: 0, t: markerT })).toBe("[0 published]");
    expect(postsStatMeta({ published: 5, t: markerT })).toBe("[5 published]");
    expect(pagesStatMeta({ drafts: 1, t: markerT })).toBe("[1 draft]");
    expect(pagesStatMeta({ drafts: 0, t: markerT })).toBe("[0 drafts]");
    expect(pagesStatMeta({ drafts: 3, t: markerT })).toBe("[3 drafts]");
    expect(commentsStatMeta({ pendingCount: 0, t: markerT })).toBe("[nothing to review]");
    expect(commentsStatMeta({ pendingCount: 4, t: markerT })).toBe("[awaiting moderation]");
    expect(commentsStatMeta({ pendingCount: null, t: markerT })).toBe("[awaiting moderation]");
  });
});

describe("shouldShowDefaultPasswordBanner", () => {
  it("shows when the caller is on the default and hasn't dismissed", () => {
    expect(shouldShowDefaultPasswordBanner({ usesDefault: true, dismissed: false })).toBe(true);
  });

  it("hides once dismissed, even if still on the default", () => {
    expect(shouldShowDefaultPasswordBanner({ usesDefault: true, dismissed: true })).toBe(false);
  });

  it("hides when the caller is not on the default", () => {
    expect(shouldShowDefaultPasswordBanner({ usesDefault: false, dismissed: false })).toBe(false);
  });

  it("hides while the status is unknown (null) — fail closed, not open", () => {
    expect(shouldShowDefaultPasswordBanner({ usesDefault: null, dismissed: false })).toBe(false);
  });
});

describe("shouldShowSiteKeyBanner (site-key plan §A.6)", () => {
  it("shows for missing-with-data — a site key can't be found but this site has saved credentials", () => {
    expect(shouldShowSiteKeyBanner({ state: "missing-with-data" })).toBe(true);
  });

  it("shows for mismatch — the active key's fingerprint disagrees with the site's stamped one", () => {
    expect(shouldShowSiteKeyBanner({ state: "mismatch" })).toBe(true);
  });

  it("shows for invalid — a source was found but fails hex validation", () => {
    expect(shouldShowSiteKeyBanner({ state: "invalid" })).toBe(true);
  });

  it("hides for active — the normal case", () => {
    expect(shouldShowSiteKeyBanner({ state: "active" })).toBe(false);
  });

  it("hides for plain missing — a fresh site before its first key is minted at boot", () => {
    expect(shouldShowSiteKeyBanner({ state: "missing" })).toBe(false);
  });

  it("hides while the state is unknown (undefined) — fail closed, same default shouldShowDefaultPasswordBanner uses", () => {
    expect(shouldShowSiteKeyBanner({ state: undefined })).toBe(false);
  });
});

describe("siteKeyBannerCopy (site-key plan §A.6)", () => {
  it("has non-empty, distinct copy for each of the three bannered states", () => {
    const missingWithData = siteKeyBannerCopy({ state: "missing-with-data", t: identityT });
    const mismatch = siteKeyBannerCopy({ state: "mismatch", t: identityT });
    const invalid = siteKeyBannerCopy({ state: "invalid", t: identityT });
    expect(missingWithData.length).toBeGreaterThan(0);
    expect(mismatch.length).toBeGreaterThan(0);
    expect(invalid.length).toBeGreaterThan(0);
    expect(new Set([missingWithData, mismatch, invalid]).size).toBe(3);
  });

  it("returns empty string for a non-bannered state — Dashboard.tsx never renders it for these", () => {
    expect(siteKeyBannerCopy({ state: "active", t: identityT })).toBe("");
    expect(siteKeyBannerCopy({ state: "missing", t: identityT })).toBe("");
    expect(siteKeyBannerCopy({ state: undefined, t: identityT })).toBe("");
  });
});

describe("activeThemeName", () => {
  it("names the active theme by its display name, falling back to the id", () => {
    const settings = { activeThemeId: "starter" };
    expect(activeThemeName({ settings, availableThemes: [{ id: "starter", name: "Starter" }] })).toBe("Starter");
    expect(activeThemeName({ settings, availableThemes: [{ id: "starter" }] })).toBe("starter");
    expect(activeThemeName({ settings })).toBe("starter");
  });
});

function row(overrides: Partial<DashboardActivityRow>): DashboardActivityRow {
  return { id: "r", kind: "post", slug: "r", title: "R", status: "draft", updatedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

describe("mergeRecent", () => {
  it("merges both sources newest-first, interleaving across them", () => {
    const prev = [row({ id: "post-1", updatedAt: "2026-07-30T09:00:00.000Z" }), row({ id: "post-2", updatedAt: "2026-07-27T09:00:00.000Z" })];
    const incoming = [row({ id: "page-1", kind: "page", updatedAt: "2026-07-31T09:00:00.000Z" }), row({ id: "page-2", kind: "page", updatedAt: "2026-07-28T09:00:00.000Z" })];
    expect(mergeRecent({ prev, incoming }).map((r) => r.id)).toEqual(["page-1", "post-1", "page-2", "post-2"]);
  });

  it("dedupes on id, the incoming row winning", () => {
    const merged = mergeRecent({ prev: [row({ id: "same", title: "Old" })], incoming: [row({ id: "same", title: "New" })] });
    expect(merged.map((r) => r.title)).toEqual(["New"]);
  });

  it("treats a null prev as empty", () => {
    expect(mergeRecent({ prev: null, incoming: [row({ id: "only" })] }).map((r) => r.id)).toEqual(["only"]);
  });
});

describe("activityRowHref", () => {
  it("sends a post row to its slug and a page row to the Pages list", () => {
    expect(activityRowHref(row({ id: "p1", kind: "post", slug: "post-one" }))).toBe("/admin/posts/post-one");
    expect(activityRowHref(row({ id: "pg1", kind: "page", slug: "page-one" }))).toBe("/admin/pages");
  });
});
