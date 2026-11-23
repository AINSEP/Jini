import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createExportRunner, type ExportRunReportLike } from "../export-run.js";

/** The single-flight contract: one runner = one slot shared by the export route, the trigger tool
 *  and the read-only diagnostic. Cases mirror the host's pin, run here against the factory. */
const tick = () => new Promise<void>((done) => setImmediate(done));
function deps() {
  let calls = 0;
  return { exportOutputRootDir: "/tmp/runner-export", clock: { nowMs: () => Date.parse(++calls === 1 ? "2026-10-01T10:00:00.000Z" : "2026-10-01T10:01:00.000Z") } };
}
const emptyReport = (): ExportRunReportLike => ({ routes: { succeeded: [], failed: [] }, assets: { succeeded: [], failed: [] }, skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [] });
const alreadyRunning = expect.objectContaining({ code: "ALREADY_RUNNING", message: expect.stringMatching(/an export is already running/) });

describe("createExportRunner", () => {
  it("starts idle, reports running immediately and settles to a completed snapshot with failure detail", async () => {
    const runner = createExportRunner({});
    expect(runner.getExportRunSnapshot()).toEqual({ status: "idle", startedAtIso: null, finishedAtIso: null, outputDir: null });
    let resolve!: (value: ExportRunReportLike) => void;
    const calls: unknown[] = [];
    const d = deps();
    const running = runner.startExportRun({ routeDeps: d, runExportSite: (options) => { calls.push(options); return new Promise((done) => { resolve = done; }); }, clean: false }, { basePath: "/docs" });
    expect(running).toEqual({ status: "running", startedAtIso: "2026-10-01T10:00:00.000Z", finishedAtIso: null, outputDir: "/tmp/runner-export" });
    expect(calls).toEqual([{ routeDeps: d, outputDir: "/tmp/runner-export", clean: false, basePath: "/docs" }]);
    resolve({ ...emptyReport(), assets: { succeeded: ["logo"], failed: [{ url: "/missing.png", reason: "404" }] }, basePath: "/docs" });
    await tick();
    expect(runner.getExportRunSnapshot()).toEqual({
      status: "completed", startedAtIso: "2026-10-01T10:00:00.000Z", finishedAtIso: "2026-10-01T10:01:00.000Z", outputDir: "/tmp/runner-export", basePath: "/docs", ok: false,
      counts: { routesSucceeded: 0, routesFailed: 0, assetsSucceeded: 1, assetsFailed: 1 },
      failedRoutes: [], failedAssets: [{ url: "/missing.png", reason: "404" }], skippedManifestEntries: [], unreferencedThemeFiles: [], droppedReferences: [],
    });
  });

  it("records a rejected export as errored with its message and tells the settle hook and tracker", async () => {
    const runner = createExportRunner({});
    const settled: unknown[] = [];
    const captured: unknown[] = [];
    const tracker = { capture: async (...args: unknown[]) => { captured.push(args); } };
    runner.startExportRun({ routeDeps: deps(), runExportSite: async () => { throw new Error("disk full"); }, clean: true }, { onSettled: (s) => settled.push(s), productEvent: { tracker: tracker as never, userId: "u1", operationId: "op1", source: "admin" } });
    await tick();
    expect(runner.getExportRunSnapshot()).toMatchObject({ status: "errored", error: "disk full", finishedAtIso: "2026-10-01T10:01:00.000Z" });
    expect(settled).toEqual([{ status: "errored" }]);
    expect(captured).toEqual([[{ name: "site_exported", userId: "u1" }, { properties: { outcome: "errored", operationId: "op1", eventId: "export:op1", source: "admin" } }]]);
  });

  it("refuses a trigger and a diagnostic while a run is in flight, then frees the slot", async () => {
    const runner = createExportRunner({});
    let resolve!: (value: ExportRunReportLike) => void;
    runner.startExportRun({ routeDeps: deps(), runExportSite: () => new Promise((done) => { resolve = done; }), clean: false });
    let engineCalls = 0;
    expect(() => runner.assertExportNotRunning({})).toThrow(alreadyRunning);
    await expect(runner.diagnoseStaticExport({ routeDeps: deps(), runExportSite: async () => { engineCalls++; return emptyReport(); } })).rejects.toThrow(alreadyRunning);
    expect(engineCalls).toBe(0);
    resolve(emptyReport());
    await tick();
    expect(runner.getExportRunSnapshot().status).toBe("completed");
    expect(() => runner.assertExportNotRunning({})).not.toThrow();
  });

  it("a diagnostic reserves the slot, removes its temp output and restores the prior snapshot, even on failure", async () => {
    const runner = createExportRunner({});
    const before = runner.getExportRunSnapshot();
    let outputDir = "";
    let refusedDuring = false;
    const result = await runner.diagnoseStaticExport({ routeDeps: deps(), runExportSite: async (options) => {
      outputDir = options.outputDir;
      expect(runner.getExportRunSnapshot()).toMatchObject({ status: "running", outputDir });
      try { runner.assertExportNotRunning({}); } catch { refusedDuring = true; }
      return emptyReport();
    } });
    expect(refusedDuring).toBe(true);
    expect(result).toMatchObject({ ok: true, counts: { routesSucceeded: 0, routesFailed: 0, assetsSucceeded: 0, assetsFailed: 0 } });
    expect(existsSync(outputDir)).toBe(false);
    expect(runner.getExportRunSnapshot()).toBe(before);
    await expect(runner.diagnoseStaticExport({ routeDeps: deps(), runExportSite: async () => { throw new Error("engine down"); } })).rejects.toThrow("engine down");
    expect(runner.getExportRunSnapshot()).toBe(before);
    expect(() => runner.assertExportNotRunning({})).not.toThrow();
  });

  it("two runners own independent slots", () => {
    const first = createExportRunner({});
    const second = createExportRunner({});
    first.startExportRun({ routeDeps: deps(), runExportSite: () => new Promise(() => {}), clean: false });
    expect(() => first.assertExportNotRunning({})).toThrow(alreadyRunning);
    expect(() => second.assertExportNotRunning({})).not.toThrow();
    expect(second.getExportRunSnapshot().status).toBe("idle");
  });
});
