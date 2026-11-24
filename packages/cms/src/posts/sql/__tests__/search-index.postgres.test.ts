import assert from "node:assert/strict";
import { test } from "vitest";

import { foldForIndex } from "../search-index.postgres.js";

// F1.1/F4.3: replacing NFKD with NFC, or dropping separator normalization, changes these literals.
test("Postgres indexing folds combining marks, compatibility characters and punctuation into searchable words", () => {
  assert.equal(foldForIndex({ text: "  CAFÉ́—crème/brûlée!  " }), "CAFE creme brulee");
  assert.equal(foldForIndex({ text: "Ｆｕｌｌ １２３ ﬃ 日本語" }), "Full 123 ffi 日本語");
  assert.equal(foldForIndex({ text: "!?\t\n" }), "");
});
