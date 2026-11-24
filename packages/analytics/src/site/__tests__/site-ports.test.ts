import { expect, test } from "vitest";

import { analyticsAgentToolCatalog } from "../agent-tools.js";
import {
  AnalyticsDisabledError,
  AnalyticsPiiRejectedError,
  AnalyticsValidationError,
  AnalyticsWorkspaceUnresolvedError,
} from "../ports.js";
import { AnalyticsPiiRejectedError as PackageAnalyticsPiiRejectedError } from "../../ports.js";

/**
 * @file Characterization of the analytics site seams moved from the host: the agent tool catalog
 * (read-only, permission-gated, bounded window) and the empty error subclasses hosts match with
 * `instanceof`.
 */

test("the recent-hits catalog entry is read-only, gated on analytics.read and bounds its window", () => {
  expect(analyticsAgentToolCatalog).toHaveLength(1);
  const [tool] = analyticsAgentToolCatalog;
  if (tool === undefined) throw new Error("catalog is empty");
  expect(tool.name).toBe("analytics_list_recent_hits");
  expect(tool.sideEffects).toBe("none");
  expect(tool.authorization).toEqual({ permission: "analytics.read" });
  expect(tool.inputSchema.additionalProperties).toBe(false);
  expect(tool.inputSchema.properties.limit).toEqual({ type: "integer", minimum: 1, maximum: 500, clamp: true, default: 100 });
  expect(tool.inputSchema.properties.summarize).toEqual({ type: "boolean", default: false });
});

test("each site error is its own Error subclass, distinct from the package ingest refusal", () => {
  const classes = [AnalyticsDisabledError, AnalyticsValidationError, AnalyticsPiiRejectedError, AnalyticsWorkspaceUnresolvedError];
  for (const ErrorClass of classes) {
    const error = new ErrorClass("boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
    for (const Other of classes) if (Other !== ErrorClass) expect(error).not.toBeInstanceOf(Other);
  }
  expect(new AnalyticsPiiRejectedError("x")).not.toBeInstanceOf(PackageAnalyticsPiiRejectedError);
});
