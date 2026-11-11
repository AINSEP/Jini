import { expect, test } from "vitest";
import { RECOVERY_LIMIT, RECOVERY_WINDOW_MS, RUN_STALENESS_MS } from "../policies.js";

// Stryker L5 (2026-10-25): `5 * 60_000` → `5 / 60_000` survived. Recovery budgets are product
// policy (how long and how often a dead answer is retried); pin them as literals.
test("recovery budgets: 3 attempts, a 5-minute window, 30-minute staleness", () => {
  expect({ RECOVERY_LIMIT, RECOVERY_WINDOW_MS, RUN_STALENESS_MS }).toEqual({ RECOVERY_LIMIT: 3, RECOVERY_WINDOW_MS: 300_000, RUN_STALENESS_MS: 1_800_000 });
});
