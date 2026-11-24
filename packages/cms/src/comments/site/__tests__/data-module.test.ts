import { expect, test } from "vitest";

import { commentsDataModule } from "../types.js";

/** @file The comments data-module declaration carries the host's provenance and the two plugin tables. */

test("commentsDataModule stamps the host-supplied provenance and declares the comments + moderation tables", () => {
  const provenance = { sourceUrl: "builtin://comments", publisher: "host-core" };
  const decl = commentsDataModule({ provenance });
  expect(decl.provenance).toBe(provenance);
  expect(decl.pluginId).toBe("comments");
  expect(decl.pluginTier).toBe("tier-2");
  expect(decl.tables.map((table) => table.name)).toHaveLength(2);
});
