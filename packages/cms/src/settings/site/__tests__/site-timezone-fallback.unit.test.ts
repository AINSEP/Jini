import assert from "node:assert/strict";
import { test } from "vitest";

import { getEffective, InMemorySettingsRepo } from "@jini-ai/core/settings";
import type { Logger } from "@jini-ai/core/primitives";
import { resolveSiteTimeZone } from "../site-timezone.js";

import { createSiteTimeZoneFallbackReporter } from "../site-timezone-fallback.js";

/**
 * @file The host's timezone fallback reporter logs fixed text plus safe fields: a repository error
 * that echoes a secret never reaches the log, and the render still gets the creation zone.
 */

test("a failed core.site.timezone read logs fixed text without the error's secret-bearing message", async () => {
  const secret = "postgres://admin:hunter2-SECRET@db.internal/site";
  const lines: unknown[] = [];
  const record = (level: string) => (required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }) => { lines.push({ level, required, optional }); };
  const logger: Logger = { info: record("info"), warn: record("warn"), error: record("error") };
  const failing = new InMemorySettingsRepo();
  failing.findActiveDefinition = async () => { throw new Error(`connect failed for ${secret}`); };

  const zone = await resolveSiteTimeZone(
    { settingsRepo: failing, getEffective, reportFallback: createSiteTimeZoneFallbackReporter({ logger }), creationTimeZone: { read: () => "Asia/Kolkata" } },
    { workspaceId: "ws-1" },
  );

  assert.equal(zone, "Asia/Kolkata");
  assert.deepEqual(lines, [{ level: "error", required: { message: "resolveSiteTimeZone: settings read failed; using the creation zone" }, optional: { meta: { workspaceId: "ws-1", errorClass: "Error" } } }]);
  assert.equal(JSON.stringify(lines).includes("hunter2"), false);
});
