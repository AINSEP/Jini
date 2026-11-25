import assert from "node:assert/strict";
import { test } from "vitest";

import type { Logger } from "@jini-ai/core/primitives";

import { createSiteTitleFailureReporter, createSiteTitlePreservationSummaryReporter } from "../site-title-reporter.js";

/**
 * @file The host's site-title reporters log fixed text plus safe fields only, and the preservation
 * summary keeps its counts-only line.
 */

function recordingLogger(lines: unknown[]): Logger {
  const record = (level: string) => (required: { message: string }, optional?: { meta?: Record<string, unknown>; error?: unknown }) => { lines.push({ level, required, optional }); };
  return { info: record("info"), warn: record("warn"), error: record("error") };
}

test("a site-title failure logs the event's fixed text with workspaceId and errorClass, and omits an absent errorClass", () => {
  const lines: unknown[] = [];
  const report = createSiteTitleFailureReporter({ logger: recordingLogger(lines) });
  report({ message: "resolveSiteTitle: falling back to the legacy title", workspaceId: "ws-1", errorClass: "Error" });
  report({ message: "preserveLegacySiteTitles: workspace stays pending, pin failed: core.site/title is not registered", workspaceId: "ws-2" });
  assert.deepEqual(lines, [
    { level: "error", required: { message: "resolveSiteTitle: falling back to the legacy title" }, optional: { meta: { workspaceId: "ws-1", errorClass: "Error" } } },
    { level: "error", required: { message: "preserveLegacySiteTitles: workspace stays pending, pin failed: core.site/title is not registered" }, optional: { meta: { workspaceId: "ws-2" } } },
  ]);
});

test("a preservation run logs its pinned/skipped/failed counts as info", () => {
  const lines: unknown[] = [];
  createSiteTitlePreservationSummaryReporter({ logger: recordingLogger(lines) })({ pinnedWorkspaceIds: ["a", "b"], skippedWorkspaceIds: [], failedWorkspaceIds: ["c"] });
  assert.deepEqual(lines, [{ level: "info", required: { message: "preserveLegacySiteTitles: pinned=2 skipped=0 failed=1" }, optional: undefined }]);
});
