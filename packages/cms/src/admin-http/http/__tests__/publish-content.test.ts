import { describe, expect, it } from "vitest";

import type { BackstopAuditPort } from "../../../publish/transfer/index.js";
import { readBackstopApplyReport, toPublishContentReportDto, type PublishContentReportSource } from "../publish-content.js";

/**
 * @file Unit tests for the publish-content HTTP DTO helpers: the report whitelist mapper and the
 * advisory apply-report read the import `execute` reply spreads in.
 */

const retires = { entityType: "post", entityId: "p-old", entityLabel: "Old", hash: "h1" };

function sourceReport(overrides: Partial<PublishContentReportSource["rows"][number]> = {}): PublishContentReportSource {
  return {
    refused: false,
    refusalReason: null,
    applyOrder: ["media", "post"],
    rows: [{
      entityType: "post", entityId: "p1", entityLabel: "Hello", outcome: "conflict", writes: true,
      reason: "changed on live", canOverwrite: true, retires, ...overrides,
    }],
  };
}

describe("toPublishContentReportDto", () => {
  it("copies exactly the whitelisted fields and nothing a domain row adds", () => {
    const report = sourceReport();
    const withExtra = { ...report, backstop: { mode: "backstop" }, rows: [{ ...report.rows[0], sourceReplacement: { secret: 1 } }] };
    const dto = toPublishContentReportDto({ report: withExtra as PublishContentReportSource });
    expect(dto).toEqual({
      refused: false, refusalReason: null, applyOrder: ["media", "post"],
      rows: [{ entityType: "post", entityId: "p1", entityLabel: "Hello", outcome: "conflict", writes: true, reason: "changed on live", canOverwrite: true, retires }],
    });
    expect(Object.keys(dto)).toEqual(["refused", "refusalReason", "applyOrder", "rows"]);
    expect(dto.applyOrder).not.toBe(report.applyOrder);
  });

  it("omits the referencedBy key entirely when the planner row has none", () => {
    const dto = toPublishContentReportDto({ report: sourceReport() });
    expect("referencedBy" in (dto.rows[0] as object)).toBe(false);
  });

  it("maps referencedBy holders field by field when present", () => {
    const holder = { entityType: "menu", entityId: "m1", entityLabel: "Main", referencedId: "p-old", extra: "dropped" };
    const dto = toPublishContentReportDto({ report: sourceReport({ referencedBy: [holder] }) });
    expect(dto.rows[0]?.referencedBy).toEqual([{ entityType: "menu", entityId: "m1", entityLabel: "Main", referencedId: "p-old" }]);
  });

  it("keeps a refused report's refusal fields", () => {
    const dto = toPublishContentReportDto({ report: { refused: true, refusalReason: "format too new", applyOrder: [], rows: [] } });
    expect(dto).toEqual({ refused: true, refusalReason: "format too new", applyOrder: [], rows: [] });
  });
});

function audit(required: { ready?: () => Promise<boolean>; get?: () => Promise<unknown> }): BackstopAuditPort {
  return { ready: required.ready ?? (async () => true), get: required.get ?? (async () => null) } as unknown as BackstopAuditPort;
}

const destinationLog = { direction: "destination", details: { report: sourceReport() } };

describe("readBackstopApplyReport", () => {
  it("returns the mapped report from a ready audit's destination record, read by workspace and run id", async () => {
    const reads: unknown[] = [];
    const port = audit({ get: async (...args: unknown[]) => { reads.push(args[0]); return destinationLog; } });
    const result = await readBackstopApplyReport({ audit: port, workspaceId: "ws-1", runId: "run-1" });
    expect(result).toEqual({ report: toPublishContentReportDto({ report: sourceReport() }) });
    expect(reads).toEqual([{ workspaceId: "ws-1", id: "run-1" }]);
  });

  it.each([
    ["no audit port", undefined],
    ["an audit that is not ready", audit({ ready: async () => false })],
    ["no record", audit({ get: async () => null })],
    ["a source-side record", audit({ get: async () => ({ direction: "source", details: { report: sourceReport() } }) })],
    ["a destination record without a report", audit({ get: async () => ({ direction: "destination", details: {} }) })],
    ["a failing read", audit({ get: async () => { throw new Error("db down"); } })],
    ["a failing readiness probe", audit({ ready: async () => { throw new Error("db down"); } })],
  ])("adds nothing and never throws for %s", async (_label, port) => {
    await expect(readBackstopApplyReport({ audit: port, workspaceId: "ws-1", runId: "run-1" })).resolves.toEqual({});
  });
});
