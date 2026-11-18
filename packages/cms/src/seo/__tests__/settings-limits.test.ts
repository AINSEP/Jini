import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESCRIPTION_MAX_LENGTH,
  DEFAULT_OG_IMAGE_MAX_LENGTH,
  MAX_ROBOTS_RULES,
  MAX_RULE_PATH_ENTRIES,
  TITLE_TEMPLATE_MAX_LENGTH,
  TWITTER_SITE_MAX_LENGTH,
} from "../settings-limits.js";

describe("seo settings limits", () => {
  it("allows at most 50 robots rules, each with at most 100 path entries", () => {
    expect(MAX_ROBOTS_RULES).toBe(50);
    expect(MAX_RULE_PATH_ENTRIES).toBe(100);
  });

  it("bounds the text settings", () => {
    expect(TITLE_TEMPLATE_MAX_LENGTH).toBe(500);
    expect(DEFAULT_DESCRIPTION_MAX_LENGTH).toBe(500);
    expect(DEFAULT_OG_IMAGE_MAX_LENGTH).toBe(2048);
    expect(TWITTER_SITE_MAX_LENGTH).toBe(100);
  });
});
